// 匯出：原始資料 CSV、事件 CSV、GPS CSV、本趟摘要 JSON。
// 手機上優先用 Web Share（可存到「檔案」、AirDrop、傳 LINE），不支援時改成下載。
import { eventsCsv, gpsCsv, motionCsv } from '../core/csv';
import { processTrip } from '../core/trip';
import { loadRaw, type TripMeta } from './storage';

export interface ExportFile {
  name: string;
  blob: Blob;
}

function stamp(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function baseName(meta: TripMeta) {
  const route = (meta.route || 'unknown').replace(/[\\/:*?"<>|\s,]+/g, '_');
  return `sunsunbus_${stamp(meta.createdAt)}_${route}`;
}

export function summaryJson(meta: TripMeta) {
  return {
    schemaVersion: meta.schemaVersion,
    app: 'sunsunbus',
    trip: {
      createdAt: new Date(meta.createdAt).toISOString(),
      endedAt: meta.endedAt ? new Date(meta.endedAt).toISOString() : null,
      route: meta.route,
      plate: meta.plate,
      seatRow: meta.seatRow,
      seatSide: meta.seatSide,
      posture: meta.posture,
      placement: meta.placement,
      testMode: meta.testMode,
    },
    device: meta.device,
    sampleRateHz: meta.summary?.sampleRateHz ?? meta.liveSampleRateHz,
    accelSign: meta.accelSign,
    summary: meta.summary,
    segments: meta.segments,
    markers: meta.markers,
    gaps: meta.gaps,
    thanks: meta.thanks,
    params: meta.params,
  };
}

export async function buildExportFiles(meta: TripMeta): Promise<ExportFile[]> {
  const raw = await loadRaw(meta.id);
  const r = processTrip(raw, meta.params);
  const base = baseName(meta);
  const csv = (s: string) => new Blob([s], { type: 'text/csv' });
  return [
    { name: `${base}_motion.csv`, blob: csv(motionCsv(raw.motion, raw.orientation, r.samples)) },
    { name: `${base}_gps.csv`, blob: csv(gpsCsv(raw.gps)) },
    { name: `${base}_events.csv`, blob: csv(eventsCsv(r.events)) },
    { name: `${base}_summary.json`, blob: new Blob([JSON.stringify(summaryJson(meta), null, 2)], { type: 'application/json' }) },
  ];
}

export function download(f: ExportFile) {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 用系統分享面板一次分享多個檔案；不支援時回傳 false */
export async function shareFiles(files: ExportFile[]): Promise<boolean> {
  const fs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (!navigator.canShare?.({ files: fs })) return false;
  try {
    await navigator.share({ files: fs, title: '順順行 量測資料' });
    return true;
  } catch (e) {
    // 使用者取消分享也算「處理過了」
    return (e as Error).name === 'AbortError';
  }
}
