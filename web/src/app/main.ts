// 順順行 sunsunbus 手機網頁：畫面與流程。
// 畫面：首頁（填路線、上車開始）→ 記錄中（即時圖表）→ 本趟摘要（地圖、匯出、謝謝司機）。
import './style.css';
import QRCode from 'qrcode';
import { registerSW } from 'virtual:pwa-register';
import { DEFAULT_PARAMS, type Params } from '../core/params';
import { EVENT_LABELS, EVENT_TYPES, type GpsFix, type TripEvent } from '../core/types';
import { smoothScore } from '../core/summary';
import { haversineM } from '../core/math';
import { SIMULATE, requestMotionPermission } from './sensors';
import { Recorder, finalizeTrip, type TripSetup } from './recorder';
import { deleteTrip, getTrip, listTrips, loadRaw, requestPersistence, saveTrip, type TripMeta } from './storage';
import { LiveChart } from './chart';
import { SETTING_FIELDS, getPath, loadLastSetup, loadParams, resetParams, saveLastSetup, saveParams, setPath } from './settings';
import { buildExportFiles, download, shareFiles } from './export';
import { EVENT_COLORS, renderTripMap } from './map';
import { API_BASE, uploadTrip } from './upload';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app')!;
let recorder: Recorder | null = null;
let cleanup: (() => void) | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const fmtDuration = (sec: number) => `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`;

function render(html: string) {
  cleanup?.();
  cleanup = null;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function toast(msg: string, kind: 'info' | 'event' | 'warn' = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- 首頁 ----------

const ROUTE_SUGGESTIONS = ['中山幹線', '信義幹線', '敦化幹線', '民生幹線', '南京幹線', '307', '262', '650'];

function homeView() {
  const q = new URLSearchParams(location.search);
  const last = loadLastSetup<TripSetup>();
  const v = {
    route: q.get('route') ?? last.route ?? '',
    plate: q.get('plate') ?? last.plate ?? '',
    seatRow: (q.get('seat') as TripSetup['seatRow']) ?? last.seatRow ?? '',
    seatSide: last.seatSide ?? '',
    posture: last.posture ?? '',
    placement: (q.get('placement') as TripSetup['placement']) ?? last.placement ?? 'mount',
  };
  const radio = (name: string, opts: [string, string][], cur: string) =>
    `<div class="seg" role="radiogroup">${opts
      .map(([val, label]) => `<label><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><span>${label}</span></label>`)
      .join('')}</div>`;
  const secure = window.isSecureContext;

  render(`
    <header class="hero">
      <h1>順順行</h1>
      <p class="tagline">開順不開慢・用手機量測公車平穩度</p>
    </header>
    ${secure ? '' : '<p class="warn">⚠️ 這個網頁不是 HTTPS，手機的加速度感測器無法使用。</p>'}
    ${SIMULATE ? '<p class="warn">模擬模式：使用合成的公車行程，不讀取真實感測器。</p>' : ''}
    <form id="setup" class="card">
      <label class="field">路線<input name="route" list="routes" value="${esc(v.route)}" placeholder="例：中山幹線" autocomplete="off"></label>
      <datalist id="routes">${ROUTE_SUGGESTIONS.map((r) => `<option value="${r}">`).join('')}</datalist>
      <label class="field">車牌（選填）<input name="plate" value="${esc(v.plate)}" placeholder="例：KKA-1234" autocomplete="off" autocapitalize="characters"></label>
      <div class="field">手機放在哪裡${radio('placement', [['mount', '支架'], ['seat', '座椅上'], ['hand', '手持']], v.placement)}</div>
      <div class="field">座位${radio('seatRow', [['front', '前排'], ['middle', '中段'], ['rear', '後排']], v.seatRow)}</div>
      <div class="field">${radio('seatSide', [['window', '靠窗'], ['aisle', '走道']], v.seatSide)}</div>
      <div class="field">${radio('posture', [['sit', '坐'], ['stand', '站']], v.posture)}</div>
      <button class="big primary" type="submit">上車開始</button>
      <p class="hint">記錄中請保持這個畫面開著（鎖屏或切到其他 App 會停止量測）。資料只存在這支手機。</p>
    </form>
    <nav class="links">
      <button id="shake" class="secondary">🤳 搖手機測試</button>
      <button id="history" class="secondary">📋 紀錄</button>
      <button id="settings" class="secondary">⚙️ 設定</button>
      <button id="share" class="secondary">🔗 QR code</button>
    </nav>
    <p class="hint"><a href="play.html${SIMULATE ? '?simulate=1' : ''}">試玩遊戲版（原型二）</a></p>
  `);

  const form = document.querySelector<HTMLFormElement>('#setup')!;
  const readSetup = (testMode: boolean): TripSetup => {
    const d = new FormData(form);
    const s = (k: string) => String(d.get(k) ?? '').trim();
    return {
      route: testMode ? '搖手機測試' : s('route'),
      plate: testMode ? '' : s('plate').toUpperCase(),
      seatRow: s('seatRow') as TripSetup['seatRow'],
      seatSide: s('seatSide') as TripSetup['seatSide'],
      posture: s('posture') as TripSetup['posture'],
      placement: testMode ? 'hand' : (s('placement') as TripSetup['placement']),
      testMode,
    };
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const setup = readSetup(false);
    saveLastSetup(setup);
    void startTrip(setup);
  });
  document.querySelector('#shake')!.addEventListener('click', () => void startTrip(readSetup(true)));
  document.querySelector('#history')!.addEventListener('click', () => void historyView());
  document.querySelector('#settings')!.addEventListener('click', settingsView);
  document.querySelector('#share')!.addEventListener('click', () => void shareView(readSetup(false)));
}

// ---------- 記錄中 ----------

async function startTrip(setup: TripSetup) {
  // 權限必須在點擊當下要求，不能先 await 其他東西
  const perm = await requestMotionPermission();
  if (!perm.motion) {
    toast('沒有取得動作感測權限。iPhone 請在 Safari 設定中允許「動作與方向」。', 'warn');
    return;
  }
  void requestPersistence();
  const params = loadParams();
  recordingView(setup, params);
}

function recordingView(setup: TripSetup, params: Params) {
  render(`
    <section class="rec">
      <div class="rec-head">
        <div>
          <div class="route">${esc(setup.route || '未填路線')}${setup.testMode ? ' <span class="badge">測試</span>' : ''}</div>
          <div class="sub" id="elapsed">0:00</div>
        </div>
        <div class="score"><span id="score">100</span><small>平穩分數</small></div>
      </div>
      <div id="stability" class="status pending">準備中…</div>
      <div class="counts">
        ${EVENT_TYPES.map((t) => `<div class="count" data-type="${t}" style="--c:${EVENT_COLORS[t]}"><b id="c-${t}">0</b><span>${EVENT_LABELS[t]}</span></div>`).join('')}
      </div>
      <canvas id="chart" class="chart"></canvas>
      <div class="legend"><span style="--c:#0f766e">縱向 a</span><span style="--c:#d97706">橫向 a</span><span style="--c:#6366f1">加加速度</span><span class="unstable">不穩定</span></div>
      <div class="meta" id="meta"></div>
      <div class="row">
        <button id="mark" class="secondary">✋ 剛剛急煞了</button>
        <button id="sync" class="secondary">🔔 對時敲擊</button>
      </div>
      <button id="stop" class="big danger">下車結束</button>
      <p class="hint" id="wake"></p>
    </section>
  `);

  let distKm = 0;
  let prevFix: GpsFix | null = null;
  const t0 = Date.now();

  const rec = new Recorder(setup, params, {
    onSample: (s) => chart.push(s),
    onEvent: (e: TripEvent) => {
      document.querySelector(`#c-${e.type}`)!.textContent = String(rec.live.counts[e.type]);
      const tile = document.querySelector<HTMLElement>(`.count[data-type="${e.type}"]`)!;
      tile.classList.remove('flash');
      void tile.offsetWidth;
      tile.classList.add('flash');
      toast(`${EVENT_LABELS[e.type]}  ${e.peakValue.toFixed(1)}`, 'event');
    },
    onGps: (g) => {
      if (g.accuracy <= 50) {
        if (prevFix) {
          const d = haversineM(prevFix.lat, prevFix.lon, g.lat, g.lon);
          const dt = (g.t - prevFix.t) / 1000;
          if (dt > 0 && d / dt <= 40) distKm += d / 1000;
        }
        prevFix = g;
      }
    },
    onGpsError: (msg) => toast(`定位：${msg}`, 'warn'),
    onGap: (sec) => toast(`畫面離開了 ${Math.round(sec)} 秒，這段沒有量測到`, 'warn'),
  });
  recorder = rec;
  const chart = new LiveChart(document.querySelector('#chart')!, rec.meta.params, () => rec.live.jerkThreshold());

  void rec.start().then(() => {
    document.querySelector('#wake')!.textContent = rec.wakeLockOk
      ? '螢幕常亮已開啟。請勿鎖屏或切到其他 App。'
      : '⚠️ 這個瀏覽器無法保持螢幕常亮，請把自動鎖定時間調長，並保持這個畫面開著。';
  });

  const stabilityEl = document.querySelector<HTMLElement>('#stability')!;
  const metaEl = document.querySelector<HTMLElement>('#meta')!;
  const tick = window.setInterval(() => {
    const sec = (Date.now() - t0) / 1000;
    document.querySelector('#elapsed')!.textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    const { score } = smoothScore(rec.live.counts, distKm, sec, rec.meta.params);
    document.querySelector('#score')!.textContent = String(Math.round(score));

    const s = rec.live.last;
    if (!s) {
      stabilityEl.className = 'status warn';
      stabilityEl.textContent = rec.motionCount === 0 && sec > 2 ? '沒有收到感測資料（電腦瀏覽器沒有加速度計，或權限被拒）' : '準備中…';
    } else if (setup.testMode) {
      stabilityEl.className = 'status ok';
      stabilityEl.textContent = '搖手機測試中：用力前後搖就會記錄事件';
    } else if (s.stable) {
      stabilityEl.className = 'status ok';
      stabilityEl.textContent = '✅ 穩定量測中';
    } else {
      stabilityEl.className = 'status warn';
      stabilityEl.textContent = '📱 請把手機放在支架或座椅上';
    }
    const o = rec.live.orientation();
    const src = o ? { gps: 'GPS 校準', pca: '加速度主軸', guess: '依擺放猜測' }[o.source] : '–';
    const g = rec.lastGps;
    metaEl.textContent = `取樣 ${fmt(rec.live.sampleRateHz, 0)} Hz・方向：${src}・GPS ${g ? `±${Math.round(g.accuracy)} m・${fmt((g.speed ?? 0) * 3.6, 0)} km/h` : '等待中'}・${fmt(distKm, 2)} km`;
  }, 500);

  document.querySelector('#mark')!.addEventListener('click', () => {
    rec.mark('manual_brake');
    toast('已標記（人工記錄，用來和自動偵測比對）');
  });
  document.querySelector('#sync')!.addEventListener('click', () => {
    rec.mark('sync_tap');
    toast('已標記對時：現在把手機和感測盒一起敲一下');
  });
  document.querySelector('#stop')!.addEventListener('click', async () => {
    const btn = document.querySelector<HTMLButtonElement>('#stop')!;
    btn.disabled = true;
    btn.textContent = '計算中…';
    const meta = await rec.stop();
    recorder = null;
    void summaryView(meta.id);
  });

  cleanup = () => {
    window.clearInterval(tick);
    chart.destroy();
  };
}

// ---------- 本趟摘要 ----------

async function summaryView(id: string) {
  let meta = await getTrip(id);
  if (!meta) return homeView();
  if (meta.status !== 'done' || !meta.summary) meta = await finalizeTrip(meta);
  const s = meta.summary!;
  const events = meta.events ?? [];
  const raw = await loadRaw(id);

  const peak = (label: string, v: number, unit: string) => `<div><small>${label}</small><b>${fmt(v, 2)}</b><small>${unit}</small></div>`;
  render(`
    <section class="summary">
      <button class="back" id="back">← 首頁</button>
      <h2>${esc(meta.route || '未填路線')} ${meta.plate ? `<span class="sub">${esc(meta.plate)}</span>` : ''}</h2>
      <p class="sub">${new Date(meta.createdAt).toLocaleString()}・${fmtDuration(s.durationSec)}・${fmt(s.distanceKm, 2)} km</p>
      <div class="card score-card">
        <div class="score big-score"><span>${Math.round(s.smoothScore)}</span><small>平穩分數</small></div>
        <div class="counts">
          ${EVENT_TYPES.map((t) => `<div class="count" style="--c:${EVENT_COLORS[t]}"><b>${s.counts[t]}</b><span>${EVENT_LABELS[t]}</span></div>`).join('')}
        </div>
      </div>
      <div class="card peaks">
        ${peak('最大加速', s.peaks.maxAccel, 'm/s²')}
        ${peak('最大煞車', s.peaks.maxBrake, 'm/s²')}
        ${peak('最大橫向', s.peaks.maxLat, 'm/s²')}
        ${peak('最大加加速度', s.peaks.maxJerk, 'm/s³')}
      </div>
      <p class="sub">穩定量測 ${fmt(s.stableRatio * 100, 0)}%・取樣 ${fmt(s.sampleRateHz, 0)} Hz・加加速度門檻 ${fmt(s.jerkThreshold, 1)} m/s³・每公里 ${fmt(s.eventsPerKm, 1)} 次事件・超標時間 ${fmt(s.exceedanceRatio * 100, 1)}%
      ${meta.gaps.length ? `<br>⚠️ 中途有 ${meta.gaps.length} 段畫面離開、未量測` : ''}</p>
      <div id="map" class="map"></div>
      <button id="thanks" class="big thanks">🙏 謝謝司機${meta.thanks.length ? `（已送出 ${meta.thanks.length}）` : ''}</button>
      <div class="card">
        <h3>匯出資料</h3>
        <button id="share-all" class="primary">分享全部檔案</button>
        <div class="row wrap" id="files"></div>
        ${API_BASE ? `<button id="upload" class="secondary">${meta.uploadedAt ? '已上傳 ✓' : '匿名上傳摘要'}</button>` : ''}
      </div>
      ${events.length ? `
      <details class="card"><summary>事件列表（${events.length}）</summary>
        <div class="events-wrap"><table class="events"><thead><tr><th>時間</th><th>類型</th><th>峰值</th><th>加加速度</th><th>km/h</th></tr></thead><tbody>
        ${events.map((e) => `<tr><td>${new Date(e.tPeak).toLocaleTimeString()}</td><td style="color:${EVENT_COLORS[e.type]}">${EVENT_LABELS[e.type]}</td><td>${fmt(e.peakValue, 2)}</td><td>${fmt(e.peakJerk, 1)}</td><td>${e.speed === null ? '–' : fmt(e.speed * 3.6, 0)}</td></tr>`).join('')}
        </tbody></table></div>
      </details>` : ''}
      <button id="delete" class="link danger-text">刪除這趟紀錄</button>
    </section>
  `);

  const map = renderTripMap(document.querySelector('#map')!, raw.gps, events);
  if (!map) document.querySelector<HTMLElement>('#map')!.hidden = true;
  cleanup = () => map?.remove();

  document.querySelector('#back')!.addEventListener('click', homeView);
  document.querySelector('#thanks')!.addEventListener('click', async (e) => {
    meta!.thanks.push(Date.now());
    await saveTrip(meta!);
    (e.currentTarget as HTMLButtonElement).textContent = `🙏 謝謝司機（已送出 ${meta!.thanks.length}）`;
    toast('謝謝！（目前先記在手機上）');
  });

  const filesEl = document.querySelector('#files')!;
  const files = await buildExportFiles(meta);
  for (const f of files) {
    const b = document.createElement('button');
    b.className = 'secondary small';
    b.textContent = `⬇ ${f.name.split('_').at(-1)}`;
    b.addEventListener('click', () => download(f));
    filesEl.append(b);
  }
  document.querySelector('#share-all')!.addEventListener('click', async () => {
    if (!(await shareFiles(files))) {
      files.forEach((f, i) => setTimeout(() => download(f), i * 400));
    }
  });
  document.querySelector('#upload')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      b.disabled = true;
      await uploadTrip(meta!);
      meta!.uploadedAt = Date.now();
      await saveTrip(meta!);
      b.textContent = '已上傳 ✓';
    } catch (err) {
      b.disabled = false;
      toast((err as Error).message, 'warn');
    }
  });
  const del = document.querySelector<HTMLButtonElement>('#delete')!;
  del.addEventListener('click', async () => {
    if (del.dataset.confirm !== '1') {
      del.dataset.confirm = '1';
      del.textContent = '確定刪除？再按一次';
      return;
    }
    await deleteTrip(id);
    void historyView();
  });
}

// ---------- 紀錄列表 ----------

async function historyView() {
  const trips = await listTrips();
  render(`
    <section>
      <button class="back" id="back">← 首頁</button>
      <h2>紀錄</h2>
      ${trips.length ? '' : '<p class="sub">還沒有紀錄。</p>'}
      <ul class="trips">
        ${trips.map((t: TripMeta) => `
          <li data-id="${t.id}">
            <div><b>${esc(t.route || '未填路線')}</b> ${t.plate ? `<span class="sub">${esc(t.plate)}</span>` : ''}${t.testMode ? ' <span class="badge">測試</span>' : ''}
            <div class="sub">${new Date(t.createdAt).toLocaleString()}${t.summary ? `・${fmtDuration(t.summary.durationSec)}・${fmt(t.summary.distanceKm, 1)} km` : '・未完成（點開可補算）'}</div></div>
            <div class="score small-score">${t.summary ? Math.round(t.summary.smoothScore) : '–'}</div>
          </li>`).join('')}
      </ul>
    </section>
  `);
  document.querySelector('#back')!.addEventListener('click', homeView);
  document.querySelectorAll<HTMLElement>('.trips li').forEach((li) => li.addEventListener('click', () => void summaryView(li.dataset.id!)));
}

// ---------- 設定 ----------

function settingsView() {
  const p = loadParams();
  render(`
    <section>
      <button class="back" id="back">← 首頁</button>
      <h2>設定</h2>
      <p class="sub">門檻與濾波參數（只影響這支手機；預設值依 Krašna et al. 2021：加速 1.5、煞車 1.0 m/s²）。</p>
      <p class="sub">加加速度（jerk）是加速度的變化率（m/s³）：加速度變化越突然，乘客越容易站不穩。</p>
      <form id="params" class="card settings">
        ${SETTING_FIELDS.map(([path, label, unit, step]) => `
          <label class="field inline"><span>${label}</span>
            <span><input type="number" step="${step}" name="${path}" value="${getPath(p, path)}"> <small>${unit}</small></span>
          </label>`).join('')}
        <div class="row">
          <button type="submit" class="primary">儲存</button>
          <button type="button" id="reset" class="secondary">恢復預設</button>
        </div>
      </form>
      <p class="sub">已完成的紀錄會沿用當時的參數；分析工具可用新參數重算。</p>
    </section>
  `);
  document.querySelector('#back')!.addEventListener('click', homeView);
  document.querySelector<HTMLFormElement>('#params')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget as HTMLFormElement);
    const next = loadParams();
    for (const [path] of SETTING_FIELDS) {
      const v = Number(d.get(path));
      if (Number.isFinite(v)) setPath(next, path, v);
    }
    saveParams(next);
    toast('已儲存');
  });
  document.querySelector('#reset')!.addEventListener('click', () => {
    resetParams();
    saveParams(structuredClone(DEFAULT_PARAMS));
    settingsView();
    toast('已恢復預設');
  });
}

// ---------- QR code ----------

async function shareView(setup: TripSetup) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (setup.route) url.searchParams.set('route', setup.route);
  if (setup.plate) url.searchParams.set('plate', setup.plate);
  render(`
    <section class="center">
      <button class="back" id="back">← 首頁</button>
      <h2>掃描開始量測</h2>
      <canvas id="qr"></canvas>
      <p class="url">${esc(url.toString())}</p>
      <p class="sub">首頁填的路線與車牌會帶入網址，可以印成貼紙貼在車上（日後可改成 NFC 貼紙）。</p>
    </section>
  `);
  await QRCode.toCanvas(document.querySelector('#qr')!, url.toString(), { width: 280, margin: 1 });
  document.querySelector('#back')!.addEventListener('click', homeView);
}

// 記錄中誤觸返回或關閉時提醒
window.addEventListener('beforeunload', (e) => {
  if (recorder) e.preventDefault();
});

homeView();
