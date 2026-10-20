"""硬體感測盒（對照組）：讀檔、與手機對時、比較。

感測盒 CSV 格式見 docs/hardware-format.md：
    # sunsunbus-box v1
    t_ms,ax,ay,az[,gx,gy,gz][,unix_ms][,lat,lon,speed]
t_ms 是盒子自己的時鐘（開機後毫秒），加速度單位 m/s²（含重力），陀螺儀 deg/s。

對時順序：
1. 粗對時：有 unix_ms（盒子有 GPS 或 RTC）就直接用；否則找開頭的「敲擊」——
   上車時把手機和盒子疊在一起敲一下，兩邊都會出現一個很尖的加速度峰。
2. 細對時：在 ±max_lag 秒內對「水平加速度大小」做互相關，取最大值的位移。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .core import EVENT_TYPES, GpsFix, MotionSample, TripResult, process_trip
from .params import Params

G = 9.81


@dataclass
class BoxData:
    t: np.ndarray  # 盒子時鐘 (ms)
    acc: np.ndarray  # (n, 3) m/s²，含重力
    gyro: np.ndarray | None  # (n, 3) deg/s
    unix_ms: np.ndarray | None
    gps: pd.DataFrame | None
    meta: dict


def read_box_csv(path) -> BoxData:
    meta = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.startswith("#"):
                break
            for kv in line[1:].split():
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    meta[k] = v
    df = pd.read_csv(path, comment="#")
    gyro = df[["gx", "gy", "gz"]].to_numpy(float) if {"gx", "gy", "gz"} <= set(df.columns) else None
    unix_ms = df["unix_ms"].to_numpy(float) if "unix_ms" in df.columns and df["unix_ms"].notna().any() else None
    gps = df[["t_ms", "lat", "lon", "speed"]].dropna() if {"lat", "lon"} <= set(df.columns) else None
    return BoxData(df["t_ms"].to_numpy(float), df[["ax", "ay", "az"]].to_numpy(float), gyro, unix_ms, gps, meta)


def find_tap(t: np.ndarray, acc_mag: np.ndarray, window: tuple[float, float] | None = None, threshold: float = 12.0):
    """找第一個「敲擊」：|a| 偏離 g 超過 threshold (m/s²) 的時間（ms）。找不到回傳 None。"""
    dev = np.abs(acc_mag - G)
    mask = dev > threshold
    if window is not None:
        mask &= (t >= window[0]) & (t <= window[1])
    idx = np.flatnonzero(mask)
    return float(t[idx[0]]) if idx.size else None


def _horizontal_mag(t: np.ndarray, acc: np.ndarray, fs: float = 20.0):
    """去掉重力（1 秒移動平均）後的水平加速度大小，重新取樣到等間隔。"""
    grid = np.arange(t[0], t[-1], 1000 / fs)
    a = np.column_stack([np.interp(grid, t, acc[:, k]) for k in range(3)])
    k = max(1, int(fs))
    kern = np.ones(k) / k
    g = np.column_stack([np.convolve(a[:, i], kern, mode="same") for i in range(3)])
    up = g / np.linalg.norm(g, axis=1, keepdims=True)
    lin = a - g
    horiz = lin - (np.sum(lin * up, axis=1, keepdims=True)) * up
    return grid, np.linalg.norm(horiz, axis=1)


def xcorr_offset(t_ref, x_ref, t_other, x_other, guess_ms: float, max_lag_s: float = 5.0, fs: float = 20.0) -> float:
    """細對時：回傳 offset，使得 other 的時間 + offset ≈ ref 的時間。"""
    step = 1000 / fs
    lags = np.arange(-max_lag_s * 1000, max_lag_s * 1000 + step, step)
    best, best_lag = -np.inf, 0.0
    for lag in lags:
        off = guess_ms + lag
        y = np.interp(t_ref, t_other + off, x_other, left=np.nan, right=np.nan)
        ok = ~np.isnan(y)
        if ok.sum() < fs * 10:
            continue
        a, b = x_ref[ok] - x_ref[ok].mean(), y[ok] - y[ok].mean()
        den = math.sqrt(float((a * a).sum() * (b * b).sum()))
        c = float((a * b).sum()) / den if den > 0 else -np.inf
        if c > best:
            best, best_lag = c, lag
    return guess_ms + best_lag


def align_box(phone_motion: list[MotionSample], box: BoxData, sync_tap_ms: float | None = None, max_lag_s: float = 5.0) -> dict:
    """算出 offset（ms），使得 盒子時間 + offset = 手機 epoch 時間。"""
    pt = np.array([m.t for m in phone_motion])
    pacc = np.array([[m.gx, m.gy, m.gz] for m in phone_motion])
    method = None
    guess = None
    if box.unix_ms is not None:
        guess = float(np.median(box.unix_ms - box.t))
        method = "unix_ms"
    else:
        win = (sync_tap_ms - 15000, sync_tap_ms + 15000) if sync_tap_ms else (pt[0], pt[0] + 120000)
        p_tap = find_tap(pt, np.linalg.norm(pacc, axis=1), win)
        b_tap = find_tap(box.t, np.linalg.norm(box.acc, axis=1), (box.t[0], box.t[0] + 600000))
        if p_tap is not None and b_tap is not None:
            guess = p_tap - b_tap
            method = "tap"
    if guess is None:
        # 沒有任何線索：假設兩邊同時開始
        guess = pt[0] - box.t[0]
        method = "start"
        max_lag_s = max(max_lag_s, 60)
    tg, hp = _horizontal_mag(pt, pacc)
    tb, hb = _horizontal_mag(box.t, box.acc)
    offset = xcorr_offset(tg, hp, tb, hb, guess, max_lag_s)
    return {"offset_ms": offset, "coarse_ms": guess, "method": method}


def box_to_motion(box: BoxData, offset_ms: float) -> list[MotionSample]:
    """把盒子資料換成手機的 MotionSample（沒有 OS 線性加速度），套用同一套處理。"""
    out = []
    for i in range(len(box.t)):
        g = box.gyro[i] if box.gyro is not None else (None, None, None)
        out.append(
            MotionSample(
                t=float(box.t[i] + offset_ms), ax=None, ay=None, az=None,
                gx=float(box.acc[i, 0]), gy=float(box.acc[i, 1]), gz=float(box.acc[i, 2]),
                # 盒子的陀螺儀 x/y/z 對應 W3C 的 beta/gamma/alpha
                ra=None if g[2] is None else float(g[2]), rb=None if g[0] is None else float(g[0]), rg=None if g[1] is None else float(g[1]),
            )
        )
    return out


def match_events(a: TripResult, b: TripResult, tol_ms: float = 1500) -> dict:
    """事件一致率：同類型、峰值時間相差 tol_ms 以內算同一個事件。"""
    out = {}
    for etype in EVENT_TYPES:
        ea = [e.t_peak for e in a.events if e.type == etype]
        eb = [e.t_peak for e in b.events if e.type == etype]
        used = set()
        matched = 0
        for t in ea:
            cands = [(abs(t - u), j) for j, u in enumerate(eb) if j not in used and abs(t - u) <= tol_ms]
            if cands:
                used.add(min(cands)[1])
                matched += 1
        union = len(ea) + len(eb) - matched
        out[etype] = {"phone": len(ea), "box": len(eb), "matched": matched, "agreement": matched / union if union else 1.0}
    return out


def compare_phone_box(phone: TripResult, box: TripResult, fs: float = 20.0) -> dict:
    """時間對齊後的相關係數（只用兩邊都穩定的時段）與事件一致率。"""
    t0 = max(phone.samples[0].t, box.samples[0].t)
    t1 = min(phone.samples[-1].t, box.samples[-1].t)
    if t1 <= t0:
        raise ValueError("手機與感測盒的時間沒有重疊，請確認對時")
    grid = np.arange(t0, t1, 1000 / fs)

    def series(r: TripResult, attr: str):
        t = np.array([s.t for s in r.samples])
        v = np.array([getattr(s, attr) for s in r.samples])
        st = np.array([s.stable for s in r.samples], float)
        return np.interp(grid, t, v), np.interp(grid, t, st) > 0.99

    res = {"overlap_s": (t1 - t0) / 1000}
    for attr in ("a_long", "a_lat", "jerk_mag"):
        x, sx = series(phone, attr)
        y, sy = series(box, attr)
        ok = sx & sy
        res[f"corr_{attr}"] = float(np.corrcoef(x[ok], y[ok])[0, 1]) if ok.sum() > 10 else math.nan
        res[f"rmse_{attr}"] = float(np.sqrt(np.mean((x[ok] - y[ok]) ** 2))) if ok.sum() > 10 else math.nan
    res["both_stable_ratio"] = float(np.mean(series(phone, "a_long")[1] & series(box, "a_long")[1]))
    res["events"] = match_events(phone, box)
    return res


def process_box(box: BoxData, offset_ms: float, phone_gps: list[GpsFix], p: Params) -> TripResult:
    """盒子固定在車上：沒有 deviceorientation，前進方向用手機的 GPS 校準。"""
    gps = phone_gps
    if box.gps is not None and len(box.gps):
        gps = [GpsFix(t=float(r.t_ms + offset_ms), lat=float(r.lat), lon=float(r.lon), speed=float(r.speed), heading=None, accuracy=10.0) for r in box.gps.itertuples()]
    return process_trip(box_to_motion(box, offset_ms), [], gps, p)
