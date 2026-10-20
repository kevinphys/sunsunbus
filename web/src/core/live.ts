// 即時處理：記錄中逐筆推入感測資料，給即時圖表、事件計數與「搖手機測試」用。
// 結束後的正式摘要以 trip.ts 的批次結果為準。
import type { Params } from './params';
import { jerkThreshold } from './params';
import type { EventType, GpsFix, MotionSample, OrientationSample, ProcessedSample, TripEvent } from './types';
import { FrameStage } from './frame';
import { OrientationEstimator, type OrientationEstimate } from './orientation';
import { VehicleStage } from './vehicle';
import { EventDetector, makeGpsLookup } from './events';
import { emptyCounts } from './summary';
import { estimateSampleRate } from './math';
import { signVote } from './trip';

const WARMUP_SAMPLES = 30;
const SIGN_VOTES_NEEDED = 10;

/** 加加速度分布的即時直方圖（0.05 m/s³ 一格），用來估計 P95 */
class Histogram {
  private bins = new Uint32Array(2000);
  count = 0;
  add(x: number) {
    this.bins[Math.min(this.bins.length - 1, Math.max(0, Math.floor(x / 0.05)))]++;
    this.count++;
  }
  percentile(q: number): number {
    const target = (this.count * q) / 100;
    let acc = 0;
    for (let i = 0; i < this.bins.length; i++) {
      acc += this.bins[i];
      if (acc >= target) return (i + 0.5) * 0.05;
    }
    return this.bins.length * 0.05;
  }
}

export class LiveProcessor {
  private warmup: MotionSample[] = [];
  private frame: FrameStage | null = null;
  private veh: VehicleStage | null = null;
  private est: OrientationEstimator;
  private det: EventDetector;
  private hist = new Histogram();
  private gps: GpsFix[] = [];
  private lastMotion: MotionSample | null = null;
  private signVotes = 0;
  private signN = 0;
  private accelSign: 1 | -1 = 1;
  private signFixed = false;

  sampleRateHz = 0;
  events: TripEvent[] = [];
  counts: Record<EventType, number> = emptyCounts();
  last: ProcessedSample | null = null;

  constructor(
    private p: Params,
    private onEvent: (e: TripEvent) => void = () => {},
  ) {
    this.est = new OrientationEstimator(p);
    this.det = new EventDetector(p, makeGpsLookup(this.gps));
  }

  pushOrientation(o: OrientationSample) {
    if (this.signFixed || !this.lastMotion || Math.abs(this.lastMotion.t - o.t) > 200) return;
    const v = signVote(this.lastMotion, o);
    if (v === 0) return;
    this.signVotes += v;
    this.signN++;
    if (this.signN >= SIGN_VOTES_NEEDED) {
      this.signFixed = true;
      this.accelSign = this.signVotes < 0 ? -1 : 1;
      this.frame?.setAccelSign(this.accelSign);
    }
  }

  pushGps(fix: GpsFix) {
    this.gps.push(fix);
    this.est.pushGps(fix);
  }

  pushMotion(m: MotionSample): ProcessedSample[] {
    this.lastMotion = m;
    if (!this.frame) {
      this.warmup.push(m);
      if (this.warmup.length < WARMUP_SAMPLES) return [];
      this.sampleRateHz = estimateSampleRate(this.warmup.map((w) => w.t));
      this.frame = new FrameStage(this.p, this.sampleRateHz, this.accelSign);
      this.veh = new VehicleStage(this.p, this.sampleRateHz);
      const out = this.warmup.map((w) => this.step(w));
      this.warmup = [];
      return out;
    }
    return [this.step(m)];
  }

  private step(m: MotionSample): ProcessedSample {
    const f = this.frame!.push(m);
    const o = this.est.pushFrame(f);
    const s = this.veh!.push(f, o.theta, o.source);
    if (s.stable) this.hist.add(s.jerkMag);
    for (const e of this.det.push(s, this.jerkThreshold())) this.record(e);
    this.last = s;
    return s;
  }

  jerkThreshold(): number {
    const pct = this.hist.count >= this.p.events.jerkMinSamplesForPercentile ? this.hist.percentile(this.p.events.jerkPercentile) : null;
    return jerkThreshold(pct, this.p);
  }

  orientation(): OrientationEstimate | null {
    return this.est.current();
  }

  activeEvents(): EventType[] {
    return this.det.activeTypes();
  }

  finish(): TripEvent[] {
    for (const e of this.det.flush()) this.record(e);
    return this.events;
  }

  private record(e: TripEvent) {
    this.events.push(e);
    this.counts[e.type]++;
    this.onEvent(e);
  }
}
