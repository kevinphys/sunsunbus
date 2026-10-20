// 合成資料產生器：給單元測試、Python 對照資料（fixtures）用。
//
// 車輛座標：X 向前、Y 向左、Z 向上。手機姿態 Q 的三個欄向量是手機 x/y/z 軸在車輛座標的方向，
// 量測值 = Qᵀ × 比力（specific force = 加速度 + 向上 9.81）。
import type { GpsFix, MotionSample, OrientationSample } from './types';
import type { TripInput } from './trip';

type Mat = number[]; // 3x3，row-major

const G = 9.81;

function mul(a: Mat, b: Mat): Mat {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
const tr = (a: Mat): Mat => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const apply = (a: Mat, v: number[]) => [0, 1, 2].map((i) => a[i * 3] * v[0] + a[i * 3 + 1] * v[1] + a[i * 3 + 2] * v[2]);
const rad = (d: number) => (d * Math.PI) / 180;
function rx(d: number): Mat {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function ry(d: number): Mat {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rz(d: number): Mat {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** 手機平放、螢幕朝上、螢幕頂端朝前 */
const Q_FLAT: Mat = [0, 1, 0, -1, 0, 0, 0, 0, 1];

export interface Mount {
  /** 手機繞車輛垂直軸的偏轉 (deg) */
  yawDeg: number;
  /** 繞手機 x 軸立起來的角度：0 = 平放、90 = 直立且螢幕朝後（面向乘客） */
  tiltDeg: number;
  /** 繞手機 y 軸的側傾 (deg) */
  rollDeg?: number;
}

export interface Scenario {
  durationSec: number;
  fs?: number;
  /** 車輛縱向／橫向加速度 (m/s²)，t 為秒 */
  aLong: (t: number) => number;
  aLat?: (t: number) => number;
  initialSpeed?: number;
  mount: Mount | ((t: number) => Mount);
  /** 哪些時間是手持（加上手部晃動） */
  handheld?: (t: number) => boolean;
  vibration?: number;
  noise?: number;
  /** 模擬加速度正負號相反的平台 */
  invertSign?: boolean;
  gps?: boolean;
  gyro?: boolean;
  osLinear?: boolean;
  orientation?: boolean;
  seed?: number;
  t0?: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平滑的梯形脈衝：在 [start, start+dur] 內為 amp，前後各 ramp 秒線性上升／下降 */
export function pulse(t: number, start: number, dur: number, amp: number, ramp = 0.4): number {
  if (t < start - ramp || t > start + dur + ramp) return 0;
  if (t < start) return (amp * (t - (start - ramp))) / ramp;
  if (t > start + dur) return (amp * (start + dur + ramp - t)) / ramp;
  return amp;
}

export function generateTrip(sc: Scenario): TripInput {
  const fs = sc.fs ?? 60;
  const rand = rng(sc.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const noise = sc.noise ?? 0.05;
  const vib = sc.vibration ?? 0.2;
  const sign = sc.invertSign ? -1 : 1;
  const t0 = sc.t0 ?? 1_760_000_000_000;
  const dt = 1 / fs;
  const n = Math.round(sc.durationSec * fs);

  // 手持晃動：多個頻率的小角度轉動（相位隨機）
  const ph = Array.from({ length: 6 }, () => rand() * 2 * Math.PI);
  const wobble = (t: number): Mat =>
    mul(
      mul(rx(10 * Math.sin(2 * Math.PI * 1.3 * t + ph[0]) + 4 * Math.sin(2 * Math.PI * 3.1 * t + ph[1])),
        ry(8 * Math.sin(2 * Math.PI * 0.9 * t + ph[2]) + 3 * Math.sin(2 * Math.PI * 2.7 * t + ph[3]))),
      rz(15 * Math.sin(2 * Math.PI * 0.3 * t + ph[4])),
    );
  const mountAt = (t: number): Mount => (typeof sc.mount === 'function' ? sc.mount(t) : sc.mount);
  // 姿態 Q(t)：車輛偏航不影響（手機跟著車轉，在車輛座標中姿態不變）
  const pose = (t: number): Mat => {
    const m = mountAt(t);
    let q = mul(mul(rz(m.yawDeg), Q_FLAT), mul(rx(m.tiltDeg), ry(m.rollDeg ?? 0)));
    if (sc.handheld?.(t)) q = mul(q, wobble(t));
    return q;
  };

  const motion: MotionSample[] = [];
  const orientation: OrientationSample[] = [];
  const gps: GpsFix[] = [];
  let v = sc.initialSpeed ?? 0;
  let heading = 0;
  let x = 0;
  let y = 0;
  let nextGps = 0;

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let al = sc.aLong(t);
    if (v <= 0 && al < 0) al = 0;
    const lat = sc.aLat?.(t) ?? 0;
    const yawRate = v > 0.5 ? lat / v : 0;

    // 比力（車輛座標）＋車身震動
    const fv = [
      al + vib * 0.3 * Math.sin(2 * Math.PI * 11 * t + 0.3),
      lat + vib * 0.3 * Math.sin(2 * Math.PI * 9 * t + 1.1),
      G + vib * Math.sin(2 * Math.PI * 13 * t),
    ];
    const q = pose(t);
    const qt = tr(q);
    const incG = apply(qt, fv).map((c) => sign * (c + noise * gauss()));
    const lin = apply(qt, [fv[0], fv[1], fv[2] - G]).map((c) => sign * (c + noise * gauss()));

    // 角速度（手機座標）= 車輛偏航 + 手機相對車輛的轉動
    const qn = pose(t + dt);
    const w = mul(qt, qn.map((c, k) => (c - q[k]) / dt));
    const body = [w[7], w[2], w[3]]; // [ω]× 的 (2,1)、(0,2)、(1,0)
    const yawPhone = apply(qt, [0, 0, yawRate]);
    const omega = body.map((c, k) => ((c + yawPhone[k]) * 180) / Math.PI + 0.3 * gauss());

    const ts = t0 + Math.round(t * 1000 * 1000) / 1000;
    motion.push({
      t: ts,
      ax: sc.osLinear === false ? null : lin[0],
      ay: sc.osLinear === false ? null : lin[1],
      az: sc.osLinear === false ? null : lin[2],
      gx: incG[0],
      gy: incG[1],
      gz: incG[2],
      ra: sc.gyro === false ? null : omega[2],
      rb: sc.gyro === false ? null : omega[0],
      rg: sc.gyro === false ? null : omega[1],
      interval: 1000 / fs,
    });

    if (sc.orientation !== false && i % 3 === 0) {
      const up = apply(qt, [0, 0, 1]);
      orientation.push({
        t: ts,
        alpha: 0,
        beta: (Math.asin(Math.max(-1, Math.min(1, up[1]))) * 180) / Math.PI,
        gamma: (Math.atan2(-up[0], up[2]) * 180) / Math.PI,
      });
    }

    if (sc.gps !== false && t >= nextGps) {
      nextGps += 1;
      gps.push({
        t: ts,
        lat: 25.0478 + y / 111_320,
        lon: 121.517 + x / (111_320 * Math.cos((25.0478 * Math.PI) / 180)),
        speed: Math.max(0, v + 0.1 * gauss()),
        heading: ((90 - (heading * 180) / Math.PI) % 360 + 360) % 360,
        accuracy: 5,
      });
    }

    v = Math.max(0, v + al * dt);
    heading += yawRate * dt;
    x += v * Math.cos(heading) * dt;
    y += v * Math.sin(heading) * dt;
  }
  return { motion, orientation, gps };
}

/** 常用情境：先停 5 秒、起步加速到約 10 m/s、等速，之後由呼叫者加入事件 */
export function busProfile(events: (t: number) => number, gentle = true) {
  return (t: number) => (gentle ? pulse(t, 5, 8, 1.1) : 0) + events(t);
}
