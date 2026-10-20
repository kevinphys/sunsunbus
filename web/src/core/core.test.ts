import { describe, expect, it } from 'vitest';
import { Biquad, percentile } from './math';
import { DEFAULT_PARAMS, mergeParams } from './params';
import { generateTrip, pulse, busProfile, type Scenario } from './synthetic';
import { processTrip } from './trip';
import { LiveProcessor } from './live';

const p = DEFAULT_PARAMS;
const run = (sc: Scenario) => processTrip(generateTrip(sc), p);
const count = (r: ReturnType<typeof run>, type: string) => r.events.filter((e) => e.type === type).length;

describe('math', () => {
  it('Biquad：直流增益 1、高頻被衰減', () => {
    const f = new Biquad(3, 60);
    let y = 0;
    for (let i = 0; i < 300; i++) y = f.process(2);
    expect(y).toBeCloseTo(2, 6);
    const g = new Biquad(3, 60);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      const out = g.process(Math.sin((2 * Math.PI * 15 * i) / 60));
      if (i > 300) peak = Math.max(peak, Math.abs(out));
    }
    expect(peak).toBeLessThan(0.1);
  });

  it('percentile 與 numpy 預設（linear）一致', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(percentile([10, 0, 5], 95)).toBeCloseTo(9.5);
  });
});

describe('等速行駛', () => {
  const r = run({ durationSec: 60, aLong: () => 0, initialSpeed: 8, mount: { yawDeg: 20, tiltDeg: 0 } });

  it('穩定、沒有任何事件', () => {
    expect(r.summary.stableRatio).toBeGreaterThan(0.9);
    expect(r.events).toHaveLength(0);
    expect(r.summary.smoothScore).toBe(100);
  });
});

describe('單次急煞（直立支架、手機斜放 37°）', () => {
  const r = run({
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 2, -2.5) + pulse(t, 45, 6, -0.6) + pulse(t, 55, 5, 0.9)),
    mount: { yawDeg: 37, tiltDeg: 80 },
  });

  it('偵測到恰好一次急煞、沒有急加速', () => {
    expect(count(r, 'hard_brake')).toBe(1);
    expect(count(r, 'hard_accel')).toBe(0);
    expect(count(r, 'sharp_turn')).toBe(0);
  });

  it('GPS 校準出前進方向，峰值接近真值', () => {
    expect(r.segments.some((s) => s.source === 'gps')).toBe(true);
    const brake = r.events.find((e) => e.type === 'hard_brake')!;
    expect(brake.peakValue).toBeLessThan(-2.2);
    expect(brake.peakValue).toBeGreaterThan(-2.9);
    expect(brake.tPeak - r.samples[0].t).toBeGreaterThan(29_000);
    expect(brake.tPeak - r.samples[0].t).toBeLessThan(33_500);
    expect(brake.lat).not.toBeNull();
  });
});

describe('單次急加速', () => {
  const r = run({
    durationSec: 60,
    aLong: busProfile((t) => pulse(t, 25, 3, 2.0) + pulse(t, 40, 5, -0.8)),
    mount: { yawDeg: -60, tiltDeg: 0 },
  });
  it('偵測到一次急加速、沒有急煞', () => {
    expect(count(r, 'hard_accel')).toBe(1);
    expect(count(r, 'hard_brake')).toBe(0);
  });
});

describe('急轉彎', () => {
  const r = run({
    durationSec: 60,
    aLong: busProfile((t) => pulse(t, 45, 4, -0.7)),
    aLat: (t) => pulse(t, 25, 4, 2.0),
    mount: { yawDeg: 120, tiltDeg: 0 },
  });
  it('偵測到一次急轉彎，沒有誤判成加減速', () => {
    expect(count(r, 'sharp_turn')).toBe(1);
    expect(count(r, 'hard_brake')).toBe(0);
    expect(count(r, 'hard_accel')).toBe(0);
  });
});

describe('手持晃動', () => {
  const r = run({
    durationSec: 60,
    aLong: busProfile((t) => pulse(t, 30, 2, -2.5)),
    mount: { yawDeg: 0, tiltDeg: 60 },
    handheld: () => true,
  });
  it('大部分標記為不穩定，且不產生事件', () => {
    expect(r.summary.stableRatio).toBeLessThan(0.2);
    expect(count(r, 'hard_brake')).toBe(0);
  });
});

describe('先手持、再放上支架', () => {
  const r = run({
    durationSec: 90,
    aLong: (t) => pulse(t, 25, 8, 1.1) + pulse(t, 60, 2, -2.5) + pulse(t, 70, 5, -0.6),
    mount: (t) => (t < 15 ? { yawDeg: 0, tiltDeg: 50 } : { yawDeg: 75, tiltDeg: 85 }),
    handheld: (t) => t < 15,
  });
  it('放上支架後開新的校準段，並偵測到急煞', () => {
    expect(r.segments.length).toBeGreaterThanOrEqual(2);
    expect(r.samples.find((s) => s.t - r.samples[0].t > 5000)!.stable).toBe(false);
    expect(r.samples.find((s) => s.t - r.samples[0].t > 30000)!.stable).toBe(true);
    expect(count(r, 'hard_brake')).toBe(1);
  });
});

describe('加速度正負號相反的平台', () => {
  const r = run({
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 2, -2.5) + pulse(t, 45, 6, -0.6)),
    mount: { yawDeg: 10, tiltDeg: 0 },
    invertSign: true,
  });
  it('由 deviceorientation 判斷出 −1，急煞仍為負值', () => {
    expect(r.accelSign).toBe(-1);
    expect(count(r, 'hard_brake')).toBe(1);
    expect(r.events.find((e) => e.type === 'hard_brake')!.peakValue).toBeLessThan(-2);
  });
});

describe('去抖動', () => {
  const r = run({
    durationSec: 60,
    aLong: busProfile((t) => (t > 30 && t < 33 ? (t > 31.4 && t < 31.6 ? -0.8 : -1.6) : 0) + pulse(t, 45, 5, -0.6)),
    mount: { yawDeg: 0, tiltDeg: 0 },
  });
  it('煞車中途短暫低於門檻，仍只算一次', () => {
    expect(count(r, 'hard_brake')).toBe(1);
  });
});

describe('沒有 GPS：PCA ＋ 速度不為負', () => {
  const r = run({
    durationSec: 80,
    aLong: (t) => pulse(t, 8, 6, 1.2) + pulse(t, 30, 3, -1.6) + pulse(t, 50, 4, 1.0) + pulse(t, 65, 5, -0.8),
    mount: { yawDeg: 150, tiltDeg: 0 },
    gps: false,
  });
  it('用 PCA 決定方向，急煞是負的', () => {
    expect(r.segments.some((s) => s.source === 'pca')).toBe(true);
    expect(count(r, 'hard_brake')).toBe(1);
    expect(count(r, 'hard_accel')).toBe(0);
  });
});

describe('門檻可調', () => {
  const trip = generateTrip({
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 2, -1.3) + pulse(t, 45, 6, -0.6)),
    mount: { yawDeg: 0, tiltDeg: 0 },
  });
  it('預設 1.0 抓得到 −1.3 的煞車，調成 1.5 就不算', () => {
    expect(processTrip(trip, p).events.filter((e) => e.type === 'hard_brake')).toHaveLength(1);
    const strict = mergeParams({ events: { brakeThreshold: 1.5 } });
    expect(processTrip(trip, strict).events.filter((e) => e.type === 'hard_brake')).toHaveLength(0);
  });
});

describe('即時處理', () => {
  it('逐筆推入也能偵測急煞', () => {
    const trip = generateTrip({
      durationSec: 70,
      aLong: busProfile((t) => pulse(t, 30, 2, -2.5) + pulse(t, 45, 6, -0.6)),
      mount: { yawDeg: 37, tiltDeg: 80 },
    });
    const live = new LiveProcessor(p);
    let gi = 0;
    let oi = 0;
    for (const m of trip.motion) {
      while (gi < trip.gps.length && trip.gps[gi].t <= m.t) live.pushGps(trip.gps[gi++]);
      while (oi < trip.orientation.length && trip.orientation[oi].t <= m.t) live.pushOrientation(trip.orientation[oi++]);
      live.pushMotion(m);
    }
    live.finish();
    expect(live.sampleRateHz).toBeCloseTo(60, 0);
    expect(live.counts.hard_brake).toBe(1);
  });
});

describe('沒有 OS 線性加速度、沒有陀螺儀的裝置', () => {
  const r = run({
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 2, -2.5) + pulse(t, 45, 6, -0.6)),
    mount: { yawDeg: 25, tiltDeg: 0 },
    osLinear: false,
    gyro: false,
  });
  it('只用 accelerationIncludingGravity 也能偵測急煞', () => {
    expect(count(r, 'hard_brake')).toBe(1);
    expect(count(r, 'hard_accel')).toBe(0);
  });
});

describe('高加加速度', () => {
  // 0.15 秒內從 0 煞到 −2.5：加加速度約 16 m/s³（接近文獻中公車起步實測最大值 15.7）
  const r = run({
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 1.5, -2.5, 0.15) + pulse(t, 45, 6, -0.6)),
    mount: { yawDeg: 0, tiltDeg: 0 },
  });
  it('急煞開始時記錄到高加加速度事件，峰值 > 8 m/s³', () => {
    const jerks = r.events.filter((e) => e.type === 'high_jerk' && Math.abs(e.tPeak - r.samples[0].t - 30_000) < 1000);
    expect(jerks.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...jerks.map((e) => e.peakJerk))).toBeGreaterThan(8);
  });
});
