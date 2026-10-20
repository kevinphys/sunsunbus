"""圖表：單趟時間序列、分布、事件地圖、手機與感測盒比較。"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .core import EVENT_LABELS, EVENT_TYPES, TripResult  # noqa: E402

EVENT_COLORS = {"hard_brake": "#dc2626", "hard_accel": "#d97706", "sharp_turn": "#7c3aed", "high_jerk": "#475569"}

# 中文字型：依序嘗試各平台常見字型
plt.rcParams["font.sans-serif"] = ["PingFang TC", "Heiti TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Arial Unicode MS", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def _shade_unstable(ax, t, stable):
    start = None
    for ti, s in zip(t, stable):
        if not s and start is None:
            start = ti
        if s and start is not None:
            ax.axvspan(start, ti, color="#94a3b8", alpha=0.2, lw=0)
            start = None
    if start is not None:
        ax.axvspan(start, t[-1], color="#94a3b8", alpha=0.2, lw=0)


def plot_trip(r: TripResult, title: str, path: Path | str, params: dict, manual_marks: list[float] | None = None):
    t0 = r.samples[0].t
    t = np.array([(s.t - t0) / 1000 for s in r.samples])
    stable = np.array([s.stable for s in r.samples])
    a_long = np.array([s.a_long for s in r.samples])
    a_lat = np.array([s.a_lat for s in r.samples])
    jerk = np.array([s.jerk_long for s in r.samples])
    e = params["events"]

    fig, axes = plt.subplots(3, 1, figsize=(14, 8), sharex=True, constrained_layout=True)
    for ax, y, label, color, lines in (
        (axes[0], a_long, "縱向 a (m/s²)", "#0f766e", [e["accelThreshold"], -e["brakeThreshold"]]),
        (axes[1], a_lat, "橫向 a (m/s²)", "#d97706", [e["turnThreshold"], -e["turnThreshold"]]),
        (axes[2], jerk, "縱向 jerk (m/s³)", "#6366f1", [r.jerk_threshold, -r.jerk_threshold]),
    ):
        _shade_unstable(ax, t, stable)
        ax.plot(t, y, color=color, lw=0.8)
        for v in lines:
            ax.axhline(v, color="#64748b", ls="--", lw=0.8)
        ax.axhline(0, color="#cbd5e1", lw=0.6)
        ax.set_ylabel(label)
        ax.grid(alpha=0.2)
    for ev in r.events:
        ax = axes[0] if ev.type in ("hard_brake", "hard_accel") else axes[1] if ev.type == "sharp_turn" else axes[2]
        ax.axvspan((ev.t_start - t0) / 1000, (ev.t_end - t0) / 1000, color=EVENT_COLORS[ev.type], alpha=0.25, lw=0)
    for m in manual_marks or []:
        for ax in axes:
            ax.axvline((m - t0) / 1000, color="#dc2626", ls=":", lw=1)
    counts = "  ".join(f"{EVENT_LABELS[k]} {r.summary['counts'][k]}" for k in EVENT_TYPES)
    axes[0].set_title(f"{title}\n平穩分數 {r.summary['smoothScore']:.0f}・{counts}・穩定 {r.summary['stableRatio']:.0%}（灰底為不穩定）", loc="left")
    axes[2].set_xlabel("時間 (s)")
    fig.savefig(path, dpi=110)
    plt.close(fig)


def plot_distributions(items, path: Path | str, by: str = "placement"):
    """|a_long|、|a_lat|、jerk 的分布（log 縱軸），依放置方式或座位分組比較。"""
    groups: dict[str, dict[str, list]] = {}
    for trip, r in items:
        key = (getattr(trip, by, "") if by != "route" else trip.route) or "未填"
        d = groups.setdefault(key, {"a_long": [], "a_lat": [], "jerk_mag": []})
        for s in r.samples:
            if s.stable:
                d["a_long"].append(s.a_long)
                d["a_lat"].append(s.a_lat)
                d["jerk_mag"].append(s.jerk_mag)
    fig, axes = plt.subplots(1, 3, figsize=(15, 4), constrained_layout=True)
    for ax, (metric, label, rng) in zip(axes, (("a_long", "縱向 a (m/s²)", (-4, 4)), ("a_lat", "橫向 a (m/s²)", (-4, 4)), ("jerk_mag", "jerk (m/s³)", (0, 20)))):
        for key, d in groups.items():
            if d[metric]:
                ax.hist(d[metric], bins=120, range=rng, histtype="step", density=True, label=f"{key}（n={len(d[metric])}）")
        ax.set_yscale("log")
        ax.set_xlabel(label)
        ax.grid(alpha=0.2)
    axes[0].legend(fontsize=8)
    fig.savefig(path, dpi=110)
    plt.close(fig)


def plot_phone_vs_box(phone: TripResult, box: TripResult, path: Path | str, title: str = "手機 vs 感測盒"):
    t0 = max(phone.samples[0].t, box.samples[0].t)
    fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True, constrained_layout=True)
    for r, name, color in ((phone, "手機", "#0f766e"), (box, "感測盒", "#dc2626")):
        t = np.array([(s.t - t0) / 1000 for s in r.samples])
        axes[0].plot(t, [s.a_long for s in r.samples], color=color, lw=0.8, label=name)
        axes[1].plot(t, [s.jerk_mag for s in r.samples], color=color, lw=0.8, label=name)
    axes[0].set_ylabel("縱向 a (m/s²)")
    axes[1].set_ylabel("jerk (m/s³)")
    axes[1].set_xlabel("時間 (s)")
    axes[0].legend()
    axes[0].set_title(title, loc="left")
    for ax in axes:
        ax.grid(alpha=0.2)
    fig.savefig(path, dpi=110)
    plt.close(fig)


def events_map(items, path: Path | str):
    """所有趟次的軌跡與事件位置（folium，輸出 HTML）。"""
    import folium

    pts = [(e.lat, e.lon) for _, r in items for e in r.events if e.lat is not None]
    tracks = [[(g.lat, g.lon) for g in trip.gps if g.accuracy <= 50] for trip, _ in items]
    allpts = pts + [p for tr in tracks for p in tr]
    center = np.mean(allpts, axis=0).tolist() if allpts else [25.0478, 121.517]
    m = folium.Map(location=center, zoom_start=14, tiles="OpenStreetMap")
    for (trip, _), tr in zip(items, tracks):
        if len(tr) > 1:
            folium.PolyLine(tr, color="#0f766e", weight=3, opacity=0.5, tooltip=f"{trip.route} {trip.name}").add_to(m)
    for trip, r in items:
        for e in r.events:
            if e.lat is None:
                continue
            folium.CircleMarker(
                (e.lat, e.lon), radius=6, color="#fff", weight=1, fill=True, fill_color=EVENT_COLORS[e.type], fill_opacity=0.9,
                tooltip=f"{EVENT_LABELS[e.type]} {e.peak_value:.2f}｜{trip.route}",
            ).add_to(m)
    if allpts:
        m.fit_bounds([[min(p[0] for p in allpts), min(p[1] for p in allpts)], [max(p[0] for p in allpts), max(p[1] for p in allpts)]])
    m.save(str(path))
