"""把事件對應到路線上的路段與站間。

支援的路線資料：
- TDX 公車路線線型（/v2/Bus/Shape/City/{City}/{RouteName}）：Geometry 為 WKT LINESTRING
- GeoJSON（LineString / MultiLineString），例如 data.taipei 的路線軌跡轉檔後
- TDX 站序（/v2/Bus/StopOfRoute/City/{City}/{RouteName}）

作法：把經緯度用等距投影換成公尺，計算每個事件投影到路線上的「里程」（距起點公尺數），
再分到固定長度的路段（預設 200 m）與前後兩站之間。
"""

from __future__ import annotations

import json
import math
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TDX_TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
TDX_API = "https://tdx.transportdata.tw/api/basic/v2/Bus"


@dataclass
class RouteShape:
    name: str
    direction: int | None
    lonlat: np.ndarray  # (n, 2)


@dataclass
class Stop:
    name: str
    seq: int
    lat: float
    lon: float


def _parse_wkt(wkt: str) -> np.ndarray:
    nums = re.findall(r"(-?\d+\.?\d*)\s+(-?\d+\.?\d*)", wkt)
    return np.array([[float(a), float(b)] for a, b in nums])


def load_route_shapes(path) -> list[RouteShape]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    shapes = []
    if isinstance(data, dict) and data.get("type") in ("FeatureCollection", "Feature", "LineString", "MultiLineString"):
        feats = data["features"] if data.get("type") == "FeatureCollection" else [data if data.get("type") == "Feature" else {"geometry": data, "properties": {}}]
        for f in feats:
            g = f["geometry"]
            lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
            props = f.get("properties") or {}
            for line in lines:
                shapes.append(RouteShape(str(props.get("name", props.get("RouteName", ""))), props.get("direction"), np.array(line, float)[:, :2]))
        return shapes
    for item in data if isinstance(data, list) else [data]:
        name = item.get("RouteName", {})
        shapes.append(RouteShape(name.get("Zh_tw", "") if isinstance(name, dict) else str(name), item.get("Direction"), _parse_wkt(item["Geometry"])))
    return shapes


def load_stops(path, direction: int | None = None) -> list[Stop]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    stops = []
    for route in data:
        if direction is not None and route.get("Direction") != direction:
            continue
        for s in route["Stops"]:
            pos = s["StopPosition"]
            stops.append(Stop(s["StopName"]["Zh_tw"], int(s["StopSequence"]), float(pos["PositionLat"]), float(pos["PositionLon"])))
        if direction is None:
            break
    return sorted(stops, key=lambda s: s.seq)


class RouteProjector:
    def __init__(self, shape: RouteShape):
        self.shape = shape
        self.lat0 = float(np.mean(shape.lonlat[:, 1]))
        self.lon0 = float(np.mean(shape.lonlat[:, 0]))
        self.xy = self._to_xy(shape.lonlat[:, 1], shape.lonlat[:, 0])
        seg = np.diff(self.xy, axis=0)
        self.seg_len = np.hypot(seg[:, 0], seg[:, 1])
        self.cum = np.concatenate([[0], np.cumsum(self.seg_len)])
        self.length_m = float(self.cum[-1])

    def _to_xy(self, lat, lon):
        lat = np.asarray(lat, float)
        lon = np.asarray(lon, float)
        k = 111_320.0
        return np.column_stack([(lon - self.lon0) * k * math.cos(math.radians(self.lat0)), (lat - self.lat0) * k])

    def project(self, lat: float, lon: float) -> tuple[float, float]:
        """回傳（沿路線里程 m，離路線距離 m）。"""
        p = self._to_xy([lat], [lon])[0]
        a = self.xy[:-1]
        d = self.xy[1:] - a
        L2 = np.maximum((d * d).sum(1), 1e-9)
        tt = np.clip(((p - a) * d).sum(1) / L2, 0, 1)
        proj = a + d * tt[:, None]
        dist = np.hypot(*(proj - p).T)
        i = int(np.argmin(dist))
        return float(self.cum[i] + tt[i] * self.seg_len[i]), float(dist[i])


def pick_shape(shapes: list[RouteShape], track: list[tuple[float, float]]) -> RouteShape:
    """有去程／回程時，選平均距離 GPS 軌跡最近的那條。"""
    if len(shapes) == 1 or not track:
        return shapes[0]
    sample = track[:: max(1, len(track) // 50)]
    best = min(shapes, key=lambda s: np.mean([RouteProjector(s).project(lat, lon)[1] for lat, lon in sample]))
    return best


def assign_events(events_df, shape: RouteShape, stops: list[Stop] | None = None, bin_m: float = 200, max_offset_m: float = 80):
    """在事件 DataFrame（需有 lat、lon 欄）加上 chainage_m、offset_m、segment_bin、between_stops。"""
    proj = RouteProjector(shape)
    stop_ch = [(proj.project(s.lat, s.lon)[0], s.name) for s in stops or []]
    stop_ch.sort()
    ch, off, bins, between = [], [], [], []
    for lat, lon in zip(events_df["lat"], events_df["lon"]):
        if lat is None or (isinstance(lat, float) and math.isnan(lat)):
            ch.append(math.nan), off.append(math.nan), bins.append(None), between.append(None)
            continue
        c, d = proj.project(lat, lon)
        ch.append(c)
        off.append(d)
        if d > max_offset_m:
            bins.append(None), between.append("（不在路線上）")
            continue
        b = int(c // bin_m)
        bins.append(f"{b * bin_m:.0f}–{(b + 1) * bin_m:.0f} m")
        label = None
        for (c1, n1), (c2, n2) in zip(stop_ch, stop_ch[1:]):
            if c1 <= c < c2:
                label = f"{n1} → {n2}"
                break
        between.append(label)
    out = events_df.copy()
    out["chainage_m"] = ch
    out["offset_m"] = off
    out["segment_bin"] = bins
    out["between_stops"] = between
    return out


# ---------------------------------------------------------------- TDX 下載（需要 TDX 會員的 Client ID / Secret）


def tdx_token(client_id: str, client_secret: str) -> str:
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}).encode()
    req = urllib.request.Request(TDX_TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def fetch_tdx(route: str, out_dir, client_id: str, client_secret: str, city: str = "Taipei") -> dict:
    """下載路線線型與站序到 out_dir，回傳兩個檔案路徑。"""
    token = tdx_token(client_id, client_secret)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = {}
    for kind in ("Shape", "StopOfRoute"):
        url = f"{TDX_API}/{kind}/City/{city}/{urllib.parse.quote(route)}?%24format=JSON"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept-Encoding": "identity"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        # 依路線名稱查詢可能也回傳名稱相近的路線（例如 307 與 307莒光，未實測確認），只留完全相符的
        exact = [d for d in data if d.get("RouteName", {}).get("Zh_tw") == route] or data
        p = out / f"{route}_{kind}.json"
        p.write_text(json.dumps(exact, ensure_ascii=False, indent=1), encoding="utf-8")
        paths[kind] = p
    return paths
