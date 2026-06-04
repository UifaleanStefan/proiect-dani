"""Fair Value Gap / Simple Gap detector.

A 3-candle gap between candles C1, C2, C3:
    - Bullish gap: C1.high < C3.low  -> gap zone = [C1.high, C3.low]
    - Bearish gap: C1.low > C3.high  -> gap zone = [C3.high, C1.low]

When the middle candle C2 is INSIDE a displacement window, the gap is an FVG.
Otherwise it's a "Simple Gap".

For setup classification we usually only care about gaps inside the
displacement (the displacement-anchored impulse).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .. import config
from .displacement import Displacement


@dataclass
class Gap:
    """A 3-candle gap (FVG or simple)."""
    c1_idx: int                # candle BEFORE the gap
    c2_idx: int                # the candle whose strong move created the gap
    c3_idx: int                # candle AFTER the gap
    direction: str             # "bullish" (price moved up) or "bearish"
    top: float                 # upper boundary of the gap zone
    bottom: float              # lower boundary
    size_points: float         # top - bottom
    midpoint: float            # (top + bottom) / 2 — used as entry price
    c2_is_green: bool          # True if c2 is bullish (close > open)
    in_displacement: bool      # True if c2 is inside a displacement
    consecutive_to_prev: bool  # True if there is another gap on c1_idx-1..c1_idx+1


def find_gaps_in(df: pd.DataFrame, disp: Displacement) -> list[Gap]:
    """Return all gaps whose middle candle is inside [disp.start_idx, disp.end_idx],
    AND whose direction + c2 candle color matches the trade direction.

    Strategy rule:
      - Buy/long → execute in BULLISH gaps formed on a GREEN c2 candle
      - Sell/short → execute in BEARISH gaps formed on a RED c2 candle
    """
    gaps: list[Gap] = []
    for c2 in range(max(1, disp.start_idx), min(len(df) - 1, disp.end_idx + 1)):
        gap = _detect_gap(df, c2, in_displacement=True)
        if gap is None:
            continue
        # v0.7: minimum FVG size — gaps smaller than this are not tradeable
        if gap.size_points < config.MIN_FVG_SIZE_POINTS:
            continue
        # Direction match: gap direction + c2 color must align with trade
        if disp.direction == "buy":
            if gap.direction != "bullish" or not gap.c2_is_green:
                continue
        else:  # sell
            if gap.direction != "bearish" or gap.c2_is_green:
                continue
        gaps.append(gap)

    # Mark consecutiveness — two gaps are "consecutive" if their c2 indices are adjacent
    if gaps:
        c2_set = {g.c2_idx for g in gaps}
        for g in gaps:
            g.consecutive_to_prev = (g.c2_idx - 1) in c2_set
    return gaps


def find_simple_gaps(df: pd.DataFrame, start_idx: int, end_idx: int) -> list[Gap]:
    """Return gaps in [start_idx, end_idx] whose c2 is NOT inside a displacement.

    Used for SLG detection (mini-sweep gap before a real displacement).
    """
    gaps: list[Gap] = []
    for c2 in range(max(1, start_idx), min(len(df) - 1, end_idx + 1)):
        gap = _detect_gap(df, c2, in_displacement=False)
        if gap:
            gaps.append(gap)
    return gaps


def _detect_gap(df: pd.DataFrame, c2_idx: int, *, in_displacement: bool) -> Gap | None:
    """Return a Gap if there's a 3-candle FVG centered on c2_idx, else None."""
    c1 = df.iloc[c2_idx - 1]
    c2 = df.iloc[c2_idx]
    c3 = df.iloc[c2_idx + 1]
    c2_is_green = bool(c2["close"] > c2["open"])

    # Bullish gap: c1.high < c3.low
    if c1["high"] < c3["low"]:
        top = float(c3["low"])
        bottom = float(c1["high"])
        size = top - bottom
        if size <= 0:
            return None
        return Gap(
            c1_idx=c2_idx - 1,
            c2_idx=c2_idx,
            c3_idx=c2_idx + 1,
            direction="bullish",
            top=top,
            bottom=bottom,
            size_points=size,
            midpoint=(top + bottom) / 2.0,
            c2_is_green=c2_is_green,
            in_displacement=in_displacement,
            consecutive_to_prev=False,  # set later
        )

    # Bearish gap: c1.low > c3.high
    if c1["low"] > c3["high"]:
        top = float(c1["low"])
        bottom = float(c3["high"])
        size = top - bottom
        if size <= 0:
            return None
        return Gap(
            c1_idx=c2_idx - 1,
            c2_idx=c2_idx,
            c3_idx=c2_idx + 1,
            direction="bearish",
            top=top,
            bottom=bottom,
            size_points=size,
            midpoint=(top + bottom) / 2.0,
            c2_is_green=c2_is_green,
            in_displacement=in_displacement,
            consecutive_to_prev=False,
        )

    return None
