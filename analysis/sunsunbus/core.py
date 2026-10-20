"""感測處理演算法的 Python 移植版（加加速度＝jerk，變數名稱沿用 jerk）。

逐行對應 web/src/core/（frame.ts、orientation.ts、vehicle.ts、events.ts、summary.ts、trip.ts 的批次版
process_trip），參數讀同一份 shared/params.default.json。修改演算法時兩邊要一起改，
並用 `npm run fixtures`（web/）重新產生對照資料、跑 `pytest` 確認一致。
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

from .params import Params

EVENT_TYPES = ["hard_brake", "hard_accel", "sharp_turn", "high_jerk"]
EVENT_LABELS = {"hard_brake": "急煞", "hard_accel": "急加速", "sharp_turn": "急轉彎", "high_jerk": "高加加速度"}

Vec3 = tuple[float, float, float]


# ---------------------------------------------------------------- 資料型別


@dataclass
class MotionSample:
    t: float
    ax: Optional[float]
    ay: Optional[float]
    az: Optional[float]
    gx: float
    gy: float
    gz: float
    ra: Optional[float]
    rb: Optional[float]
    rg: Optional[float]
    interval: Optional[float] = None


@dataclass
class OrientationSample:
    t: float
    alpha: Optional[float]
    beta: Optional[float]
    gamma: Optional[float]


@dataclass
class GpsFix:
    t: float
    lat: float
    lon: float
    speed: Optional[float]
    heading: Optional[float]
    accuracy: float


@dataclass
class FrameSample:
    t: float
    h1: float
    h2: float
    v: float
    stable: bool
    segment: int
    guess_theta: float
    grav_angle: float
    tilt_rms: float


@dataclass
class ProcessedSample:
    t: float
    a_long: float
    a_lat: float
    a_vert: float
    jerk_long: float
    jerk_lat: float
    jerk_mag: float
    stable: bool
    segment: int
    theta: float
    orient_source: str


@dataclass
class TripEvent:
    type: str
    t_start: float
    t_end: float
    t_peak: float
    peak_value: float
    peak_a_long: float
    peak_a_lat: float
    peak_jerk: float
    lat: Optional[float]
    lon: Optional[float]
    speed: Optional[float]
    orient_source: str


@dataclass
class Segment:
    id: int
    t_start: float
    t_end: float
    theta: float
    source: str
    quality: float


@dataclass
class TripResult:
    samples: list[ProcessedSample]
    events: list[TripEvent]
    segments: list[Segment]
    accel_sign: int
    sample_rate_hz: float
    jerk_p95: Optional[float]
    jerk_threshold: float
    summary: dict


# ---------------------------------------------------------------- 數學工具（對應 math.ts）


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vnorm(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def scale(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def normalize(a: Vec3) -> Vec3:
    n = vnorm(a)
    return scale(a, 1 / n) if n > 1e-9 else (0.0, 0.0, 1.0)


def angle_deg(a: Vec3, b: Vec3) -> float:
    c = max(-1.0, min(1.0, dot(a, b)))
    return math.acos(c) * 180 / math.pi


def horizontalize(v: Vec3, up: Vec3) -> Vec3:
    return normalize(sub(v, scale(up, dot(v, up))))


def ema_alpha(dt_sec: float, tau_sec: float) -> float:
    if tau_sec <= 0:
        return 1.0
    return 1 - math.exp(-dt_sec / tau_sec)


class Biquad:
    """二階 Butterworth 低通（RBJ，Direct Form II Transposed），以第一筆輸入初始化為穩態。"""

    def __init__(self, cutoff_hz: float, fs: float):
        fc = min(cutoff_hz, fs * 0.45)
        w0 = 2 * math.pi * fc / fs
        cosw = math.cos(w0)
        alpha = math.sin(w0) / (2 * math.sqrt(0.5))
        a0 = 1 + alpha
        self.b0 = (1 - cosw) / 2 / a0
        self.b1 = (1 - cosw) / a0
        self.b2 = self.b0
        self.a1 = (-2 * cosw) / a0
        self.a2 = (1 - alpha) / a0
        self.z1 = 0.0
        self.z2 = 0.0
        self.init = False

    def process(self, x: float) -> float:
        if not self.init:
            self.z2 = (self.b2 - self.a2) * x
            self.z1 = (self.b1 - self.a1) * x + self.z2
            self.init = True
        y = self.b0 * x + self.z1
        self.z1 = self.b1 * x - self.a1 * y + self.z2
        self.z2 = self.b2 * x - self.a2 * y
        return y


def median(xs: list[float]) -> float:
    if not xs:
        return math.nan
    s = sorted(xs)
    m = len(s) >> 1
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def percentile(xs: list[float], q: float) -> float:
    """與 numpy.percentile（linear）相同。"""
    s = sorted(xs)
    if not s:
        return math.nan
    pos = (len(s) - 1) * q / 100
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def estimate_sample_rate(ts: list[float], n: int = 60) -> float:
    dts = [ts[i] - ts[i - 1] for i in range(1, min(len(ts), n + 1)) if ts[i] - ts[i - 1] > 0]
    m = median(dts)
    return 1000 / m if math.isfinite(m) and m > 0 else 60.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    rad = math.pi / 180
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def up_from_orientation(beta_deg: float, gamma_deg: float) -> Vec3:
    b = beta_deg * math.pi / 180
    g = gamma_deg * math.pi / 180
    return (-math.cos(b) * math.sin(g), math.sin(b), math.cos(b) * math.cos(g))


def wrap_angle(a: float) -> float:
    while a > math.pi:
        a -= 2 * math.pi
    while a <= -math.pi:
        a += 2 * math.pi
    return a


# ---------------------------------------------------------------- 階段 A（frame.ts）


def _ema(prev: Optional[Vec3], x: Vec3, a: float) -> Vec3:
    if prev is None:
        return tuple(x)  # type: ignore[return-value]
    return (prev[0] + a * (x[0] - prev[0]), prev[1] + a * (x[1] - prev[1]), prev[2] + a * (x[2] - prev[2]))


class FrameStage:
    def __init__(self, p: Params, fs: float, accel_sign: int = 1):
        self.p = p
        self.fs = fs
        self.accel_sign = accel_sign
        self.g: Optional[Vec3] = None
        self.g_slow: Optional[Vec3] = None
        self.last_t: Optional[float] = None
        c = p["lowpassCutoffHz"]
        self.lpf = (Biquad(c, fs), Biquad(c, fs), Biquad(c, fs))
        self.win: deque = deque()
        self.stable = False
        self.ever_stable = False
        self.ok_since: Optional[float] = None
        self.unstable_since: Optional[float] = None
        self.segment = 0
        self.seg_up: Optional[Vec3] = None
        self.ref_axis: Vec3 = (0.0, 1.0, 0.0)
        self.guess_theta = 0.0

    def push(self, s: MotionSample) -> FrameSample:
        p = self.p
        dt = 1 / self.fs if self.last_t is None else max((s.t - self.last_t) / 1000, 1e-4)
        self.last_t = s.t
        inc_g = (s.gx, s.gy, s.gz)
        has_lin = p["useOsLinearAcceleration"] and s.ax is not None and s.ay is not None and s.az is not None
        if has_lin:
            acc = (s.ax, s.ay, s.az)
            self.g = _ema(self.g, sub(inc_g, acc), ema_alpha(dt, p["osGravitySmoothSec"]))
            self.g_slow = self.g
            lin = acc
        else:
            self.g = _ema(self.g, inc_g, ema_alpha(dt, p["gravityTauSec"]))
            moved_ms = 0 if self.unstable_since is None or self.ok_since is not None else s.t - self.unstable_since
            if self.g_slow is None or (not self.stable and moved_ms >= p["stability"]["recalibrateAfterUnstableSec"] * 1000):
                self.g_slow = self.g
            elif self.stable:
                self.g_slow = _ema(self.g_slow, inc_g, ema_alpha(dt, p["gravityStableTauSec"]))
            lin = sub(inc_g, self.g_slow)
        up = scale(normalize(self.g), self.accel_sign)
        up_lin = scale(normalize(self.g_slow), self.accel_sign)
        lin = scale(lin, self.accel_sign)
        f = (self.lpf[0].process(lin[0]), self.lpf[1].process(lin[1]), self.lpf[2].process(lin[2]))

        tilt2 = math.nan
        if s.ra is not None and s.rb is not None and s.rg is not None:
            w = (s.rb, s.rg, s.ra)
            tilt = sub(w, scale(up, dot(w, up)))
            tilt2 = dot(tilt, tilt)

        grav_angle, tilt_rms = self._update_window(s.t, up, tilt2)
        if self.seg_up is None:
            self._start_segment(up, False)
        self._update_stability(s.t, up, grav_angle, tilt_rms)

        e1 = horizontalize(self.ref_axis, up_lin)
        e2 = cross(up_lin, e1)
        return FrameSample(s.t, dot(f, e1), dot(f, e2), dot(f, up_lin), self.stable, self.segment, self.guess_theta, grav_angle, tilt_rms)

    def _update_window(self, t: float, up: Vec3, tilt2: float):
        win_ms = self.p["stability"]["windowSec"] * 1000
        self.win.append((t, up, tilt2))
        while len(self.win) > 1 and t - self.win[0][0] > win_ms:
            self.win.popleft()
        sx = sy = sz = 0.0
        tilt_sum = 0.0
        tilt_n = 0
        for _, u, t2 in self.win:
            sx += u[0]
            sy += u[1]
            sz += u[2]
            if not math.isnan(t2):
                tilt_sum += t2
                tilt_n += 1
        mean = normalize((sx, sy, sz))
        grav_angle = 0.0
        for _, u, _ in self.win:
            grav_angle = max(grav_angle, angle_deg(u, mean))
        tilt_rms = math.sqrt(tilt_sum / tilt_n) if tilt_n > 0 else math.nan
        return grav_angle, tilt_rms

    def _update_stability(self, t: float, up: Vec3, grav_angle: float, tilt_rms: float):
        st = self.p["stability"]
        ok = grav_angle <= st["maxGravityAngleDeg"] and (math.isnan(tilt_rms) or tilt_rms <= st["maxTiltRateRmsDps"])
        if not ok:
            if self.unstable_since is None:
                self.unstable_since = t
            self.ok_since = None
            self.stable = False
            return
        if self.ok_since is None:
            self.ok_since = t
        if not self.stable and t - self.ok_since >= st["minStableSec"] * 1000:
            self.stable = True
            unstable_ms = 0 if self.unstable_since is None else self.ok_since - self.unstable_since
            drift = angle_deg(up, self.seg_up) if self.seg_up else 0
            if (
                not self.ever_stable
                or unstable_ms >= st["recalibrateAfterUnstableSec"] * 1000
                or drift > st["recalibrateGravityDriftDeg"]
            ):
                self._start_segment(up, True)
            self.ever_stable = True
            self.unstable_since = None
        elif self.stable and self.seg_up and angle_deg(up, self.seg_up) > st["recalibrateGravityDriftDeg"]:
            self._start_segment(up, True)

    def _start_segment(self, up: Vec3, increment: bool):
        if increment:
            self.segment += 1
        self.seg_up = up
        self.ref_axis = (0.0, 1.0, 0.0) if abs(up[1]) < 0.9 else (1.0, 0.0, 0.0)
        fwd_phone: Vec3 = (0.0, 0.0, -1.0) if abs(up[2]) < 0.7 else (0.0, 1.0, 0.0)
        e1 = horizontalize(self.ref_axis, up)
        e2 = cross(up, e1)
        fh = horizontalize(fwd_phone, up)
        self.guess_theta = math.atan2(dot(fh, e2), dot(fh, e1))


# ---------------------------------------------------------------- 階段 B（orientation.ts）


@dataclass
class _Seg:
    id: int
    t_start: float
    t_end: float
    guess_theta: float
    gn: int = 0
    s1: float = 0.0
    s2: float = 0.0
    s11: float = 0.0
    s12: float = 0.0
    s22: float = 0.0
    s1d: float = 0.0
    s2d: float = 0.0
    sd: float = 0.0
    sdd: float = 0.0
    pn: int = 0
    pxx: float = 0.0
    pxy: float = 0.0
    pyy: float = 0.0
    last_t: float = 0.0
    cum1: float = 0.0
    cum2: float = 0.0
    path: list = field(default_factory=lambda: [(0.0, 0.0)])
    last_path_t: float = 0.0
    i_n: int = 0
    i1: float = 0.0
    i2: float = 0.0
    i_stable: bool = False
    i_fresh: bool = False


class OrientationEstimator:
    def __init__(self, p: Params):
        self.p = p
        self.seg: Optional[_Seg] = None
        self.done: list[_Seg] = []
        self.last_fix: Optional[tuple[float, float, float, float]] = None  # t, speed, lat, lon

    def push_frame(self, f: FrameSample):
        if self.seg is None or f.segment != self.seg.id:
            if self.seg:
                self.done.append(self.seg)
            self.seg = _Seg(id=f.segment, t_start=f.t, t_end=f.t, guess_theta=f.guess_theta, last_t=f.t, last_path_t=f.t)
        s = self.seg
        s.t_end = f.t
        if s.i_n == 0:
            s.i_stable = True
        s.i_n += 1
        s.i1 += f.h1
        s.i2 += f.h2
        s.i_stable = s.i_stable and f.stable

        dt = (f.t - s.last_t) / 1000
        s.last_t = f.t
        if not f.stable:
            return
        o = self.p["orientation"]
        hm = math.hypot(f.h1, f.h2)
        if hm > o["pcaMinHorizAccel"]:
            s.pn += 1
            s.pxx += f.h1 * f.h1
            s.pxy += f.h1 * f.h2
            s.pyy += f.h2 * f.h2
        if hm > o["velocityDeadbandAccel"] and 0 < dt < 1:
            s.cum1 += f.h1 * dt
            s.cum2 += f.h2 * dt
        if f.t - s.last_path_t >= o["velocityPathIntervalSec"] * 1000:
            s.path.append((s.cum1, s.cum2))
            s.last_path_t = f.t

    def push_gps(self, fix: GpsFix):
        o = self.p["orientation"]
        speed = fix.speed
        if (speed is None or not math.isfinite(speed)) and self.last_fix:
            dt = (fix.t - self.last_fix[0]) / 1000
            if dt > 0:
                speed = haversine_m(self.last_fix[2], self.last_fix[3], fix.lat, fix.lon) / dt
        if fix.accuracy > o["gpsMaxAccuracyM"] or speed is None or not math.isfinite(speed):
            self.last_fix = None
            self._reset_interval()
            return
        s = self.seg
        if s and self.last_fix and s.i_n > 0 and s.i_stable and s.i_fresh:
            dt = (fix.t - self.last_fix[0]) / 1000
            if o["gpsMinIntervalSec"] <= dt <= o["gpsMaxIntervalSec"]:
                d = (speed - self.last_fix[1]) / dt
                m1 = s.i1 / s.i_n
                m2 = s.i2 / s.i_n
                s.gn += 1
                s.s1 += m1
                s.s2 += m2
                s.s11 += m1 * m1
                s.s12 += m1 * m2
                s.s22 += m2 * m2
                s.s1d += m1 * d
                s.s2d += m2 * d
                s.sd += d
                s.sdd += d * d
        self.last_fix = (fix.t, speed, fix.lat, fix.lon)
        self._reset_interval()

    def _reset_interval(self):
        if not self.seg:
            return
        self.seg.i_n = 0
        self.seg.i1 = 0.0
        self.seg.i2 = 0.0
        self.seg.i_stable = False
        self.seg.i_fresh = True

    def finalize(self) -> dict[int, Segment]:
        segs = self.done + ([self.seg] if self.seg else [])
        out = {}
        for s in segs:
            theta, source, quality = self._estimate(s)
            out[s.id] = Segment(s.id, s.t_start, s.t_end, theta, source, quality)
        return out

    def _estimate(self, s: _Seg) -> tuple[float, str, float]:
        o = self.p["orientation"]
        if s.gn >= o["gpsMinPairs"]:
            n = s.gn
            d_std = math.sqrt(max(s.sdd / n - (s.sd / n) ** 2, 0))
            mag = math.hypot(s.s1d, s.s2d)
            if d_std >= o["gpsMinDvdtStd"] and mag > 1e-9:
                c1 = s.s1d / mag
                c2 = s.s2d / mag
                sp = c1 * s.s1 + c2 * s.s2
                spp = c1 * c1 * s.s11 + 2 * c1 * c2 * s.s12 + c2 * c2 * s.s22
                sdp = c1 * s.s1d + c2 * s.s2d
                prod = (n * s.sdd - s.sd * s.sd) * (n * spp - sp * sp)
                den = math.sqrt(prod) if prod > 0 else 0
                r = (n * sdp - s.sd * sp) / den if den > 0 else 0
                if r >= o["gpsMinR"]:
                    return math.atan2(c2, c1), "gps", r
        if s.pn >= o["pcaMinSamples"]:
            tr = s.pxx + s.pyy
            diff = math.sqrt((s.pxx - s.pyy) ** 2 + 4 * s.pxy * s.pxy)
            l1 = (tr + diff) / 2
            l2 = (tr - diff) / 2
            aniso = l1 / max(l2, 1e-9)
            if aniso >= o["pcaMinAnisotropy"]:
                phi = 0.5 * math.atan2(2 * s.pxy, s.pxx - s.pyy)
                c, sn = math.cos(phi), math.sin(phi)
                vmax = vmin = 0.0
                for p1, p2 in s.path:
                    v = p1 * c + p2 * sn
                    vmax = max(vmax, v)
                    vmin = min(vmin, v)
                sign = vmax + vmin
                if abs(sign) < 0.1:
                    sign = math.cos(s.guess_theta - phi)
                return wrap_angle(phi if sign >= 0 else phi + math.pi), "pca", aniso
        return s.guess_theta, "guess", 0.0


# ---------------------------------------------------------------- 階段 C（vehicle.ts）


class VehicleStage:
    def __init__(self, p: Params, fs: float):
        # 與 JS 的 Math.round 一致（.5 進位；Python 的 round 是銀行家捨入）
        self.k = max(1, math.floor(p["jerkWindowSec"] * fs + 0.5))
        self.hist: deque = deque()
        self.segment = -1

    def push(self, f: FrameSample, theta: float, source: str) -> ProcessedSample:
        if f.segment != self.segment:
            self.hist.clear()
            self.segment = f.segment
        self.hist.append((f.t, f.h1, f.h2))
        if len(self.hist) > self.k + 1:
            self.hist.popleft()
        j1 = j2 = 0.0
        if len(self.hist) == self.k + 1:
            ot, o1, o2 = self.hist[0]
            dt = (f.t - ot) / 1000
            if dt > 0:
                j1 = (f.h1 - o1) / dt
                j2 = (f.h2 - o2) / dt
        c, s = math.cos(theta), math.sin(theta)
        return ProcessedSample(
            t=f.t,
            a_long=f.h1 * c + f.h2 * s,
            a_lat=-f.h1 * s + f.h2 * c,
            a_vert=f.v,
            jerk_long=j1 * c + j2 * s,
            jerk_lat=-j1 * s + j2 * c,
            jerk_mag=math.hypot(j1, j2),
            stable=f.stable,
            segment=f.segment,
            theta=theta,
            orient_source=source,
        )


# ---------------------------------------------------------------- 階段 D（events.ts）


def _condition(etype: str, s: ProcessedSample, e: dict, jerk_thr: float) -> bool:
    if etype == "hard_accel":
        return s.a_long > e["accelThreshold"]
    if etype == "hard_brake":
        return s.a_long < -e["brakeThreshold"]
    if etype == "sharp_turn":
        return abs(s.a_lat) > e["turnThreshold"]
    return s.jerk_mag > jerk_thr


def _metric(etype: str, s: ProcessedSample) -> tuple[float, float]:
    if etype == "hard_accel":
        return s.a_long, s.a_long
    if etype == "hard_brake":
        return -s.a_long, s.a_long
    if etype == "sharp_turn":
        return abs(s.a_lat), s.a_lat
    return s.jerk_mag, s.jerk_mag


def _max_abs(a: float, b: float) -> float:
    return b if abs(b) > abs(a) else a


GpsLookup = Callable[[float], Optional[GpsFix]]


class EventDetector:
    def __init__(self, p: Params, gps_lookup: GpsLookup = lambda t: None):
        self.p = p
        self.gps_lookup = gps_lookup
        self.active: dict[str, dict] = {}

    def push(self, s: ProcessedSample, jerk_thr: float) -> list[TripEvent]:
        out = []
        e = self.p["events"]
        for etype in EVENT_TYPES:
            c = s.stable and _condition(etype, s, e, jerk_thr)
            a = self.active.get(etype)
            if c:
                if a is None:
                    a = dict(
                        t_start=s.t, last_true=s.t, confirmed=False, best=-math.inf, t_peak=s.t, peak_value=0.0,
                        peak_a_long=0.0, peak_a_lat=0.0, peak_jerk=0.0, orient_source=s.orient_source,
                    )
                    self.active[etype] = a
                a["last_true"] = s.t
                score, value = _metric(etype, s)
                if score > a["best"]:
                    a["best"] = score
                    a["t_peak"] = s.t
                    a["peak_value"] = value
                    a["orient_source"] = s.orient_source
                a["peak_a_long"] = _max_abs(a["peak_a_long"], s.a_long)
                a["peak_a_lat"] = _max_abs(a["peak_a_lat"], s.a_lat)
                a["peak_jerk"] = max(a["peak_jerk"], s.jerk_mag)
                min_dur = e["jerkMinDurationSec"] if etype == "high_jerk" else e["minDurationSec"]
                if not a["confirmed"] and s.t - a["t_start"] >= min_dur * 1000:
                    a["confirmed"] = True
            elif a is not None:
                if not a["confirmed"]:
                    del self.active[etype]
                elif not s.stable or s.t - a["last_true"] > e["endGapSec"] * 1000:
                    out.append(self._finish(etype, a))
                    del self.active[etype]
        return out

    def flush(self) -> list[TripEvent]:
        out = [self._finish(t, a) for t, a in self.active.items() if a["confirmed"]]
        self.active.clear()
        return out

    def _finish(self, etype: str, a: dict) -> TripEvent:
        fix = self.gps_lookup(a["t_peak"])
        return TripEvent(
            type=etype, t_start=a["t_start"], t_end=a["last_true"], t_peak=a["t_peak"], peak_value=a["peak_value"],
            peak_a_long=a["peak_a_long"], peak_a_lat=a["peak_a_lat"], peak_jerk=a["peak_jerk"],
            lat=fix.lat if fix else None, lon=fix.lon if fix else None, speed=fix.speed if fix else None,
            orient_source=a["orient_source"],
        )


def make_gps_lookup(fixes: list[GpsFix], max_age_ms: float = 5000) -> GpsLookup:
    import bisect

    ts = [f.t for f in fixes]

    def lookup(t: float) -> Optional[GpsFix]:
        i = bisect.bisect_right(ts, t) - 1
        if i < 0:
            return None
        return fixes[i] if t - fixes[i].t <= max_age_ms else None

    return lookup


# ---------------------------------------------------------------- 摘要（summary.ts）


def gps_distance_km(gps: list[GpsFix]) -> float:
    d = 0.0
    prev = None
    for f in gps:
        if f.accuracy > 50:
            continue
        if prev:
            seg = haversine_m(prev.lat, prev.lon, f.lat, f.lon)
            dt = (f.t - prev.t) / 1000
            if dt > 0 and seg / dt <= 40:
                d += seg
        prev = f
    return d / 1000


def smooth_score(counts: dict, distance_km: float, duration_sec: float, p: Params) -> tuple[float, float]:
    sc = p["score"]
    km = distance_km if distance_km >= sc["minKm"] else max(duration_sec / 60 * sc["fallbackKmPerMin"], sc["minKm"])
    weighted = sum(sc["weights"][t] * counts[t] for t in EVENT_TYPES)
    total = sum(counts[t] for t in EVENT_TYPES)
    score = max(0.0, min(100.0, 100 - sc["penaltyPerWeightedEventPerKm"] * weighted / km))
    # 與 JS 的 Math.round(x*10)/10 相同（四捨五入，.5 進位）
    return math.floor(score * 10 + 0.5) / 10, total / km


def compute_summary(samples, events, gps, p: Params, fs: float, jerk_p95, jerk_thr) -> dict:
    e = p["events"]
    duration = (samples[-1].t - samples[0].t) / 1000 if len(samples) > 1 else 0.0
    dist = gps_distance_km(gps)
    counts = {t: 0 for t in EVENT_TYPES}
    for ev in events:
        counts[ev.type] += 1
    stable_n = exceed_n = 0
    peaks = {"maxAccel": 0.0, "maxBrake": 0.0, "maxLat": 0.0, "maxJerk": 0.0}
    for s in samples:
        if not s.stable:
            continue
        stable_n += 1
        if s.a_long > e["accelThreshold"] or s.a_long < -e["brakeThreshold"] or abs(s.a_lat) > e["turnThreshold"]:
            exceed_n += 1
        peaks["maxAccel"] = max(peaks["maxAccel"], s.a_long)
        peaks["maxBrake"] = min(peaks["maxBrake"], s.a_long)
        peaks["maxLat"] = max(peaks["maxLat"], abs(s.a_lat))
        peaks["maxJerk"] = max(peaks["maxJerk"], s.jerk_mag)
    score, epk = smooth_score(counts, dist, duration, p)
    return {
        "durationSec": duration,
        "distanceKm": dist,
        "sampleCount": len(samples),
        "sampleRateHz": fs,
        "stableRatio": stable_n / len(samples) if samples else 0,
        "counts": counts,
        "peaks": peaks,
        "jerkThreshold": jerk_thr,
        "jerkP95": jerk_p95,
        "exceedanceRatio": exceed_n / stable_n if stable_n else 0,
        "eventsPerKm": epk,
        "smoothScore": score,
    }


# ---------------------------------------------------------------- 整趟批次處理（trip.ts）


def jerk_threshold(pct_value: Optional[float], p: Params) -> float:
    e = p["events"]
    if pct_value is None:
        return e["jerkAbsThreshold"]
    return min(max(pct_value, e["jerkFloor"]), e["jerkAbsThreshold"])


def sign_vote(m: MotionSample, o: OrientationSample) -> int:
    if o.beta is None or o.gamma is None:
        return 0
    u = normalize((m.gx, m.gy, m.gz))
    d = dot(u, up_from_orientation(o.beta, o.gamma))
    return 1 if d > 0.5 else (-1 if d < -0.5 else 0)


def detect_accel_sign(motion: list[MotionSample], orientation: list[OrientationSample]) -> int:
    votes = 0
    j = 0
    for o in orientation:
        while j + 1 < len(motion) and abs(motion[j + 1].t - o.t) <= abs(motion[j].t - o.t):
            j += 1
        if motion and abs(motion[j].t - o.t) <= 200:
            votes += sign_vote(motion[j], o)
    return -1 if votes < 0 else 1


def process_trip(
    motion: list[MotionSample], orientation: list[OrientationSample], gps: list[GpsFix], p: Params
) -> TripResult:
    motion = sorted(motion, key=lambda m: m.t)
    gps = sorted(gps, key=lambda g: g.t)
    orientation = sorted(orientation, key=lambda o: o.t)
    fs = estimate_sample_rate([m.t for m in motion])
    accel_sign = detect_accel_sign(motion, orientation)

    frame = FrameStage(p, fs, accel_sign)
    est = OrientationEstimator(p)
    frames = []
    gi = 0
    for m in motion:
        while gi < len(gps) and gps[gi].t <= m.t:
            est.push_gps(gps[gi])
            gi += 1
        f = frame.push(m)
        est.push_frame(f)
        frames.append(f)
    while gi < len(gps):
        est.push_gps(gps[gi])
        gi += 1
    seg_map = est.finalize()

    veh = VehicleStage(p, fs)
    samples = [veh.push(f, seg_map[f.segment].theta, seg_map[f.segment].source) for f in frames]

    stable_jerk = [s.jerk_mag for s in samples if s.stable]
    jerk_p95 = (
        percentile(stable_jerk, p["events"]["jerkPercentile"])
        if len(stable_jerk) >= p["events"]["jerkMinSamplesForPercentile"]
        else None
    )
    thr = jerk_threshold(jerk_p95, p)

    det = EventDetector(p, make_gps_lookup(gps))
    events: list[TripEvent] = []
    for s in samples:
        events.extend(det.push(s, thr))
    events.extend(det.flush())
    events.sort(key=lambda e: (e.t_start, e.type))

    return TripResult(
        samples=samples,
        events=events,
        segments=list(seg_map.values()),
        accel_sign=accel_sign,
        sample_rate_hz=fs,
        jerk_p95=jerk_p95,
        jerk_threshold=thr,
        summary=compute_summary(samples, events, gps, p, fs, jerk_p95, thr),
    )
