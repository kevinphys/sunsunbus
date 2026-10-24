// 示範行程：7 個站、6 個站間，開法依序是 盛開、小花、盛開、乾土、盛開（中途拿起手機）、小花。
// 給 ?simulate=1 的展示與單元測試共用。給了真實站牌時，GPS 沿這 7 站走、站間距離照實際；
// 沒給時站牌放在模擬軌跡的停靠點上（站名是示意，只給測試用）。
import { haversineM } from '../core/math';
import { generateTrip, pulse } from '../core/synthetic';
import type { TripInput } from '../core/trip';
import type { Stop } from './segments';

interface Leg {
  accel: number;
  accelSec: number;
  cruiseSec: number;
  brake: number;
  /** 等速時的額外事件 */
  extra?: { at: number; dur: number; aLong?: number; aLat?: number };
  /** 等速時拿起手機幾秒 */
  liftSec?: number;
}

const LEGS: Leg[] = [
  { accel: 1.0, accelSec: 9, cruiseSec: 18, brake: 0.8 },
  { accel: 1.0, accelSec: 9, cruiseSec: 16, brake: 1.5 },
  { accel: 0.9, accelSec: 10, cruiseSec: 20, brake: 0.8 },
  { accel: 1.9, accelSec: 5, cruiseSec: 12, brake: 2.9 },
  { accel: 1.0, accelSec: 9, cruiseSec: 30, brake: 0.8, liftSec: 6 },
  { accel: 1.0, accelSec: 9, cruiseSec: 16, brake: 0.8, extra: { at: 6, dur: 2.5, aLat: 1.9 } },
];
const DWELL_SEC = 12;
/** 終點站停久一點，留時間按「我下車了」 */
const LAST_DWELL_SEC = 40;
const FIRST_DWELL_SEC = 8;
const RAMP = 0.4;
/** 挑真實站牌時，站間距離要在這個範圍（太近的站會被併掉，太遠跑太久） */
const PICK_GAP_M: [number, number] = [250, 700];

export const DEMO_EXPECTED_LEVELS = ['bloom', 'sprout', 'bloom', 'dry', 'bloom', 'sprout'] as const;

export interface DemoTrip {
  trip: TripInput;
  stops: Stop[];
  durationSec: number;
  /** 各站停靠的中點時間 (s) */
  stopTimes: number[];
}

/** 從一條路線挑 7 個連續、站距適中的站；優先挑終點是「車站」的一段，否則挑最靠近路線中間的一段 */
export function pickDemoStops(stops: Stop[]): Stop[] | null {
  const n = LEGS.length + 1;
  const ok: number[] = [];
  for (let i = 0; i + n <= stops.length; i++) {
    const w = stops.slice(i, i + n);
    if (w.every((s, k) => k === 0 || inRange(haversineM(w[k - 1].lat, w[k - 1].lon, s.lat, s.lon)))) ok.push(i);
  }
  if (!ok.length) return null;
  const mid = (stops.length - n) / 2;
  const i = ok.find((j) => stops[j + n - 1].name.includes('車站')) ?? ok.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return stops.slice(i, i + n);
}
const inRange = (d: number) => d >= PICK_GAP_M[0] && d <= PICK_GAP_M[1];

/** realStops：7 個真實站牌（見 pickDemoStops）。不給就用示意站牌 */
export function demoTrip(seed = 11, realStops?: Stop[]): DemoTrip {
  const real = realStops && realStops.length === LEGS.length + 1 ? realStops : null;
  const longs: ((t: number) => number)[] = [];
  const lats: ((t: number) => number)[] = [];
  const lifts: [number, number][] = [];
  const stopTimes = [FIRST_DWELL_SEC / 2];
  let c = FIRST_DWELL_SEC;
  LEGS.forEach((base, k) => {
    const v = base.accel * (base.accelSec + RAMP);
    // 真實站牌：拉長等速時間，讓這段開的距離等於站距（加速段、煞車段各約 v²/2a）
    const legM = real ? haversineM(real[k].lat, real[k].lon, real[k + 1].lat, real[k + 1].lon) : 0;
    const cruiseSec = real ? Math.max(base.cruiseSec, (legM - (v * v) / (2 * base.accel) - (v * v) / (2 * base.brake)) / v) : base.cruiseSec;
    const leg = { ...base, cruiseSec };
    const start = c;
    longs.push((t) => pulse(t, start, leg.accelSec, leg.accel));
    const cruise = start + leg.accelSec + RAMP;
    if (leg.extra) {
      const ex = leg.extra;
      if (ex.aLong) longs.push((t) => pulse(t, cruise + ex.at, ex.dur, ex.aLong!));
      if (ex.aLat) lats.push((t) => pulse(t, cruise + ex.at, ex.dur, ex.aLat!));
    }
    if (leg.liftSec) lifts.push([cruise + 8, cruise + 8 + leg.liftSec]);
    const brakeStart = cruise + leg.cruiseSec;
    const brakeDur = v / leg.brake - RAMP;
    longs.push((t) => pulse(t, brakeStart, brakeDur, -leg.brake));
    c = brakeStart + brakeDur + RAMP + 1;
    const dwell = k === LEGS.length - 1 ? LAST_DWELL_SEC : DWELL_SEC;
    stopTimes.push(c + dwell / 2);
    c += dwell;
  });
  const durationSec = Math.ceil(c);
  const trip = generateTrip({
    durationSec,
    aLong: (t) => longs.reduce((s, f) => s + f(t), 0),
    aLat: (t) => lats.reduce((s, f) => s + f(t), 0),
    mount: { yawDeg: 10, tiltDeg: 75 },
    handheld: (t) => lifts.some(([a, b]) => t >= a && t <= b),
    seed,
  });
  const t0 = trip.motion[0].t;
  const atStop = stopTimes.map((st) => trip.gps.reduce((bi, f, i) => (Math.abs(f.t - t0 - st * 1000) < Math.abs(trip.gps[bi].t - t0 - st * 1000) ? i : bi), 0));
  if (!real) {
    const stops = atStop.map((gi, i) => ({ id: `demo-${i + 1}`, name: `示範站 ${i + 1}`, lat: trip.gps[gi].lat, lon: trip.gps[gi].lon }));
    return { trip, stops, durationSec, stopTimes };
  }
  // 把模擬軌跡（直線）沿行駛距離搬到真實站牌之間：每個站間按比例內插，停靠點剛好落在站牌上
  const cum = [0];
  for (let i = 1; i < trip.gps.length; i++) {
    const a = trip.gps[i - 1], b = trip.gps[i];
    cum.push(cum[i - 1] + haversineM(a.lat, a.lon, b.lat, b.lon));
  }
  const S = atStop.map((gi) => cum[gi]);
  trip.gps = trip.gps.map((f, i) => {
    const s = cum[i];
    let k = 0;
    while (k < S.length - 2 && s > S[k + 1]) k++;
    const span = S[k + 1] - S[k];
    const u = span > 0 ? Math.min(1, Math.max(0, (s - S[k]) / span)) : 0;
    const a = real[k], b = real[k + 1];
    return { ...f, lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u, heading: null };
  });
  return { trip, stops: real, durationSec, stopTimes };
}
