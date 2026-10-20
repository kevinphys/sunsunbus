// 演算法參數。預設值放在 repo 根目錄 shared/params.default.json，
// 前端與 Python 分析工具讀同一份，調參時改那個檔案即可。
import defaults from '../../../shared/params.default.json';
import type { EventType } from './types';

export interface Params {
  /** 沒有 OS 線性加速度時，用 accelerationIncludingGravity 低通估計重力的時間常數 (s)：用於靜置偵測 */
  gravityTauSec: number;
  /** 同上，但手機穩定時用來扣重力的慢速估計 (s)；太短會把持續的加減速當成重力濾掉 */
  gravityStableTauSec: number;
  /** 有 OS 線性加速度時，平滑 (accIncG − acc) 重力向量的時間常數 (s) */
  osGravitySmoothSec: number;
  useOsLinearAcceleration: boolean;
  /** 低通濾波截止頻率 (Hz)：去除車身震動 */
  lowpassCutoffHz: number;
  /** 加加速度（jerk）差分的時間跨度 (s) */
  jerkWindowSec: number;
  stability: {
    windowSec: number;
    maxGravityAngleDeg: number;
    maxTiltRateRmsDps: number;
    minStableSec: number;
    recalibrateAfterUnstableSec: number;
    recalibrateGravityDriftDeg: number;
  };
  orientation: {
    gpsMaxAccuracyM: number;
    gpsMinIntervalSec: number;
    gpsMaxIntervalSec: number;
    gpsMinPairs: number;
    gpsMinDvdtStd: number;
    gpsMinR: number;
    pcaMinSamples: number;
    pcaMinHorizAccel: number;
    pcaMinAnisotropy: number;
    velocityDeadbandAccel: number;
    velocityPathIntervalSec: number;
  };
  events: {
    accelThreshold: number;
    brakeThreshold: number;
    turnThreshold: number;
    jerkPercentile: number;
    jerkFloor: number;
    jerkAbsThreshold: number;
    jerkMinSamplesForPercentile: number;
    minDurationSec: number;
    /** 加加速度是微分量，尖峰本來就短，用較短的最短持續時間 */
    jerkMinDurationSec: number;
    endGapSec: number;
  };
  score: {
    weights: Record<EventType, number>;
    penaltyPerWeightedEventPerKm: number;
    fallbackKmPerMin: number;
    minKm: number;
  };
}

export const DEFAULT_PARAMS: Params = defaults as Params;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ParamOverrides = DeepPartial<Params>;

/** 深層合併參數覆寫（設定頁、測試用） */
export function mergeParams(overrides: ParamOverrides = {}, base: Params = DEFAULT_PARAMS): Params {
  return deepMerge(structuredClone(base), overrides) as Params;
}

function deepMerge(target: any, src: any): any {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] ?? {}, v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}

/**
 * 高加加速度門檻：本趟加加速度分布的第 N 百分位（不低於 jerkFloor），或絕對門檻，取較低者。
 * 也就是「超過 P95 或超過絕對門檻」都算；jerkFloor 避免很平穩的一趟把小擾動也標成事件。
 * 樣本不足時只用絕對門檻。
 */
export function jerkThreshold(percentileValue: number | null, p: Params): number {
  const e = p.events;
  if (percentileValue === null) return e.jerkAbsThreshold;
  return Math.min(Math.max(percentileValue, e.jerkFloor), e.jerkAbsThreshold);
}
