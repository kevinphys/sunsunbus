import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SUNSUNBUS_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("SUNSUNBUS_MIN_TRIPS", "3")
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def trip(**over):
    t = {
        "schemaVersion": 1, "route": "中山幹線", "plate": "kka-1234", "timeBucket": "2026-10-20T00:15:00.000Z",
        "durationMin": 30, "distanceKm": 8.0, "placement": "mount", "seatRow": "middle", "stableRatio": 0.95,
        "smoothScore": 80, "counts": {"hard_brake": 2, "hard_accel": 1, "sharp_turn": 0, "high_jerk": 4},
        "events": [{"type": "hard_brake", "timeBucket": "2026-10-20T00:15:00Z", "lat": 25.04812345, "lon": 121.5171234, "peakValue": -1.8}],
    }
    t.update(over)
    return t


def test_accepts_trip(client):
    assert client.post("/api/trips", json=trip()).status_code == 201


def test_rejects_unrounded_time(client):
    r = client.post("/api/trips", json=trip(timeBucket="2026-10-20T00:17:00Z"))
    assert r.status_code == 422


def test_rejects_unknown_fields_values(client):
    assert client.post("/api/trips", json=trip(placement="pocket")).status_code == 422
    assert client.post("/api/trips", json=trip(plate="<script>")).status_code == 422


def test_stats_hidden_until_min_trips(client):
    for _ in range(2):
        client.post("/api/trips", json=trip())
    g = client.get("/api/stats").json()["groups"][0]
    assert g["trips"] is None and "樣本不足" in g["note"]
    client.post("/api/trips", json=trip())
    g = client.get("/api/stats", params={"route": "中山幹線"}).json()["groups"][0]
    assert g["trips"] == 3
    assert g["hour"] == 8  # 00:15Z = 台北 08:15
    assert g["perKm"]["hard_brake"] == pytest.approx(6 / 24, abs=0.01)
