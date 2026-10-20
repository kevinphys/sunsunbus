// 產生 Python 對照測試用的資料：合成行程 → 匯出 CSV → 讀回 → TS 批次處理的結果存成 expected JSON。
// Python 端（analysis/tests/test_parity.py）讀同一份 CSV 重跑，結果必須一致。
// 用法：npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/core/params';
import { generateTrip, pulse, busProfile, type Scenario } from '../src/core/synthetic';
import { gpsCsv, motionCsv, parseGpsCsv, parseMotionCsv } from '../src/core/csv';
import { processTrip } from '../src/core/trip';

const OUT = new URL('../../analysis/tests/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const scenarios: Record<string, Scenario> = {
  brake_upright: {
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 2, -2.5) + pulse(t, 45, 6, -0.6) + pulse(t, 55, 5, 0.9)),
    mount: { yawDeg: 37, tiltDeg: 80 },
  },
  turn_flat: {
    durationSec: 60,
    aLong: busProfile((t) => pulse(t, 45, 4, -0.7)),
    aLat: (t) => pulse(t, 25, 4, 2.0),
    mount: { yawDeg: 120, tiltDeg: 0 },
  },
  handheld_then_mount: {
    durationSec: 90,
    aLong: (t) => pulse(t, 25, 8, 1.1) + pulse(t, 60, 2, -2.5) + pulse(t, 70, 5, -0.6),
    mount: (t) => (t < 15 ? { yawDeg: 0, tiltDeg: 50 } : { yawDeg: 75, tiltDeg: 85 }),
    handheld: (t) => t < 15,
  },
  no_gps_inverted: {
    durationSec: 80,
    aLong: (t) => pulse(t, 8, 6, 1.2) + pulse(t, 30, 3, -1.6) + pulse(t, 50, 4, 1.0) + pulse(t, 65, 5, -0.8),
    mount: { yawDeg: 150, tiltDeg: 0 },
    gps: false,
    invertSign: true,
  },
  no_linear_no_gyro: {
    durationSec: 70,
    aLong: busProfile((t) => pulse(t, 30, 1.5, -2.5, 0.15) + pulse(t, 45, 6, -0.6)),
    mount: { yawDeg: 25, tiltDeg: 0 },
    osLinear: false,
    gyro: false,
  },
};

for (const [name, sc] of Object.entries(scenarios)) {
  const trip = generateTrip(sc);
  const mText = motionCsv(trip.motion, trip.orientation);
  const gText = gpsCsv(trip.gps);
  // 用讀回的 CSV 處理，確保和 Python 看到的輸入完全相同（含小數位數）
  const parsed = parseMotionCsv(mText);
  const r = processTrip({ ...parsed, gps: parseGpsCsv(gText) }, DEFAULT_PARAMS);
  writeFileSync(new URL(`${name}_motion.csv`, OUT), mText);
  writeFileSync(new URL(`${name}_gps.csv`, OUT), gText);
  const every = 30;
  writeFileSync(
    new URL(`${name}_expected.json`, OUT),
    JSON.stringify(
      {
        accelSign: r.accelSign,
        sampleRateHz: r.sampleRateHz,
        jerkP95: r.jerkP95,
        jerkThreshold: r.jerkThreshold,
        segments: r.segments,
        events: r.events,
        summary: r.summary,
        // 每 30 筆抽一筆處理後的數值，比對整條管線
        sampleEvery: every,
        samples: r.samples.filter((_, i) => i % every === 0),
      },
      null,
      1,
    ),
  );
  console.log(name, r.events.map((e) => e.type).join(' '));
}
