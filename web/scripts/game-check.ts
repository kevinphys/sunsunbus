// 用實測資料檢查站間切分與開花等級：npx vite-node scripts/game-check.ts <檔名前綴>
// 例：npx vite-node scripts/game-check.ts ../analysis/data/sunsunbus_<日期時間>_<路線>
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/core/params';
import { parseGpsCsv, parseMotionCsv } from '../src/core/csv';
import { processTrip } from '../src/core/trip';
import { DEFAULT_RULES } from '../src/game/rules';
import { LEVEL_LABELS, segmentTrip } from '../src/game/segments';
import { evaluateRide } from '../src/game/ride';

const prefix = process.argv[2];
if (!prefix) throw new Error('用法：vite-node scripts/game-check.ts <檔名前綴>');
const { motion, orientation } = parseMotionCsv(readFileSync(`${prefix}_motion.csv`, 'utf8'));
const gps = parseGpsCsv(readFileSync(`${prefix}_gps.csv`, 'utf8'));
const r = processTrip({ motion, orientation, gps }, DEFAULT_PARAMS);
const segs = segmentTrip(r.samples, r.events, gps, null, DEFAULT_RULES).segments;
const t0 = r.samples[0].t;
for (const s of segs) {
  const ev = s.events.map((e) => `${e.type.replace('hard_', '').replace('high_', '')}:${e.peak.toFixed(1)}`).join(' ');
  console.log(
    `${s.fromName.padEnd(6)} → ${s.toName.padEnd(6)} ${((s.tStart - t0) / 1000).toFixed(0).padStart(4)}–${((s.tEnd - t0) / 1000).toFixed(0).padStart(4)} s ` +
      `${s.distanceM.toFixed(0).padStart(5)} m stable ${(s.stableRatio * 100).toFixed(0).padStart(3)}% ${LEVEL_LABELS[s.level]} (${s.points}) ${ev}`,
  );
}
const ride = evaluateRide(segs, r.summary.stableRatio, 0, DEFAULT_RULES, { stopSource: 'dwell' });
console.log(JSON.stringify({ levels: ride.levelCounts, valid: ride.valid, fruit: ride.fruit, kind: ride.fruitKind, events: r.summary.counts }));
