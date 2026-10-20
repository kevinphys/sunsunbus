// 匯出格式（Python 分析工具 analysis/sunsunbus/io.py 讀同一格式）。
// 欄位定義見 docs/data-format.md。
import type { GpsFix, MotionSample, OrientationSample, ProcessedSample, TripEvent } from './types';
import { EVENT_LABELS } from './types';

export const MOTION_COLUMNS = [
  't_ms', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'rot_alpha', 'rot_beta', 'rot_gamma', 'interval',
  'ori_alpha', 'ori_beta', 'ori_gamma',
  'a_long', 'a_lat', 'a_vert', 'jerk_long', 'jerk_lat', 'jerk_mag', 'stable', 'segment', 'orient_source',
] as const;

export const GPS_COLUMNS = ['t_ms', 'lat', 'lon', 'speed', 'heading', 'accuracy'] as const;

export const EVENT_COLUMNS = [
  'type', 'label', 't_start_ms', 't_end_ms', 't_peak_ms', 'duration_s',
  'peak_value', 'peak_a_long', 'peak_a_lat', 'peak_jerk', 'lat', 'lon', 'speed', 'orient_source',
] as const;

const num = (x: number | null | undefined, d: number) => (x === null || x === undefined || !Number.isFinite(x) ? '' : x.toFixed(d));

/**
 * 原始資料 CSV：每一筆 devicemotion 一列，附上當下最近一筆（之前）的 deviceorientation，
 * 以及處理後的車輛座標數值（processed 與 motion 必須一一對應）。
 */
export function motionCsv(motion: MotionSample[], orientation: OrientationSample[], processed?: ProcessedSample[]): string {
  const lines: string[] = [MOTION_COLUMNS.join(',')];
  let oi = -1;
  for (let i = 0; i < motion.length; i++) {
    const m = motion[i];
    while (oi + 1 < orientation.length && orientation[oi + 1].t <= m.t) oi++;
    const o = oi >= 0 ? orientation[oi] : null;
    const p = processed?.[i];
    lines.push(
      [
        num(m.t, 3), num(m.ax, 5), num(m.ay, 5), num(m.az, 5), num(m.gx, 5), num(m.gy, 5), num(m.gz, 5),
        num(m.ra, 4), num(m.rb, 4), num(m.rg, 4), num(m.interval, 4),
        num(o?.alpha, 3), num(o?.beta, 3), num(o?.gamma, 3),
        num(p?.aLong, 5), num(p?.aLat, 5), num(p?.aVert, 5),
        num(p?.jerkLong, 4), num(p?.jerkLat, 4), num(p?.jerkMag, 4),
        p ? (p.stable ? '1' : '0') : '', p ? String(p.segment) : '', p?.orientSource ?? '',
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function gpsCsv(gps: GpsFix[]): string {
  const lines: string[] = [GPS_COLUMNS.join(',')];
  for (const g of gps) {
    lines.push([num(g.t, 0), num(g.lat, 7), num(g.lon, 7), num(g.speed, 3), num(g.heading, 1), num(g.accuracy, 1)].join(','));
  }
  return lines.join('\n') + '\n';
}

export function eventsCsv(events: TripEvent[]): string {
  const lines: string[] = [EVENT_COLUMNS.join(',')];
  for (const e of events) {
    lines.push(
      [
        e.type, EVENT_LABELS[e.type], num(e.tStart, 0), num(e.tEnd, 0), num(e.tPeak, 0), num((e.tEnd - e.tStart) / 1000, 2),
        num(e.peakValue, 3), num(e.peakALong, 3), num(e.peakALat, 3), num(e.peakJerk, 3),
        num(e.lat, 7), num(e.lon, 7), num(e.speed, 2), e.orientSource,
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** 簡單的 CSV 解析（沒有引號跳脫，本專案輸出的檔案不含逗號） */
export function parseCsv(text: string): Record<string, string>[] {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.filter((r) => r && !r.startsWith('#')).map((r) => {
    const v = r.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

const f = (s: string) => (s === '' ? null : Number(s));

/** 由匯出的 CSV 讀回原始資料（給 fixtures 與對照測試用） */
export function parseMotionCsv(text: string): { motion: MotionSample[]; orientation: OrientationSample[] } {
  const motion: MotionSample[] = [];
  const orientation: OrientationSample[] = [];
  for (const r of parseCsv(text)) {
    const t = Number(r.t_ms);
    motion.push({
      t, ax: f(r.ax), ay: f(r.ay), az: f(r.az), gx: Number(r.gx), gy: Number(r.gy), gz: Number(r.gz),
      ra: f(r.rot_alpha), rb: f(r.rot_beta), rg: f(r.rot_gamma), interval: f(r.interval),
    });
    if (r.ori_beta !== '') orientation.push({ t, alpha: f(r.ori_alpha), beta: f(r.ori_beta), gamma: f(r.ori_gamma) });
  }
  return { motion, orientation };
}

export function parseGpsCsv(text: string): GpsFix[] {
  return parseCsv(text).map((r) => ({
    t: Number(r.t_ms), lat: Number(r.lat), lon: Number(r.lon), speed: f(r.speed), heading: f(r.heading), accuracy: Number(r.accuracy),
  }));
}
