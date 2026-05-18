"""Displacement detector.

A displacement is the impulsive price move that follows a liquidity sweep
(per v0.4 spec). It is formed by at least DISPLACEMENT_MIN_CANDLES "prominent"
candles in the trade direction. A candle is "prominent" if its range >=
ATR_multiplier * ATR.

We allow up to DISPLACEMENT_MAX_PAUSE non-prominent candles between prominent
ones to absorb minor pullbacks within the impulse.

v0.4 change: search starts FROM THE SWEEP (not from MSS) so the FIRST gaps
formed after liquidation can be detected even when MSS confirms later.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .. import config
from . import swings
from .liquidity import SweepEvent


@dataclass
class Displacement:
    """An impulsive price-move window after a sweep."""
    sweep: SweepEvent   # the sweep that triggered the search
    start_idx: int      # first prominent candle (inclusive)
    end_idx: int        # last prominent candle (inclusive)
    direction: str      # "buy" or "sell" (matches sweep.direction)
    candle_count: int   # number of prominent candles in the displacement
    high: float         # max high across the displacement
    low: float          # min low across the displacement


def find_displacement_after_sweep(
    df: pd.DataFrame, sweep: SweepEvent
) -> Displacement | None:
    """Look forward from sweep for the impulsive displacement window."""
    if "atr" not in df.columns:
        df = swings.annotate_atr(df)

    n = len(df)
    direction = sweep.direction
    start_search = sweep.sweep_idx
    end_search = min(n, start_search + config.DISPLACEMENT_LOOKFORWARD_LIMIT + 1)
    multiplier = config.DISPLACEMENT_ATR_MULTIPLIER
    min_candles = config.DISPLACEMENT_MIN_CANDLES
    max_pause = config.DISPLACEMENT_MAX_PAUSE

    prominent_streak: list[int] = []
    pause_count = 0
    first_prominent_idx: int | None = None

    for j in range(start_search, end_search):
        candle = df.iloc[j]
        rng = candle["high"] - candle["low"]
        atr = candle["atr"]
        if pd.isna(atr) or atr <= 0:
            continue
        threshold = multiplier * atr

        is_prominent = rng >= threshold
        is_correct_dir = (
            (direction == "sell" and candle["close"] < candle["open"])
            or (direction == "buy" and candle["close"] > candle["open"])
        )

        if is_prominent and is_correct_dir:
            if first_prominent_idx is None:
                first_prominent_idx = j
            prominent_streak.append(j)
            pause_count = 0
        else:
            if first_prominent_idx is None:
                continue
            pause_count += 1
            if pause_count > max_pause:
                if len(prominent_streak) >= min_candles:
                    return _build(df, sweep, prominent_streak)
                prominent_streak = []
                pause_count = 0
                first_prominent_idx = None

    if len(prominent_streak) >= min_candles:
        return _build(df, sweep, prominent_streak)
    return None


# Legacy alias for backward compat with old call sites that pass an MSS event
def find_displacement_after(df: pd.DataFrame, mss) -> Displacement | None:
    """Legacy: derives sweep from mss.sweep and calls find_displacement_after_sweep."""
    return find_displacement_after_sweep(df, mss.sweep)


def _build(df: pd.DataFrame, sweep: SweepEvent, streak: list[int]) -> Displacement:
    start = streak[0]
    end = streak[-1]
    window = df.iloc[start : end + 1]
    return Displacement(
        sweep=sweep,
        start_idx=start,
        end_idx=end,
        direction=sweep.direction,
        candle_count=len(streak),
        high=float(window["high"].max()),
        low=float(window["low"].min()),
    )
