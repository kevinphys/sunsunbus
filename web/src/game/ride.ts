// 一趟的遊戲結果：有沒有效、採到幾顆果實、是不是探路果。
// 果實只看「有沒有完成有效量測」，與站間開得好壞無關；乾土只改變果實外觀（探路果，價值相同）。
import type { GameRules } from './rules';
import type { Level, RideSegment } from './segments';

export type InvalidReason = 'handheld' | 'too_few_segments' | 'daily_cap';

export interface RideResult {
  segments: RideSegment[];
  valid: boolean;
  invalidReason?: InvalidReason;
  fruit: number;
  fruitKind: 'normal' | 'scout';
  levelCounts: Record<Level, number>;
  stableRatio: number;
  /** 用了站牌資料（站名是真的）還是停靠推測 */
  stopSource: 'tdx' | 'dwell';
  /** 忘了按「我下車了」時的自動結束原因 */
  autoEnded?: 'off_route' | 'unstable';
  boardStop?: string;
  alightStop?: string;
  thirst: boolean;
  /** 經過整條路線的第一站與最後一站（有站牌資料時） */
  fullRoute?: boolean;
  /** 採完這趟後的果實數（下車 review 顯示用） */
  balanceAfter?: number;
}

export function evaluateRide(
  segments: RideSegment[],
  stableRatio: number,
  fruitsToday: number,
  rules: GameRules,
  opts: { stopSource: RideResult['stopSource']; thirst?: boolean; autoEnded?: RideResult['autoEnded'] },
): RideResult {
  const r = rules.ride;
  const levelCounts: Record<Level, number> = { bloom: 0, sprout: 0, dry: 0, unmeasured: 0 };
  for (const s of segments) levelCounts[s.level]++;
  const measured = segments.length - levelCounts.unmeasured;
  const base = { segments, levelCounts, stableRatio, stopSource: opts.stopSource, autoEnded: opts.autoEnded, thirst: !!opts.thirst };
  const fruitKind = measured > 0 && levelCounts.dry / measured >= r.scoutDryShare ? 'scout' : 'normal';

  let invalidReason: InvalidReason | undefined;
  if (stableRatio < r.minStableRatio) invalidReason = 'handheld';
  else if (measured < r.minSegments) invalidReason = 'too_few_segments';
  else if (fruitsToday >= r.dailyCap) invalidReason = 'daily_cap';
  if (invalidReason) return { ...base, valid: false, invalidReason, fruit: 0, fruitKind };

  const fruit = Math.min(opts.thirst ? r.thirstMultiplier : 1, r.dailyCap - fruitsToday);
  return { ...base, valid: true, fruit, fruitKind };
}

/** 路線水果圖鑑：中山幹線固定芭樂，其他路線依名稱雜湊分配 */
const FRUITS = ['蓮霧', '鳳梨', '芒果', '荔枝', '柚子', '楊桃', '西瓜', '香蕉', '木瓜', '龍眼', '釋迦', '橘子'];
export function routeFruit(route: string): string {
  if (route === '中山幹線') return '芭樂';
  let h = 0;
  for (const c of route) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return FRUITS[h % FRUITS.length];
}
