"""多趟統計：每趟摘要表、事件表、依路線／時段／座位／放置方式的事件率與分布。

對外公開的統計以「路線 × 時段」為單位，且樣本不足 MIN_TRIPS_PUBLIC 趟的組合標記為不公開
（隱私原則：樣本不足 10 趟的時段不公開）。
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd

from .core import EVENT_LABELS, EVENT_TYPES, TripResult
from .io import Trip

MIN_TRIPS_PUBLIC = 10
TPE = timezone(timedelta(hours=8))
WEEKDAYS = "一二三四五六日"


def _time_cols(ms: float) -> dict:
    d = datetime.fromtimestamp(ms / 1000, TPE)
    q = d.replace(minute=d.minute // 15 * 15, second=0, microsecond=0)
    return {
        "date": d.date().isoformat(),
        "hour": d.hour,
        "weekday": f"週{WEEKDAYS[d.weekday()]}",
        "time_bucket": q.strftime("%H:%M"),
        "peak_hour": d.weekday() < 5 and (7 <= d.hour < 9 or 17 <= d.hour < 19),
    }


def trips_table(items: list[tuple[Trip, TripResult]]) -> pd.DataFrame:
    rows = []
    for trip, r in items:
        s = r.summary
        stable_j = [x.jerk_mag for x in r.samples if x.stable]
        trip_meta = trip.meta.get("trip", {})
        rows.append({
            "trip": trip.name,
            "route": trip.route,
            "plate": trip_meta.get("plate", ""),
            "placement": trip.placement,
            "seat_row": trip.seat_row,
            "seat_side": trip_meta.get("seatSide", ""),
            "posture": trip_meta.get("posture", ""),
            "test_mode": bool(trip_meta.get("testMode", False)),
            "device": (trip.meta.get("device") or {}).get("platform", ""),
            **_time_cols(trip.start_ms),
            "duration_min": s["durationSec"] / 60,
            "distance_km": s["distanceKm"],
            "sample_rate_hz": s["sampleRateHz"],
            "stable_ratio": s["stableRatio"],
            **{f"n_{t}": s["counts"][t] for t in EVENT_TYPES},
            "events_per_km": s["eventsPerKm"],
            "smooth_score": s["smoothScore"],
            "max_accel": s["peaks"]["maxAccel"],
            "max_brake": s["peaks"]["maxBrake"],
            "max_lat": s["peaks"]["maxLat"],
            "max_jerk": s["peaks"]["maxJerk"],
            "jerk_p95": float(np.percentile(stable_j, 95)) if stable_j else np.nan,
            "exceedance_ratio": s["exceedanceRatio"],
            "orient_sources": ",".join(sorted({seg.source for seg in r.segments})),
        })
    return pd.DataFrame(rows)


def events_table(items: list[tuple[Trip, TripResult]]) -> pd.DataFrame:
    rows = []
    for trip, r in items:
        for e in r.events:
            rows.append({
                "trip": trip.name,
                "route": trip.route,
                "placement": trip.placement,
                "seat_row": trip.seat_row,
                "type": e.type,
                "label": EVENT_LABELS[e.type],
                "t_peak_ms": e.t_peak,
                **_time_cols(e.t_peak),
                "duration_s": (e.t_end - e.t_start) / 1000,
                "peak_value": e.peak_value,
                "peak_jerk": e.peak_jerk,
                "lat": e.lat,
                "lon": e.lon,
                "speed_kmh": None if e.speed is None else e.speed * 3.6,
                "orient_source": e.orient_source,
            })
    return pd.DataFrame(rows)


def rates_by(trips: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """依 keys 分組：趟數、總里程、各類事件每公里次數。publishable 標記是否達到公開門檻。"""
    if trips.empty:
        return pd.DataFrame()
    agg = {"trip": "count", "distance_km": "sum", "duration_min": "sum", "smooth_score": "mean", "stable_ratio": "mean"}
    agg.update({f"n_{t}": "sum" for t in EVENT_TYPES})
    g = trips.groupby(keys, dropna=False).agg(agg).rename(columns={"trip": "n_trips"}).reset_index()
    km = g["distance_km"].where(g["distance_km"] > 0)
    for t in EVENT_TYPES:
        g[f"{t}_per_km"] = g[f"n_{t}"] / km
    g["publishable"] = g["n_trips"] >= MIN_TRIPS_PUBLIC
    return g


def distribution(items: list[tuple[Trip, TripResult]], by: str = "placement") -> pd.DataFrame:
    """穩定區段的 |a_long|、|a_lat|、加加速度分布百分位，依 by（例如放置方式、座位）分組。"""
    rows = []
    groups: dict[str, dict[str, list]] = {}
    for trip, r in items:
        key = getattr(trip, by, None) if by != "route" else trip.route
        d = groups.setdefault(key or "未填", {"a_long": [], "a_lat": [], "jerk_mag": []})
        for s in r.samples:
            if s.stable:
                d["a_long"].append(abs(s.a_long))
                d["a_lat"].append(abs(s.a_lat))
                d["jerk_mag"].append(s.jerk_mag)
    for key, d in groups.items():
        for metric, xs in d.items():
            if not xs:
                continue
            a = np.asarray(xs)
            rows.append({by: key, "metric": metric, "n": a.size, **{f"p{q}": float(np.percentile(a, q)) for q in (50, 90, 95, 99)}, "max": float(a.max())})
    return pd.DataFrame(rows)


def manual_marker_agreement(trip: Trip, r: TripResult, tol_ms: float = 3000) -> dict:
    """乘客按「剛剛急煞了」的人工標記 vs 自動偵測的急煞（對照 Ma 2018 的作法）。"""
    marks = [m["t"] for m in trip.meta.get("markers", []) if m.get("kind") == "manual_brake"]
    brakes = [e.t_peak for e in r.events if e.type == "hard_brake"]
    # 人工標記通常晚於事件（反應時間），只往前找
    hit = sum(any(0 <= m - b <= tol_ms for b in brakes) for m in marks)
    return {"manual": len(marks), "auto": len(brakes), "manual_matched": hit}
