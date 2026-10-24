import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/params';
import { processTrip } from '../core/trip';
import type { GpsFix, TripEvent } from '../core/types';
import { DEFAULT_RULES } from './rules';
import { DEMO_EXPECTED_LEVELS, demoTrip, pickDemoStops } from './demo';
import { StableIndex, StopTracker, buildSegments, parseTdxStops, segmentLevel, segmentTrip, type RideSegment } from './segments';
import { evaluateRide, routeFruit } from './ride';

const demo = demoTrip();
const result = processTrip(demo.trip, DEFAULT_PARAMS);

describe('站間切分', () => {
  it('有站牌資料：6 個站間，等級符合示範行程', () => {
    const segs = segmentTrip(result.samples, result.events, demo.trip.gps, demo.stops, DEFAULT_RULES).segments;
    expect(segs.map((s) => s.fromName)).toEqual(demo.stops.slice(0, 6).map((s) => s.name));
    expect(segs.map((s) => s.level)).toEqual([...DEMO_EXPECTED_LEVELS]);
  });

  it('沒有站牌資料：用停靠推測，切出一樣的站間', () => {
    const segs = segmentTrip(result.samples, result.events, demo.trip.gps, null, DEFAULT_RULES).segments;
    expect(segs.map((s) => s.level)).toEqual([...DEMO_EXPECTED_LEVELS]);
    expect(segs[0].fromName).toBe('上車處');
    expect(segs[1].fromName).toBe('停靠 1');
  });

  it('進站煞車算到站的那一段、出站起步算離站的那一段', () => {
    const segs = segmentTrip(result.samples, result.events, demo.trip.gps, demo.stops, DEFAULT_RULES).segments;
    // 第 4 段（示範站 4 → 5）：出站急加速與進站急煞都在這一段，前後兩段都沒有
    expect(segs[3].events.map((e) => e.type)).toEqual(expect.arrayContaining(['hard_accel', 'hard_brake']));
    expect(segs[2].events.filter((e) => e.type !== 'high_jerk')).toEqual([]);
    expect(segs[4].events.filter((e) => e.type !== 'high_jerk')).toEqual([]);
  });

  it('上車站由第一筆 GPS 偵測，下車站取最後 GPS 最近的站牌', () => {
    const r = segmentTrip(result.samples, result.events, demo.trip.gps, demo.stops, DEFAULT_RULES);
    expect(r.boardStop).toBe('示範站 1');
    expect(r.alightStop).toBe('示範站 7');
    const tr = new StopTracker(DEFAULT_RULES, demo.stops, result.samples[0].t);
    tr.push(demo.trip.gps[0]);
    expect(tr.boardStop()).toBe('示範站 1');
  });

  it('中途上車：從離第一筆 GPS 最近的站開始', () => {
    const t3 = demo.trip.motion[0].t + demo.stopTimes[2] * 1000;
    const gps = demo.trip.gps.filter((g) => g.t >= t3);
    const samples = result.samples.filter((s) => s.t >= t3);
    const r = segmentTrip(samples, result.events, gps, demo.stops, DEFAULT_RULES);
    expect(r.boardStop).toBe('示範站 3');
    expect(r.segments.map((s) => s.fromName)).toEqual(['示範站 3', '示範站 4', '示範站 5', '示範站 6']);
  });

  it('自動結束：只算截止前到達的站，終點取其中最後一站', () => {
    const cutoff = demo.trip.motion[0].t + (demo.stopTimes[4] + 20) * 1000;
    const r = segmentTrip(result.samples, result.events, demo.trip.gps, demo.stops, DEFAULT_RULES, cutoff);
    expect(r.segments).toHaveLength(4);
    expect(r.alightStop).toBe('示範站 5');
  });

  it('沒有站牌資料：上下車處不顯示站名', () => {
    const r = segmentTrip(result.samples, result.events, demo.trip.gps, null, DEFAULT_RULES);
    expect(r.boardStop).toBe('上車處');
  });

  it('停靠期間的事件不計分', () => {
    const t0 = result.samples[0].t;
    const tr = new StopTracker(DEFAULT_RULES, demo.stops, t0);
    for (const g of demo.trip.gps) tr.push(g);
    tr.finish();
    const v = tr.visits[2];
    const ev: TripEvent = { type: 'hard_brake', tStart: v.tArrive, tEnd: v.tArrive + 500, tPeak: (v.tArrive + v.tDepart) / 2, peakValue: -3, peakALong: -3, peakALat: 0, peakJerk: 0, lat: null, lon: null, speed: null, orientSource: 'gps' };
    const segs = buildSegments(tr.visits, result.samples.at(-1)!.t, tr.distM, StableIndex.from(result.samples), [ev], DEFAULT_RULES);
    expect(segs.every((s) => s.events.length === 0)).toBe(true);
  });

  it('站前走走停停（距離不足 minSegmentM）併成一次停靠', () => {
    // 停 6 秒 → 往前 30 m → 再停 6 秒 → 開走 400 m → 停 6 秒
    const fixes: GpsFix[] = [];
    let t = 0, x = 0;
    const add = (sec: number, v: number) => {
      for (let i = 0; i < sec; i++) {
        fixes.push({ t: t * 1000, lat: 25, lon: 121 + x / 100_900, speed: v, heading: 90, accuracy: 5 });
        t++;
        x += v;
      }
    };
    add(3, 8);
    add(30, 10);
    add(6, 0);
    add(3, 10);
    add(6, 0);
    add(40, 10);
    add(6, 0);
    const tr = new StopTracker(DEFAULT_RULES, null, 0);
    for (const f of fixes) tr.push(f);
    expect(tr.visits.filter((v) => !v.virtual).map((v) => v.name)).toEqual(['停靠 1', '停靠 2']);
  });

  it('等級：無事件盛開、1 至 2 點小花、嚴重事件或更多點數乾土、stable 不足沒量到', () => {
    const e = (type: RideSegment['events'][0]['type'], peak: number) => ({ type, peak, t: 0 });
    expect(segmentLevel([], 1, DEFAULT_RULES).level).toBe('bloom');
    expect(segmentLevel([e('high_jerk', 9)], 1, DEFAULT_RULES).level).toBe('bloom');
    expect(segmentLevel([e('hard_brake', -1.6), e('hard_accel', 1.7)], 1, DEFAULT_RULES).level).toBe('sprout');
    expect(segmentLevel([e('hard_brake', -1.6), e('hard_brake', -1.2), e('hard_accel', 1.7)], 1, DEFAULT_RULES).level).toBe('dry');
    expect(segmentLevel([e('hard_brake', -2.7)], 1, DEFAULT_RULES).level).toBe('dry');
    expect(segmentLevel([], 0.3, DEFAULT_RULES).level).toBe('unmeasured');
  });
});

describe('模擬行程走真實站牌', () => {
  const route = parseTdxStops(JSON.parse(readFileSync(new URL('../../public/stops/中山幹線.json', import.meta.url), 'utf8')), 0)!;
  const picked = pickDemoStops(route.stops)!;
  const sim = demoTrip(11, picked);
  const res = processTrip(sim.trip, DEFAULT_PARAMS);

  it('中山幹線挑到往臺北車站的 7 站', () => {
    expect(picked.map((s) => s.name)).toEqual(['大同大學', '大同公司(晴光市場)', '台泥大樓(馬偕醫院)', '國賓飯店', '中山市場', '行政院', '臺北車站(忠孝)']);
  });

  it('用整條路線的站序切分：上下車站、站間與等級都對', () => {
    const r = segmentTrip(res.samples, res.events, sim.trip.gps, route.stops, DEFAULT_RULES);
    expect(r.boardStop).toBe('大同大學');
    expect(r.alightStop).toBe('臺北車站(忠孝)');
    expect(r.segments.map((s) => s.fromName)).toEqual(picked.slice(0, 6).map((s) => s.name));
    expect(r.segments.map((s) => s.level)).toEqual([...DEMO_EXPECTED_LEVELS]);
  });
});

describe('果實', () => {
  const seg = (level: RideSegment['level']): RideSegment => ({ fromName: 'a', toName: 'b', tStart: 0, tEnd: 1, distanceM: 300, stableRatio: 1, events: [], points: 0, score: 100, level });
  const opts = { stopSource: 'tdx' as const };

  it('有效的一趟 1 顆，不管開得順不順', () => {
    expect(evaluateRide([seg('bloom'), seg('bloom'), seg('sprout')], 0.9, 0, DEFAULT_RULES, opts)).toMatchObject({ valid: true, fruit: 1, fruitKind: 'normal' });
    expect(evaluateRide([seg('dry'), seg('dry'), seg('sprout')], 0.9, 0, DEFAULT_RULES, opts)).toMatchObject({ valid: true, fruit: 1, fruitKind: 'scout' });
  });

  it('無效：手機拿在手上、站間太少、今日已滿', () => {
    expect(evaluateRide([seg('bloom'), seg('bloom'), seg('bloom')], 0.3, 0, DEFAULT_RULES, opts)).toMatchObject({ valid: false, invalidReason: 'handheld', fruit: 0 });
    expect(evaluateRide([seg('bloom'), seg('bloom'), seg('unmeasured')], 0.9, 0, DEFAULT_RULES, opts)).toMatchObject({ valid: false, invalidReason: 'too_few_segments' });
    expect(evaluateRide([seg('bloom'), seg('bloom'), seg('bloom')], 0.9, 4, DEFAULT_RULES, opts)).toMatchObject({ valid: false, invalidReason: 'daily_cap' });
  });

  it('缺水任務 2 顆，但不超過每日上限', () => {
    const segs = [seg('bloom'), seg('bloom'), seg('bloom')];
    expect(evaluateRide(segs, 0.9, 0, DEFAULT_RULES, { ...opts, thirst: true }).fruit).toBe(2);
    expect(evaluateRide(segs, 0.9, 3, DEFAULT_RULES, { ...opts, thirst: true }).fruit).toBe(1);
  });

  it('路線水果固定', () => {
    expect(routeFruit('中山幹線')).toBe('芭樂');
    expect(routeFruit('307')).toBe(routeFruit('307'));
  });
});

describe('TDX 站序', () => {
  it('依方向與站序排序', () => {
    const data = [
      { Direction: 1, Stops: [{ StopUID: 'x', StopSequence: 1, StopName: { Zh_tw: '回程' }, StopPosition: { PositionLat: 25, PositionLon: 121 } }] },
      {
        Direction: 0,
        Stops: [
          { StopUID: 'b', StopSequence: 2, StopName: { Zh_tw: '終點' }, StopPosition: { PositionLat: 25.01, PositionLon: 121 } },
          { StopUID: 'a', StopSequence: 1, StopName: { Zh_tw: '起點' }, StopPosition: { PositionLat: 25, PositionLon: 121 } },
        ],
      },
    ];
    const r = parseTdxStops(data, 0)!;
    expect(r.stops.map((s) => s.name)).toEqual(['起點', '終點']);
    expect(r.headsign).toBe('終點');
    expect(parseTdxStops(data, 1)!.stops[0].name).toBe('回程');
  });
});
