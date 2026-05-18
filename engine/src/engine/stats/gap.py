"""Gap-fill % at trade exit time."""

from __future__ import annotations

import pandas as pd

from ..detectors.fvg import Gap


def fill_pct(df: pd.DataFrame, gap: Gap, exit_idx: int, direction: str) -> str:
    """How much of the gap zone has been traversed by `exit_idx`?

    A gap is "100% filled" when price has moved through the entire gap zone
    in the corrective direction. Can exceed 100% if price overshoots.

    For a Buy trade entered in a Bullish gap: fill happens when price moves UP
    out of the gap (away from c1.high boundary, into c3.low and beyond).

    Wait — the typical interpretation: a Bullish FVG is created when price
    moved UP fast leaving an unfilled zone above c1.high. "Filling" that gap
    happens when price comes BACK DOWN through the zone. So for a Buy trade,
    we entered at the midpoint AS price was filling — the filled% measures
    how DEEP into the gap (back toward c1.high) the price went before exit.
    """
    end_window = df.iloc[gap.c3_idx : exit_idx + 1]
    if len(end_window) == 0:
        return "0%"

    if direction == "buy":
        # Bullish gap (c1.high < c3.low). Entry midpoint is between them.
        # The "fill" is how DEEP the lowest low went into the gap.
        deepest = float(end_window["low"].min())
        # Map to fraction: at gap.top no fill, at gap.bottom 100% fill, below = >100%
        if gap.top == gap.bottom:
            return "100%"
        filled_frac = (gap.top - deepest) / gap.size_points
    else:
        # Bearish gap (c1.low > c3.high). Trade is short, entry at midpoint.
        # Fill = how HIGH the highest high went (toward c1.low / above gap.top).
        highest = float(end_window["high"].max())
        filled_frac = (highest - gap.bottom) / gap.size_points

    pct = max(0.0, filled_frac) * 100
    if pct >= 200:
        return "200%+"
    return f"{pct:.0f}%"
