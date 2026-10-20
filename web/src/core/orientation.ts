// 階段 B：估計車輛前進方向（在水平基底 e1/e2 上的角度 theta）。
//
// 優先順序：
// 1. GPS：每兩筆定位之間的速度變化 dv/dt，與同一時段的平均水平加速度 (h1, h2) 配對，
//    前進方向 = (Σh1·d, Σh2·d) 的方向；投影後與 dv/dt 的相關係數 r 夠高才採用。
//    手機加速度計正負號相反時，方向會自動對齊，所以 GPS 校準不受平台差異影響。
// 2. PCA：水平加速度的主軸（公車的加減速通常大於轉彎）。正負號用「速度不會是負的」判斷：
//    把水平加速度積分成速度變化（|h| 小於 deadband 的部分不積分，避免偏差累積），
//    投影到主軸後，正確的方向應該讓速度曲線大多在 0 以上（上車時公車停著，速度從 0 開始）。
//    比較 max(V) 與 −min(V)，取速度「往正的走得比較遠」的那一邊。
// 3. 猜測：由手機擺放姿態猜（見 frame.ts）。
import type { Params } from './params';
import type { FrameSample, GpsFix, OrientSource } from './types';
import { haversineM } from './math';

export interface OrientationEstimate {
  theta: number;
  source: OrientSource;
  quality: number;
}

interface SegState {
  id: number;
  tStart: number;
  tEnd: number;
  guessTheta: number;
  // GPS 迴歸的累加量
  gn: number;
  s1: number;
  s2: number;
  s11: number;
  s12: number;
  s22: number;
  s1d: number;
  s2d: number;
  sd: number;
  sdd: number;
  // PCA 的累加量
  pn: number;
  pxx: number;
  pxy: number;
  pyy: number;
  // 速度積分（水平基底上的二維向量）與每隔一段時間的取樣
  lastT: number;
  cum1: number;
  cum2: number;
  path: number[];
  lastPathT: number;
  // 目前 GPS 區間內的水平加速度累加
  in: number;
  i1: number;
  i2: number;
  iStable: boolean;
  /** 區間是從上一筆 GPS 開始累加的（新校準段的第一個區間不完整，不採用） */
  iFresh: boolean;
  est: OrientationEstimate;
}

function newSeg(f: FrameSample): SegState {
  return {
    id: f.segment,
    tStart: f.t,
    tEnd: f.t,
    guessTheta: f.guessTheta,
    gn: 0, s1: 0, s2: 0, s11: 0, s12: 0, s22: 0, s1d: 0, s2d: 0, sd: 0, sdd: 0,
    pn: 0, pxx: 0, pxy: 0, pyy: 0,
    lastT: f.t, cum1: 0, cum2: 0, path: [0, 0], lastPathT: f.t,
    in: 0, i1: 0, i2: 0, iStable: false, iFresh: false,
    est: { theta: f.guessTheta, source: 'guess', quality: 0 },
  };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export class OrientationEstimator {
  private seg: SegState | null = null;
  private done: SegState[] = [];
  private lastFix: { t: number; speed: number; lat: number; lon: number } | null = null;
  private framesSinceEstimate = 0;

  constructor(private p: Params) {}

  pushFrame(f: FrameSample): OrientationEstimate {
    if (!this.seg || f.segment !== this.seg.id) {
      if (this.seg) this.done.push(this.seg);
      this.seg = newSeg(f);
    }
    const s = this.seg;
    s.tEnd = f.t;

    // GPS 區間累加：整段都要是穩定的才拿來配對
    if (s.in === 0) s.iStable = true;
    s.in++;
    s.i1 += f.h1;
    s.i2 += f.h2;
    s.iStable = s.iStable && f.stable;

    const dt = (f.t - s.lastT) / 1000;
    s.lastT = f.t;
    if (!f.stable) return s.est;

    const o = this.p.orientation;
    const hm = Math.hypot(f.h1, f.h2);
    if (hm > o.pcaMinHorizAccel) {
      s.pn++;
      s.pxx += f.h1 * f.h1;
      s.pxy += f.h1 * f.h2;
      s.pyy += f.h2 * f.h2;
    }

    // 帶 deadband 的速度積分
    if (hm > o.velocityDeadbandAccel && dt > 0 && dt < 1) {
      s.cum1 += f.h1 * dt;
      s.cum2 += f.h2 * dt;
    }
    if (f.t - s.lastPathT >= o.velocityPathIntervalSec * 1000) {
      s.path.push(s.cum1, s.cum2);
      s.lastPathT = f.t;
    }

    // 每 30 筆重新估計一次（PCA 部分）
    if (++this.framesSinceEstimate >= 30) {
      this.framesSinceEstimate = 0;
      s.est = this.estimate(s);
    }
    return s.est;
  }

  pushGps(fix: GpsFix): OrientationEstimate | null {
    const o = this.p.orientation;
    let speed = fix.speed;
    if ((speed === null || !Number.isFinite(speed)) && this.lastFix) {
      const dt = (fix.t - this.lastFix.t) / 1000;
      if (dt > 0) speed = haversineM(this.lastFix.lat, this.lastFix.lon, fix.lat, fix.lon) / dt;
    }
    if (fix.accuracy > o.gpsMaxAccuracyM || speed === null || !Number.isFinite(speed)) {
      this.lastFix = null;
      this.resetInterval();
      return null;
    }
    const s = this.seg;
    if (s && this.lastFix && s.in > 0 && s.iStable && s.iFresh) {
      const dt = (fix.t - this.lastFix.t) / 1000;
      if (dt >= o.gpsMinIntervalSec && dt <= o.gpsMaxIntervalSec) {
        const d = (speed - this.lastFix.speed) / dt;
        const m1 = s.i1 / s.in;
        const m2 = s.i2 / s.in;
        s.gn++;
        s.s1 += m1;
        s.s2 += m2;
        s.s11 += m1 * m1;
        s.s12 += m1 * m2;
        s.s22 += m2 * m2;
        s.s1d += m1 * d;
        s.s2d += m2 * d;
        s.sd += d;
        s.sdd += d * d;
        s.est = this.estimate(s);
      }
    }
    this.lastFix = { t: fix.t, speed, lat: fix.lat, lon: fix.lon };
    this.resetInterval();
    return s ? s.est : null;
  }

  current(): OrientationEstimate | null {
    return this.seg ? this.seg.est : null;
  }

  /** 所有校準段的最終估計（批次處理第二輪用） */
  finalize(): Map<number, OrientationEstimate & { tStart: number; tEnd: number }> {
    const all = this.seg ? [...this.done, this.seg] : this.done;
    const out = new Map<number, OrientationEstimate & { tStart: number; tEnd: number }>();
    for (const s of all) out.set(s.id, { ...this.estimate(s), tStart: s.tStart, tEnd: s.tEnd });
    return out;
  }

  private resetInterval() {
    if (!this.seg) return;
    this.seg.in = 0;
    this.seg.i1 = 0;
    this.seg.i2 = 0;
    this.seg.iStable = false;
    this.seg.iFresh = true;
  }

  private estimate(s: SegState): OrientationEstimate {
    const o = this.p.orientation;
    // 1. GPS：前進方向 = 水平加速度與 dv/dt 的交叉共變異向量 (Σh1·d, Σh2·d) 的方向。
    //    不做完整 2×2 最小平方反矩陣：公車很少有持續的橫向加速度，橫向分量幾乎沒被激發，
    //    反矩陣會把雜訊放大成很大的角度誤差。
    if (s.gn >= o.gpsMinPairs) {
      const n = s.gn;
      const dStd = Math.sqrt(Math.max(s.sdd / n - (s.sd / n) ** 2, 0));
      const mag = Math.hypot(s.s1d, s.s2d);
      if (dStd >= o.gpsMinDvdtStd && mag > 1e-9) {
        const c1 = s.s1d / mag;
        const c2 = s.s2d / mag;
        // 相關係數 r = corr(d, h·f)
        const sp = c1 * s.s1 + c2 * s.s2;
        const spp = c1 * c1 * s.s11 + 2 * c1 * c2 * s.s12 + c2 * c2 * s.s22;
        const sdp = c1 * s.s1d + c2 * s.s2d;
        const den = Math.sqrt((n * s.sdd - s.sd * s.sd) * (n * spp - sp * sp));
        const r = den > 0 ? (n * sdp - s.sd * sp) / den : 0;
        if (r >= o.gpsMinR) return { theta: Math.atan2(c2, c1), source: 'gps', quality: r };
      }
    }
    // 2. PCA 主軸 + 起步方向
    if (s.pn >= o.pcaMinSamples) {
      const tr = s.pxx + s.pyy;
      const diff = Math.sqrt((s.pxx - s.pyy) ** 2 + 4 * s.pxy * s.pxy);
      const l1 = (tr + diff) / 2;
      const l2 = (tr - diff) / 2;
      const aniso = l1 / Math.max(l2, 1e-9);
      if (aniso >= o.pcaMinAnisotropy) {
        const phi = 0.5 * Math.atan2(2 * s.pxy, s.pxx - s.pyy);
        const c = Math.cos(phi);
        const sn = Math.sin(phi);
        let vmax = 0;
        let vmin = 0;
        for (let i = 0; i < s.path.length; i += 2) {
          const v = s.path[i] * c + s.path[i + 1] * sn;
          vmax = Math.max(vmax, v);
          vmin = Math.min(vmin, v);
        }
        let sign = vmax + vmin;
        if (Math.abs(sign) < 0.1) sign = Math.cos(s.guessTheta - phi);
        return { theta: wrapAngle(sign >= 0 ? phi : phi + Math.PI), source: 'pca', quality: aniso };
      }
    }
    return { theta: s.guessTheta, source: 'guess', quality: 0 };
  }
}
