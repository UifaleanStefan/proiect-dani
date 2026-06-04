"""Trade simulation: from a Setup to a final outcome (Win/Loss/Break Even).

Entry rule:
    The entry triggers when price returns to the gap midpoint AFTER the gap
    forms (c3_idx). For a Buy setup the entry triggers when low <= midpoint;
    for a Sell setup when high >= midpoint.
    If the price doesn't enter within GAP_ENTRY_TIMEOUT_MINUTES, the trade
    is skipped (returns None).

Stop loss:
    Placed beyond the last RELEVANT swing high/low pre-displacement, with a
    SL_BUFFER_POINTS buffer so a re-liquidation doesn't immediately stop us out.

Take profit:
    Fixed 2:1 RR. TP = entry + 2*risk for Buy / entry - 2*risk for Sell.

Break-even rule:
    When floating profit reaches 1.4 * risk, SL moves to entry. After that,
    outcome can only be Win (TP hit) or Break Even (price returns to entry).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from .. import config
from ..detectors import mss as mss_mod
from ..detectors.setup_classifier import Setup


@dataclass
class TradeOutcome:
    setup: Setup
    direction: str                 # "buy" or "sell"
    entry_price: float
    sl_price: float
    tp_price: float
    risk_points: float
    entry_idx: int                 # candle where entry triggered
    entry_time: pd.Timestamp
    exit_idx: int                  # candle where TP/SL/BE was hit
    exit_time: pd.Timestamp
    exit_price: float
    result: str                    # "Win" / "Loss" / "Break Even" / "Open"
    sl_points: float               # |entry - initial_sl| (for output schema)
    be_armed: bool                 # whether SL got moved to entry
    return_pct: float              # +2.0 / -1.0 / 0.0 / None for Open
    setup_time_td: pd.Timedelta    # sweep_time -> setup formed (gap completes)
    gapfill_time_td: pd.Timedelta  # gap_complete_time -> price entered the gap

    @property
    def duration(self) -> pd.Timedelta:
        return self.exit_time - self.entry_time


def simulate(df: pd.DataFrame, setup: Setup) -> TradeOutcome | None:
    """Simulate a trade from setup → exit. Returns None if entry never triggers
    within GAP_ENTRY_TIMEOUT_MINUTES."""
    direction = setup.displacement.direction
    entry_price = setup.entry_price
    disp = setup.displacement
    touch = disp.sweep
    sweep_time = touch.sweep_time

    # --- 1. Find entry trigger with 60-minute gap-fill timeout ---
    entry_idx = _find_entry(df, setup, direction)
    if entry_idx is None:
        return None
    entry_time = df.index[entry_idx]
    gap_complete_time = df.index[setup.entry_idx_hint]
    gapfill_td = entry_time - gap_complete_time
    timeout = pd.Timedelta(minutes=config.GAP_ENTRY_TIMEOUT_MINUTES)
    if gapfill_td > timeout:
        return None
    setup_time_td = gap_complete_time - sweep_time

    # --- 2. MSS must form in [touch, entry] (any order vs FVG, before execution) ---
    mss = mss_mod.find_last_mss_in_range(df, touch, end_idx=entry_idx)
    if mss is None:
        return None
    setup.mss = mss

    # --- 3. SL = protective extreme between touch and entry, +/- buffer ---
    sl_price = _compute_sl(df, touch.sweep_idx, entry_idx, direction)
    if sl_price is None:
        return None
    risk = abs(entry_price - sl_price)

    # --- 4. Dynamic SL size band (scaled with price); skip if out of band ---
    lo, hi = _sl_bounds(entry_price)
    if risk < lo or risk > hi:
        return None

    # --- 5. Compute TP at fixed 1:2 RR ---
    if direction == "buy":
        tp_price = entry_price + config.TP_RR_RATIO * risk
    else:
        tp_price = entry_price - config.TP_RR_RATIO * risk

    # --- Walk forward and detect TP / BE / SL ---
    n = len(df)
    state = "open"
    cur_sl = sl_price
    be_threshold = config.BE_RR_TRIGGER * risk

    for j in range(entry_idx + 1, n):
        c = df.iloc[j]

        if direction == "buy":
            if c["high"] >= tp_price:
                return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                              entry_idx, entry_time, j, df.index[j], tp_price, "Win",
                              state == "be_armed", config.WIN_PCT,
                              setup_time_td, gapfill_td)
            if c["low"] <= cur_sl:
                if state == "be_armed":
                    return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                                  entry_idx, entry_time, j, df.index[j], cur_sl, "Break Even",
                                  True, config.BE_PCT, setup_time_td, gapfill_td)
                return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                              entry_idx, entry_time, j, df.index[j], cur_sl, "Loss",
                              False, config.LOSS_PCT, setup_time_td, gapfill_td)
            if state == "open" and (c["high"] - entry_price) >= be_threshold:
                state = "be_armed"
                cur_sl = entry_price
        else:  # sell
            if c["low"] <= tp_price:
                return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                              entry_idx, entry_time, j, df.index[j], tp_price, "Win",
                              state == "be_armed", config.WIN_PCT,
                              setup_time_td, gapfill_td)
            if c["high"] >= cur_sl:
                if state == "be_armed":
                    return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                                  entry_idx, entry_time, j, df.index[j], cur_sl, "Break Even",
                                  True, config.BE_PCT, setup_time_td, gapfill_td)
                return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                              entry_idx, entry_time, j, df.index[j], cur_sl, "Loss",
                              False, config.LOSS_PCT, setup_time_td, gapfill_td)
            if state == "open" and (entry_price - c["low"]) >= be_threshold:
                state = "be_armed"
                cur_sl = entry_price

    last_idx = n - 1
    return _build(setup, direction, entry_price, sl_price, tp_price, risk,
                  entry_idx, entry_time, last_idx, df.index[last_idx],
                  float(df.iloc[last_idx]["close"]), "Open",
                  state == "be_armed", 0.0, setup_time_td, gapfill_td)


def _compute_sl(df: pd.DataFrame, touch_idx: int, entry_idx: int,
                direction: str) -> float | None:
    """v0.7: SL placed at the protective extreme between the touch and the entry,
    plus the buffer.

    - sell: SL = max(high in [touch_idx, entry_idx]) + buffer
    - buy:  SL = min(low  in [touch_idx, entry_idx]) - buffer

    This guarantees that if the move's extreme is re-tested, we're out cleanly.
    """
    buffer = config.SL_BUFFER_POINTS
    lo = min(touch_idx, entry_idx)
    hi = max(touch_idx, entry_idx)
    window = df.iloc[lo : hi + 1]
    if len(window) == 0:
        return None
    if direction == "sell":
        return float(window["high"].max()) + buffer
    return float(window["low"].min()) - buffer


def _sl_bounds(price: float) -> tuple[float, float]:
    """v0.7: dynamic SL size band scaled with price.

    ref = floor(price / SL_QUANTIZE_STEP) * SL_QUANTIZE_STEP  (recompute each 1000 move)
    X   = ref / SL_REF_PRICE
    returns (X * SL_MIN_AT_REF, X * SL_MAX_AT_REF)
    At price 15000 -> (10, 35). At 24000 -> (16, 56).
    """
    ref = math.floor(price / config.SL_QUANTIZE_STEP) * config.SL_QUANTIZE_STEP
    if ref <= 0:
        ref = config.SL_QUANTIZE_STEP
    x = ref / config.SL_REF_PRICE
    return x * config.SL_MIN_AT_REF, x * config.SL_MAX_AT_REF


def _find_entry(df: pd.DataFrame, setup: Setup, direction: str) -> int | None:
    """Find the first candle AFTER the gap completes where price hits the entry midpoint."""
    entry = setup.entry_price
    start = setup.entry_idx_hint
    n = len(df)
    # We allow up to GAP_ENTRY_TIMEOUT_MINUTES + a bit; the actual deadline is
    # enforced again in simulate() against wall-clock time.
    end = min(n, start + config.GAP_ENTRY_TIMEOUT_MINUTES + 5)
    for j in range(start, end):
        c = df.iloc[j]
        if direction == "buy":
            if c["low"] <= entry:
                return j
        else:
            if c["high"] >= entry:
                return j
    return None


def _build(setup, direction, entry_price, sl_price, tp_price, risk,
           entry_idx, entry_time, exit_idx, exit_time, exit_price,
           result, be_armed, return_pct, setup_time_td, gapfill_td):
    return TradeOutcome(
        setup=setup,
        direction=direction,
        entry_price=float(entry_price),
        sl_price=float(sl_price),
        tp_price=float(tp_price),
        risk_points=float(risk),
        entry_idx=int(entry_idx),
        entry_time=entry_time,
        exit_idx=int(exit_idx),
        exit_time=exit_time,
        exit_price=float(exit_price),
        result=result,
        sl_points=float(abs(entry_price - sl_price)),
        be_armed=bool(be_armed),
        return_pct=float(return_pct),
        setup_time_td=setup_time_td,
        gapfill_time_td=gapfill_td,
    )
