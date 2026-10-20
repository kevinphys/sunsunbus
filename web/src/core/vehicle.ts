// 階段 C：把水平加速度旋轉到車輛座標，並計算 jerk。
// jerk 先在手機水平基底上差分再旋轉：前進方向估計更新時才不會產生假的 jerk 尖峰。
import type { Params } from './params';
import type { FrameSample, OrientSource, ProcessedSample } from './types';

export class VehicleStage {
  private hist: { t: number; h1: number; h2: number }[] = [];
  private segment = -1;
  private k: number;

  constructor(p: Params, fs: number) {
    this.k = Math.max(1, Math.round(p.jerkWindowSec * fs));
  }

  push(f: FrameSample, theta: number, source: OrientSource): ProcessedSample {
    if (f.segment !== this.segment) {
      this.hist = [];
      this.segment = f.segment;
    }
    this.hist.push({ t: f.t, h1: f.h1, h2: f.h2 });
    if (this.hist.length > this.k + 1) this.hist.shift();

    let j1 = 0;
    let j2 = 0;
    if (this.hist.length === this.k + 1) {
      const old = this.hist[0];
      const dt = (f.t - old.t) / 1000;
      if (dt > 0) {
        j1 = (f.h1 - old.h1) / dt;
        j2 = (f.h2 - old.h2) / dt;
      }
    }

    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return {
      t: f.t,
      aLong: f.h1 * c + f.h2 * s,
      aLat: -f.h1 * s + f.h2 * c,
      aVert: f.v,
      jerkLong: j1 * c + j2 * s,
      jerkLat: -j1 * s + j2 * c,
      jerkMag: Math.hypot(j1, j2),
      stable: f.stable,
      segment: f.segment,
      theta,
      orientSource: source,
    };
  }
}
