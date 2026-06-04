"""Liquidity detection.

Concepts:
    - HOD/LOD: extremes formed between previous-day-last-candle and 10:00 today.
      MUST be liquidated 10:00..12:00 to count as HOD/LOD; later sweeps -> Local.
    - Local: any swing extremum that, at sweep time, has age 3h..3d
      (or older if it lacks the "extreme structure" — it stays Local, doesn't
      promote to Major).
    - Major: a swing that is BOTH old (3d..8w) AND has the "extreme structure
      on chart" — i.e., it's a valid swing point in the structural sense.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .. import config
from . import swings


# -----------------------------------------------------------------------------
# Sweep event model
# -----------------------------------------------------------------------------


@dataclass
class SweepEvent:
    """A liquidity-sweep event detected on the candle stream."""

    sweep_idx: int                    # candle index where the sweep occurs
    sweep_time: pd.Timestamp          # tz-aware
    direction: str                    # "buy" if low was swept (sweep below), "sell" if high (sweep above)
    swept_price: float                # the price level that was swept (wick-based, used by simulator)
    display_price: float              # cleaner body-level price for chart annotations
    pivot_idx: int                    # candle index of the pivot that defined the level
    pivot_time: pd.Timestamp          # tz-aware
    age: pd.Timedelta                 # sweep_time - pivot_time
    liquidity_type: str               # "HOD", "LOD", "Local", "Major"
    sweep_kind: str                   # "wick" if only wick crossed, "body" if close crossed
    additional_liquidity: str | None  # "Local" / "Major" if a SECOND level was also swept simultaneously, else None

    def to_dict(self) -> dict:
        return {
            "sweep_idx": int(self.sweep_idx),
            "sweep_time": self.sweep_time.isoformat(),
            "direction": self.direction,
            "swept_price": float(self.swept_price),
            "display_price": float(self.display_price),
            "pivot_idx": int(self.pivot_idx),
            "pivot_time": self.pivot_time.isoformat(),
            "age_seconds": int(self.age.total_seconds()),
            "liquidity_type": self.liquidity_type,
            "sweep_kind": self.sweep_kind,
            "additional_liquidity": self.additional_liquidity,
        }


# -----------------------------------------------------------------------------
# HOD/LOD detection per session day
# -----------------------------------------------------------------------------


def _session_hod_lod(df: pd.DataFrame, day: pd.Timestamp) -> tuple[tuple[int, float] | None, tuple[int, float] | None]:
    """For a given session day, return (hod_index, hod_price), (lod_index, lod_price).

    HOD/LOD = extreme between previous-day-last-candle and 10:00 today.

    Returns the *index in df* and the price.
    """
    tz = df.index.tz
    # Previous calendar day's last candle = up to but not including 'day' midnight
    day_start = pd.Timestamp(day.date(), tz=tz)
    cutoff = day_start + pd.Timedelta(hours=config.HOD_LOD_FORMATION_END_HOUR)
    prev_day_start = day_start - pd.Timedelta(days=7)  # search up to a week back to find prev session

    # Find the last candle BEFORE day_start (i.e., previous trading day's last)
    pre_day = df.loc[(df.index < day_start) & (df.index >= prev_day_start)]
    if len(pre_day) == 0:
        # No previous-day data available; just use current pre-10AM window
        window = df.loc[(df.index >= day_start) & (df.index < cutoff)]
    else:
        # Window = from previous-day-last-candle (inclusive) to today 10:00 (exclusive)
        last_prev_idx = pre_day.index[-1]
        window = df.loc[(df.index >= last_prev_idx) & (df.index < cutoff)]

    if len(window) == 0:
        return None, None

    high_idx_label = window["high"].idxmax()
    low_idx_label = window["low"].idxmin()
    hod_price = float(window.loc[high_idx_label, "high"])
    lod_price = float(window.loc[low_idx_label, "low"])
    hod_idx = df.index.get_loc(high_idx_label)
    lod_idx = df.index.get_loc(low_idx_label)
    return (hod_idx, hod_price), (lod_idx, lod_price)


# -----------------------------------------------------------------------------
# Sweep helpers
# -----------------------------------------------------------------------------


def _classify_sweep_kind(candle: pd.Series, level: float, direction: str) -> str:
    """Did the candle 'body' cross the level, or only the wick?"""
    if direction == "sell":  # swept ABOVE (high broke up)
        body_top = max(candle["open"], candle["close"])
        return "body" if body_top > level else "wick"
    else:  # "buy" — swept BELOW
        body_bot = min(candle["open"], candle["close"])
        return "body" if body_bot < level else "wick"


def _is_swept(candle: pd.Series, level: float, direction: str) -> bool:
    """Did this candle sweep the level (wick or body)?"""
    if direction == "sell":
        return candle["high"] > level
    else:
        return candle["low"] < level


# -----------------------------------------------------------------------------
# v0.5 — Qualitative liquidity-level detection (touch-based)
# -----------------------------------------------------------------------------


@dataclass
class LiquidityLevel:
    """A 'qualitative' extreme high or low that may later be touched by price."""
    pivot_idx: int            # candle index that defines the level
    direction: str            # "high" or "low" — which side the liquidity sits on
    price: float              # the level price used for touch detection (wick or body, see code)
    display_price: float      # same as price for now; kept for snapshot symmetry
    tier: str                 # "local" or "major"
    prominence: float         # how much it sticks out (in price units)


def find_liquidity_levels(
    df: pd.DataFrame, *, tier: str
) -> list[LiquidityLevel]:
    """Find qualitative extreme points on the chart.

    A high at index i qualifies as a level if:
      1. high[i] is the maximum high in [i-lookback, i+lookback]
      2. high[i] sticks out above surrounding body-tops by >= threshold * ATR[i]
    Lows mirror.

    tier='local' uses LOCAL_LOOKBACK + LOCAL_PROMINENCE_ATR
    tier='major' uses MAJOR_LOOKBACK + MAJOR_PROMINENCE_ATR
    """
    if tier == "local":
        lookback = config.LOCAL_LOOKBACK
        prom_threshold = config.LOCAL_PROMINENCE_ATR
    elif tier == "major":
        lookback = config.MAJOR_LOOKBACK
        prom_threshold = config.MAJOR_PROMINENCE_ATR
    else:
        raise ValueError(f"unknown tier: {tier}")

    if "atr" not in df.columns:
        df = swings.annotate_atr(df)

    n = len(df)
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    open_arr = df["open"].to_numpy()
    close_arr = df["close"].to_numpy()
    atr_arr = df["atr"].to_numpy()
    body_top = np.maximum(open_arr, close_arr)
    body_bot = np.minimum(open_arr, close_arr)
    spike_gap = config.LIQ_SPIKE_BODY_GAP_ATR

    levels: list[LiquidityLevel] = []

    for i in range(lookback, n - lookback):
        atr = atr_arr[i]
        if not np.isfinite(atr) or atr <= 0:
            continue

        win_h = high[i - lookback : i + lookback + 1]
        win_l = low[i - lookback : i + lookback + 1]

        # --- High candidate ---
        if high[i] >= win_h.max():
            # Compare against surrounding body-tops (excluding i itself)
            win_body_top = np.concatenate(
                [body_top[i - lookback : i], body_top[i + 1 : i + lookback + 1]]
            )
            if win_body_top.size:
                surrounding_max = float(win_body_top.max())
                prominence = float(high[i]) - surrounding_max
                if prominence >= prom_threshold * atr:
                    # Spike vs body-cluster decision
                    wick_above = float(high[i]) - float(body_top[i])
                    if wick_above >= spike_gap * atr:
                        price = float(high[i])           # spike — use wick
                    else:
                        price = float(body_top[i])       # cluster — use body
                    levels.append(LiquidityLevel(
                        pivot_idx=i,
                        direction="high",
                        price=price,
                        display_price=price,
                        tier=tier,
                        prominence=prominence,
                    ))

        # --- Low candidate ---
        if low[i] <= win_l.min():
            win_body_bot = np.concatenate(
                [body_bot[i - lookback : i], body_bot[i + 1 : i + lookback + 1]]
            )
            if win_body_bot.size:
                surrounding_min = float(win_body_bot.min())
                prominence = surrounding_min - float(low[i])
                if prominence >= prom_threshold * atr:
                    wick_below = float(body_bot[i]) - float(low[i])
                    if wick_below >= spike_gap * atr:
                        price = float(low[i])
                    else:
                        price = float(body_bot[i])
                    levels.append(LiquidityLevel(
                        pivot_idx=i,
                        direction="low",
                        price=price,
                        display_price=price,
                        tier=tier,
                        prominence=prominence,
                    ))

    return levels


def _is_touched(candle: pd.Series, level_price: float, direction: str) -> bool:
    """Touch = price reaches the level (no need to cross)."""
    if direction == "high":
        return candle["high"] >= level_price
    return candle["low"] <= level_price


def _touch_event(
    df: pd.DataFrame,
    level: LiquidityLevel,
    touch_idx: int,
    liquidity_type: str,
) -> "SweepEvent":
    """Build a SweepEvent from a liquidity-level touch (v0.5)."""
    t = df.index[touch_idx]
    candle = df.iloc[touch_idx]
    # Touch direction: "sell" trade for high-side touch, "buy" for low-side
    trade_direction = "sell" if level.direction == "high" else "buy"
    # 'Body' if candle close crossed the level; 'Wick' if only the wick reached
    if level.direction == "high":
        body_top = max(candle["open"], candle["close"])
        touch_kind = "Body" if body_top >= level.price else "Wick"
    else:
        body_bot = min(candle["open"], candle["close"])
        touch_kind = "Body" if body_bot <= level.price else "Wick"
    return SweepEvent(
        sweep_idx=touch_idx,
        sweep_time=t,
        direction=trade_direction,
        swept_price=level.price,
        display_price=level.display_price,
        pivot_idx=level.pivot_idx,
        pivot_time=df.index[level.pivot_idx],
        age=t - df.index[level.pivot_idx],
        liquidity_type=liquidity_type,
        sweep_kind=touch_kind,
        additional_liquidity=None,
    )


def find_touch_events(
    df: pd.DataFrame, levels: list[LiquidityLevel]
) -> list["SweepEvent"]:
    """For each level, find the FIRST candle after formation where price
    reaches the level. Classify as Local/Major based on age + tier."""
    events: list[SweepEvent] = []
    n = len(df)

    for level in levels:
        # Skip if level is too close to end of data
        if level.pivot_idx + 1 >= n:
            continue

        # Walk forward and find first touch
        for j in range(level.pivot_idx + 1, n):
            candle = df.iloc[j]
            if _is_touched(candle, level.price, level.direction):
                # Classify based on tier + age at touch
                pivot_time = df.index[level.pivot_idx]
                touch_time = df.index[j]
                liquidity_type = _classify_v05(level.tier, pivot_time, touch_time)
                if liquidity_type is not None:
                    events.append(_touch_event(df, level, j, liquidity_type))
                break  # one-shot per level
    return events


def _classify_v05(
    tier: str, pivot_time: pd.Timestamp, touch_time: pd.Timestamp
) -> str | None:
    """v0.5 classification using tier + age at touch.

    - Local tier: requires age >= 3h, <= 3 calendar days
    - Major tier: requires age >= 3 business days, <= 8 weeks
    Returns None if level doesn't qualify (too young or expired).
    """
    age = touch_time - pivot_time
    hours = age.total_seconds() / 3600
    days = hours / 24
    weeks = days / 7

    if hours < config.LIQUIDITY_LOCAL_MIN_HOURS:
        return None

    if tier == "major":
        bdays = _business_days_between(pivot_time, touch_time)
        if bdays >= config.LIQUIDITY_MAJOR_MIN_DAYS and weeks <= config.LIQUIDITY_MAJOR_MAX_WEEKS:
            return "Major"
        # Major-tier level that doesn't meet age → falls back to Local if young enough
        if days <= config.LIQUIDITY_LOCAL_MAX_DAYS:
            return "Local"
        # Old but doesn't meet business-day Major criterion → stays Local up to 8w
        if weeks <= config.LIQUIDITY_MAJOR_MAX_WEEKS:
            return "Local"
        return None

    # Local tier
    if days <= config.LIQUIDITY_LOCAL_MAX_DAYS:
        return "Local"
    # Old Local-tier (3d+ but not detected as Major) → stays Local up to 8 weeks
    if weeks <= config.LIQUIDITY_MAJOR_MAX_WEEKS:
        return "Local"
    return None


# -----------------------------------------------------------------------------
# Main: detect all sweep events (v0.5: now wraps level-based touch detection)
# -----------------------------------------------------------------------------


def find_sweep_events(df: pd.DataFrame) -> list[SweepEvent]:
    """v0.6: HOD/LOD-ONLY strategy. Emit AT MOST ONE event per day — the
    first of {HOD, LOD} that is TOUCHED (>=, no sweep needed) in the
    10:00..12:00 window. If neither is touched by 12:00, the day is skipped.

    HOD/LOD are the extremes of the overnight window
    [previous-day 22:59 .. current-day 09:59] (see `_session_hod_lod`).

    The Local/Major detection (find_liquidity_levels / find_touch_events) is
    intentionally NOT called here — those concepts are removed from the active
    strategy (functions kept for reference only).
    """
    if "atr" not in df.columns:
        df = swings.annotate_atr(df)
    n = len(df)
    if n == 0:
        return []
    return _find_hod_lod_touch_events(df)


def _find_hod_lod_touch_events(df: pd.DataFrame) -> list[SweepEvent]:
    """One event per day: first HOD/LOD touch in 10:00..12:00.

    Vectorized (O(n)): HOD/LOD per session day = extreme of the formation window
    [previous-trading-day last candle .. today 09:59], computed via groupby, plus
    the carried-forward previous-day last candle. The 10:00..12:00 touch scan uses
    precomputed per-day position lists. Avoids the O(days x n) per-day full-frame
    masking that made the full 2020-2026 run hang.
    """
    n = len(df)
    if n == 0:
        return []
    events: list[SweepEvent] = []
    times_local = df.index.tz_convert(config.TIMEZONE)
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    date_arr = np.asarray(times_local.date)          # python date objects, computed once
    hour_arr = np.asarray(times_local.hour)          # int hours, once
    pos = np.arange(n)

    touch_start = config.HOD_LOD_FORMATION_END_HOUR   # 10
    touch_end = config.HOD_LOD_SWEEP_DEADLINE_HOUR    # 12

    # --- Per-day formation extremes over the morning (00:00..09:59) ---
    morning = hour_arr < touch_start
    md = pd.DataFrame({
        "d": date_arr[morning], "h": high[morning],
        "l": low[morning], "p": pos[morning],
    })
    if md.empty:
        return []
    hod_rows = md.loc[md.groupby("d")["h"].idxmax()].set_index("d")
    lod_rows = md.loc[md.groupby("d")["l"].idxmin()].set_index("d")

    # --- Last candle position per calendar day (for prev-day carry-forward) ---
    last_pos_per_day = pd.Series(pos, index=pd.Index(date_arr)).groupby(level=0).max()

    # --- Touch-window (10:00..12:00) positions per day, in order ---
    win = (hour_arr >= touch_start) & (hour_arr < touch_end)
    wd = pd.DataFrame({"d": date_arr[win], "p": pos[win]}).sort_values("p")
    win_by_day: dict = {d: grp.to_numpy() for d, grp in wd.groupby("d")["p"]}

    all_days = sorted(set(date_arr))
    prev_day = None
    for d in all_days:
        if d not in hod_rows.index:
            prev_day = d
            continue
        hr = hod_rows.loc[d]
        lr = lod_rows.loc[d]
        hod_idx, hod_price = int(hr["p"]), float(hr["h"])
        lod_idx, lod_price = int(lr["p"]), float(lr["l"])
        # Carry forward the previous trading day's last candle (its 22:59 extreme)
        if prev_day is not None and prev_day in last_pos_per_day.index:
            pl = int(last_pos_per_day.loc[prev_day])
            if high[pl] > hod_price:
                hod_idx, hod_price = pl, float(high[pl])
            if low[pl] < lod_price:
                lod_idx, lod_price = pl, float(low[pl])

        for j in win_by_day.get(d, ()):  # already in time order
            j = int(j)
            if j > hod_idx and high[j] >= hod_price:
                events.append(_make_event(df, j, df.index[j], "sell",
                                          hod_price, hod_idx, "HOD"))
                break
            if j > lod_idx and low[j] <= lod_price:
                events.append(_make_event(df, j, df.index[j], "buy",
                                          lod_price, lod_idx, "LOD"))
                break
        prev_day = d

    events.sort(key=lambda e: e.sweep_idx)
    return events


def _find_hod_lod_events(df: pd.DataFrame) -> list[SweepEvent]:
    """Detect HOD/LOD sweeps (unchanged from prior versions)."""
    n = len(df)
    events: list[SweepEvent] = []
    days = pd.unique(df.index.normalize())
    hod_lod_per_day: dict = {}
    for d in days:
        d_ts = pd.Timestamp(d)
        hod, lod = _session_hod_lod(df, d_ts)
        hod_lod_per_day[d_ts.date()] = (hod, lod)
    hod_swept: dict = {}
    lod_swept: dict = {}

    for i in range(n):
        candle = df.iloc[i]
        t = df.index[i]
        day = t.date()
        hod, lod = hod_lod_per_day.get(day, (None, None))

        if hod is not None and not hod_swept.get(day, False):
            hod_idx, hod_price = hod
            if i > hod_idx and _is_swept(candle, hod_price, "sell"):
                local_t = t.tz_convert(config.TIMEZONE)
                hour = local_t.hour
                if config.HOD_LOD_FORMATION_END_HOUR <= hour < config.HOD_LOD_SWEEP_DEADLINE_HOUR:
                    liquidity_type = "HOD"
                else:
                    liquidity_type = "Local"
                events.append(_make_event(df, i, t, "sell", hod_price, hod_idx, liquidity_type))
                hod_swept[day] = True

        if lod is not None and not lod_swept.get(day, False):
            lod_idx, lod_price = lod
            if i > lod_idx and _is_swept(candle, lod_price, "buy"):
                local_t = t.tz_convert(config.TIMEZONE)
                hour = local_t.hour
                if config.HOD_LOD_FORMATION_END_HOUR <= hour < config.HOD_LOD_SWEEP_DEADLINE_HOUR:
                    liquidity_type = "LOD"
                else:
                    liquidity_type = "Local"
                events.append(_make_event(df, i, t, "buy", lod_price, lod_idx, liquidity_type))
                lod_swept[day] = True

    return events


def _find_sweep_events_legacy(df: pd.DataFrame) -> list[SweepEvent]:
    """Old swing-pivot based detector. Kept for reference/tests only."""
    df = swings.annotate_swings(df)
    df = swings.annotate_valid_swings(df)

    n = len(df)
    if n == 0:
        return []

    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    open_ = df["open"].to_numpy()
    close = df["close"].to_numpy()
    swing_h = df["swing_high"].to_numpy()
    swing_l = df["swing_low"].to_numpy()
    valid_h = df["valid_swing_high"].to_numpy()
    valid_l = df["valid_swing_low"].to_numpy()
    times = df.index

    # Pre-compute HOD/LOD per session day
    days = pd.unique(df.index.normalize())
    hod_lod_per_day: dict[pd.Timestamp, tuple] = {}
    for d in days:
        d_ts = pd.Timestamp(d)
        hod, lod = _session_hod_lod(df, d_ts)
        hod_lod_per_day[d_ts.date()] = (hod, lod)

    # Active swing-high / swing-low levels (pivot_idx, price, is_valid)
    active_highs: list[tuple[int, float, bool]] = []
    active_lows: list[tuple[int, float, bool]] = []

    # HOD/LOD active per day (set true when sweep happens to avoid double-emit)
    hod_swept: dict = {}
    lod_swept: dict = {}

    events: list[SweepEvent] = []
    lookback = config.SWING_LOOKBACK

    for i in range(n):
        candle = df.iloc[i]
        t = times[i]
        day = t.date()

        # ---------- Try sweep against HOD/LOD first ----------
        hod, lod = hod_lod_per_day.get(day, (None, None))

        # HOD: a Sell sweep ABOVE the high. Only valid 10:00..12:00.
        if hod is not None and not hod_swept.get(day, False):
            hod_idx, hod_price = hod
            if i > hod_idx and _is_swept(candle, hod_price, "sell"):
                local_t = t.tz_convert(config.TIMEZONE)
                hour = local_t.hour
                if config.HOD_LOD_FORMATION_END_HOUR <= hour < config.HOD_LOD_SWEEP_DEADLINE_HOUR:
                    liquidity_type = "HOD"
                else:
                    # Late sweep -> reclassify as Local
                    liquidity_type = "Local"
                events.append(_make_event(
                    df, i, t, "sell", hod_price, hod_idx, liquidity_type
                ))
                hod_swept[day] = True

        # LOD: a Buy sweep BELOW the low.
        if lod is not None and not lod_swept.get(day, False):
            lod_idx, lod_price = lod
            if i > lod_idx and _is_swept(candle, lod_price, "buy"):
                local_t = t.tz_convert(config.TIMEZONE)
                hour = local_t.hour
                if config.HOD_LOD_FORMATION_END_HOUR <= hour < config.HOD_LOD_SWEEP_DEADLINE_HOUR:
                    liquidity_type = "LOD"
                else:
                    liquidity_type = "Local"
                events.append(_make_event(
                    df, i, t, "buy", lod_price, lod_idx, liquidity_type
                ))
                lod_swept[day] = True

        # ---------- Try sweep against active swing highs (sell direction) ----------
        new_active_highs = []
        for piv_idx, piv_price, piv_valid in active_highs:
            if _is_swept(candle, piv_price, "sell"):
                liquidity_type = _classify_age(times[piv_idx], t, piv_valid)
                if liquidity_type is not None:
                    events.append(_make_event(
                        df, i, t, "sell", piv_price, piv_idx, liquidity_type
                    ))
                # consume regardless — once swept, the level is gone
            else:
                new_active_highs.append((piv_idx, piv_price, piv_valid))
        active_highs = new_active_highs

        # ---------- Try sweep against active swing lows (buy direction) ----------
        new_active_lows = []
        for piv_idx, piv_price, piv_valid in active_lows:
            if _is_swept(candle, piv_price, "buy"):
                liquidity_type = _classify_age(times[piv_idx], t, piv_valid)
                if liquidity_type is not None:
                    events.append(_make_event(
                        df, i, t, "buy", piv_price, piv_idx, liquidity_type
                    ))
            else:
                new_active_lows.append((piv_idx, piv_price, piv_valid))
        active_lows = new_active_lows

        # ---------- Confirm pivots from i-lookback (now safe to register) ----------
        confirm_idx = i - lookback
        if confirm_idx >= 0:
            if swing_h[confirm_idx]:
                active_highs.append((confirm_idx, float(high[confirm_idx]), bool(valid_h[confirm_idx])))
            if swing_l[confirm_idx]:
                active_lows.append((confirm_idx, float(low[confirm_idx]), bool(valid_l[confirm_idx])))

    # Post-process: for each event, populate `additional_liquidity` if multiple events
    # happened within ±2 candles of each other (different classification).
    events = _annotate_additional_liquidity(events)
    return events


def _business_days_between(t_old: pd.Timestamp, t_new: pd.Timestamp) -> int:
    """Number of business days (Mon-Fri) between two tz-aware timestamps.
    Excludes weekends. A 5-day Mon→Fri returns 4."""
    if t_new <= t_old:
        return 0
    # Use date-only for bdate_range; handle case where both are same business day
    d1 = t_old.date()
    d2 = t_new.date()
    bd = pd.bdate_range(d1, d2)
    return max(0, len(bd) - 1)


def _classify_age(
    pivot_time: pd.Timestamp, sweep_time: pd.Timestamp, is_valid_pivot: bool
) -> str | None:
    """Return Local or Major based on age + structure.

    - Local: age >= 3h AND age <= 3 calendar days
    - Major: age >= 3 BUSINESS days AND structural extreme AND age <= 8 weeks
    - Old (>3d) without extreme structure: stays Local (per user spec)
    - Too young (<3h) or too old (>8w): None (skip)
    """
    age = sweep_time - pivot_time
    hours = age.total_seconds() / 3600
    days = hours / 24
    weeks = days / 7

    if hours < config.LIQUIDITY_LOCAL_MIN_HOURS:
        return None

    business_days = _business_days_between(pivot_time, sweep_time)

    # Major requires BOTH:
    #   - business-day age >= 3 (Mon-Fri only counted)
    #   - valid pivot structure (extreme on chart)
    #   - age <= 8 calendar weeks
    if (
        is_valid_pivot
        and business_days >= config.LIQUIDITY_MAJOR_MIN_DAYS
        and weeks <= config.LIQUIDITY_MAJOR_MAX_WEEKS
    ):
        return "Major"

    # Local: 3h <= age <= 3 calendar days, OR older but no extreme structure (and not expired)
    if days <= config.LIQUIDITY_LOCAL_MAX_DAYS:
        return "Local"
    if weeks <= config.LIQUIDITY_MAJOR_MAX_WEEKS:
        return "Local"  # old but internal — stays Local per spec
    return None  # expired


def _make_event(df: pd.DataFrame, sweep_idx: int, sweep_time, direction: str,
                level: float, pivot_idx: int, liquidity_type: str) -> SweepEvent:
    candle = df.iloc[sweep_idx]
    kind = _classify_sweep_kind(candle, level, direction)
    # v0.6: for HOD/LOD the level IS the exact overnight extreme (wick) — draw
    # the line right at that price (institutions target the precise high/low).
    display_price = float(level)
    return SweepEvent(
        sweep_idx=sweep_idx,
        sweep_time=sweep_time,
        direction=direction,
        swept_price=level,
        display_price=display_price,
        pivot_idx=pivot_idx,
        pivot_time=df.index[pivot_idx],
        age=sweep_time - df.index[pivot_idx],
        liquidity_type=liquidity_type,
        sweep_kind=kind,
        additional_liquidity=None,
    )


def _annotate_additional_liquidity(events: list[SweepEvent]) -> list[SweepEvent]:
    """If two sweeps of DIFFERENT classes happen within ±2 candles, mark each as
    having `additional_liquidity` = the OTHER's class."""
    if len(events) < 2:
        return events
    # Sort by sweep_idx
    events_sorted = sorted(events, key=lambda e: e.sweep_idx)
    for i, e in enumerate(events_sorted):
        for j in range(max(0, i - 3), min(len(events_sorted), i + 4)):
            if i == j:
                continue
            other = events_sorted[j]
            if abs(other.sweep_idx - e.sweep_idx) <= 2 and other.liquidity_type != e.liquidity_type:
                # take whichever is "stronger" (Major > HOD/LOD > Local)
                e.additional_liquidity = other.liquidity_type
                break
    return events_sorted


def format_age(td: pd.Timedelta) -> str:
    """Format a Timedelta as '20h52m', '4d32m', '3h47m', etc. — matches log style."""
    total_minutes = int(td.total_seconds() // 60)
    days, rem = divmod(total_minutes, 60 * 24)
    hours, minutes = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours or days:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return "".join(parts)
