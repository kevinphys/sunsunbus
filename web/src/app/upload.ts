// 選用：上傳到簡易後端（server/）。只有設定了 VITE_API_BASE 才會出現上傳按鈕。
//
// 隱私原則：只上傳「路線、車牌、路段（以約 100 m 格網的位置代表）、事件類型、時間（取整到 15 分鐘）」，
// 不含裝置資訊、精確時間、精確軌跡或任何可識別乘客的資料。
import type { TripMeta } from './storage';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

const QUARTER_MS = 15 * 60 * 1000;
export const floorTo15Min = (ms: number) => new Date(Math.floor(ms / QUARTER_MS) * QUARTER_MS).toISOString();
/** 經緯度取到小數 3 位（約 100 m），當作路段的代表點 */
const grid = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

export function privacyPayload(meta: TripMeta) {
  const s = meta.summary!;
  return {
    schemaVersion: 1,
    route: meta.route,
    plate: meta.plate,
    timeBucket: floorTo15Min(meta.createdAt),
    durationMin: Math.round(s.durationSec / 60),
    distanceKm: Math.round(s.distanceKm * 10) / 10,
    placement: meta.placement,
    seatRow: meta.seatRow,
    stableRatio: Math.round(s.stableRatio * 100) / 100,
    smoothScore: Math.round(s.smoothScore),
    counts: s.counts,
    events: (meta.events ?? []).map((e) => ({
      type: e.type,
      timeBucket: floorTo15Min(e.tPeak),
      lat: grid(e.lat),
      lon: grid(e.lon),
      peakValue: Math.round(e.peakValue * 10) / 10,
    })),
  };
}

export async function uploadTrip(meta: TripMeta): Promise<void> {
  const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(privacyPayload(meta)),
  });
  if (!res.ok) throw new Error(`上傳失敗：HTTP ${res.status}`);
}
