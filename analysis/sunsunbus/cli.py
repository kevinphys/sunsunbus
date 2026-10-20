"""命令列工具。

    uv run sunsunbus report data/ --out output/
    uv run sunsunbus report data/ --params my-params.json --route-shape 中山幹線_Shape.json --stops 中山幹線_StopOfRoute.json
    uv run sunsunbus compare-box data/sunsunbus_20261020-1803_中山幹線 data/box_0001.csv
    TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... uv run sunsunbus fetch-tdx 中山幹線 --out data/routes
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .core import EVENT_LABELS, EVENT_TYPES, process_trip
from .io import find_trips, load_trip
from .params import load_params


def _params(path: str | None):
    return load_params(json.loads(Path(path).read_text(encoding="utf-8")) if path else None)


def cmd_report(a) -> int:
    from . import plots, stats

    p = _params(a.params)
    out = Path(a.out)
    (out / "plots").mkdir(parents=True, exist_ok=True)
    bases = find_trips(a.folder)
    if not bases:
        print(f"在 {a.folder} 找不到 *_motion.csv", file=sys.stderr)
        return 1
    items = []
    for b in bases:
        trip = load_trip(b)
        if trip.meta.get("trip", {}).get("testMode") and not a.include_test:
            print(f"略過搖手機測試：{trip.name}")
            continue
        print(f"處理 {trip.name}（{len(trip.motion)} 筆）…", flush=True)
        r = process_trip(trip.motion, trip.orientation, trip.gps, p)
        items.append((trip, r))
        marks = [m["t"] for m in trip.meta.get("markers", []) if m.get("kind") == "manual_brake"]
        plots.plot_trip(r, f"{trip.route}｜{trip.name}", out / "plots" / f"{trip.name}.png", p, marks)
    if not items:
        print("沒有可分析的趟次", file=sys.stderr)
        return 1

    trips = stats.trips_table(items)
    events = stats.events_table(items)
    if a.route_shape and not events.empty:
        from . import routes

        shapes = routes.load_route_shapes(a.route_shape)
        track = [(g.lat, g.lon) for trip, _ in items for g in trip.gps]
        shape = routes.pick_shape(shapes, track)
        stops = routes.load_stops(a.stops, shape.direction) if a.stops else None
        events = routes.assign_events(events, shape, stops)
        if "between_stops" in events:
            seg = events.groupby(["between_stops", "label"]).size().unstack(fill_value=0)
            seg.to_csv(out / "events_by_stop_segment.csv", encoding="utf-8-sig")

    trips.to_csv(out / "trips.csv", index=False, encoding="utf-8-sig")
    events.to_csv(out / "events.csv", index=False, encoding="utf-8-sig")
    tables = {
        "rates_by_route_hour": ["route", "hour"],
        "rates_by_route_peak": ["route", "peak_hour"],
        "rates_by_placement": ["placement"],
        "rates_by_seat": ["seat_row", "posture"],
    }
    for name, keys in tables.items():
        stats.rates_by(trips, keys).to_csv(out / f"{name}.csv", index=False, encoding="utf-8-sig")
    dist = stats.distribution(items, "placement")
    dist.to_csv(out / "distribution_by_placement.csv", index=False, encoding="utf-8-sig")
    plots.plot_distributions(items, out / "distribution_by_placement.png", "placement")
    plots.plot_distributions(items, out / "distribution_by_seat.png", "seat_row")
    plots.events_map(items, out / "events_map.html")

    # 文字摘要
    lines = [f"# 順順行 分析報告\n", f"共 {len(items)} 趟，{trips['distance_km'].sum():.1f} km，{trips['duration_min'].sum():.0f} 分鐘。\n"]
    lines.append("| 事件 | 次數 | 每公里 |\n|---|---|---|")
    km = trips["distance_km"].sum()
    for t in EVENT_TYPES:
        n = int(trips[f"n_{t}"].sum())
        lines.append(f"| {EVENT_LABELS[t]} | {n} | {n / km:.2f} |" if km > 0 else f"| {EVENT_LABELS[t]} | {n} | – |")
    if not dist.empty:
        lines.append("\n## 穩定區段的分布（第 95 百分位）\n")
        lines.append("| 放置方式 | 指標 | P95 | P99 | 最大 |\n|---|---|---|---|---|")
        for r in dist.itertuples():
            lines.append(f"| {r.placement} | {r.metric} | {r.p95:.2f} | {r.p99:.2f} | {r.max:.2f} |")
    lines.append("\n## 人工標記 vs 自動偵測（急煞）\n")
    for trip, r in items:
        m = stats.manual_marker_agreement(trip, r)
        if m["manual"]:
            lines.append(f"- {trip.name}：人工 {m['manual']} 次，自動 {m['auto']} 次，人工標記有對應到自動偵測 {m['manual_matched']} 次")
    lines.append(f"\n樣本不足 {stats.MIN_TRIPS_PUBLIC} 趟的「路線 × 時段」在 rates_by_*.csv 標記 publishable = False，對外發表時不要公開。")
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"完成，輸出在 {out}/")
    return 0


def cmd_compare_box(a) -> int:
    from . import hardware, plots

    p = _params(a.params)
    trip = load_trip(a.phone)
    box = hardware.read_box_csv(a.box)
    taps = [m["t"] for m in trip.meta.get("markers", []) if m.get("kind") == "sync_tap"]
    al = hardware.align_box(trip.motion, box, taps[0] if taps else None, a.max_lag)
    print(f"對時：{al['method']}，offset = {al['offset_ms']:.0f} ms（粗對時 {al['coarse_ms']:.0f} ms）")
    phone_r = process_trip(trip.motion, trip.orientation, trip.gps, p)
    box_r = hardware.process_box(box, al["offset_ms"], trip.gps, p)
    res = hardware.compare_phone_box(phone_r, box_r)
    res["alignment"] = al
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{trip.name}_vs_box.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    plots.plot_phone_vs_box(phone_r, box_r, out / f"{trip.name}_vs_box.png", f"手機（{trip.placement or '?'}）vs 感測盒")
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_fetch_tdx(a) -> int:
    from . import routes

    cid, secret = os.environ.get("TDX_CLIENT_ID"), os.environ.get("TDX_CLIENT_SECRET")
    if not cid or not secret:
        print("請先設定環境變數 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET（在 TDX 會員中心申請）", file=sys.stderr)
        return 1
    paths = routes.fetch_tdx(a.route, a.out, cid, secret, a.city)
    for k, v in paths.items():
        print(f"{k}: {v}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="sunsunbus", description="順順行 公車加速度資料分析")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("report", help="分析資料夾內所有趟次，輸出圖表與統計")
    r.add_argument("folder")
    r.add_argument("--out", default="output")
    r.add_argument("--params", help="參數覆寫 JSON（只需寫要改的欄位）")
    r.add_argument("--route-shape", help="路線線型（TDX Shape JSON 或 GeoJSON）")
    r.add_argument("--stops", help="站序（TDX StopOfRoute JSON）")
    r.add_argument("--include-test", action="store_true", help="也分析搖手機測試的紀錄")
    r.set_defaults(func=cmd_report)

    c = sub.add_parser("compare-box", help="手機與硬體感測盒對時、比較")
    c.add_argument("phone", help="手機趟次（任一個匯出檔或共同前綴）")
    c.add_argument("box", help="感測盒 CSV")
    c.add_argument("--out", default="output")
    c.add_argument("--params")
    c.add_argument("--max-lag", type=float, default=5.0, help="細對時搜尋範圍（秒）")
    c.set_defaults(func=cmd_compare_box)

    f = sub.add_parser("fetch-tdx", help="從 TDX 下載路線線型與站序")
    f.add_argument("route")
    f.add_argument("--out", default="data/routes")
    f.add_argument("--city", default="Taipei")
    f.set_defaults(func=cmd_fetch_tdx)

    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
