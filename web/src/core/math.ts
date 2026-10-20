// 向量運算、濾波器與統計小工具（Python 版在 analysis/sunsunbus/core.py 有一模一樣的實作）

export type Vec3 = [number, number, number];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3) => Math.sqrt(dot(a, a));
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 1e-9 ? scale(a, 1 / n) : [0, 0, 1];
}

/** 兩個單位向量的夾角 (deg) */
export function angleDeg(a: Vec3, b: Vec3): number {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** 把向量投影到與 up 垂直的平面並正規化 */
export function horizontalize(v: Vec3, up: Vec3): Vec3 {
  return normalize(sub(v, scale(up, dot(v, up))));
}

/** 指數移動平均的係數：dt 與時間常數 tau 都用秒 */
export function emaAlpha(dtSec: number, tauSec: number): number {
  if (tauSec <= 0) return 1;
  return 1 - Math.exp(-dtSec / tauSec);
}

/**
 * 二階 Butterworth 低通（RBJ biquad，Direct Form II Transposed）。
 * 用第一筆輸入初始化成穩態，避免開頭的暫態。
 */
export class Biquad {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private z1 = 0;
  private z2 = 0;
  private init = false;

  constructor(cutoffHz: number, fs: number) {
    const fc = Math.min(cutoffHz, fs * 0.45);
    const w0 = (2 * Math.PI * fc) / fs;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.b0 = (1 - cosw) / 2 / a0;
    this.b1 = (1 - cosw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    if (!this.init) {
      this.z2 = (this.b2 - this.a2) * x;
      this.z1 = (this.b1 - this.a1) * x + this.z2;
      this.init = true;
    }
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 與 numpy.percentile 預設（linear）相同的百分位數 */
export function percentile(xs: ArrayLike<number>, q: number): number {
  const s = Array.from(xs).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = ((s.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 由時間戳估計取樣頻率：前 N 個間隔的中位數 */
export function estimateSampleRate(ts: number[], n = 60): number {
  const dts: number[] = [];
  for (let i = 1; i < Math.min(ts.length, n + 1); i++) {
    const dt = ts[i] - ts[i - 1];
    if (dt > 0) dts.push(dt);
  }
  const m = median(dts);
  return Number.isFinite(m) && m > 0 ? 1000 / m : 60;
}

/** 兩點間的大圓距離 (m) */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** W3C deviceorientation 的 beta/gamma (deg) 換算成「地面向上」在手機座標的單位向量 */
export function upFromOrientation(betaDeg: number, gammaDeg: number): Vec3 {
  const b = (betaDeg * Math.PI) / 180;
  const g = (gammaDeg * Math.PI) / 180;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}
