// 階段 D：事件偵測。
// 每一類事件獨立判斷：條件持續 minDurationSec 才算數；條件中斷不超過 endGapSec 視為同一次
// （去抖動，避免一次煞車算成多次）；只採用穩定（手機靜置）的資料，不穩定時立即結束事件。
import type { Params } from './params';
import type { EventType, GpsFix, ProcessedSample, TripEvent } from './types';
import { EVENT_TYPES } from './types';

interface Active {
  tStart: number;
  lastTrue: number;
  confirmed: boolean;
  best: number;
  tPeak: number;
  peakValue: number;
  peakALong: number;
  peakALat: number;
  peakJerk: number;
  orientSource: ProcessedSample['orientSource'];
}

export type GpsLookup = (t: number) => GpsFix | null;

function condition(type: EventType, s: ProcessedSample, p: Params, jerkThr: number): boolean {
  const e = p.events;
  switch (type) {
    case 'hard_accel':
      return s.aLong > e.accelThreshold;
    case 'hard_brake':
      return s.aLong < -e.brakeThreshold;
    case 'sharp_turn':
      return Math.abs(s.aLat) > e.turnThreshold;
    case 'high_jerk':
      return s.jerkMag > jerkThr;
  }
}

/** 用來挑峰值的分數（越大越極端）與要記錄的帶正負號峰值 */
function metric(type: EventType, s: ProcessedSample): [number, number] {
  switch (type) {
    case 'hard_accel':
      return [s.aLong, s.aLong];
    case 'hard_brake':
      return [-s.aLong, s.aLong];
    case 'sharp_turn':
      return [Math.abs(s.aLat), s.aLat];
    case 'high_jerk':
      return [s.jerkMag, s.jerkMag];
  }
}

const maxAbs = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a);

export class EventDetector {
  private active = new Map<EventType, Active>();

  constructor(
    private p: Params,
    private gpsLookup: GpsLookup = () => null,
  ) {}

  /** 推入一筆資料，回傳這一筆造成「結束」的事件 */
  push(s: ProcessedSample, jerkThr: number): TripEvent[] {
    const out: TripEvent[] = [];
    const e = this.p.events;
    for (const type of EVENT_TYPES) {
      const c = s.stable && condition(type, s, this.p, jerkThr);
      let a = this.active.get(type);
      if (c) {
        if (!a) {
          a = {
            tStart: s.t, lastTrue: s.t, confirmed: false, best: -Infinity, tPeak: s.t,
            peakValue: 0, peakALong: 0, peakALat: 0, peakJerk: 0, orientSource: s.orientSource,
          };
          this.active.set(type, a);
        }
        a.lastTrue = s.t;
        const [score, value] = metric(type, s);
        if (score > a.best) {
          a.best = score;
          a.tPeak = s.t;
          a.peakValue = value;
          a.orientSource = s.orientSource;
        }
        a.peakALong = maxAbs(a.peakALong, s.aLong);
        a.peakALat = maxAbs(a.peakALat, s.aLat);
        a.peakJerk = Math.max(a.peakJerk, s.jerkMag);
        const minDur = type === 'high_jerk' ? e.jerkMinDurationSec : e.minDurationSec;
        if (!a.confirmed && s.t - a.tStart >= minDur * 1000) a.confirmed = true;
      } else if (a) {
        if (!a.confirmed) {
          this.active.delete(type);
        } else if (!s.stable || s.t - a.lastTrue > e.endGapSec * 1000) {
          out.push(this.finish(type, a));
          this.active.delete(type);
        }
      }
    }
    return out;
  }

  /** 結束記錄時，把還在進行中的事件收尾 */
  flush(): TripEvent[] {
    const out: TripEvent[] = [];
    for (const [type, a] of this.active) if (a.confirmed) out.push(this.finish(type, a));
    this.active.clear();
    return out;
  }

  /** 目前正在進行（已確認）的事件類型，給即時畫面用 */
  activeTypes(): EventType[] {
    return [...this.active].filter(([, a]) => a.confirmed).map(([t]) => t);
  }

  private finish(type: EventType, a: Active): TripEvent {
    const fix = this.gpsLookup(a.tPeak);
    return {
      type,
      tStart: a.tStart,
      tEnd: a.lastTrue,
      tPeak: a.tPeak,
      peakValue: a.peakValue,
      peakALong: a.peakALong,
      peakALat: a.peakALat,
      peakJerk: a.peakJerk,
      lat: fix?.lat ?? null,
      lon: fix?.lon ?? null,
      speed: fix?.speed ?? null,
      orientSource: a.orientSource,
    };
  }
}

/** 二分搜尋：時間 t 之前（含）最近的一筆 GPS；超過 maxAgeMs 視為沒有 */
export function makeGpsLookup(fixes: GpsFix[], maxAgeMs = 5000): GpsLookup {
  return (t) => {
    let lo = 0;
    let hi = fixes.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fixes[mid].t <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (ans < 0) return null;
    return t - fixes[ans].t <= maxAgeMs ? fixes[ans] : null;
  };
}
