// 站間切分與三級開花。
//
// 站間 = 兩次「停靠」之間的行駛。停靠有兩種判斷方式：
// - 有站牌資料（TDX StopOfRoute）：GPS 進入站牌 stopRadiusM 範圍內算到站。範圍內有停車的話，
//   到站／離站時間取停車的第一筆與最後一筆；沒停（過站不停）就取最接近站牌的那一刻。
// - 沒有站牌資料：速度低於 dwellSpeedMs 持續 dwellMinSec 秒算一次停靠（紅燈也會被算進去，
//   所以只是備援）。離上一次停靠不到 minSegmentM 的停車併入上一次（站前排隊、走走停停）。
//
// 上車站：第一筆 GPS 距最近站牌 boardRadiusM 內就認定為上車站（這趟的起點改用站名）。
// 下車站：乘客按「我下車了」時的 GPS 對應最近站牌；自動結束時取最後一個穩定量測的站。
//
// 事件依峰值時間歸屬：在停靠之前 → 到站的那一段（進站煞車）；停靠期間 → 不計分（開關門、上下車）；
// 停靠之後 → 離站的那一段（出站起步）。
import type { EventType, GpsFix, ProcessedSample, TripEvent } from '../core/types';
import { haversineM } from '../core/math';
import type { GameRules } from './rules';

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface StopVisit {
  name: string;
  /** 有站牌資料時是站序（stops 陣列索引），否則 null */
  stopIndex: number | null;
  /** 上車處、下車處：不是真的停靠，只是這趟的頭尾 */
  virtual: boolean;
  tArrive: number;
  tDepart: number;
  /** 到站、離站時的累計里程 (m) */
  distArrive: number;
  distDepart: number;
}

export type Level = 'bloom' | 'sprout' | 'dry' | 'unmeasured';

export const LEVEL_LABELS: Record<Level, string> = { bloom: '盛開', sprout: '小花', dry: '乾土', unmeasured: '沒量到' };

export interface RideSegment {
  fromName: string;
  toName: string;
  tStart: number;
  tEnd: number;
  distanceM: number;
  stableRatio: number;
  events: { type: EventType; peak: number; t: number }[];
  points: number;
  score: number;
  level: Level;
  /** 搭乘中還沒到站的那一段 */
  open?: boolean;
}

/** 每秒的 stable 取樣數，用來算任一時段的 stable 占比（即時與批次共用） */
export class StableIndex {
  private bins = new Map<number, [number, number]>();
  add(t: number, stable: boolean) {
    const k = Math.floor(t / 1000);
    const b = this.bins.get(k) ?? [0, 0];
    if (stable) b[0]++;
    b[1]++;
    this.bins.set(k, b);
  }
  ratio(t0: number, t1: number): number {
    let s = 0, n = 0;
    for (let k = Math.floor(t0 / 1000); k <= Math.floor(t1 / 1000); k++) {
      const b = this.bins.get(k);
      if (b) {
        s += b[0];
        n += b[1];
      }
    }
    return n ? s / n : 0;
  }
  static from(samples: ProcessedSample[]): StableIndex {
    const idx = new StableIndex();
    for (const s of samples) idx.add(s.t, s.stable);
    return idx;
  }
}

interface Candidate {
  /** 有站牌：站序；沒有站牌：-1 */
  idx: number;
  tStart: number;
  distStart: number;
  closestT: number;
  closestD: number;
  closestDist: number;
  firstSlow: { t: number; dist: number } | null;
  lastSlow: { t: number; dist: number } | null;
  /** 沒有站牌時：停夠久、已經記成停靠 */
  visit: StopVisit | null;
}

/** 逐筆推入 GPS，找出停靠。即時（搭乘中）與批次（下車後）用同一套。 */
export class StopTracker {
  visits: StopVisit[] = [];
  distM = 0;
  /** 有站牌時：距離所有站牌都超過 offRouteM 的起始時間 */
  offRouteSince: number | null = null;
  lastT: number;
  private cand: Candidate | null = null;
  private good: GpsFix | null = null;
  private dwellCount = 0;
  private lastIdx = -1;

  constructor(
    private rules: GameRules,
    readonly stops: Stop[] | null,
    t0: number,
  ) {
    this.lastT = t0;
    this.visits.push({ name: '上車處', stopIndex: null, virtual: true, tArrive: t0, tDepart: t0, distArrive: 0, distDepart: 0 });
  }

  push(f: GpsFix) {
    const r = this.rules.segment;
    this.lastT = Math.max(this.lastT, f.t);
    if (f.accuracy > r.maxAccuracyM) return;
    let derived: number | null = null;
    if (this.good) {
      const d = haversineM(this.good.lat, this.good.lon, f.lat, f.lon);
      const dt = (f.t - this.good.t) / 1000;
      if (dt <= 0) return;
      derived = d / dt;
      if (derived <= r.maxJumpSpeedMs) this.distM += d;
    }
    if (!this.good && this.stops) this.detectBoard(f);
    this.good = f;
    const speed = f.speed ?? derived;
    const slow = speed !== null && speed < r.dwellSpeedMs;
    if (this.stops) this.pushWithStops(f, slow);
    else this.pushDwell(f, slow);
  }

  private pushDwell(f: GpsFix, slow: boolean) {
    const r = this.rules.segment;
    if (!slow) {
      this.cand = null;
      return;
    }
    const c = (this.cand ??= this.newCand(-1, f.t, 0));
    if (!c.visit && f.t - c.tStart >= r.dwellMinSec * 1000) {
      const last = this.visits.at(-1)!;
      if (c.distStart - last.distDepart < r.minSegmentM) {
        c.visit = last;
      } else {
        c.visit = { name: `停靠 ${++this.dwellCount}`, stopIndex: null, virtual: false, tArrive: c.tStart, tDepart: c.tStart, distArrive: c.distStart, distDepart: c.distStart };
        this.visits.push(c.visit);
      }
    }
    if (c.visit) {
      c.visit.tDepart = f.t;
      c.visit.distDepart = this.distM;
    }
  }

  private pushWithStops(f: GpsFix, slow: boolean) {
    const stops = this.stops!;
    const r = this.rules;
    // 只往後找（站序遞增），一次最多往後看 8 站，避免繞圈路線跳到很後面的同名站
    const from = this.lastIdx + 1;
    const to = this.lastIdx < 0 ? stops.length : Math.min(stops.length, from + 8);
    let best = -1, bd = Infinity, nearest = Infinity;
    for (let j = 0; j < stops.length; j++) {
      const d = haversineM(stops[j].lat, stops[j].lon, f.lat, f.lon);
      nearest = Math.min(nearest, d);
      if (j >= from && j < to && d < bd) {
        bd = d;
        best = j;
      }
    }
    if (nearest > r.riding.offRouteM) this.offRouteSince ??= f.t;
    else this.offRouteSince = null;

    if (best >= 0 && bd <= r.segment.stopRadiusM) {
      if (this.cand && this.cand.idx !== best) this.closeCand();
      const c = (this.cand ??= this.newCand(best, f.t, bd));
      if (bd < c.closestD) {
        c.closestD = bd;
        c.closestT = f.t;
        c.closestDist = this.distM;
      }
      if (slow) {
        c.firstSlow ??= { t: f.t, dist: this.distM };
        c.lastSlow = { t: f.t, dist: this.distM };
      }
    } else {
      this.closeCand();
    }
  }

  /** 第一筆可用的 GPS：附近有站牌就當作上車站，之後從這一站開始往後找 */
  private detectBoard(f: GpsFix) {
    const near = nearestStop(this.stops!, f.lat, f.lon, this.rules.segment.boardRadiusM);
    if (!near) return;
    this.visits[0].name = this.stops![near.index].name;
    this.visits[0].stopIndex = near.index;
    // 從上車站本身開始找，車還停在站上的話，這次停靠也會被認出來（不計分）
    this.lastIdx = near.index - 1;
  }

  /** 上車站名（有站牌資料且偵測到時），否則 null */
  boardStop(): string | null {
    return this.visits[0].stopIndex !== null ? this.visits[0].name : null;
  }

  /** 最後一筆可用的 GPS */
  lastFix(): GpsFix | null {
    return this.good;
  }

  private newCand(idx: number, t: number, d: number): Candidate {
    return { idx, tStart: t, distStart: this.distM, closestT: t, closestD: d, closestDist: this.distM, firstSlow: null, lastSlow: null, visit: null };
  }

  private candVisit(c: Candidate): StopVisit {
    const a = c.firstSlow ?? { t: c.closestT, dist: c.closestDist };
    const b = c.lastSlow ?? a;
    return { name: this.stops![c.idx].name, stopIndex: c.idx, virtual: false, tArrive: a.t, tDepart: b.t, distArrive: a.dist, distDepart: b.dist };
  }

  private closeCand() {
    const c = this.cand;
    this.cand = null;
    if (!c || c.idx < 0) return;
    this.visits.push(this.candVisit(c));
    this.lastIdx = c.idx;
  }

  /** 目前停靠紀錄，加上「正在站牌範圍內」還沒結束的那一站 */
  currentVisits(): StopVisit[] {
    return this.cand && this.cand.idx >= 0 ? [...this.visits, this.candVisit(this.cand)] : this.visits;
  }

  /** 正在哪一站的範圍內（有站牌時），以及進站多久 (s) */
  atStop(): { index: number; sinceSec: number } | null {
    if (!this.cand || this.cand.idx < 0) return null;
    return { index: this.cand.idx, sinceSec: (this.lastT - this.cand.tStart) / 1000 };
  }

  isDwelling(): boolean {
    return !!this.cand && (this.cand.idx >= 0 ? this.cand.lastSlow !== null : this.cand.visit !== null);
  }

  nextStopName(): string | null {
    if (!this.stops) return null;
    const i = this.cand && this.cand.idx >= 0 ? this.cand.idx + 1 : this.lastIdx + 1;
    return this.stops[i]?.name ?? null;
  }

  finish() {
    if (this.stops) this.closeCand();
  }
}

/** 距 (lat, lon) 最近、且在 maxM 公尺內的站牌 */
export function nearestStop(stops: Stop[], lat: number, lon: number, maxM: number): { index: number; distM: number } | null {
  let best: { index: number; distM: number } | null = null;
  stops.forEach((s, index) => {
    const distM = haversineM(s.lat, s.lon, lat, lon);
    if (distM <= maxM && (!best || distM < best.distM)) best = { index, distM };
  });
  return best;
}

/** 站間等級：任一嚴重事件 → 乾土；否則依點數分盛開、小花、乾土。stable 不足 → 沒量到 */
export function segmentLevel(events: RideSegment['events'], stableRatio: number, rules: GameRules): Pick<RideSegment, 'points' | 'score' | 'level'> {
  const lv = rules.level;
  let points = 0;
  let severe = false;
  for (const e of events) {
    points += lv.weights[e.type];
    if (Math.abs(e.peak) >= lv.severe[e.type]) severe = true;
  }
  const score = Math.max(0, 100 - lv.penaltyPerPoint * points);
  if (stableRatio < rules.segment.minSegmentStableRatio) return { points, score, level: 'unmeasured' };
  const level = severe || points > lv.sproutMaxPoints ? 'dry' : points > 0 ? 'sprout' : 'bloom';
  return { points, score, level };
}

/**
 * 由停靠紀錄切出站間。tEnd、distEnd 是這趟的結尾（搭乘中為「現在」）。
 * 頭尾（上車處、下車處）不足 minSegmentM 的站間略過。
 */
export function buildSegments(
  visits: StopVisit[],
  tEnd: number,
  distEnd: number,
  stable: StableIndex,
  events: TripEvent[],
  rules: GameRules,
  endName = '下車處',
): RideSegment[] {
  const end: StopVisit = { name: endName, stopIndex: null, virtual: true, tArrive: tEnd, tDepart: tEnd, distArrive: distEnd, distDepart: distEnd };
  const all = [...visits, end];
  const out: RideSegment[] = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i], b = all[i + 1];
    const distanceM = b.distArrive - a.distDepart;
    if ((a.virtual || b.virtual) && distanceM < rules.segment.minSegmentM) continue;
    if (b.tArrive <= a.tDepart) continue;
    const evs = events
      .filter((e) => e.tPeak > a.tDepart && e.tPeak <= b.tArrive)
      .map((e) => ({ type: e.type, peak: e.peakValue, t: e.tPeak }));
    const stableRatio = stable.ratio(a.tDepart, b.tArrive);
    out.push({ fromName: a.name, toName: b.name, tStart: a.tDepart, tEnd: b.tArrive, distanceM, stableRatio, events: evs, ...segmentLevel(evs, stableRatio, rules) });
  }
  return out;
}

export interface TripSegments {
  segments: RideSegment[];
  boardStop: string;
  alightStop: string;
}

/**
 * 下車後：用整趟（批次處理後）的資料切站間。
 * - 手動結束：最後一段的終點是按下時 GPS 最近的站牌（alightRadiusM 內），沒有就叫「下車處」。
 * - 自動結束（cutoff）：只保留 cutoff 之前到達的停靠，終點取其中最後一站。
 */
export function segmentTrip(
  samples: ProcessedSample[],
  events: TripEvent[],
  gps: GpsFix[],
  stops: Stop[] | null,
  rules: GameRules,
  cutoff?: number,
): TripSegments {
  if (!samples.length) return { segments: [], boardStop: '上車處', alightStop: '下車處' };
  const tr = new StopTracker(rules, stops, samples[0].t);
  for (const g of [...gps].sort((a, b) => a.t - b.t)) tr.push(g);
  tr.finish();
  const stable = StableIndex.from(samples);
  let segments: RideSegment[];
  if (cutoff !== undefined) {
    const kept = tr.visits.filter((v) => v.tArrive <= cutoff);
    const last = kept[kept.length - 1];
    segments = buildSegments(kept, last.tArrive, last.distArrive, stable, events, rules);
  } else {
    const fix = tr.lastFix();
    const near = stops && fix ? nearestStop(stops, fix.lat, fix.lon, rules.riding.alightRadiusM) : null;
    segments = buildSegments(tr.visits, samples[samples.length - 1].t, tr.distM, stable, events, rules, near ? stops![near.index].name : '下車處');
  }
  return {
    segments,
    boardStop: segments[0]?.fromName ?? tr.visits[0].name,
    alightStop: segments[segments.length - 1]?.toName ?? '下車處',
  };
}

/** TDX StopOfRoute JSON → 某方向的站序 */
export function parseTdxStops(data: unknown, direction: number): { stops: Stop[]; headsign: string } | null {
  if (!Array.isArray(data)) return null;
  const route = data.find((r) => r?.Direction === direction) ?? (direction === 0 ? data[0] : null);
  if (!route?.Stops?.length) return null;
  const stops: Stop[] = [...route.Stops]
    .sort((a, b) => Number(a.StopSequence) - Number(b.StopSequence))
    .map((s) => ({ id: String(s.StopUID ?? s.StopID ?? s.StopSequence), name: s.StopName?.Zh_tw ?? '', lat: Number(s.StopPosition?.PositionLat), lon: Number(s.StopPosition?.PositionLon) }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  return stops.length ? { stops, headsign: stops[stops.length - 1].name } : null;
}
