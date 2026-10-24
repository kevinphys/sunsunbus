// 果實帳本：只記「哪一天採到幾顆、哪一種」與兌換紀錄，不記路線與時間，和搭乘資料（IndexedDB）分開存。
// 原型只存在這支手機（localStorage）；正式版第一次兌換時才綁定支付帳戶。
const KEY = 'sunsunbus.fruit';

export interface Ledger {
  entries: { day: string; n: number; kind: 'normal' | 'scout' }[];
  redemptions: { day: string; fruits: number; wallet: string }[];
  consented: boolean;
  wallet: string | null;
}

/** 本地日期 YYYY-MM-DD */
export const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE');

export function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { entries: [], redemptions: [], consented: false, wallet: null, ...(JSON.parse(raw) as Partial<Ledger>) };
  } catch {
    /* 無痕模式等情況讀不到，就從空的開始 */
  }
  return { entries: [], redemptions: [], consented: false, wallet: null };
}

export function saveLedger(l: Ledger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

export const balance = (l: Ledger) => l.entries.reduce((s, e) => s + e.n, 0) - l.redemptions.reduce((s, r) => s + r.fruits, 0);
export const fruitsToday = (l: Ledger) => l.entries.filter((e) => e.day === dayKey()).reduce((s, e) => s + e.n, 0);
export const collectedThisMonth = (l: Ledger) => l.entries.filter((e) => e.day.slice(0, 7) === dayKey().slice(0, 7)).reduce((s, e) => s + e.n, 0);

/** 連續幾天（到今天或昨天為止）都有採到果實 */
export function streakDays(l: Ledger): number {
  const days = new Set(l.entries.filter((e) => e.n > 0).map((e) => e.day));
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function addFruit(n: number, kind: 'normal' | 'scout') {
  if (n <= 0) return;
  const l = loadLedger();
  l.entries.push({ day: dayKey(), n, kind });
  saveLedger(l);
}
