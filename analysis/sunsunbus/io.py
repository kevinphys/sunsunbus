"""讀取手機 App 匯出的檔案。

一趟記錄匯出成同一個前綴的四個檔案（格式見 docs/data-format.md）：
    sunsunbus_20261020-1803_中山幹線_motion.csv   每筆感測取樣＋處理後數值
    sunsunbus_20261020-1803_中山幹線_gps.csv      GPS 定位
    sunsunbus_20261020-1803_中山幹線_events.csv   事件（手機上算的）
    sunsunbus_20261020-1803_中山幹線_summary.json 路線、座位、裝置、參數、摘要
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from .core import GpsFix, MotionSample, OrientationSample

SUFFIXES = ("_motion.csv", "_gps.csv", "_events.csv", "_summary.json")


def _opt(x) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


@dataclass
class Trip:
    name: str
    motion: list[MotionSample]
    orientation: list[OrientationSample]
    gps: list[GpsFix]
    meta: dict = field(default_factory=dict)
    motion_df: pd.DataFrame | None = None
    gps_df: pd.DataFrame | None = None

    @property
    def route(self) -> str:
        return self.meta.get("trip", {}).get("route", "") or "未填路線"

    @property
    def placement(self) -> str:
        return self.meta.get("trip", {}).get("placement", "") or ""

    @property
    def seat_row(self) -> str:
        return self.meta.get("trip", {}).get("seatRow", "") or ""

    @property
    def start_ms(self) -> float:
        return self.motion[0].t if self.motion else math.nan


def read_motion_csv(path: Path | str):
    df = pd.read_csv(path, comment="#")
    motion = [
        MotionSample(
            t=float(r.t_ms), ax=_opt(r.ax), ay=_opt(r.ay), az=_opt(r.az), gx=float(r.gx), gy=float(r.gy), gz=float(r.gz),
            ra=_opt(r.rot_alpha), rb=_opt(r.rot_beta), rg=_opt(r.rot_gamma), interval=_opt(r.interval),
        )
        for r in df.itertuples(index=False)
    ]
    # deviceorientation 在匯出時已對齊到每一筆 motion（取之前最近的一筆）
    orientation = [
        OrientationSample(t=float(r.t_ms), alpha=_opt(r.ori_alpha), beta=_opt(r.ori_beta), gamma=_opt(r.ori_gamma))
        for r in df.itertuples(index=False)
        if not (isinstance(r.ori_beta, float) and math.isnan(r.ori_beta))
    ]
    return motion, orientation, df


def read_gps_csv(path: Path | str):
    df = pd.read_csv(path, comment="#")
    gps = [
        GpsFix(t=float(r.t_ms), lat=float(r.lat), lon=float(r.lon), speed=_opt(r.speed), heading=_opt(r.heading), accuracy=float(r.accuracy))
        for r in df.itertuples(index=False)
    ]
    return gps, df


def trip_base(path: Path | str) -> Path:
    """由任一個匯出檔的路徑取得共同前綴。"""
    p = Path(path)
    for suf in SUFFIXES:
        if p.name.endswith(suf):
            return p.with_name(p.name[: -len(suf)])
    return p


def load_trip(path: Path | str) -> Trip:
    base = trip_base(path)
    motion, orientation, mdf = read_motion_csv(f"{base}_motion.csv")
    gps_path = Path(f"{base}_gps.csv")
    gps, gdf = read_gps_csv(gps_path) if gps_path.exists() else ([], None)
    meta_path = Path(f"{base}_summary.json")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    return Trip(name=base.name, motion=motion, orientation=orientation, gps=gps, meta=meta, motion_df=mdf, gps_df=gdf)


def find_trips(folder: Path | str) -> list[Path]:
    """資料夾內（含子資料夾）所有趟次的前綴。"""
    return sorted({trip_base(p) for p in Path(folder).rglob("*_motion.csv")})
