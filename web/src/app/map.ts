// 本趟事件小地圖（Leaflet + OpenStreetMap）。
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GpsFix, TripEvent } from '../core/types';
import { EVENT_LABELS } from '../core/types';

export const EVENT_COLORS: Record<TripEvent['type'], string> = {
  hard_brake: '#dc2626',
  hard_accel: '#d97706',
  sharp_turn: '#7c3aed',
  high_jerk: '#475569',
};

export function renderTripMap(el: HTMLElement, gps: GpsFix[], events: TripEvent[]): L.Map | null {
  const track = gps.filter((g) => g.accuracy <= 50).map((g) => [g.lat, g.lon] as [number, number]);
  const pts = events.filter((e) => e.lat !== null && e.lon !== null);
  if (!track.length && !pts.length) return null;

  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const layers: L.Layer[] = [];
  if (track.length) layers.push(L.polyline(track, { color: '#0f766e', weight: 4, opacity: 0.7 }).addTo(map));
  for (const e of pts) {
    layers.push(
      L.circleMarker([e.lat!, e.lon!], { radius: 7, color: '#fff', weight: 2, fillColor: EVENT_COLORS[e.type], fillOpacity: 0.95 })
        .bindPopup(`${EVENT_LABELS[e.type]}<br>峰值 ${e.peakValue.toFixed(2)}<br>${new Date(e.tPeak).toLocaleTimeString()}`)
        .addTo(map),
    );
  }
  const bounds = L.featureGroup(layers).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { maxZoom: 17 });
  return map;
}
