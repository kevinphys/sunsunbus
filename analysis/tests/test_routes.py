import json

import pandas as pd

from sunsunbus.routes import RouteProjector, RouteShape, Stop, assign_events, load_route_shapes


def _shape():
    # 往東約 1 km 的直線路線
    import numpy as np

    return RouteShape("測試線", 0, np.array([[121.50, 25.05], [121.51, 25.05]]))


def test_projection_chainage():
    proj = RouteProjector(_shape())
    assert 990 < proj.length_m < 1020
    ch, off = proj.project(25.0501, 121.505)
    assert abs(ch - proj.length_m / 2) < 5
    assert 8 < off < 14


def test_assign_events_between_stops():
    stops = [Stop("A站", 1, 25.05, 121.50), Stop("B站", 2, 25.05, 121.505), Stop("C站", 3, 25.05, 121.51)]
    ev = pd.DataFrame({"lat": [25.05, 25.05, 25.06], "lon": [121.502, 121.508, 121.505]})
    out = assign_events(ev, _shape(), stops)
    assert out["between_stops"].tolist() == ["A站 → B站", "B站 → C站", "（不在路線上）"]
    assert out["segment_bin"][0] == "200–400 m"


def test_load_tdx_and_geojson(tmp_path):
    tdx = [{"RouteName": {"Zh_tw": "測試線"}, "Direction": 0, "Geometry": "LINESTRING(121.5 25.05,121.51 25.05)"}]
    (tmp_path / "s.json").write_text(json.dumps(tdx))
    gj = {"type": "Feature", "properties": {"name": "測試線"}, "geometry": {"type": "LineString", "coordinates": [[121.5, 25.05], [121.51, 25.05]]}}
    (tmp_path / "g.json").write_text(json.dumps(gj))
    for f in ("s.json", "g.json"):
        shapes = load_route_shapes(tmp_path / f)
        assert len(shapes) == 1 and shapes[0].lonlat.shape == (2, 2)
