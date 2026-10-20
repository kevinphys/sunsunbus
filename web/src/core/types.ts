// 感測資料與處理結果的型別。所有時間戳都是 Unix epoch 毫秒。

/** 一筆 devicemotion 取樣（手機座標系，W3C 定義：x 向右、y 向上（螢幕頂端）、z 朝螢幕外） */
export interface MotionSample {
  t: number;
  /** acceleration：作業系統已扣掉重力的線性加速度 (m/s²)；部分裝置沒有 */
  ax: number | null;
  ay: number | null;
  az: number | null;
  /** accelerationIncludingGravity (m/s²) */
  gx: number;
  gy: number;
  gz: number;
  /** rotationRate (deg/s)：alpha 繞 z、beta 繞 x、gamma 繞 y */
  ra: number | null;
  rb: number | null;
  rg: number | null;
  /** 瀏覽器回報的 interval，原樣保存（各平台單位不一，實際頻率以時間戳計算） */
  interval: number | null;
}

/** 一筆 deviceorientation 取樣 (deg) */
export interface OrientationSample {
  t: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

/** 一筆 GPS 定位 */
export interface GpsFix {
  t: number;
  lat: number;
  lon: number;
  /** m/s，瀏覽器可能給 null */
  speed: number | null;
  /** deg，瀏覽器可能給 null */
  heading: number | null;
  /** 水平精度 (m) */
  accuracy: number;
}

export type OrientSource = 'guess' | 'pca' | 'gps';

export type EventType = 'hard_accel' | 'hard_brake' | 'sharp_turn' | 'high_jerk';

export const EVENT_TYPES: EventType[] = ['hard_brake', 'hard_accel', 'sharp_turn', 'high_jerk'];

export const EVENT_LABELS: Record<EventType, string> = {
  hard_brake: '急煞',
  hard_accel: '急加速',
  sharp_turn: '急轉彎',
  high_jerk: '高 jerk',
};

/** 階段 A 輸出：已換到「水平面 + 垂直」座標，但前進方向尚未決定 */
export interface FrameSample {
  t: number;
  /** 濾波後的水平加速度，在本段的水平基底 (e1, e2) 上的分量 (m/s²) */
  h1: number;
  h2: number;
  /** 濾波後的垂直加速度（向上為正，若無法判斷重力正負號則可能相反） */
  v: number;
  stable: boolean;
  /** 校準段編號：手機被移動後重新校準，段號 +1 */
  segment: number;
  /** 本段由手機擺放姿態猜的前進方向角 (rad, 在 e1/e2 平面) */
  guessTheta: number;
  /** 視窗內重力方向最大偏角 (deg) */
  gravAngle: number;
  /** 視窗內非偏航方向的轉動速率 RMS (deg/s)，沒有陀螺儀時為 NaN */
  tiltRms: number;
}

/** 完整處理後的一筆資料（車輛座標） */
export interface ProcessedSample {
  t: number;
  /** 縱向加速度：正為加速、負為煞車 (m/s²) */
  aLong: number;
  /** 橫向加速度：正為向左 (m/s²) */
  aLat: number;
  /** 垂直加速度 (m/s²) */
  aVert: number;
  /** jerk (m/s³) */
  jerkLong: number;
  jerkLat: number;
  /** 水平 jerk 大小 */
  jerkMag: number;
  stable: boolean;
  segment: number;
  theta: number;
  orientSource: OrientSource;
}

export interface TripEvent {
  type: EventType;
  tStart: number;
  tEnd: number;
  tPeak: number;
  /** 依類型的峰值：急加速取最大 aLong、急煞取最小 aLong、急轉彎取絕對值最大的 aLat、jerk 取最大 jerkMag */
  peakValue: number;
  peakALong: number;
  peakALat: number;
  peakJerk: number;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  orientSource: OrientSource;
}

export interface SegmentInfo {
  id: number;
  tStart: number;
  tEnd: number;
  theta: number;
  source: OrientSource;
  /** GPS 校準時為相關係數 r；PCA 為異向比；猜測為 0 */
  quality: number;
}

export interface TripSummary {
  durationSec: number;
  distanceKm: number;
  sampleCount: number;
  sampleRateHz: number;
  stableRatio: number;
  counts: Record<EventType, number>;
  peaks: {
    maxAccel: number;
    maxBrake: number;
    maxLat: number;
    maxJerk: number;
  };
  jerkThreshold: number;
  jerkP95: number | null;
  /** 穩定區段中，任一加速度門檻超標的時間比例 */
  exceedanceRatio: number;
  eventsPerKm: number;
  smoothScore: number;
}
