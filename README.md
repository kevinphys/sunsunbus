# 順順行 sunsunbus

> 開順不開慢：讓人跌倒的是加速度與 jerk，不是速度。

用乘客手機量測台北公車的加速度、急煞、急轉彎與 jerk，補上「台北沒有公開實測資料」的空白。
本 repo 是黑客松的階段一 prototype：一個手機網頁（PWA），加上電腦端的 Python 分析工具。

任務說明見 [`sunsunbus-claude-code-任務書.md`](sunsunbus-claude-code-任務書.md)。

## Repo 結構

```
shared/params.default.json   演算法參數（前端與 Python 共用，調參改這裡）
web/                         手機網頁 PWA（Vite + TypeScript，無框架）
  src/core/                  感測處理純函式模組（與 UI 分離，附單元測試）
  src/app/                   UI：記錄、即時圖表、摘要、匯出、設定
analysis/                    Python 分析工具（同一套演算法的移植＋圖表、統計、地圖）
hardware/                    硬體感測盒 CSV 格式與 ESP32 範例韌體
server/                      選用的極簡後端（只收摘要與事件）
docs/                        實測規劃、資料格式等文件
```

（安裝、部署、上車實測步驟、已知限制與決策紀錄在完成各功能後補上。）
