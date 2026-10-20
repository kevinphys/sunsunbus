// 本機儲存（IndexedDB）。資料預設只存在手機上。
// trips：每趟的設定、摘要、事件；chunks：原始感測資料，每 5 秒寫一塊，避免當機時整趟遺失。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Params } from '../core/params';
import type { GpsFix, MotionSample, OrientationSample, SegmentInfo, TripEvent, TripSummary } from '../core/types';

export type SeatRow = 'front' | 'middle' | 'rear';
export type SeatSide = 'window' | 'aisle';
export type Posture = 'sit' | 'stand';
export type Placement = 'mount' | 'seat' | 'hand';

export interface Marker {
  t: number;
  kind: 'manual_brake' | 'sync_tap';
}

export interface TripMeta {
  id: string;
  schemaVersion: 1;
  createdAt: number;
  endedAt: number | null;
  status: 'recording' | 'done';
  route: string;
  plate: string;
  seatRow: SeatRow | '';
  seatSide: SeatSide | '';
  posture: Posture | '';
  placement: Placement | '';
  /** 搖手機測試模式：不檢查靜置、方向用猜的 */
  testMode: boolean;
  device: { userAgent: string; platform: string; language: string; screen: string };
  params: Params;
  markers: Marker[];
  /** 頁面被切到背景或鎖屏、收不到感測資料的時段 */
  gaps: { tStart: number; tEnd: number }[];
  /** 「謝謝司機」按下的時間（先只存本機，留給階段二的點讚機制） */
  thanks: number[];
  liveSampleRateHz: number;
  chunkCount: number;
  summary?: TripSummary;
  events?: TripEvent[];
  segments?: SegmentInfo[];
  accelSign?: 1 | -1;
  uploadedAt?: number;
}

export interface Chunk {
  tripId: string;
  seq: number;
  motion: MotionSample[];
  orientation: OrientationSample[];
  gps: GpsFix[];
}

interface Schema extends DBSchema {
  trips: { key: string; value: TripMeta; indexes: { createdAt: number } };
  chunks: { key: [string, number]; value: Chunk; indexes: { tripId: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  dbp ??= openDB<Schema>('sunsunbus', 1, {
    upgrade(d) {
      const trips = d.createObjectStore('trips', { keyPath: 'id' });
      trips.createIndex('createdAt', 'createdAt');
      const chunks = d.createObjectStore('chunks', { keyPath: ['tripId', 'seq'] });
      chunks.createIndex('tripId', 'tripId');
    },
  });
  return dbp;
}

export async function saveTrip(meta: TripMeta) {
  await (await db()).put('trips', meta);
}

export async function getTrip(id: string) {
  return (await db()).get('trips', id);
}

export async function listTrips(): Promise<TripMeta[]> {
  const all = await (await db()).getAllFromIndex('trips', 'createdAt');
  return all.reverse();
}

export async function appendChunk(chunk: Chunk) {
  await (await db()).put('chunks', chunk);
}

/** 讀回整趟原始資料（依序串接） */
export async function loadRaw(tripId: string) {
  const chunks = await (await db()).getAllFromIndex('chunks', 'tripId', tripId);
  chunks.sort((a, b) => a.seq - b.seq);
  return {
    motion: chunks.flatMap((c) => c.motion),
    orientation: chunks.flatMap((c) => c.orientation),
    gps: chunks.flatMap((c) => c.gps),
  };
}

export async function deleteTrip(tripId: string) {
  const d = await db();
  const tx = d.transaction(['trips', 'chunks'], 'readwrite');
  const keys = await tx.objectStore('chunks').index('tripId').getAllKeys(tripId);
  await Promise.all([...keys.map((k) => tx.objectStore('chunks').delete(k)), tx.objectStore('trips').delete(tripId), tx.done]);
}

/** 要求瀏覽器不要自動清掉資料（iOS 會在空間不足時清除網站資料） */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
