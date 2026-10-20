"""感測盒對時與比較：用手機合成資料假造一個時鐘不同、取樣率不同的盒子。"""

from pathlib import Path

import numpy as np

from sunsunbus import load_params, process_trip
from sunsunbus.hardware import BoxData, align_box, compare_phone_box, process_box
from sunsunbus.io import load_trip

FIXTURES = Path(__file__).parent / "fixtures"
TRUE_OFFSET = 1_760_000_000_000 - 123_456.0  # 盒子時間 + offset = 手機時間


def _box_from_phone(trip, tap_at_s: float = 3.0, every: int = 1):
    t = np.array([m.t for m in trip.motion])
    acc = np.array([[m.gx, m.gy, m.gz] for m in trip.motion])
    tap = np.abs(t - (t[0] + tap_at_s * 1000)) < 25
    acc_phone = acc.copy()
    acc_phone[tap, 2] += 25  # 手機與盒子一起敲擊
    for m, a in zip(trip.motion, acc_phone):
        m.gx, m.gy, m.gz = a
    box_acc = acc_phone[::every] + np.random.default_rng(0).normal(0, 0.03, acc_phone[::every].shape)
    return BoxData(t=t[::every] - TRUE_OFFSET, acc=box_acc, gyro=None, unix_ms=None, gps=None, meta={})


def test_tap_alignment_recovers_offset():
    trip = load_trip(FIXTURES / "brake_upright")
    box = _box_from_phone(trip)
    al = align_box(trip.motion, box)
    assert al["method"] == "tap"
    assert abs(al["offset_ms"] - TRUE_OFFSET) < 60


def test_phone_and_box_agree():
    p = load_params()
    trip = load_trip(FIXTURES / "brake_upright")
    box = _box_from_phone(trip)
    al = align_box(trip.motion, box)
    phone_r = process_trip(trip.motion, trip.orientation, trip.gps, p)
    box_r = process_box(box, al["offset_ms"], trip.gps, p)
    res = compare_phone_box(phone_r, box_r)
    assert res["corr_a_long"] > 0.95
    assert res["events"]["hard_brake"]["matched"] == 1
