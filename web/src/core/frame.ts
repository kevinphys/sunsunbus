// 階段 A：重力估計、水平面投影、低通濾波、靜置偵測、校準段切換。
//
// 做法：
// 1. 重力向量：有 OS 線性加速度時用 (accelerationIncludingGravity − acceleration) 再輕微平滑；
//    沒有時（部分 Android、硬體感測盒）對 accelerationIncludingGravity 做兩個指數低通：
//    快的（約 1 秒）給靜置偵測用；慢的（穩定時約 30 秒，不穩定時跟著快的）拿來扣重力。
//    只用快的會變成 1 秒的高通濾波，持續好幾秒的起步加速會被當成重力濾掉。
// 2. 線性加速度在手機座標做二階 Butterworth 低通（去車身震動），再投影到
//    水平基底 (e1, e2) 與 up。e1 是本段固定的手機軸投影到水平面，所以車子轉彎不會影響基底。
// 3. 靜置偵測：1 秒滑動視窗內 (a) up 方向相對視窗平均的最大偏角、
//    (b) 去掉繞 up 軸（車輛偏航）之後的轉動速率 RMS。手持時兩者都明顯較大。
// 4. 不穩定超過 recalibrateAfterUnstableSec 秒（手機被拿起來過），回到穩定時開新的校準段。
import type { Params } from './params';
import type { FrameSample, MotionSample } from './types';
import { Biquad, angleDeg, cross, dot, emaAlpha, horizontalize, normalize, scale, sub, type Vec3 } from './math';

function ema(prev: Vec3 | null, x: Vec3, a: number): Vec3 {
  if (prev === null) return [...x];
  return [prev[0] + a * (x[0] - prev[0]), prev[1] + a * (x[1] - prev[1]), prev[2] + a * (x[2] - prev[2])];
}

interface WindowEntry {
  t: number;
  up: Vec3;
  tilt2: number;
}

export class FrameStage {
  private g: Vec3 | null = null;
  private gSlow: Vec3 | null = null;
  private lastT: number | null = null;
  private lpf: [Biquad, Biquad, Biquad];
  private win: WindowEntry[] = [];
  private stable = false;
  private everStable = false;
  private okSince: number | null = null;
  private unstableSince: number | null = null;
  private segment = 0;
  private segUp: Vec3 | null = null;
  private refAxis: Vec3 = [0, 1, 0];
  private guessTheta = 0;

  constructor(
    private p: Params,
    private fs: number,
    private accelSign: 1 | -1 = 1,
  ) {
    this.lpf = [new Biquad(p.lowpassCutoffHz, fs), new Biquad(p.lowpassCutoffHz, fs), new Biquad(p.lowpassCutoffHz, fs)];
  }

  setAccelSign(sign: 1 | -1) {
    this.accelSign = sign;
  }

  push(s: MotionSample): FrameSample {
    const p = this.p;
    const dt = this.lastT === null ? 1 / this.fs : Math.max((s.t - this.lastT) / 1000, 1e-4);
    this.lastT = s.t;

    const incG: Vec3 = [s.gx, s.gy, s.gz];
    const hasLin = p.useOsLinearAcceleration && s.ax !== null && s.ay !== null && s.az !== null;
    let lin: Vec3;
    if (hasLin) {
      const acc: Vec3 = [s.ax!, s.ay!, s.az!];
      const gRaw = sub(incG, acc);
      this.g = ema(this.g, gRaw, emaAlpha(dt, p.osGravitySmoothSec));
      this.gSlow = this.g;
      lin = acc;
    } else {
      this.g = ema(this.g, incG, emaAlpha(dt, p.gravityTauSec));
      // 穩定時慢慢更新；短暫不穩定（例如沒有陀螺儀時的急煞）先凍結；
      // 不穩定超過重新校準的時間（手機真的被移動）才跟上快速估計
      // 與開新校準段的判斷一致：只計算「條件不成立」的時間，不含恢復後等待穩定的那段
      const movedMs = this.unstableSince === null || this.okSince !== null ? 0 : s.t - this.unstableSince;
      if (this.gSlow === null || (!this.stable && movedMs >= p.stability.recalibrateAfterUnstableSec * 1000)) this.gSlow = this.g;
      else if (this.stable) this.gSlow = ema(this.gSlow, incG, emaAlpha(dt, p.gravityStableTauSec));
      lin = sub(incG, this.gSlow);
    }
    // accelSign 修正部分平台加速度正負號相反的問題，使 up 指向天空。
    // up（快）給靜置偵測；upLin（慢）給投影
    const up = scale(normalize(this.g), this.accelSign);
    const upLin = scale(normalize(this.gSlow), this.accelSign);
    lin = scale(lin, this.accelSign);
    const f: Vec3 = [this.lpf[0].process(lin[0]), this.lpf[1].process(lin[1]), this.lpf[2].process(lin[2])];

    // 轉動速率：W3C rotationRate 的 alpha/beta/gamma 分別繞 z/x/y
    let tilt2 = NaN;
    if (s.ra !== null && s.rb !== null && s.rg !== null) {
      const w: Vec3 = [s.rb, s.rg, s.ra];
      const tilt = sub(w, scale(up, dot(w, up)));
      tilt2 = dot(tilt, tilt);
    }

    const { gravAngle, tiltRms } = this.updateWindow(s.t, up, tilt2);
    if (this.segUp === null) this.startSegment(up, false);
    this.updateStability(s.t, up, gravAngle, tiltRms);

    const e1 = horizontalize(this.refAxis, upLin);
    const e2 = cross(upLin, e1);
    return {
      t: s.t,
      h1: dot(f, e1),
      h2: dot(f, e2),
      v: dot(f, upLin),
      stable: this.stable,
      segment: this.segment,
      guessTheta: this.guessTheta,
      gravAngle,
      tiltRms,
    };
  }

  private updateWindow(t: number, up: Vec3, tilt2: number) {
    const winMs = this.p.stability.windowSec * 1000;
    this.win.push({ t, up, tilt2 });
    while (this.win.length > 1 && t - this.win[0].t > winMs) this.win.shift();
    let sum: Vec3 = [0, 0, 0];
    let tiltSum = 0;
    let tiltN = 0;
    for (const e of this.win) {
      sum = [sum[0] + e.up[0], sum[1] + e.up[1], sum[2] + e.up[2]];
      if (!Number.isNaN(e.tilt2)) {
        tiltSum += e.tilt2;
        tiltN++;
      }
    }
    const mean = normalize(sum);
    let gravAngle = 0;
    for (const e of this.win) gravAngle = Math.max(gravAngle, angleDeg(e.up, mean));
    const tiltRms = tiltN > 0 ? Math.sqrt(tiltSum / tiltN) : NaN;
    return { gravAngle, tiltRms };
  }

  private updateStability(t: number, up: Vec3, gravAngle: number, tiltRms: number) {
    const st = this.p.stability;
    const ok = gravAngle <= st.maxGravityAngleDeg && (Number.isNaN(tiltRms) || tiltRms <= st.maxTiltRateRmsDps);
    if (!ok) {
      if (this.unstableSince === null) this.unstableSince = t;
      this.okSince = null;
      this.stable = false;
      return;
    }
    if (this.okSince === null) this.okSince = t;
    if (!this.stable && t - this.okSince >= st.minStableSec * 1000) {
      this.stable = true;
      const unstableMs = this.unstableSince === null ? 0 : this.okSince - this.unstableSince;
      const drift = this.segUp ? angleDeg(up, this.segUp) : 0;
      if (!this.everStable || unstableMs >= st.recalibrateAfterUnstableSec * 1000 || drift > st.recalibrateGravityDriftDeg) {
        this.startSegment(up, true);
      }
      this.everStable = true;
      this.unstableSince = null;
    } else if (this.stable && this.segUp && angleDeg(up, this.segUp) > st.recalibrateGravityDriftDeg) {
      // 手機在穩定狀態下慢慢滑動偏轉：重新校準
      this.startSegment(up, true);
    }
  }

  /** 開新的校準段：決定水平基底的參考軸，並由擺放姿態猜一個前進方向 */
  private startSegment(up: Vec3, increment: boolean) {
    if (increment) this.segment++;
    this.segUp = up;
    // e1 參考軸：手機 y 軸（螢幕頂端）；若 y 幾乎垂直（直立擺放）改用 x 軸
    this.refAxis = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    // 猜測前進方向：直立（螢幕朝向乘客、乘客面向前方）時手機背面朝前 → −z；
    // 平放時假設螢幕頂端朝前 → +y
    const fwdPhone: Vec3 = Math.abs(up[2]) < 0.7 ? [0, 0, -1] : [0, 1, 0];
    const e1 = horizontalize(this.refAxis, up);
    const e2 = cross(up, e1);
    const fh = horizontalize(fwdPhone, up);
    this.guessTheta = Math.atan2(dot(fh, e2), dot(fh, e1));
  }
}
