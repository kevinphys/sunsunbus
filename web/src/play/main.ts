// 順順行 遊戲版原型（原型二）：依 wireframe 的七個畫面重新實作，感測與事件偵測沿用記錄器。
// ① 上車 → ② 搭乘中 → ③ 下車 review → ④ 我的果籃 → ⑤ 換乘車金；⑥ 司機端、⑦ 市府儀表板為展示畫面。
// 網址：play.html?route=中山幹線&plate=KKA-1234&dir=0（支架 NFC 貼紙或 QR 帶入）；加 &simulate=1 播放示範行程。
import './play.css';
import { registerSW } from 'virtual:pwa-register';
import { SIMULATE, requestMotionPermission } from '../app/sensors';
import { loadLastSetup, loadParams, saveLastSetup } from '../app/settings';
import { getTrip, listTrips, requestPersistence, saveTrip, type Placement, type Posture, type SeatRow, type TripMeta } from '../app/storage';
import { DEFAULT_RULES } from '../game/rules';
import { LEVEL_LABELS, nearestStop, parseTdxStops, type Level, type RideSegment, type Stop } from '../game/segments';
import { routeFruit, type RideResult } from '../game/ride';
import { demoTrip } from '../game/demo';
import { LiveRide, type RideSetup } from './live';
import { balance, collectedThisMonth, dayKey, loadLedger, saveLedger, streakDays } from './ledger';
import * as art from './art';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app')!;
const rules = DEFAULT_RULES;
let ride: LiveRide | null = null;
let cleanup: (() => void) | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(html: string, bodyClass = '') {
  cleanup?.();
  cleanup = null;
  document.body.className = bodyClass;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app.querySelector<T>(sel)!;

// ---------- 站牌資料 ----------

/** 站序：web/public/stops/<路線>.json（TDX StopOfRoute 原始格式）。沒有檔案時改用停靠推測 */
const stopCache = new Map<string, unknown>();
async function loadStops(route: string, direction: number): Promise<{ stops: Stop[]; headsign: string } | null> {
  if (SIMULATE && route === DEMO_ROUTE) {
    const s = demo().stops;
    return { stops: s, headsign: s[s.length - 1].name };
  }
  if (!stopCache.has(route)) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}stops/${encodeURIComponent(route)}.json`);
      stopCache.set(route, res.ok ? await res.json() : null);
    } catch {
      stopCache.set(route, null);
    }
  }
  return parseTdxStops(stopCache.get(route), direction);
}

const DEMO_ROUTE = '示範路線';
let demoCache: ReturnType<typeof demoTrip> | null = null;
const demo = () => (demoCache ??= demoTrip());

// ---------- ① 上車 ----------

interface Pending {
  route: string;
  plate: string;
  direction: number;
  fromSticker: boolean;
}

type Prefs = { seatRow: SeatRow; posture: Posture; placement: Placement };
const SEAT: [SeatRow, string][] = [['front', '前排'], ['middle', '中段'], ['rear', '後排']];
const POSTURE: [Posture, string][] = [['sit', '坐'], ['stand', '站']];
const PLACE: [Placement, string][] = [['mount', '支架'], ['seat', '座椅']];
const ROUTE_SUGGESTIONS = ['中山幹線', '信義幹線', '敦化幹線', '民生幹線', '南京幹線', '307', '262', '656'];

function stickerFromUrl(): Pending | null {
  const q = new URLSearchParams(location.search);
  if (SIMULATE && !q.get('route')) return { route: DEMO_ROUTE, plate: 'DEMO-001', direction: 0, fromSticker: true };
  const route = q.get('route')?.trim();
  if (!route) return null;
  return { route, plate: q.get('plate')?.trim() ?? '', direction: Number(q.get('dir') ?? 0) === 1 ? 1 : 0, fromSticker: true };
}

function loadPrefs(): Prefs {
  const last = loadLastSetup<Prefs>();
  return {
    seatRow: last.seatRow || 'middle',
    posture: last.posture || 'sit',
    placement: last.placement === 'seat' ? 'seat' : 'mount',
  };
}

function homeView(pending: Pending | null = stickerFromUrl(), manual = false) {
  const prefs = loadPrefs();
  const n = balance(loadLedger());
  const label = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] ?? '';
  const chips = (name: keyof Prefs, list: [string, string][]) =>
    list.map(([k, l]) => `<button class="chip" data-pref="${name}" data-v="${k}" aria-pressed="${prefs[name] === k}">${l}</button>`).join('');

  const card = pending && !manual
    ? `<div class="card">
        <p class="muted">${pending.fromSticker ? '從支架貼紙推測，你可能在搭' : '你要搭'}</p>
        <p style="font-size:24px;font-weight:900" id="route-title">${esc(pending.route)}</p>
        <p class="muted" id="plate-line">${pending.plate ? `車牌 ${esc(pending.plate)}` : ''}</p>
        <div id="stop-extra"></div>
        <div class="btns">
          <button class="btn" id="confirm">對，是這班</button>
          <button class="btn ghost" id="other">不是，換一班</button>
        </div>
      </div>`
    : `<div class="card">
        <label class="field">路線<input id="route" list="routes" placeholder="例：中山幹線" value="${esc(pending?.route ?? '')}" autocomplete="off"></label>
        <datalist id="routes">${ROUTE_SUGGESTIONS.map((r) => `<option value="${r}">`).join('')}</datalist>
        <label class="field">車牌（選填）<input id="plate" placeholder="例：KKA-1234" value="${esc(pending?.plate ?? '')}" autocomplete="off"></label>
        <button class="btn" id="manual-go">確認路線</button>
      </div>`;

  render(`
    <section class="screen">
      <div class="row">
        <p class="brand">公車順順行</p>
        <a class="pill" href="#/garden">我的果籃 · ${n} 顆</a>
      </div>
      ${SIMULATE ? '<p class="small">模擬模式：播放 5 分鐘的示範行程（7 站），到終點站後按「我下車了」。不讀取真實感測器。</p>' : ''}
      ${card}
      <button class="tap ${pending && !manual ? 'ready' : ''}" id="tap" ${pending && !manual ? '' : 'disabled'}>
        <div class="tap-circle">${art.dropReady}<p>${pending && !manual ? '點一下開始' : '放上支架，碰一下'}</p></div>
        <p class="body center">${pending && !manual ? '確認路線就開始，<br>不用先選下車站，下車時點一下就好。' : '碰支架貼紙或掃 QR 就會帶入路線，<br>不用先選下車站，下車時點一下就好。'}</p>
      </button>
      <div class="card" style="padding:12px 14px;gap:8px;border-width:1px">
        <div class="row">
          <p style="font-size:14px">上次設定：<b>${label(SEAT, prefs.seatRow)} · ${label(POSTURE, prefs.posture)} · ${label(PLACE, prefs.placement)}</b></p>
          <button class="chip" id="toggle-prefs" style="font-weight:700;border-color:var(--ink)">修改</button>
        </div>
        <div class="chips" id="prefs" hidden>${chips('seatRow', SEAT)}${chips('posture', POSTURE)}${chips('placement', PLACE)}</div>
      </div>
      ${pending && !manual ? '' : '<button class="link" id="manual">沒有支架？手動選路線</button>'}
      <p class="small center">量測時螢幕需保持亮著，支架會幫你充電。<br><a href="./">研究用記錄器</a></p>
    </section>
  `);

  $('#toggle-prefs').onclick = () => {
    const el = $('#prefs');
    el.hidden = !el.hidden;
    $('#toggle-prefs').textContent = el.hidden ? '修改' : '收合';
  };
  app.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.pref as keyof Prefs;
      saveLastSetup({ ...loadLastSetup<Prefs>(), ...prefs, [k]: b.dataset.v });
      homeView(pending, manual);
      $('#prefs').hidden = false;
      $('#toggle-prefs').textContent = '收合';
    };
  });
  app.querySelector<HTMLButtonElement>('#manual')?.addEventListener('click', () => homeView(pending, true));
  app.querySelector<HTMLButtonElement>('#other')?.addEventListener('click', () => homeView({ route: '', plate: '', direction: 0, fromSticker: false }, true));
  app.querySelector<HTMLButtonElement>('#manual-go')?.addEventListener('click', () => {
    const route = $<HTMLInputElement>('#route').value.trim();
    if (!route) return toast('請填路線');
    homeView({ route, plate: $<HTMLInputElement>('#plate').value.trim(), direction: 0, fromSticker: false });
  });

  if (!pending || manual) return;
  let stopInfo: Awaited<ReturnType<typeof loadStops>> = null;
  const showStops = async () => {
    stopInfo = await loadStops(pending.route, pending.direction);
    const extra = app.querySelector('#stop-extra');
    if (!extra) return;
    if (!stopInfo) {
      extra.innerHTML = '<p class="small">這條路線還沒有站牌資料，站間會用停靠位置推測。</p>';
      return;
    }
    $('#route-title').textContent = `${pending.route} · 往 ${stopInfo.headsign}`;
    const plateLine = $('#plate-line');
    plateLine.innerHTML = `${pending.plate ? `車牌 ${esc(pending.plate)} · ` : ''}上車站 <b id="board" style="color:var(--ink)">偵測中…</b>（GPS 偵測）`;
    extra.innerHTML = '<button class="link" id="flip" style="text-align:left;padding:0">方向不對？換成另一個方向</button>';
    $('#flip').onclick = () => homeView({ ...pending, direction: 1 - pending.direction });
    const board = await detectBoardStop(stopInfo.stops);
    const el = app.querySelector('#board');
    if (el) el.textContent = board ?? '開始後偵測';
  };
  void showStops();

  const go = () => {
    const p = loadPrefs();
    void startRide(
      { route: pending.route, plate: pending.plate, seatRow: p.seatRow, seatSide: '', posture: p.posture, placement: p.placement, testMode: false, direction: pending.direction },
      stopInfo?.stops ?? null,
    );
  };
  $('#confirm').onclick = go;
  $('#tap').onclick = go;
}

/** 首頁先抓一次 GPS，顯示偵測到的上車站（正式判定在開始記錄後的第一筆 GPS） */
function detectBoardStop(stops: Stop[]): Promise<string | null> {
  if (SIMULATE) return Promise.resolve(stops[0]?.name ?? null);
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestStop(stops, pos.coords.latitude, pos.coords.longitude, rules.segment.boardRadiusM);
        resolve(near ? stops[near.index].name : null);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

async function startRide(setup: RideSetup, stops: Stop[] | null) {
  // 權限必須在點擊當下要求，不能先 await 其他東西
  const perm = await requestMotionPermission();
  if (!perm.motion) return toast('沒有取得動作感測權限。iPhone 請在 Safari 設定中允許「動作與方向」。');
  void requestPersistence();
  ride = new LiveRide(setup, loadParams(), rules, stops, SIMULATE && setup.route === DEMO_ROUTE ? demo().trip : undefined);
  await ride.start();
  location.hash = '#/ride';
}

// ---------- ② 搭乘中 ----------

const CAPTIONS: Record<Level, string> = {
  bloom: '水都澆進土裡，這段盛開',
  sprout: '晃了一兩下，這段開了小花',
  dry: '哎呀，晃得厲害，這段還是乾土',
  unmeasured: '這段手機不在支架上，沒量到',
};
/** 站間進度逐格增加：最多顯示最近 7 段，最後一格是正在澆的那一段 */
const SLOT_SHOWN = 7;

function ridingView() {
  if (!ride) return homeView();
  const r = ride;
  render(`
    <section class="screen">
      <div class="row">
        <p class="status" id="status">● 準備中</p>
        <p class="muted" style="color:var(--night-ink)">${esc(r.setup.route)}</p>
      </div>
      <p class="muted" style="color:var(--night-ink);font-size:15px" id="next"></p>
      <div class="stage" id="stage"></div>
      <button class="btn big" id="stop" style="font-size:20px;border-radius:999px;padding:16px">我下車了</button>
      <p class="small center" style="color:var(--night-ink)">${r.stops ? '下車站以按下時的 GPS 位置判定。' : ''}忘了按？${r.stops ? '離開路線或' : ''}手機離開支架 ${Math.round(rules.riding.autoEndUnstableSec / 60)} 分鐘會自動結束。<span id="wake"></span></p>
    </section>
  `, 'dark');

  let closed = 0;
  let caption = '開始澆水';
  let captionUntil = 0;
  let splashUntil = 0;
  let shakes = 0;
  let stopping = false;

  const finish = async (autoEnded?: Parameters<LiveRide['stop']>[0]) => {
    if (stopping) return;
    stopping = true;
    window.clearInterval(timer);
    $('#stage').innerHTML = `<p class="caption">整理這趟的站間…</p>`;
    const meta = await r.stop(autoEnded);
    ride = null;
    location.hash = `#/review/${meta.id}`;
  };

  const tick = () => {
    const v = r.view();
    const now = Date.now();
    const auto = r.autoEnd();
    if (auto) return void finish(auto);

    if (v.shakes > shakes) {
      shakes = v.shakes;
      splashUntil = now + 3500;
      caption = '哎呀，晃了一下';
      captionUntil = now + 3500;
    }
    if (v.closed > closed) {
      const seg = v.segments.filter((s) => !s.open).at(-1);
      if (seg) {
        caption = CAPTIONS[seg.level];
        captionUntil = now + 8000;
        if (seg.level === 'dry') splashUntil = now + 3500;
      }
      closed = v.closed;
    }
    const status = $('#status');
    status.textContent = v.lifted ? '● 暫停：請放回支架' : v.calibrating ? '● 校準中' : '● 穩定量測中';
    status.style.color = v.lifted ? 'var(--bloom)' : 'var(--mint-2)';
    const where = v.atStop ? `到站：${v.atStop}` : v.nextStop ? `下一站：${v.nextStop}` : v.dwelling ? '靠站中' : '下一站：（停靠時自動分段）';
    $('#next').textContent = v.boardStop ? `${v.boardStop} 上車 · ${where}` : where;
    $('#wake').textContent = r.recorder.wakeLockOk ? '' : ' 這支手機無法保持螢幕常亮，請先關閉自動鎖定。';

    const stage = $('#stage');
    if (v.lifted) {
      stage.className = 'stage lifted';
      stage.innerHTML = `${art.dropSearching}<p class="caption">小水滴在找支架</p><p class="sub">手機拿在手上時暫停澆水。<br>放回支架或座椅就會自動繼續。</p>`;
      return;
    }
    const splash = now < splashUntil;
    const text = now < captionUntil ? caption : v.dwelling ? '靠站中，停靠時間不計分' : v.segments.length ? '穩穩澆水中' : '開始澆水';
    const open = v.segments.find((s) => s.open);
    const slots =
      v.segments
        .filter((s) => !s.open)
        .slice(-SLOT_SHOWN)
        .map((s) => `<div class="slot lv-${s.level}" role="img" aria-label="${esc(s.fromName)} → ${esc(s.toName)}：${LEVEL_LABELS[s.level]}">${s.level === 'unmeasured' ? '–' : art.levelIcon(s.level, 22)}</div>`)
        .join('') + `<div class="slot next ${open ? 'open' : ''}" role="img" aria-label="下一個站間"></div>`;
    const legend = (['bloom', 'sprout', 'dry'] as const).map((l) => `<span>${art.levelIcon(l, 16)}${LEVEL_LABELS[l]}</span>`).join('');
    stage.className = `stage ${splash ? 'splash' : ''}`;
    stage.innerHTML = `<div class="drop">${splash ? art.dropSplash : art.dropCalm}</div><p class="caption">${text}</p><p class="sub">已澆 ${closed} 個站間</p><div class="slots">${slots}</div><div class="legend">${legend}</div>`;
  };
  const timer = window.setInterval(tick, 500);
  tick();
  $('#stop').onclick = () => void finish();
  cleanup = () => window.clearInterval(timer);
}

// ---------- ③ 下車 review ----------

const tagHtml = (level: Level) => `<span class="tag lv-${level}">${art.levelIcon(level, 18)}${LEVEL_LABELS[level]}</span>`;
const minutes = (m: TripMeta) => Math.max(1, Math.round(((m.endedAt ?? m.createdAt) - m.createdAt) / 60000));
const flowerCount = (r: RideResult) => r.levelCounts.bloom + r.levelCounts.sprout;

async function reviewView(id: string) {
  const meta = await getTrip(id);
  if (!meta?.ride) {
    render(`<section class="screen"><p class="title">找不到這趟的結果</p><a class="link" href="#/garden">看我的果籃</a></section>`);
    return;
  }
  const r = meta.ride;
  const measured = r.segments.length - r.levelCounts.unmeasured;
  const { bloom, sprout, dry, unmeasured } = r.levelCounts;
  const route = r.stopSource === 'tdx' && r.boardStop && r.alightStop ? ` · ${esc(r.boardStop)} 上車 → ${esc(r.alightStop)} 下車` : '';
  const autoNote = r.autoEnded
    ? `<p class="small">忘了按「我下車了」，${r.autoEnded === 'off_route' ? '離開路線' : '手機離開支架太久'}後自動結束，終點取最後一個穩定量測的站。</p>`
    : '';
  const headline = !r.valid ? '這趟沒有採到果實' : r.fruitKind === 'scout' ? '這趟車有點晃，大部分站間還是乾土' : dry === 0 ? `這趟很順，沿路開了 ${flowerCount(r)} 段花` : `這趟沿路開了 ${flowerCount(r)} 段花`;
  const reasons: Record<NonNullable<RideResult['invalidReason']>, string[]> = {
    handheld: [`這趟手機大多拿在手上（穩定 ${Math.round(r.stableRatio * 100)}%），量到 ${measured} 個站間。`, '下次把手機放上支架或平放在座椅上，就能採到果實。'],
    too_few_segments: [`這趟只量到 ${measured} 個站間（至少需要 ${rules.ride.minSegments} 個）。`, `放上支架、量滿 ${rules.ride.minSegments} 個站間就能採到果實。`],
    daily_cap: [`今天已採滿 ${rules.ride.dailyCap} 顆（每日上限），明天再來。`, '這趟的站間一樣有開花，也一樣會送給市府。'],
  };
  const summary = !r.valid
    ? `量到的 ${measured} 個站間資料仍會匿名送給市府，謝謝你。`
    : r.fruitKind === 'scout'
      ? `謝謝你的小水滴，幫市府找到 ${dry} 段需要改善的站間。`
      : `這趟澆了 ${measured} 個站間：${bloom} 段盛開、${sprout} 段小花、${dry} 段乾土${unmeasured ? `（另有 ${unmeasured} 段沒量到）` : ''}。花已送給司機。`;
  const total = r.balanceAfter ?? balance(loadLedger());
  const goal = rules.ride.fruitsPerReward;
  const fruitName = routeFruit(meta.route);
  const fruit = !r.valid
    ? `<div class="fruit none"><div><b>本趟果實 0 顆（${total} / ${goal}）</b><p class="note">放上支架、量滿 ${rules.ride.minSegments} 個站間就能採到</p></div></div>`
    : r.fruitKind === 'scout'
      ? `<div class="fruit">${art.fruitScout}<div><b>整趟採集了 ${r.fruit} 顆探路果（${total} / ${goal}）</b><p class="note">探路果價值相同，另解鎖「乾土偵察員」徽章</p></div></div>`
      : `<div class="fruit">${art.fruitNormal(fruitName)}<div><b>整趟採集了 ${r.fruit} 顆果實（${total} / ${goal}）</b><p class="note">${r.thirst ? '缺水任務：果實 ×2。' : ''}不管開得順不順，有效的一趟都採集 1 顆</p></div></div>`;
  const thanked = meta.thanks.length > 0;

  render(`
    <section class="screen">
      <p class="muted">${esc(meta.route)}${route} · ${minutes(meta)} 分鐘</p>
      <h1 class="title" style="font-size:23px">${headline}</h1>
      ${!r.valid ? `<div class="card dashed"><p style="font-size:15px;font-weight:700">為什麼沒採到？</p>${reasons[r.invalidReason!].map((t) => `<p class="body">${t}</p>`).join('')}</div>` : ''}
      ${r.segments.length ? `<div class="card seg-list">${r.segments.map((s) => `<div class="seg"><span>${esc(s.fromName)} → ${esc(s.toName)}</span>${tagHtml(s.level)}</div>`).join('')}</div>` : ''}
      ${r.stopSource === 'dwell' && r.segments.length ? '<p class="small">這條路線還沒有站牌資料，站間依停靠位置推測（紅燈也可能被算成一次停靠）。</p>' : ''}
      ${autoNote}
      <p class="body">${summary}</p>
      ${fruit}
      <div id="thanks">${thanked ? '<p class="done-msg">已送出謝謝</p>' : '<button class="btn big" id="thank" style="width:100%">謝謝司機，辛苦了</button>'}</div>
      <p class="small center">謝謝是鼓勵，不計入獎金；司機的平穩獎金只看開花率。</p>
      <div class="btns"><a class="link" href="#/garden">看我的果籃</a><a class="link" href="#/">回首頁</a></div>
    </section>
  `);
  app.querySelector<HTMLButtonElement>('#thank')?.addEventListener('click', async () => {
    meta.thanks.push(Date.now());
    await saveTrip(meta);
    $('#thanks').innerHTML = '<p class="done-msg">已送出謝謝</p>';
  });
}

// ---------- ④ 我的果籃 ----------

async function playTrips(): Promise<TripMeta[]> {
  return (await listTrips()).filter((t) => t.ride);
}

function dayLabel(t: number) {
  const d = dayKey(t);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d === dayKey() ? '今天' : d === dayKey(y.getTime()) ? '昨天' : `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
}

async function gardenView() {
  const l = loadLedger();
  const trips = await playTrips();
  const n = balance(l);
  const goal = rules.ride.fruitsPerReward;
  const routes = [...new Set(trips.filter((t) => t.ride!.valid).map((t) => t.route))];
  // 未解鎖的格子補滿一排
  const locked = ROUTE_SUGGESTIONS.filter((r) => !routes.includes(r)).slice(0, routes.length % 3 === 0 ? 3 : 3 - (routes.length % 3));
  const streak = streakDays(l);
  const scout = l.entries.some((e) => e.kind === 'scout');
  const full = trips.some((t) => t.ride!.fullRoute);
  const recent = trips.slice(0, 5).map((t) => {
    const r = t.ride!;
    const right = !r.valid ? '沒採到果實' : r.fruitKind === 'scout' ? `探路果 ${r.fruit} 顆` : `${flowerCount(r)} 段開花 · ${r.fruit} 顆`;
    return `<a class="trip" href="#/review/${t.id}"><span><b>${dayLabel(t.createdAt)} · ${esc(t.route)}</b></span><span>${right} ›</span></a>`;
  });

  render(`
    <section class="screen">
      <div class="row"><h1 class="title">我的果籃</h1><a href="#/" style="font-weight:700;text-decoration:none">首頁</a></div>
      <div class="card dark">
        <p class="muted">目前果實（本月採集 ${collectedThisMonth(l)} 顆）</p>
        <p class="num big-num">${n} / ${goal} 顆</p>
        <div class="bar"><div style="width:${Math.min(100, (n / goal) * 100)}%"></div></div>
        <a class="pill bloom" href="#/reward">換乘車金</a>
      </div>
      <p class="section">最近旅程</p>
      ${recent.join('') || '<p class="muted">還沒有旅程。上車放上支架，就會出現在這裡。</p>'}
      <p class="section">路線水果圖鑑</p>
      <div class="dex">
        ${routes.map((r) => `<div class="got">${routeFruit(r)}<small>${esc(r)}</small></div>`).join('')}
        ${locked.map((r) => `<div>？<small>${esc(r)}</small></div>`).join('')}
      </div>
      <p class="section">徽章</p>
      <div class="chips">
        <span class="badge ${streak >= 7 ? '' : 'locked'}">連續 7 天${streak >= 7 ? '' : `（${streak} / 7）`}</span>
        <span class="badge ${scout ? 'scout' : 'locked'}">乾土偵察員${scout ? '' : '（未解鎖）'}</span>
        <span class="badge ${full ? '' : 'locked'}">跑完整條路線${full ? '' : '（未解鎖）'}</span>
      </div>
      <div class="thirst">
        <p>缺水任務：果實 ×${rules.ride.thirstMultiplier}</p>
        <p class="body">樣本不足（少於 10 趟）的路線或時段，一趟可以採集 ${rules.ride.thirstMultiplier} 顆果實。（需要伺服器統計，原型先示意）</p>
      </div>
      <p class="small center">展示畫面：<a href="#/driver">司機端通知</a> · <a href="#/city">市府儀表板</a></p>
    </section>
  `);
}

// ---------- ⑤ 果實換乘車金 ----------

const WALLETS = ['悠遊付', 'iPASS MONEY', 'icash Pay', '街口', '全支付'];

function rewardView(done = false) {
  const l = loadLedger();
  const n = balance(l);
  const goal = rules.ride.fruitsPerReward;
  const wallet = l.wallet ?? WALLETS[0];
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 5);
  const when = `${next.getMonth() + 1} 月 5 號`;
  const step = done
    ? `<p class="done-msg" style="font-size:16px;line-height:1.5;padding:18px">已登記！${when}<br>存入 ${rules.ride.rewardNtd} 元到「${esc(wallet)}」</p>`
    : !l.consented
      ? `<div class="card">
          <p style="font-size:16px;font-weight:700">第一次兌換前，先說明一件事</p>
          <p class="body">兌換需要綁定一個支付帳戶。我們只記錄「果實數量」和兌換紀錄，<b>不會把你的搭乘路線或時間連到帳戶</b>，兩份資料分開保存。</p>
          <button class="btn" id="agree" style="padding:14px;font-size:16px">我了解，選擇帳戶</button>
        </div>`
      : `<div style="display:flex;flex-direction:column;gap:12px">
          <p style="font-size:15px;font-weight:700">存入哪個支付帳戶</p>
          <div class="chips">${WALLETS.map((w) => `<button class="chip" data-w="${w}" aria-pressed="${w === wallet}" style="font-size:14px;font-weight:700;padding:10px 14px;border:2px solid var(--ink)">${w}</button>`).join('')}</div>
          <button class="btn big" id="redeem" style="font-size:20px;border-radius:999px;padding:16px" ${n < goal ? 'disabled' : ''}>${n < goal ? `還差 ${goal - n} 顆` : `用 ${goal} 顆換 ${rules.ride.rewardNtd} 元`}</button>
        </div>`;
  render(`
    <section class="screen">
      <a href="#/garden" style="font-weight:700;text-decoration:none">‹ 果籃</a>
      <h1 class="title">${goal} 顆果實，<br>換一趟公車</h1>
      <div class="card dark">
        <p class="muted">目前果實</p>
        <p class="num big-num" style="font-size:44px">${n} / ${goal} 顆</p>
        <div class="bar"><div style="width:${Math.min(100, (n / goal) * 100)}%"></div></div>
        <p class="muted" style="font-size:13px">${goal} 顆 = ${rules.ride.rewardNtd} 元乘車金，下個月 5 號存入支付帳戶</p>
      </div>
      ${step}
      <div class="grow"></div>
      <p class="small">比照常客優惠的「次月存入支付帳戶」。目前雙北公車支援悠遊付、iPASS MONEY、icash Pay、街口、全支付。<b>原型示意：不會真的存入。</b></p>
    </section>
  `);
  app.querySelector<HTMLButtonElement>('#agree')?.addEventListener('click', () => {
    saveLedger({ ...l, consented: true });
    rewardView();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => {
    b.onclick = () => {
      saveLedger({ ...l, wallet: b.dataset.w! });
      rewardView();
    };
  });
  app.querySelector<HTMLButtonElement>('#redeem')?.addEventListener('click', () => {
    if (n < goal) return;
    saveLedger({ ...l, wallet, redemptions: [...l.redemptions, { day: dayKey(), fruits: goal, wallet }] });
    rewardView(true);
  });
}

// ---------- ⑥ 司機端（展示） ----------

async function driverView() {
  const today = (await playTrips()).filter((t) => dayKey(t.createdAt) === dayKey());
  const localFlowers = today.reduce((s, t) => s + flowerCount(t.ride!), 0);
  const localThanks = today.reduce((s, t) => s + t.thanks.length, 0);
  const useLocal = localFlowers > 0;
  const flowersN = useLocal ? localFlowers : 36;
  const thanksN = useLocal ? localThanks : 12;
  render(`
    <section class="screen">
      <div class="line-head"><i>順</i>公車順順行（官方帳號示意）</div>
      <p class="muted center" style="font-size:13px">今天 ${new Date().toTimeString().slice(0, 5)}</p>
      <div class="bubble">
        <p style="font-size:22px;font-weight:900">司機您辛苦了！</p>
        <p>今天你開過的站間開了 <b>${flowersN} 朵花</b>${thanksN ? `，另外有 ${thanksN} 位乘客對你說謝謝` : ''}。</p>
        <div>${art.flowers}</div>
        <p style="font-size:18px;color:var(--muted)">本月平穩獎金累積：[__] 元（依開花率計算）</p>
      </div>
      <div class="bubble"><p style="font-size:18px">你這週開過的站間一共開了 [__] 朵花，已經更新到場站的花園螢幕。</p></div>
      <div class="grow"></div>
      <div class="btns"><button class="btn line-btn">回送謝謝貼圖</button><button class="btn ghost line-btn">看我的花園</button></div>
      <p class="small center">${useLocal ? '花與謝謝的數字取自這支手機今天的旅程。' : '示意數字（這支手機今天還沒有旅程）。'}司機端只會收到好消息；大字、免下載 App。</p>
      <a class="link" href="#/garden">‹ 回果籃</a>
    </section>
  `, 'line');
}

// ---------- ⑦ 市府儀表板（展示） ----------

const SLOTS: [number, number, string][] = [[6, 9, '06–09'], [9, 12, '09–12'], [12, 15, '12–15'], [15, 17, '15–17'], [17, 19, '17–19'], [19, 22, '19–22']];
const DEMO_HEAT: [string, number[]][] = [
  ['中山幹線', [2, 3, 3, 2, 1, 2]],
  ['[路線 B]', [1, 2, 3, 2, 1, 2]],
  ['[路線 C]', [3, 3, 3, 3, 2, 3]],
  ['[路線 D]', [2, 2, 1, 1, 1, 2]],
  ['[路線 E]', [3, 2, 2, 3, 2, 3]],
];
const HEAT_LABEL = ['無資料', '急煞多', '普通', '很順'];

async function cityView(local = false) {
  const trips = (await playTrips()).filter((t) => t.ride!.valid);
  const segs: (RideSegment & { route: string; trip: string })[] = trips.flatMap((t) => t.ride!.segments.filter((s) => s.level !== 'unmeasured').map((s) => ({ ...s, route: t.route, trip: t.id })));
  let rows: [string, { lv: number; n: number }[]][];
  if (local) {
    const byRoute = [...new Set(segs.map((s) => s.route))];
    rows = byRoute.map((route) => [
      route,
      SLOTS.map(([a, b]) => {
        const cell = segs.filter((s) => s.route === route && new Date(s.tStart).getHours() >= a && new Date(s.tStart).getHours() < b);
        if (!cell.length) return { lv: 0, n: 0 };
        const share = cell.filter((s) => s.level === 'bloom').length / cell.length;
        return { lv: share >= 0.6 ? 3 : share >= 0.3 ? 2 : 1, n: new Set(cell.map((s) => s.trip)).size };
      }),
    ]);
  } else {
    rows = DEMO_HEAT.map(([r, v]) => [r, v.map((lv) => ({ lv, n: -1 }))]);
  }
  const km = segs.reduce((s, x) => s + x.distanceM, 0) / 1000;
  const brakes = segs.reduce((s, x) => s + x.events.filter((e) => e.type === 'hard_brake').length, 0);
  const thanks = trips.reduce((s, t) => s + t.thanks.length, 0);
  const flagged = rows.reduce((s, [, cells]) => s + cells.filter((c) => c.lv === 1).length, 0);
  const kpi = (label: string, v: string, dark = false) => `<div class="kpi ${dark ? 'dark' : ''}"><p class="muted">${label}</p><p class="num">${v}</p></div>`;

  render(`
    <section class="screen wide">
      <div class="row" style="align-items:flex-end;flex-wrap:wrap">
        <div><p style="font-size:15px;font-weight:700;color:#a9520f">公車順順行 · 市府儀表板（示意）</p><h1 class="title" style="font-size:30px">哪條路線、哪個時段最常急煞？</h1></div>
        <div class="chips">
          <button class="chip" data-src="demo" aria-pressed="${!local}">示意資料</button>
          <button class="chip" data-src="local" aria-pressed="${local}">這支手機的資料</button>
        </div>
      </div>
      <p class="muted">${local ? '這支手機的有效旅程（正式版每格 ≥ 10 趟才顯示，這裡不套用）' : '過去 30 天 · 每格 ≥ 10 趟才顯示（示意數字）'}</p>
      <div class="kpis">
        ${kpi('有效量測趟次', local ? String(trips.length) : '[__]')}
        ${kpi('每公里急煞次數', local ? (km > 0 ? (brakes / km).toFixed(1) : '–') : '[__]')}
        ${kpi('乘客送出的感謝', local ? String(thanks) : '[__]')}
        ${kpi('建議檢查班表的時段', `${local ? flagged : '[__]'} 個`, true)}
      </div>
      <div class="city-main">
        <div class="card">
          <p class="section">平穩度熱點圖（路線 × 時段${local ? '' : '，示意資料'}）</p>
          <div class="heat-wrap"><div class="heat">
            <p class="hd"></p>${SLOTS.map(([, , l]) => `<p class="hd">${l}</p>`).join('')}
            ${rows.map(([name, cells]) => `<p class="rn">${esc(name)}</p>${cells.map((c) => `<p class="h${c.lv}">${HEAT_LABEL[c.lv]}${c.n > 0 ? `<small>${c.n} 趟</small>` : ''}</p>`).join('')}`).join('') || `<p class="rn muted" style="grid-column:1/-1">還沒有有效旅程</p>`}
          </div></div>
          <p class="small">深綠＝很順　淺綠＝普通　橘＝常急煞（依站間盛開比例；格內文字同時標示等級）</p>
        </div>
        <div class="card">
          <p class="section">班表健康檢查：中山幹線 17–19 點</p>
          <p class="body" style="font-size:15px">表定一趟：[__] 分鐘<br>實際行車中位數：[__] 分鐘<br>守速推算的安全行車時間：[__] 分鐘</p>
          <p class="advice">建議：每趟加 [__] 分鐘緩衝，約需增加 [__] 車次</p>
          <p class="small">資料只以路線 × 時段呈現，不顯示個別司機，不用於懲處。班表數字需要 TDX 班表與更多實測資料。</p>
        </div>
      </div>
      <a class="link" href="#/garden" style="align-self:flex-start">‹ 回果籃</a>
    </section>
  `);
  app.querySelectorAll<HTMLButtonElement>('[data-src]').forEach((b) => (b.onclick = () => void cityView(b.dataset.src === 'local')));
}

// ---------- 路由 ----------

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  if (ride && page !== 'ride') {
    // 搭乘中不離開記錄畫面（例如按了瀏覽器返回）
    location.hash = '#/ride';
    return;
  }
  switch (page) {
    case 'ride':
      return ridingView();
    case 'review':
      return void reviewView(decodeURIComponent(arg ?? ''));
    case 'garden':
      return void gardenView();
    case 'reward':
      return rewardView();
    case 'driver':
      return void driverView();
    case 'city':
      return void cityView();
    default:
      return homeView();
  }
}

window.addEventListener('hashchange', route);
route();
