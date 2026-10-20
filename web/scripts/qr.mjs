// 產生網址的 QR code：終端機顯示＋存成 PNG（貼紙、簡報用）
// 用法：node scripts/qr.mjs "https://<帳號>.github.io/sunsunbus/?route=中山幹線" [輸出.png]
import QRCode from 'qrcode';

const url = process.argv[2];
if (!url) {
  console.error('用法：node scripts/qr.mjs <網址> [輸出.png]');
  process.exit(1);
}
const out = process.argv[3] ?? 'sunsunbus-qr.png';
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
await QRCode.toFile(out, url, { width: 800, margin: 2 });
console.log(`已存成 ${out}：${url}`);
