// 設定頁的參數覆寫，存在 localStorage（只影響這支手機）。
import { DEFAULT_PARAMS, mergeParams, type ParamOverrides, type Params } from '../core/params';

const KEY = 'sunsunbus.params';
const LAST_SETUP = 'sunsunbus.lastSetup';

export function loadParams(): Params {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? mergeParams(JSON.parse(raw) as ParamOverrides) : structuredClone(DEFAULT_PARAMS);
  } catch {
    return structuredClone(DEFAULT_PARAMS);
  }
}

export function saveParams(p: Params) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 無痕模式等情況存不了，就只用預設值 */
  }
}

export function resetParams() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loadLastSetup<T>(): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SETUP) ?? '{}') as Partial<T>;
  } catch {
    return {};
  }
}

export function saveLastSetup(v: unknown) {
  try {
    localStorage.setItem(LAST_SETUP, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** 設定頁顯示的欄位：[路徑, 標籤, 單位, step] */
export const SETTING_FIELDS: [string, string, string, number][] = [
  ['events.accelThreshold', '急加速門檻', 'm/s²', 0.1],
  ['events.brakeThreshold', '急煞門檻', 'm/s²', 0.1],
  ['events.turnThreshold', '急轉彎門檻', 'm/s²', 0.1],
  ['events.jerkPercentile', '高 jerk 百分位', '%', 1],
  ['events.jerkFloor', 'jerk 門檻下限', 'm/s³', 0.5],
  ['events.jerkAbsThreshold', 'jerk 絕對門檻', 'm/s³', 0.5],
  ['events.minDurationSec', '事件最短持續', 's', 0.05],
  ['events.jerkMinDurationSec', 'jerk 事件最短持續', 's', 0.05],
  ['events.endGapSec', '去抖動間隔', 's', 0.1],
  ['lowpassCutoffHz', '低通截止頻率', 'Hz', 0.5],
  ['jerkWindowSec', 'jerk 差分跨度', 's', 0.05],
  ['stability.maxGravityAngleDeg', '靜置：重力偏角上限', '°', 0.5],
  ['stability.maxTiltRateRmsDps', '靜置：轉動速率上限', '°/s', 0.5],
  ['stability.minStableSec', '靜置：需持續', 's', 0.5],
  ['score.penaltyPerWeightedEventPerKm', '平穩分數：每公里每事件扣分', '分', 1],
];

export function getPath(obj: unknown, path: string): number {
  return path.split('.').reduce((o: any, k) => o?.[k], obj) as number;
}

export function setPath(obj: unknown, path: string, value: number) {
  const keys = path.split('.');
  let o: any = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)!] = value;
}
