// 即時折線圖（canvas，不用圖表函式庫以減少耗電與體積）。
// 上圖：縱向／橫向加速度與門檻線；下圖：加加速度。不穩定時段用灰底標示。
import type { Params } from '../core/params';
import type { ProcessedSample } from '../core/types';

const WINDOW_MS = 30_000;
const COLORS = { long: '#0f766e', lat: '#d97706', jerk: '#6366f1', grid: '#cbd5e1', text: '#64748b', unstable: 'rgba(148,163,184,0.25)' };

interface Point {
  t: number;
  aLong: number;
  aLat: number;
  jerk: number;
  stable: boolean;
}

export class LiveChart {
  private pts: Point[] = [];
  private raf = 0;
  private dirty = false;
  private ctx: CanvasRenderingContext2D;

  constructor(
    private canvas: HTMLCanvasElement,
    private params: Params,
    private jerkThreshold: () => number,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const loop = () => {
      if (this.dirty) this.draw();
      this.dirty = false;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  push(s: ProcessedSample) {
    // 降到約 30 Hz 就夠畫了
    const last = this.pts.at(-1);
    if (last && s.t - last.t < 30) return;
    this.pts.push({ t: s.t, aLong: s.aLong, aLat: s.aLat, jerk: s.jerkLong, stable: s.stable });
    while (this.pts.length && s.t - this.pts[0].t > WINDOW_MS) this.pts.shift();
    this.dirty = true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private draw() {
    const c = this.canvas;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.pts.length) return;
    const tEnd = this.pts.at(-1)!.t;
    const x = (t: number) => w - ((tEnd - t) / WINDOW_MS) * w;
    const gap = 8;
    const h1 = (h - gap) * 0.6;
    const h2 = h - gap - h1;
    const e = this.params.events;

    // 不穩定時段
    ctx.fillStyle = COLORS.unstable;
    let start: number | null = null;
    for (const p of this.pts) {
      if (!p.stable && start === null) start = p.t;
      if (p.stable && start !== null) {
        ctx.fillRect(x(start), 0, x(p.t) - x(start), h);
        start = null;
      }
    }
    if (start !== null) ctx.fillRect(x(start), 0, w - x(start), h);

    const panel = (top: number, height: number, range: number, lines: { v: number; label: string }[], series: { key: keyof Point; color: string }[]) => {
      const y = (v: number) => top + height / 2 - (Math.max(-range, Math.min(range, v)) / range) * (height / 2);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px system-ui, sans-serif';
      for (const l of lines) {
        ctx.beginPath();
        ctx.moveTo(0, y(l.v));
        ctx.lineTo(w, y(l.v));
        ctx.stroke();
        ctx.fillText(l.label, 4, y(l.v) - 2);
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, y(0));
      ctx.lineTo(w, y(0));
      ctx.stroke();
      ctx.lineWidth = 2;
      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.beginPath();
        this.pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p[s.key] as number)) : ctx.moveTo(x(p.t), y(p[s.key] as number))));
        ctx.stroke();
      }
    };

    panel(0, h1, 3, [
      { v: e.accelThreshold, label: `加速 +${e.accelThreshold}` },
      { v: -e.brakeThreshold, label: `煞車 −${e.brakeThreshold}` },
    ], [
      { key: 'aLat', color: COLORS.lat },
      { key: 'aLong', color: COLORS.long },
    ]);
    const jt = this.jerkThreshold();
    panel(h1 + gap, h2, Math.max(15, jt * 1.5), [{ v: jt, label: `加加速度 ${jt.toFixed(1)}` }, { v: -jt, label: '' }], [{ key: 'jerk', color: COLORS.jerk }]);
  }
}
