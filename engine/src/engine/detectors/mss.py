"""Market Structure Shift detector.

Definition (rule 4, with v0.4 correction):
    A high/low becomes "valid" when its surrounding window contains at least
    2 green and 2 red candles (not necessarily consecutive). After a liquidity
    sweep, the price must "depasi" (break) a recent VALID swing on the OPPOSITE
    side of the sweep direction. The break can be by:
        - Body (close beyond the level) -> mss = "Body"
        - Wick (only high/low touches beyond) -> mss = "Wick"

Per the v0.4 correction: when MULTIPLE MSS confirmations happen between the
sweep and the entry trigger, we take the LAST one chronologically (the most
recently broken structure), not the first. This better represents the
"current" structure shift that justifies the trade.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .. import config
from . import swings
from .liquidity import SweepEvent


@dataclass
class MSSEvent:
    """A confirmed Market Structure Shift after a sweep."""
    sweep: SweepEvent           # the sweep that preceded this MSS
    mss_idx: int                # candle index where MSS confirmed
    mss_time: pd.Timestamp
    mss_kind: str               # "Body" or "Wick"
    broken_swing_idx: int       # index of the valid swing that was broken
    broken_swing_price: float   # price level of that swing


def find_last_mss_in_range(
    df: pd.DataFrame, sweep: SweepEvent, end_idx: int
) -> MSSEvent | None:
    """Scan candles in (sweep_idx, end_idx] for ALL MSS confirmations and
    return the LAST one (highest index) found.

    A confirmation = a candle that breaks an unbroken valid swing on the
    OPPOSITE side of the sweep direction. As price moves, the "current
    unbroken" valid swing can change (deeper lows / higher highs form).
    """
    if "valid_swing_high" not in df.columns:
        df = swings.annotate_valid_swings(df)

    n = len(df)
    end = min(n, end_idx + 1)
    if sweep.direction == "sell":
        # SHORT trade — we look for breaks BELOW valid swing LOWS
        col = "valid_swing_low"
        side = "low"
    else:
        # LONG trade — breaks ABOVE valid swing HIGHS
        col = "valid_swing_high"
        side = "high"

    flags = df[col].to_numpy()
    last_mss: MSSEvent | None = None

    for j in range(sweep.sweep_idx + 1, end):
        # The "current target" = most recent valid swing on the opposite side
        # whose index is < j (i.e., already formed and confirmed by lookback).
        target_swing_idx = _last_valid_swing_before(flags, j)
        if target_swing_idx is None:
            continue

        target_price = float(df.iloc[target_swing_idx][side])
        candle = df.iloc[j]
        broke = False
        kind = ""
        if side == "low":
            if candle["close"] < target_price:
                broke, kind = True, "Body"
            elif candle["low"] < target_price:
                broke, kind = True, "Wick"
        else:
            if candle["close"] > target_price:
                broke, kind = True, "Body"
            elif candle["high"] > target_price:
                broke, kind = True, "Wick"

        if broke:
            last_mss = MSSEvent(
                sweep, j, df.index[j], kind, target_swing_idx, target_price
            )

    return last_mss


def find_mss_after(df: pd.DataFrame, sweep: SweepEvent) -> MSSEvent | None:
    """Legacy: returns the FIRST MSS confirmation. Kept for backward compat
    with old call sites. New code should use find_last_mss_in_range."""
    if "valid_swing_high" not in df.columns:
        df = swings.annotate_valid_swings(df)

    n = len(df)
    start = sweep.sweep_idx
    end = min(n, start + config.MSS_LOOKFORWARD_LIMIT + 1)

    if sweep.direction == "sell":
        target_swing_idx = _last_valid_swing_before(
            df["valid_swing_low"].to_numpy(), sweep.sweep_idx
        )
        if target_swing_idx is None:
            return None
        target_price = float(df.iloc[target_swing_idx]["low"])
        for j in range(start + 1, end):
            candle = df.iloc[j]
            if candle["close"] < target_price:
                return MSSEvent(sweep, j, df.index[j], "Body", target_swing_idx, target_price)
            if candle["low"] < target_price:
                return MSSEvent(sweep, j, df.index[j], "Wick", target_swing_idx, target_price)
    else:
        target_swing_idx = _last_valid_swing_before(
            df["valid_swing_high"].to_numpy(), sweep.sweep_idx
        )
        if target_swing_idx is None:
            return None
        target_price = float(df.iloc[target_swing_idx]["high"])
        for j in range(start + 1, end):
            candle = df.iloc[j]
            if candle["close"] > target_price:
                return MSSEvent(sweep, j, df.index[j], "Body", target_swing_idx, target_price)
            if candle["high"] > target_price:
                return MSSEvent(sweep, j, df.index[j], "Wick", target_swing_idx, target_price)

    return None


def _last_valid_swing_before(flags, idx: int) -> int | None:
    """Return the index of the most recent valid swing flagged True before `idx`."""
    for k in range(idx - 1, -1, -1):
        if flags[k]:
            return k
    return None
