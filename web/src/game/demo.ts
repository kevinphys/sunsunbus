// 示範行程：7 個站、6 個站間，開法依序是 盛開、小花、盛開、乾土、盛開（中途拿起手機）、小花。
// 給 ?simulate=1 的展示與單元測試共用。站牌位置取自模擬軌跡上的停靠點，站名是示意。
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

export const DEMO_EXPECTED_LEVELS = ['bloom', 'sprout', 'bloom', 'dry', 'bloom', 'sprout'] as const;

export interface DemoTrip {
  trip: TripInput;
  stops: Stop[];
  durationSec: number;
  /** 各站停靠的中點時間 (s) */
  stopTimes: number[];
}

export function demoTrip(seed = 11): DemoTrip {
  const longs: ((t: number) => number)[] = [];
  const lats: ((t: number) => number)[] = [];
  const lifts: [number, number][] = [];
  const stopTimes = [FIRST_DWELL_SEC / 2];
  let c = FIRST_DWELL_SEC;
  for (const leg of LEGS) {
    const start = c;
    longs.push((t) => pulse(t, start, leg.accelSec, leg.accel));
    const v = leg.accel * (leg.accelSec + RAMP);
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
    const dwell = leg === LEGS[LEGS.length - 1] ? LAST_DWELL_SEC : DWELL_SEC;
    stopTimes.push(c + dwell / 2);
    c += dwell;
  }
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
  const stops = stopTimes.map((st, i) => {
    const g = trip.gps.reduce((best, f) => (Math.abs(f.t - t0 - st * 1000) < Math.abs(best.t - t0 - st * 1000) ? f : best));
    return { id: `demo-${i + 1}`, name: `示範站 ${i + 1}`, lat: g.lat, lon: g.lon };
  });
  return { trip, stops, durationSec, stopTimes };
}
