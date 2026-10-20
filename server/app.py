"""順順行 sunsunbus 極簡後端（選用）。

只收手機端已經匿名化的「本趟摘要 + 事件」，不收原始感測資料、不收裝置資訊。
對外統計只以「路線 × 時段」為單位，且少於 MIN_TRIPS 趟的組合不公開。

    uv run uvicorn app:app --reload --port 8787
    SUNSUNBUS_DB=/path/to.db SUNSUNBUS_CORS=https://<帳號>.github.io uv run uvicorn app:app --host 0.0.0.0
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

DB_PATH = os.environ.get("SUNSUNBUS_DB", os.path.join(os.path.dirname(__file__), "sunsunbus.db"))
CORS = [o for o in os.environ.get("SUNSUNBUS_CORS", "*").split(",") if o]
MIN_TRIPS = int(os.environ.get("SUNSUNBUS_MIN_TRIPS", "10"))
TPE = timezone(timedelta(hours=8))

EventType = Literal["hard_brake", "hard_accel", "sharp_turn", "high_jerk"]


def _check_bucket(v: str) -> str:
    """時間必須已取整到 15 分鐘（手機端負責取整，後端再檢查一次）。"""
    d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    if d.minute % 15 or d.second or d.microsecond:
        raise ValueError("時間必須取整到 15 分鐘")
    return d.astimezone(timezone.utc).isoformat()


class EventIn(BaseModel):
    type: EventType
    timeBucket: str
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    peakValue: float

    @field_validator("timeBucket")
    @classmethod
    def bucket(cls, v):
        return _check_bucket(v)

    @field_validator("lat", "lon")
    @classmethod
    def coarse(cls, v):
        # 位置最多保留到小數 3 位（約 100 m），避免精確軌跡
        return None if v is None else round(v, 3)


class TripIn(BaseModel):
    schemaVersion: Literal[1]
    route: str = Field(max_length=40)
    plate: str = Field("", max_length=16)
    timeBucket: str
    durationMin: int = Field(ge=0, le=600)
    distanceKm: float = Field(ge=0, le=500)
    placement: Literal["mount", "seat", "hand", ""] = ""
    seatRow: Literal["front", "middle", "rear", ""] = ""
    stableRatio: float = Field(ge=0, le=1)
    smoothScore: float = Field(ge=0, le=100)
    counts: dict[EventType, int]
    events: list[EventIn] = Field(max_length=2000)

    @field_validator("timeBucket")
    @classmethod
    def bucket(cls, v):
        return _check_bucket(v)

    @field_validator("plate")
    @classmethod
    def plate_format(cls, v):
        v = v.strip().upper()
        if v and not re.fullmatch(r"[A-Z0-9-]{2,12}", v):
            raise ValueError("車牌格式不正確")
        return v


SCHEMA = """
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY,
  route TEXT NOT NULL, plate TEXT, time_bucket TEXT NOT NULL,
  duration_min INTEGER, distance_km REAL, placement TEXT, seat_row TEXT,
  stable_ratio REAL, smooth_score REAL,
  n_hard_brake INTEGER, n_hard_accel INTEGER, n_sharp_turn INTEGER, n_high_jerk INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, trip_id INTEGER REFERENCES trips(id),
  type TEXT NOT NULL, time_bucket TEXT NOT NULL, lat REAL, lon REAL, peak_value REAL
);
CREATE INDEX IF NOT EXISTS trips_route ON trips(route);
"""


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


app = FastAPI(title="順順行 sunsunbus API")
app.add_middleware(CORSMiddleware, allow_origins=CORS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/trips", status_code=201)
def create_trip(t: TripIn):
    with db() as con:
        cur = con.execute(
            "INSERT INTO trips (route, plate, time_bucket, duration_min, distance_km, placement, seat_row, stable_ratio, smooth_score,"
            " n_hard_brake, n_hard_accel, n_sharp_turn, n_high_jerk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (t.route, t.plate, t.timeBucket, t.durationMin, t.distanceKm, t.placement, t.seatRow, t.stableRatio, t.smoothScore,
             t.counts.get("hard_brake", 0), t.counts.get("hard_accel", 0), t.counts.get("sharp_turn", 0), t.counts.get("high_jerk", 0)),
        )
        con.executemany(
            "INSERT INTO events (trip_id, type, time_bucket, lat, lon, peak_value) VALUES (?,?,?,?,?,?)",
            [(cur.lastrowid, e.type, e.timeBucket, e.lat, e.lon, e.peakValue) for e in t.events],
        )
    # 不回傳 id，避免乘客端保有可追溯的識別碼
    return {"ok": True}


@app.get("/api/stats")
def stats(route: Optional[str] = None):
    """路線 × 時段（台北時間的小時）事件率。趟數不足 MIN_TRIPS 的組合只回傳「樣本不足」。"""
    with db() as con:
        rows = con.execute(
            "SELECT route, time_bucket, distance_km, smooth_score, n_hard_brake, n_hard_accel, n_sharp_turn, n_high_jerk FROM trips"
            + (" WHERE route = ?" if route else ""),
            (route,) if route else (),
        ).fetchall()
    groups: dict[tuple[str, int], dict] = {}
    for r in rows:
        hour = datetime.fromisoformat(r["time_bucket"]).astimezone(TPE).hour
        g = groups.setdefault((r["route"], hour), {"n": 0, "km": 0.0, "score": 0.0, "brake": 0, "accel": 0, "turn": 0, "jerk": 0})
        g["n"] += 1
        g["km"] += r["distance_km"]
        g["score"] += r["smooth_score"]
        g["brake"] += r["n_hard_brake"]
        g["accel"] += r["n_hard_accel"]
        g["turn"] += r["n_sharp_turn"]
        g["jerk"] += r["n_high_jerk"]
    out = []
    for (rt, hour), g in sorted(groups.items()):
        item = {"route": rt, "hour": hour, "trips": g["n"] if g["n"] >= MIN_TRIPS else None}
        if g["n"] >= MIN_TRIPS and g["km"] > 0:
            item.update({
                "smoothScore": round(g["score"] / g["n"], 1),
                "perKm": {k: round(g[v] / g["km"], 2) for k, v in (("hard_brake", "brake"), ("hard_accel", "accel"), ("sharp_turn", "turn"), ("high_jerk", "jerk"))},
            })
        else:
            item["note"] = f"樣本不足 {MIN_TRIPS} 趟，不公開"
        out.append(item)
    return {"minTrips": MIN_TRIPS, "groups": out}
