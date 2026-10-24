# 順順行 sunsunbus

線上試玩：<https://kevinphys.github.io/sunsunbus/play.html>

Demo 影片：<https://youtube.com/shorts/fMHd2bKCxgo?feature=share>


<img width="294" height="517" alt="Screenshot 2026-10-24 at 6 02 13 PM" src="https://github.com/user-attachments/assets/e6bf94f6-9430-480d-9699-6521bd1f81ab" />
<img width="292" height="517" alt="Screenshot 2026-10-24 at 5 59 54 PM" src="https://github.com/user-attachments/assets/97ed8abb-674f-4135-9708-a15d9210493a" />
<img width="294" height="517" alt="Screenshot 2026-10-24 at 6 00 13 PM" src="https://github.com/user-attachments/assets/92bc8d59-f968-4c0a-a0b4-d44e69c86fcd" />




> 開順不開慢：讓人跌倒的是加速度與加加速度（jerk），不是速度。

用乘客手機量測台北公車的加速度、急煞、急轉彎與加加速度，補上「台北沒有公開實測資料」的空白。

**加加速度（jerk）** 是加速度的變化率，單位 m/s³。加速度變化越突然（例如煞車一下踩到底、起步猛催油門），加加速度越大，站立乘客越容易來不及反應而失去平衡。
本 repo 是黑客松的階段一 prototype：一個手機網頁（PWA），加上電腦端的 Python 分析工具。


**[原型一（實測版）](<https://kevinphys.github.io/sunsunbus/>)**：免安裝的網頁 App，讓乘客上車就能透過手機偵測，得到可視化資料，實測流程見 [`docs/field-test-plan.md`](docs/field-test-plan.md)。

**[原型二（遊戲版）](<https://kevinphys.github.io/sunsunbus/play.html>)**：乘客是小水滴，每個站間依平穩度開花（盛開、小花、乾土），有效的一趟採 1 顆果實。
規則、試玩方式與實測校正見 [`docs/prototype2.md`](docs/prototype2.md)。


## 功能

**手機網頁（`web/`）**
- 「上車開始」：選填路線、車牌、座位、放置方式；網址參數 `?route=中山幹線&plate=KKA-1234` 可預先帶入（給 QR code 或 NFC 貼紙用）
- 擷取 devicemotion（含／不含重力加速度、轉動速率）、deviceorientation、GPS，每筆帶毫秒時間戳
- 手機座標 → 車輛座標（縱向、橫向、垂直），低通濾波、加加速度、靜置偵測、事件偵測（急煞、急加速、急轉彎、高加加速度）
- 即時折線圖（最近 30 秒）、事件計數、平穩分數；「搖手機測試」模式給評審現場試玩
- 「✋ 剛剛急煞了」人工標記、「🔔 對時敲擊」與硬體盒對時
- 結束後的摘要：時長、距離、事件、峰值、平穩分數、事件地圖（Leaflet + OSM）、「🙏 謝謝司機」
- 資料只存在手機（IndexedDB）；匯出原始資料 CSV、GPS CSV、事件 CSV、摘要 JSON
- 螢幕常亮（Screen Wake Lock）、離開畫面的時段會被記錄並提醒
- PWA：可加到主畫面、離線也能記錄
- 設定頁可調門檻；`?simulate=1` 用合成的公車行程在電腦上展示

**分析工具（`analysis/`）**：同一套演算法的 Python 版（與前端有一致性測試）、每趟時間序列圖、分布、事件地圖、路線 × 時段事件率、事件對應到站間（TDX）、手機與硬體盒比較、Jupyter notebook。

**其他**：硬體感測盒 CSV 格式與 ESP32 範例韌體（`hardware/`）、選用的匿名摘要後端（`server/`）。

## Repo 結構

```
shared/params.default.json   演算法參數（前端與 Python 共用，調參改這裡）
shared/game.default.json     遊戲版規則參數（站間、開花、果實）
web/                         手機網頁 PWA（Vite + TypeScript，無框架）
  src/core/                  感測處理純函式模組（與 UI 分離，附單元測試）
  src/app/                   UI：記錄、即時圖表、摘要、匯出、設定
  src/game/                  遊戲版規則純函式（站間切分、開花、果實，附單元測試）
  src/play/                  遊戲版畫面（play.html）
  scripts/                   對照資料產生、QR code、圖示
analysis/                    Python 分析工具（uv 專案）
  sunsunbus/core.py          演算法的 Python 移植
  notebooks/explore.ipynb    資料探索
  tests/fixtures/            前端產生的對照資料
hardware/                    ESP32 + MPU6050 範例韌體
server/                      選用的極簡後端（FastAPI + SQLite）
docs/                        資料格式、硬體格式、實測規劃
```

## 快速開始

需要 Node.js 22 以上、[uv](https://docs.astral.sh/uv/)（Python 工具）。

```bash
cd web
npm install
npm run dev          # https://localhost:5173 ，同時開在區網
npm test             # 單元測試
```

**用手機連到開發機測試**：手機與電腦連同一個 Wi-Fi，打開 `npm run dev` 印出的 `Network: https://192.168.x.x:5173`。
開發伺服器用自簽憑證（`@vitejs/plugin-basic-ssl`），手機會警告「連線不是私人連線」：
iPhone Safari 按「顯示詳細資訊 → 瀏覽此網站」，Android Chrome 按「進階 → 繼續前往」。
加速度感測器必須在 HTTPS 下才能用，所以不能用 `http://`。

若公司或學校 Wi-Fi 擋住裝置互連，可以用 `npx cloudflared tunnel --url https://localhost:5173 --no-tls-verify` 產生臨時的公開 HTTPS 網址。

**電腦上展示**：開 `https://localhost:5173/?simulate=1`，會播放一段 3 分鐘、循環的合成公車行程（起步、急煞、轉彎、靠站）。

## 部署（GitHub Pages）

1. GitHub repo → Settings → Pages → Source 選 **GitHub Actions**。
2. 推到 `main`，`.github/workflows/deploy.yml` 會跑全部測試、建置並部署到 `https://<帳號>.github.io/sunsunbus/`。
3. 產生 QR code：`cd web && npm run qr -- "https://<帳號>.github.io/sunsunbus/?route=中山幹線"`（終端機顯示並存成 PNG）。網頁的「🔗 QR code」頁也可以直接顯示。
4. （選用）部署後端後，在 repo 的 Settings → Variables 新增 `VITE_API_BASE`，摘要頁就會出現「匿名上傳摘要」按鈕。

## 上車實測

完整流程、器材、趟次安排見 [`docs/field-test-plan.md`](docs/field-test-plan.md)。重點：

1. **放好再開始**：支架夾緊、或平放在座椅上。手持時畫面會提示「請把手機放在支架或座椅上」，那段資料不會拿來判斷事件。
2. **記錄座位與放法**：首頁選前排／中段／後排、靠窗／走道、坐／站，以及支架／座椅上／手持。
3. **不要鎖屏、不要切 App**：網頁在背景收不到感測資料。
4. **起步幾次後**，記錄頁的「方向」會從「依擺放猜測」變成「GPS 校準」，之後的縱向、橫向才準。（結束後的摘要會用整趟資料回頭重算，所以前幾十秒也會修正。）
5. 下車按「下車結束」→「分享全部檔案」，存到團隊雲端硬碟。

## 分析工具

```bash
cd analysis
uv sync                                    # 安裝
uv run pytest                              # 測試（含與前端的一致性測試）
uv run sunsunbus report data/ --out output/                      # 分析 data/ 下所有趟次
uv run sunsunbus report data/ --params my-params.json            # 用不同參數重算（只寫要改的欄位）
uv run sunsunbus compare-box data/<手機趟次前綴> data/box_0001.csv  # 手機 vs 硬體盒
TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... uv run sunsunbus fetch-tdx 中山幹線 --out data/routes
uv run sunsunbus report data/ --route-shape data/routes/中山幹線_Shape.json --stops data/routes/中山幹線_StopOfRoute.json
uv sync --extra notebook && uv run jupyter lab notebooks/explore.ipynb
```

`report` 輸出：每趟時間序列圖（`plots/`）、`trips.csv`、`events.csv`、依路線 × 小時、尖離峰、放置方式、座位的事件率（`rates_by_*.csv`，未滿 10 趟標記不公開）、分布圖、事件地圖（`events_map.html`）、`report.md`。

**改演算法時**：前端 `web/src/core/` 與 `analysis/sunsunbus/core.py` 要一起改，接著 `cd web && npm run fixtures` 重新產生對照資料，再跑兩邊的測試。

## 硬體對照組與後端

- 感測盒 CSV 格式與對時：[`docs/hardware-format.md`](docs/hardware-format.md)；範例韌體：[`hardware/`](hardware/)。
- 後端（選用）：`cd server && uv run uvicorn app:app --port 8787`。只收已匿名化的摘要（時間取整到 15 分鐘、位置約 100 m 格網、無裝置資訊），統計未滿 10 趟不公開。

## 演算法

```
devicemotion ─▶ 重力估計 ─▶ 低通濾波（2 階 Butterworth，3 Hz）─▶ 投影到水平面與垂直
                                  │
                         靜置偵測（1 秒視窗：重力方向偏角、扣除偏航的轉動速率）
                                  │ 手機被移動 → 新的校準段
GPS dv/dt ─────────────▶ 前進方向估計（GPS 交叉共變異 → PCA＋速度不為負 → 依擺放猜測）
                                  ▼
                     縱向 a_long、橫向 a_lat、加加速度（水平基底上差分再旋轉）
                                  ▼
             事件偵測（只用穩定資料；持續時間門檻＋去抖動）→ 摘要、平穩分數
```

| 事件 | 預設條件 | 依據 |
|---|---|---|
| 急加速 | a_long > 1.5 m/s²，持續 0.3 秒 | Krašna et al. 2021 建議上限 |
| 急煞 | a_long < −1.0 m/s²，持續 0.3 秒 | 同上 |
| 急轉彎 | \|a_lat\| > 1.5 m/s²，持續 0.3 秒 | 可調 |
| 高加加速度（jerk） | 水平加加速度 > min(max(本趟 P95, 3.0), 10.0) m/s³，持續 0.1 秒 | 無公認上限，先用分布前 5% |

**平穩分數** = clamp(100 − 10 × 加權事件數 ÷ km, 0, 100)，權重：急煞 1.5、急加速 1、急轉彎 1、高加加速度 0.5；里程至少以 1 km 計。所有參數在 [`shared/params.default.json`](shared/params.default.json)。

## 已知限制

- **鎖屏或切到其他 App 就停止記錄**：瀏覽器只對可見的頁面送出感測事件。已用 Screen Wake Lock 防止自動鎖屏，並記錄中斷時段；iPhone「加到主畫面」後螢幕常亮是否有效**待實機驗證**。
- **取樣頻率因手機而異**：iPhone 通常約 60 Hz；Android 依機型與瀏覽器不同。實際頻率記錄在摘要（`sampleRateHz`），演算法以時間戳計算，不假設固定頻率。
- **前幾十秒方向不準**：上車後到 GPS 校準完成前，縱向／橫向用擺放姿態猜測。即時畫面可能把加速標成煞車；結束後的摘要會回頭修正。
- **GPS 差的地方**（地下道、高樓間）方向改用加速度主軸估計；完全沒有 GPS 時距離與每公里事件數無法計算，分數以時長換算里程。
- **沒有陀螺儀的手機**：急煞時重力方向估計會被拉偏，可能把急煞的一部分判為「不穩定」而漏記。
- **加速度正負號**：部分平台的 accelerationIncludingGravity 正負號與 W3C 規範相反，用 deviceorientation 自動判斷；沒有 deviceorientation 權限時假設符合規範。
- **橫向左右**、**垂直上下**的正負號只在上述判斷成功時可靠；事件只用絕對值，不受影響。
- **門檻都還沒用台北實測資料校準**：靜置偵測、加加速度下限、平穩分數都是合理的預設值，請依實測結果調整。
- 原始高頻資料**不上傳**，只能由組員手動匯出分享（見決策紀錄）。

## 決策紀錄

| # | 決策 | 理由 |
|---|---|---|
| 1 | 前端用 Vite + TypeScript、不用框架 | 畫面少、要省電、bundle 小（約 75 kB gzip，多數是 Leaflet）；感測邏輯與 UI 完全分離，日後換框架或改原生 App 都能沿用 `src/core/` |
| 2 | 用 Vite 7 而非 8 | `vite-plugin-pwa` 穩定版（1.2）還不支援 Vite 8，支援 Vite 8 的 2.0 剛發布不到三週 |
| 3 | 演算法分成四個階段（重力與水平面 → 前進方向 → 車輛座標與加加速度 → 事件），各自是純粹的類別 | 好測試；Python 逐段移植；批次與即時共用同一份程式碼 |
| 4 | 結束後用整趟資料「批次重算」，而不是沿用即時結果 | 即時處理只能用當下的方向估計與部分 P95；批次可以讓每個校準段用最終方向回頭修正，也與 Python 分析結果一致 |
| 5 | GPS 校準用「交叉共變異向量」而非 2×2 最小平方 | 公車幾乎沒有持續的橫向加速度，最小平方會把雜訊放大成數十度的誤差（合成資料測試中誤差 54° 至 60°） |
| 6 | 沒有 GPS 時用「速度不為負」決定 PCA 主軸正負號 | 原本的「停車後第一次加速」無法區分停車與等速行駛，會把從等速煞車當成起步 |
| 7 | 沒有 OS 線性加速度時，重力用「快、慢」兩個估計 | 只用 1 秒低通等於 1 秒高通，持續數秒的起步加速會被濾掉；硬體盒與部分 Android 會受影響 |
| 8 | 加加速度先在手機水平基底差分、再旋轉到車輛座標；高加加速度事件用水平加加速度大小 | 方向估計更新時不會產生假尖峰；起步與轉彎進出都會反映 |
| 9 | 高加加速度門檻 = min(max(P95, 3.0), 10.0)，最短持續 0.1 秒 | 任務書要求「P95 或絕對門檻」；下限 3.0 避免很平穩的一趟把正常起步（約 2.75 m/s³）標成事件；加加速度尖峰本來就短，0.3 秒會把全部加加速度事件濾掉 |
| 10 | 平穩分數里程至少以 1 km 計 | 很短的一趟一個事件就會扣到 0 分 |
| 11 | 匯出拆成四個檔案（motion、gps、events、summary） | 不同取樣率的資料分開比較好讀；Python 用同一個前綴讀回 |
| 12 | 原始高頻資料不做上傳，組員用「分享全部檔案」交換 | 一小時約 20 萬筆，上傳需要較完整的後端與權限管理；黑客松階段只有組員需要原始資料 |
| 13 | 上傳的事件位置取到小數 3 位（約 100 m）當作「路段」 | 手機端沒有路線線型；精確對應路段在分析端用 TDX 線型做 |
| 14 | 事件時不讓手機震動 | 震動馬達會污染加速度量測 |
| 15 | 加入「✋ 剛剛急煞了」按鈕 | 參考 Ma 2018 用人工記錄驗證自動偵測 |
| 16 | 搖手機測試模式關閉靜置檢查 | 評審搖手機時手機一定「不穩定」，不關掉就看不到事件 |
| 17 | 本機開發用 `@vitejs/plugin-basic-ssl` 自簽憑證，不強制 mkcert | 不用安裝額外工具；手機接受一次警告即可 |
| 18 | Python 演算法是移植而不是共用程式碼 | 分析工具要能讀大量資料、調參、畫圖；用一致性測試（`npm run fixtures` + `pytest`）保證結果相同 |
| 19 | 後端與分析統計都採「未滿 10 趟不公開」 | 任務書隱私原則 |
| 20 | 遊戲版做成同一個 PWA 的第二個頁面（`play.html`），不另開專案 | 直接沿用感測、事件偵測、儲存與匯出；研究用記錄器保留給實測 |
| 21 | 遊戲規則參數另放 `shared/game.default.json` | 調開花門檻不影響事件偵測，也不影響 TS／Python 一致性測試 |
| 22 | 沒有站牌資料時用「停車 ≥ 5 秒」推測停靠 | TDX 金鑰不能放前端；先讓任何路線都能玩，紅燈被算成停靠是已知限制 |
| 23 | 高加加速度事件不計入開花（點數 0） | 第一趟實測（656 後排）大多是等速行駛的路面顛簸；計入時 8 段有 6 段乾土，其中一段 2.2 km 沒有任何急煞 |
| 24 | 上車站用 GPS 自動偵測，不要求先選下車站；下車改由乘客按「我下車了」 | wireframe 第二版：大多數人上車不會想設定下車站；自動結束（10 分鐘）只當忘了按的保護，結束點取最後一個穩定量測的站 |
| 25 | 遊戲版的站序用臺北市政府公車動態資訊（data.taipei），存成靜態檔隨網站部署 | 免金鑰，可以放在 GitHub Pages；TDX 需要金鑰，不能放前端。沒有站序時上車站、下車站、往哪裡都顯示不出來 |
