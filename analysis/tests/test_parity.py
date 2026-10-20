"""Python 版演算法與前端 TypeScript 版的一致性測試。

fixtures/ 由 web/ 的 `npm run fixtures` 產生：同一份 CSV 輸入，TS 的處理結果存成 *_expected.json。
"""

import json
from pathlib import Path

import pytest

from sunsunbus import load_params, process_trip
from sunsunbus.io import load_trip

FIXTURES = Path(__file__).parent / "fixtures"
NAMES = sorted(p.name[: -len("_expected.json")] for p in FIXTURES.glob("*_expected.json"))


@pytest.fixture(scope="module")
def params():
    return load_params()


@pytest.mark.parametrize("name", NAMES)
def test_matches_typescript(name, params):
    exp = json.loads((FIXTURES / f"{name}_expected.json").read_text())
    trip = load_trip(FIXTURES / name)
    r = process_trip(trip.motion, trip.orientation, trip.gps, params)

    assert r.accel_sign == exp["accelSign"]
    assert r.sample_rate_hz == pytest.approx(exp["sampleRateHz"], rel=1e-9)
    assert r.jerk_threshold == pytest.approx(exp["jerkThreshold"], rel=1e-6)

    assert [(s.id, s.source) for s in r.segments] == [(s["id"], s["source"]) for s in exp["segments"]]
    for got, want in zip(r.segments, exp["segments"]):
        assert got.theta == pytest.approx(want["theta"], abs=1e-6)

    assert [e.type for e in r.events] == [e["type"] for e in exp["events"]]
    for got, want in zip(r.events, exp["events"]):
        assert got.t_start == pytest.approx(want["tStart"], abs=1e-3)
        assert got.t_end == pytest.approx(want["tEnd"], abs=1e-3)
        assert got.peak_value == pytest.approx(want["peakValue"], abs=1e-6)

    every = exp["sampleEvery"]
    for got, want in zip(r.samples[::every], exp["samples"]):
        assert got.stable == want["stable"]
        assert got.segment == want["segment"]
        assert got.a_long == pytest.approx(want["aLong"], abs=1e-6)
        assert got.a_lat == pytest.approx(want["aLat"], abs=1e-6)
        assert got.jerk_mag == pytest.approx(want["jerkMag"], abs=1e-5)

    s, es = r.summary, exp["summary"]
    assert s["counts"] == es["counts"]
    assert s["smoothScore"] == pytest.approx(es["smoothScore"])
    assert s["distanceKm"] == pytest.approx(es["distanceKm"], rel=1e-9)
    assert s["stableRatio"] == pytest.approx(es["stableRatio"])


def test_threshold_override_changes_events(params):
    trip = load_trip(FIXTURES / "brake_upright")
    strict = load_params({"events": {"brakeThreshold": 3.0}})
    base = process_trip(trip.motion, trip.orientation, trip.gps, params)
    r = process_trip(trip.motion, trip.orientation, trip.gps, strict)
    assert sum(e.type == "hard_brake" for e in base.events) == 1
    assert sum(e.type == "hard_brake" for e in r.events) == 0
