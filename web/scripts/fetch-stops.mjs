// 下載臺北市公車站序（臺北市政府公車動態資訊，政府資料開放授權，免金鑰），
// 轉成遊戲版讀的 TDX StopOfRoute 格式，存到 public/stops/<路線>.json。
// 用法：npm run stops                    （預設：首頁建議的路線）
//       npm run stops -- 中山幹線 307      （指定路線）
//       npm run stops -- --all             （全部臺北市路線，約 3 MB）
// 新北市的路線（例如部分 6xx、9xx）不在這份資料裡。
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const BASE = 'https://tcgbusfs.blob.core.windows.net/blobbus';
const DEFAULT_ROUTES = ['中山幹線', '信義幹線', '敦化幹線', '民生幹線', '南京幹線', '307', '262', '656'];
const OUT = new URL('../public/stops/', import.meta.url);

async function load(name) {
  const res = await fetch(`${BASE}/${name}.gz`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8').replace(/^﻿/, '');
  return JSON.parse(text).BusInfo;
}

const args = process.argv.slice(2);
const [routes, stops] = await Promise.all([load('GetRoute'), load('GetStop')]);
const byName = new Map();
for (const r of routes) if (!byName.has(r.nameZh)) byName.set(r.nameZh, r);
const wanted = args.includes('--all') ? [...byName.keys()] : args.length ? args : DEFAULT_ROUTES;

mkdirSync(OUT, { recursive: true });
let written = 0;
for (const name of wanted) {
  const route = byName.get(name);
  if (!route) {
    console.warn(`略過 ${name}：臺北市資料裡沒有這條路線`);
    continue;
  }
  const own = stops.filter((s) => s.routeId === route.Id);
  const directions = [...new Set(own.map((s) => Number(s.goBack)))].filter((d) => d === 0 || d === 1).sort();
  const data = directions.map((d) => ({
    RouteName: { Zh_tw: name },
    Direction: d,
    Stops: own
      .filter((s) => Number(s.goBack) === d)
      .sort((a, b) => a.seqNo - b.seqNo)
      .map((s) => ({
        StopUID: `TPE${s.Id}`,
        StopSequence: s.seqNo + 1,
        StopName: { Zh_tw: s.nameZh },
        StopPosition: { PositionLat: Number(s.latitude), PositionLon: Number(s.longitude) },
      })),
  }));
  if (!data.length) {
    console.warn(`略過 ${name}：沒有站序`);
    continue;
  }
  // 檔名用路線名稱（前端以 encodeURIComponent(路線) 讀取）
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(data));
  written++;
  console.log(`${name}：${data.map((d) => `方向 ${d.Direction} ${d.Stops.length} 站（往 ${d.Stops.at(-1).StopName.Zh_tw}）`).join('、')}`);
}
console.log(`寫入 ${written} 條路線到 web/public/stops/（資料來源：臺北市政府公車動態資訊，政府資料開放授權條款）`);
