// 本趟摘要與「平穩分數」。
//
// 平穩分數公式（可在 shared/params.default.json 的 score 區段調整）：
//   加權事件數 W = Σ 權重[類型] × 次數        （預設 急煞 1.5、急加速 1、急轉彎 1、高 jerk 0.5）
//   里程 km     = max(GPS 距離, minKm)；若 GPS 距離 < minKm，改用 max(時長(分) × fallbackKmPerMin, minKm)
//                 （公車平均約 18 km/h；minKm 預設 1 km，避免很短的一趟一個事件就扣到 0 分）
//   分數        = clamp(100 − penaltyPerWeightedEventPerKm × W / km, 0, 100)
// 也就是每公里每一個加權事件扣 10 分。另外輸出 exceedanceRatio（超標時間占比）供分析比較。
import type { Params } from './params';
import type { EventType, GpsFix, ProcessedSample, TripEvent, TripSummary } from './types';
import { EVENT_TYPES } from './types';
import { haversineM } from './math';

/** GPS 里程：只用精度 ≤ 50 m 的定位，並略過換算速度 > 40 m/s 的跳點 */
export function gpsDistanceKm(gps: GpsFix[]): number {
  let d = 0;
  let prev: GpsFix | null = null;
  for (const f of gps) {
    if (f.accuracy > 50) continue;
    if (prev) {
      const seg = haversineM(prev.lat, prev.lon, f.lat, f.lon);
      const dt = (f.t - prev.t) / 1000;
      if (dt > 0 && seg / dt <= 40) d += seg;
    }
    prev = f;
  }
  return d / 1000;
}

export function emptyCounts(): Record<EventType, number> {
  return { hard_brake: 0, hard_accel: 0, sharp_turn: 0, high_jerk: 0 };
}

export function smoothScore(counts: Record<EventType, number>, distanceKm: number, durationSec: number, p: Params) {
  const sc = p.score;
  const km = distanceKm >= sc.minKm ? distanceKm : Math.max((durationSec / 60) * sc.fallbackKmPerMin, sc.minKm);
  let weighted = 0;
  let total = 0;
  for (const t of EVENT_TYPES) {
    weighted += sc.weights[t] * counts[t];
    total += counts[t];
  }
  const score = Math.max(0, Math.min(100, 100 - (sc.penaltyPerWeightedEventPerKm * weighted) / km));
  return { score: Math.round(score * 10) / 10, eventsPerKm: total / km };
}

export function computeSummary(
  samples: ProcessedSample[],
  events: TripEvent[],
  gps: GpsFix[],
  p: Params,
  sampleRateHz: number,
  jerkP95: number | null,
  jerkThr: number,
): TripSummary {
  const e = p.events;
  const durationSec = samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) / 1000 : 0;
  const distanceKm = gpsDistanceKm(gps);
  const counts = emptyCounts();
  for (const ev of events) counts[ev.type]++;

  let stableN = 0;
  let exceedN = 0;
  const peaks = { maxAccel: 0, maxBrake: 0, maxLat: 0, maxJerk: 0 };
  for (const s of samples) {
    if (!s.stable) continue;
    stableN++;
    if (s.aLong > e.accelThreshold || s.aLong < -e.brakeThreshold || Math.abs(s.aLat) > e.turnThreshold) exceedN++;
    peaks.maxAccel = Math.max(peaks.maxAccel, s.aLong);
    peaks.maxBrake = Math.min(peaks.maxBrake, s.aLong);
    peaks.maxLat = Math.max(peaks.maxLat, Math.abs(s.aLat));
    peaks.maxJerk = Math.max(peaks.maxJerk, s.jerkMag);
  }
  const { score, eventsPerKm } = smoothScore(counts, distanceKm, durationSec, p);
  return {
    durationSec,
    distanceKm,
    sampleCount: samples.length,
    sampleRateHz,
    stableRatio: samples.length ? stableN / samples.length : 0,
    counts,
    peaks,
    jerkThreshold: jerkThr,
    jerkP95,
    exceedanceRatio: stableN ? exceedN / stableN : 0,
    eventsPerKm,
    smoothScore: score,
  };
}
