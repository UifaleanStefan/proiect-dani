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

from dataclasses import dataclass

import pandas as pd

from .. import config
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
    sweep_time = disp.sweep.sweep_time

    # --- Determine SL price ---
    sl_price = _compute_sl(df, disp)
    if sl_price is None:
        return None
    risk = abs(entry_price - sl_price)
    if risk < 0.5:  # too tight to be meaningful
        return None

    # --- Compute TP at fixed 1:2 RR ---
    if direction == "buy":
        tp_price = entry_price + config.TP_RR_RATIO * risk
    else:
        tp_price = entry_price - config.TP_RR_RATIO * risk

    # --- Find entry trigger with 60-minute timeout ---
    entry_idx = _find_entry(df, setup, direction)
    if entry_idx is None:
        return None

    entry_time = df.index[entry_idx]
    gap_complete_time = df.index[setup.entry_idx_hint]
    gapfill_td = entry_time - gap_complete_time
    timeout = pd.Timedelta(minutes=config.GAP_ENTRY_TIMEOUT_MINUTES)
    if gapfill_td > timeout:
        # Strategy rule: skip if gap not entered within 60 min
        return None

    setup_time_td = gap_complete_time - sweep_time

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


def _compute_sl(df: pd.DataFrame, disp) -> float | None:
    """v0.5: SL = touched liquidity level +/- buffer.

    If price touches an upper liquidity at P (and we go short), SL = P + buffer.
    If price touches a lower liquidity at P (and we go long), SL = P - buffer.
    This guarantees that if the level is re-liquidated, we're out cleanly.
    """
    touch = disp.sweep
    buffer = config.SL_BUFFER_POINTS
    if disp.direction == "buy":
        return float(touch.swept_price) - buffer
    return float(touch.swept_price) + buffer


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
