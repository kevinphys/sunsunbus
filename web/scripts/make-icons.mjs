// 產生 PWA 用的 PNG 圖示（與 public/icon.svg 同樣的圖案），不依賴影像處理套件。
// 用法：node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// 三次貝茲曲線上的取樣點（與 SVG 的 path 一致，座標在 512 空間）
function curvePoints() {
  const segs = [[[72, 300], [152, 300], [152, 212], [256, 212]], [[256, 212], [360, 212], [360, 300], [440, 300]]];
  const pts = [];
  for (const [p0, p1, p2, p3] of segs)
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, u = 1 - t;
      pts.push([u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]);
    }
  return pts;
}
const PTS = curvePoints();
function pixel(x, y) {
  // 圓角矩形外為透明
  const r = 112, cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  if ((x - 256) ** 2 + (y - 212) ** 2 <= 30 * 30) return [253, 230, 138, 255];
  let d = Infinity;
  for (const [px, py] of PTS) d = Math.min(d, (x - px) ** 2 + (y - py) ** 2);
  if (d <= 22 * 22) return [255, 255, 255, 255];
  return [15, 118, 110, 255];
}
function png(size) {
  const ss = 2; // 超取樣抗鋸齒
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const p = pixel(((x + (sx + 0.5) / ss) * 512) / size, ((y + (sy + 0.5) / ss) * 512) / size);
        for (let k = 0; k < 4; k++) acc[k] += p[k];
      }
      for (let k = 0; k < 4; k++) row[1 + x * 4 + k] = Math.round(acc[k] / (ss * ss));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
console.log('icons written');
