"""Swing high/low detection — shared helper for liquidity and MSS detectors.

A swing high at index i is a candle whose `high` is strictly greater than the
high of the SWING_LOOKBACK candles before AND after it. (We use strict > on
both sides; equal-highs do not form valid pivots.)

Swing lows are the mirror.

For MSS we additionally need a "valid swing": one with at least
MSS_VALID_GREEN_COUNT green and MSS_VALID_RED_COUNT red candles in the
MSS_VALID_WINDOW around it (each side, not necessarily consecutive).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import config


def annotate_swings(df: pd.DataFrame, lookback: int | None = None) -> pd.DataFrame:
    """Return df with two extra columns: `swing_high`, `swing_low` (bool).

    A pivot is set on the index of the candle that IS the high/low.
    Note: detection is causal-with-lookahead — the pivot at index i can only be
    confirmed at index i+lookback.
    """
    lookback = lookback or config.SWING_LOOKBACK
    out = df.copy()

    # Use rolling max/min over a window of (2*lookback+1) centered on each candle.
    # A swing high at i means df.high[i] equals the rolling max AND is strictly
    # greater than every other value in the window (so equal-highs don't count).
    window = 2 * lookback + 1
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()

    n = len(df)
    swing_high = np.zeros(n, dtype=bool)
    swing_low = np.zeros(n, dtype=bool)

    for i in range(lookback, n - lookback):
        win_h = high[i - lookback : i + lookback + 1]
        win_l = low[i - lookback : i + lookback + 1]
        if high[i] == win_h.max() and (win_h < high[i]).sum() == window - 1:
            swing_high[i] = True
        if low[i] == win_l.min() and (win_l > low[i]).sum() == window - 1:
            swing_low[i] = True

    out["swing_high"] = swing_high
    out["swing_low"] = swing_low
    return out


def annotate_valid_swings(df: pd.DataFrame) -> pd.DataFrame:
    """Mark swings that satisfy the MSS "wave" rule.

    A swing (high or low) is "valid" if within +/- MSS_VALID_WINDOW candles
    around it there are at least MSS_VALID_GREEN_COUNT green candles AND at
    least MSS_VALID_RED_COUNT red candles. Doji (close==open) count as neither.

    Adds boolean columns `valid_swing_high`, `valid_swing_low`.
    Requires `swing_high`, `swing_low` to be present (call annotate_swings first).
    """
    if "swing_high" not in df.columns or "swing_low" not in df.columns:
        df = annotate_swings(df)

    out = df.copy()
    is_green = (out["close"] > out["open"]).to_numpy()
    is_red = (out["close"] < out["open"]).to_numpy()
    n = len(out)
    w = config.MSS_VALID_WINDOW
    gmin = config.MSS_VALID_GREEN_COUNT
    rmin = config.MSS_VALID_RED_COUNT

    valid_h = np.zeros(n, dtype=bool)
    valid_l = np.zeros(n, dtype=bool)
    sh = out["swing_high"].to_numpy()
    sl = out["swing_low"].to_numpy()

    # Pre-compute prefix sums for O(1) range queries
    g_cum = np.concatenate([[0], is_green.cumsum()])
    r_cum = np.concatenate([[0], is_red.cumsum()])

    def count_in_window(cum: np.ndarray, lo: int, hi: int) -> int:
        return int(cum[hi + 1] - cum[lo])

    for i in range(n):
        if not (sh[i] or sl[i]):
            continue
        lo = max(0, i - w)
        hi = min(n - 1, i + w)
        g = count_in_window(g_cum, lo, hi)
        r = count_in_window(r_cum, lo, hi)
        if g >= gmin and r >= rmin:
            if sh[i]:
                valid_h[i] = True
            if sl[i]:
                valid_l[i] = True

    out["valid_swing_high"] = valid_h
    out["valid_swing_low"] = valid_l
    return out


def annotate_atr(df: pd.DataFrame, period: int | None = None) -> pd.DataFrame:
    """Add `atr` column using Wilder's smoothing on True Range."""
    period = period or config.ATR_PERIOD
    out = df.copy()
    high = out["high"]
    low = out["low"]
    close = out["close"]
    prev_close = close.shift(1)

    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    # Wilder smoothing == EMA with alpha = 1/period
    out["atr"] = tr.ewm(alpha=1.0 / period, adjust=False).mean()
    return out
