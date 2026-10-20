// 一趟記錄的生命週期：開始 → 收感測資料（即時處理＋定時寫入本機）→ 結束後批次處理出摘要。
import type { Params } from '../core/params';
import { mergeParams } from '../core/params';
import { LiveProcessor } from '../core/live';
import { processTrip } from '../core/trip';
import type { GpsFix, MotionSample, OrientationSample, ProcessedSample, TripEvent } from '../core/types';
import { appendChunk, loadRaw, saveTrip, type Marker, type TripMeta } from './storage';
import { WakeLock, startSensors } from './sensors';

const FLUSH_MS = 5000;

export type TripSetup = Pick<TripMeta, 'route' | 'plate' | 'seatRow' | 'seatSide' | 'posture' | 'placement' | 'testMode'>;

/** 搖手機測試：不要求靜置，讓評審搖手機也能看到事件 */
export function testModeParams(p: Params): Params {
  return mergeParams(
    { stability: { maxGravityAngleDeg: 180, maxTiltRateRmsDps: 1e9, minStableSec: 0, recalibrateAfterUnstableSec: 1e9, recalibrateGravityDriftDeg: 180 } },
    p,
  );
}

export function deviceInfo(): TripMeta['device'] {
  return {
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
    language: navigator.language,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
  };
}

export interface RecorderListener {
  onSample?: (s: ProcessedSample) => void;
  onEvent?: (e: TripEvent) => void;
  onGps?: (g: GpsFix) => void;
  onGpsError?: (msg: string) => void;
  onGap?: (sec: number) => void;
}

export class Recorder {
  meta: TripMeta;
  live: LiveProcessor;
  lastGps: GpsFix | null = null;
  motionCount = 0;
  wakeLockOk = false;
  private buf: { motion: MotionSample[]; orientation: OrientationSample[]; gps: GpsFix[] } = { motion: [], orientation: [], gps: [] };
  private stopSensors: (() => void) | null = null;
  private wake = new WakeLock();
  private timer: number | undefined;
  private hiddenAt: number | null = null;
  private flushing = Promise.resolve();

  constructor(
    setup: TripSetup,
    params: Params,
    private listener: RecorderListener = {},
  ) {
    const effective = setup.testMode ? testModeParams(params) : params;
    this.meta = {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      createdAt: Date.now(),
      endedAt: null,
      status: 'recording',
      ...setup,
      device: deviceInfo(),
      params: effective,
      markers: [],
      gaps: [],
      thanks: [],
      liveSampleRateHz: 0,
      chunkCount: 0,
    };
    this.live = new LiveProcessor(effective, (e) => this.listener.onEvent?.(e));
  }

  async start() {
    await saveTrip(this.meta);
    this.stopSensors = startSensors({
      onMotion: (m) => {
        this.buf.motion.push(m);
        this.motionCount++;
        for (const s of this.live.pushMotion(m)) this.listener.onSample?.(s);
      },
      onOrientation: (o) => {
        this.buf.orientation.push(o);
        this.live.pushOrientation(o);
      },
      onGps: (g) => {
        this.buf.gps.push(g);
        this.live.pushGps(g);
        this.lastGps = g;
        this.listener.onGps?.(g);
      },
      onGpsError: (msg) => this.listener.onGpsError?.(msg),
    });
    this.wakeLockOk = await this.wake.start();
    this.timer = window.setInterval(() => this.flush(), FLUSH_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** 網頁在背景或鎖屏時收不到感測資料：記下中斷時段 */
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      void this.flush();
    } else if (this.hiddenAt !== null) {
      const gap = { tStart: this.hiddenAt, tEnd: Date.now() };
      this.meta.gaps.push(gap);
      this.hiddenAt = null;
      this.listener.onGap?.((gap.tEnd - gap.tStart) / 1000);
    }
  };

  mark(kind: Marker['kind']) {
    this.meta.markers.push({ t: Date.now(), kind });
  }

  private flush(): Promise<void> {
    const { motion, orientation, gps } = this.buf;
    if (!motion.length && !orientation.length && !gps.length) return this.flushing;
    this.buf = { motion: [], orientation: [], gps: [] };
    const seq = this.meta.chunkCount++;
    this.meta.liveSampleRateHz = this.live.sampleRateHz;
    this.flushing = this.flushing.then(async () => {
      await appendChunk({ tripId: this.meta.id, seq, motion, orientation, gps });
      await saveTrip(this.meta);
    });
    return this.flushing;
  }

  /** 結束記錄：停止感測器、寫入剩餘資料、用整趟資料重新批次處理 */
  async stop(): Promise<TripMeta> {
    this.stopSensors?.();
    window.clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.wake.stop();
    this.live.finish();
    this.meta.endedAt = Date.now();
    await this.flush();
    return finalizeTrip(this.meta);
  }
}

/** 由本機原始資料重新計算摘要（結束時用，也可以對中斷的趟次補做） */
export async function finalizeTrip(meta: TripMeta): Promise<TripMeta> {
  const raw = await loadRaw(meta.id);
  const r = processTrip(raw, meta.params);
  meta.status = 'done';
  meta.endedAt ??= raw.motion.at(-1)?.t ?? meta.createdAt;
  meta.summary = r.summary;
  meta.events = r.events;
  meta.segments = r.segments;
  meta.accelSign = r.accelSign;
  await saveTrip(meta);
  return meta;
}
