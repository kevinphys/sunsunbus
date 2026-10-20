// 瀏覽器感測器：權限、devicemotion、deviceorientation、定位、螢幕常亮。
import type { GpsFix, MotionSample, OrientationSample } from '../core/types';
import { generateTrip, pulse } from '../core/synthetic';

/** 網址加上 ?simulate=1 時，用合成的公車行程取代真實感測器（電腦上測試、展示用） */
export const SIMULATE = new URLSearchParams(location.search).has('simulate');

type PermissionFn = () => Promise<'granted' | 'denied'>;

/**
 * iOS 13+ 必須在使用者點擊的當下呼叫 requestPermission。
 * 兩個權限同時發出（中間不 await），避免第二個失去「使用者手勢」而被拒絕。
 */
export async function requestMotionPermission(): Promise<{ motion: boolean; orientation: boolean }> {
  if (SIMULATE) return { motion: true, orientation: true };
  const dme = (globalThis.DeviceMotionEvent as unknown as { requestPermission?: PermissionFn }) ?? {};
  const doe = (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn }) ?? {};
  const pm = typeof dme.requestPermission === 'function' ? dme.requestPermission() : Promise.resolve('granted' as const);
  const po = typeof doe.requestPermission === 'function' ? doe.requestPermission() : Promise.resolve('granted' as const);
  const [m, o] = await Promise.allSettled([pm, po]);
  return {
    motion: m.status === 'fulfilled' && m.value === 'granted',
    orientation: o.status === 'fulfilled' && o.value === 'granted',
  };
}

/** 事件的 epoch 毫秒時間戳：performance.timeOrigin + event.timeStamp（高精度、單調） */
const eventTime = (e: Event) => (e.timeStamp > 0 ? performance.timeOrigin + e.timeStamp : Date.now());

export interface SensorHandlers {
  onMotion: (m: MotionSample) => void;
  onOrientation: (o: OrientationSample) => void;
  onGps: (g: GpsFix) => void;
  onGpsError: (msg: string) => void;
}

/** 開始監聽感測器，回傳停止函式 */
export function startSensors(h: SensorHandlers): () => void {
  if (SIMULATE) return startSimulation(h);
  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    const a = e.acceleration;
    const r = e.rotationRate;
    h.onMotion({
      t: eventTime(e),
      ax: a?.x ?? null,
      ay: a?.y ?? null,
      az: a?.z ?? null,
      gx: g.x,
      gy: g.y,
      gz: g.z,
      ra: r?.alpha ?? null,
      rb: r?.beta ?? null,
      rg: r?.gamma ?? null,
      interval: e.interval ?? null,
    });
  };
  const onOrientation = (e: DeviceOrientationEvent) => {
    h.onOrientation({ t: eventTime(e), alpha: e.alpha, beta: e.beta, gamma: e.gamma });
  };
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('deviceorientation', onOrientation);

  let watchId: number | null = null;
  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      (pos) =>
        h.onGps({
          t: pos.timestamp,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy,
        }),
      (err) => h.onGpsError(err.message || `定位錯誤 ${err.code}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  } else {
    h.onGpsError('這個瀏覽器不支援定位');
  }

  return () => {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientation', onOrientation);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  };
}

/** 螢幕常亮（Screen Wake Lock API），頁面回到前景時自動重新取得 */
export class WakeLock {
  private lock: WakeLockSentinel | null = null;
  private active = false;
  supported = 'wakeLock' in navigator;

  private onVisible = () => {
    if (this.active && document.visibilityState === 'visible') void this.acquire();
  };

  async start(): Promise<boolean> {
    this.active = true;
    document.addEventListener('visibilitychange', this.onVisible);
    return this.acquire();
  }

  private async acquire(): Promise<boolean> {
    if (!this.supported) return false;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  }

  async stop() {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    await this.lock?.release().catch(() => {});
    this.lock = null;
  }
}

/**
 * 模擬一段 3 分鐘、循環播放的公車行程：起步、等速、急煞、轉彎、靠站。
 * 時間戳換成現在的時間，以真實速度送進同一套處理流程。
 */
function startSimulation(h: SensorHandlers): () => void {
  const period = 180;
  const aLong = (t: number) =>
    pulse(t, 6, 8, 1.1) + pulse(t, 40, 1.5, -2.4, 0.2) + pulse(t, 48, 5, 1.0) + pulse(t, 75, 3, 1.8) +
    pulse(t, 100, 4, -1.4) + pulse(t, 120, 6, 1.0) + pulse(t, 150, 9, -1.0);
  const aLat = (t: number) => pulse(t, 85, 4, 1.9) + pulse(t, 135, 3, -1.2);
  const trip = generateTrip({ durationSec: period, aLong, aLat, mount: { yawDeg: 15, tiltDeg: 80 }, seed: 7 });
  const tripStart = trip.motion[0].t;
  const t0 = Date.now();
  let mi = 0, oi = 0, gi = 0, loop = 0;
  const timer = window.setInterval(() => {
    const now = Date.now();
    const shift = t0 - tripStart + loop * period * 1000;
    const until = now - shift;
    while (mi < trip.motion.length && trip.motion[mi].t <= until) h.onMotion({ ...trip.motion[mi], t: trip.motion[mi++].t + shift });
    while (oi < trip.orientation.length && trip.orientation[oi].t <= until) h.onOrientation({ ...trip.orientation[oi], t: trip.orientation[oi++].t + shift });
    while (gi < trip.gps.length && trip.gps[gi].t <= until) h.onGps({ ...trip.gps[gi], t: trip.gps[gi++].t + shift });
    if (mi >= trip.motion.length) {
      mi = oi = gi = 0;
      loop++;
    }
  }, 50);
  return () => window.clearInterval(timer);
}
