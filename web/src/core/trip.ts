// 整趟批次處理（結束記錄後的摘要、匯出、Python 對照都用這一版）。
//
// 與即時處理的差別：
// - 先用整趟的 deviceorientation 判斷加速度正負號慣例；
// - 第一輪跑完後，每個校準段改用「該段最終」的前進方向回頭重算（即時版只能用當下的估計）；
// - 高加加速度門檻用整趟分布的百分位。
import type { Params } from './params';
import { jerkThreshold } from './params';
import type { GpsFix, MotionSample, OrientationSample, ProcessedSample, SegmentInfo, TripEvent, TripSummary } from './types';
import { FrameStage } from './frame';
import { OrientationEstimator } from './orientation';
import { VehicleStage } from './vehicle';
import { EventDetector, makeGpsLookup } from './events';
import { computeSummary } from './summary';
import { dot, estimateSampleRate, normalize, upFromOrientation, type Vec3 } from './math';
import { percentile } from './math';

export interface TripInput {
  motion: MotionSample[];
  orientation: OrientationSample[];
  gps: GpsFix[];
}

export interface TripResult {
  samples: ProcessedSample[];
  events: TripEvent[];
  segments: SegmentInfo[];
  accelSign: 1 | -1;
  sampleRateHz: number;
  jerkP95: number | null;
  jerkThreshold: number;
  summary: TripSummary;
}

/**
 * 加速度正負號慣例投票：W3C 規定手機平放時 accelerationIncludingGravity.z ≈ +9.8，
 * 但有些平台相反。用 deviceorientation 的 beta/gamma 算出「向上」方向來比對。
 * 回傳 +1（同向）、−1（相反）或 0（無法判斷）。
 */
export function signVote(m: MotionSample, o: OrientationSample): number {
  if (o.beta === null || o.gamma === null) return 0;
  const u = normalize([m.gx, m.gy, m.gz] as Vec3);
  const d = dot(u, upFromOrientation(o.beta, o.gamma));
  return d > 0.5 ? 1 : d < -0.5 ? -1 : 0;
}

export function detectAccelSign(motion: MotionSample[], orientation: OrientationSample[]): 1 | -1 {
  let votes = 0;
  let j = 0;
  for (const o of orientation) {
    while (j + 1 < motion.length && Math.abs(motion[j + 1].t - o.t) <= Math.abs(motion[j].t - o.t)) j++;
    if (motion.length && Math.abs(motion[j].t - o.t) <= 200) votes += signVote(motion[j], o);
  }
  return votes < 0 ? -1 : 1;
}

export function processTrip(input: TripInput, p: Params): TripResult {
  const motion = [...input.motion].sort((a, b) => a.t - b.t);
  const gps = [...input.gps].sort((a, b) => a.t - b.t);
  const orientation = [...input.orientation].sort((a, b) => a.t - b.t);
  const fs = estimateSampleRate(motion.map((m) => m.t));
  const accelSign = detectAccelSign(motion, orientation);

  // 第一輪：重力、水平面、靜置、前進方向估計
  const frame = new FrameStage(p, fs, accelSign);
  const est = new OrientationEstimator(p);
  const frames = [];
  let gi = 0;
  for (const m of motion) {
    while (gi < gps.length && gps[gi].t <= m.t) est.pushGps(gps[gi++]);
    const f = frame.push(m);
    est.pushFrame(f);
    frames.push(f);
  }
  while (gi < gps.length) est.pushGps(gps[gi++]);
  const segMap = est.finalize();

  // 第二輪：每段用最終方向換算車輛座標
  const veh = new VehicleStage(p, fs);
  const samples = frames.map((f) => {
    const seg = segMap.get(f.segment)!;
    return veh.push(f, seg.theta, seg.source);
  });

  const stableJerk = samples.filter((s) => s.stable).map((s) => s.jerkMag);
  const jerkP95 =
    stableJerk.length >= p.events.jerkMinSamplesForPercentile ? percentile(stableJerk, p.events.jerkPercentile) : null;
  const thr = jerkThreshold(jerkP95, p);

  const det = new EventDetector(p, makeGpsLookup(gps));
  const events: TripEvent[] = [];
  for (const s of samples) events.push(...det.push(s, thr));
  events.push(...det.flush());
  events.sort((a, b) => a.tStart - b.tStart || a.type.localeCompare(b.type));

  const segments: SegmentInfo[] = [...segMap].map(([id, s]) => ({
    id,
    tStart: s.tStart,
    tEnd: s.tEnd,
    theta: s.theta,
    source: s.source,
    quality: s.quality,
  }));

  return {
    samples,
    events,
    segments,
    accelSign,
    sampleRateHz: fs,
    jerkP95,
    jerkThreshold: thr,
    summary: computeSummary(samples, events, gps, p, fs, jerkP95, thr),
  };
}
