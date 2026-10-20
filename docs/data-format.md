# 匯出資料格式

每趟記錄在摘要頁可匯出四個檔案，前綴相同：`sunsunbus_<YYYYMMDD-HHMM>_<路線>`。
時間戳全部是 Unix epoch 毫秒（手機時鐘）。CSV 為 UTF-8、逗號分隔、不含引號，空字串表示沒有資料。

## `*_motion.csv`：每一筆 devicemotion 取樣

| 欄位 | 單位 | 說明 |
|---|---|---|
| `t_ms` | ms | `performance.timeOrigin + event.timeStamp`，小數 3 位 |
| `ax, ay, az` | m/s² | `acceleration`（作業系統已扣重力）；部分裝置沒有 |
| `gx, gy, gz` | m/s² | `accelerationIncludingGravity` |
| `rot_alpha, rot_beta, rot_gamma` | deg/s | `rotationRate`，分別繞手機 z、x、y 軸 |
| `interval` | 原樣 | 瀏覽器回報的 `interval`（各平台單位不一，實際頻率以 `t_ms` 計算） |
| `ori_alpha, ori_beta, ori_gamma` | deg | 這筆之前最近一筆 `deviceorientation` |
| `a_long` | m/s² | 縱向加速度，正＝加速、負＝煞車 |
| `a_lat` | m/s² | 橫向加速度，正＝向左 |
| `a_vert` | m/s² | 垂直加速度 |
| `jerk_long, jerk_lat, jerk_mag` | m/s³ | 縱向、橫向加加速度（jerk，加速度的變化率）與水平加加速度大小 |
| `stable` | 0/1 | 靜置判斷（1＝手機穩定放置，事件只採用這些資料） |
| `segment` | 整數 | 校準段：手機被移動後重新校準，段號加一 |
| `orient_source` | 文字 | 前進方向來源：`gps`（GPS 校準）、`pca`（加速度主軸）、`guess`（依擺放猜測） |

`a_long` 以後的欄位是匯出當下用整趟資料批次重算的結果（與摘要頁一致）。分析工具會用原始欄位重新計算，所以調參後不必重新匯出。

## `*_gps.csv`

| 欄位 | 單位 | 說明 |
|---|---|---|
| `t_ms` | ms | `position.timestamp` |
| `lat, lon` | deg | WGS84 |
| `speed` | m/s | 瀏覽器提供的速度，可能空白 |
| `heading` | deg | 正北為 0、順時針，可能空白 |
| `accuracy` | m | 水平精度 |

## `*_events.csv`

| 欄位 | 說明 |
|---|---|
| `type` | `hard_brake` 急煞、`hard_accel` 急加速、`sharp_turn` 急轉彎、`high_jerk` 高加加速度 |
| `label` | 中文名稱 |
| `t_start_ms, t_end_ms, t_peak_ms` | 開始、結束、峰值時間 |
| `duration_s` | 持續秒數 |
| `peak_value` | 依類型的峰值：急煞為最小 `a_long`（負值）、急加速為最大 `a_long`、急轉彎為絕對值最大的 `a_lat`、加加速度為最大 `jerk_mag` |
| `peak_a_long, peak_a_lat, peak_jerk` | 事件期間各量的極值 |
| `lat, lon, speed` | 峰值時間點之前最近的 GPS（5 秒內），沒有則空白 |
| `orient_source` | 峰值當下的前進方向來源 |

## `*_summary.json`

```jsonc
{
  "schemaVersion": 1,
  "app": "sunsunbus",
  "trip": { "createdAt", "endedAt", "route", "plate", "seatRow", "seatSide", "posture", "placement", "testMode" },
  "device": { "userAgent", "platform", "language", "screen" },
  "sampleRateHz": 60,
  "accelSign": 1,            // 加速度正負號慣例（−1 表示該平台與 W3C 規範相反）
  "summary": { "durationSec", "distanceKm", "stableRatio", "counts", "peaks", "jerkThreshold", "jerkP95",
               "exceedanceRatio", "eventsPerKm", "smoothScore" },
  "segments": [ { "id", "tStart", "tEnd", "theta", "source", "quality" } ],
  "markers": [ { "t", "kind": "manual_brake" | "sync_tap" } ],   // 乘客按「剛剛急煞了」與「對時敲擊」
  "gaps": [ { "tStart", "tEnd" } ],                               // 畫面離開、沒有量測的時段
  "thanks": [ 1760000000000 ],                                    // 按「謝謝司機」的時間
  "params": { ... }                                               // 當時使用的完整參數
}
```

`seatRow`：`front` / `middle` / `rear`；`seatSide`：`window` / `aisle`；`posture`：`sit` / `stand`；`placement`：`mount`（支架）/ `seat`（座椅上）/ `hand`（手持）。

## 隱私

這四個檔案含精確時間與軌跡，**只給組員分析用，不要公開**。對外上傳（`server/`）只送摘要：
路線、車牌、時間取整到 15 分鐘、事件類型與約 100 m 格網的位置，不含裝置資訊。
