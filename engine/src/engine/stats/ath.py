"""Distance from rolling all-time-high / all-time-low at entry time."""

from __future__ import annotations

import pandas as pd


def distance(df: pd.DataFrame, entry_time: pd.Timestamp, entry_price: float,
             direction: str) -> str:
    """Return signed pct distance from rolling ATH (for Buy) or ALL (for Sell).

    Format: '-1.41%' (negative = entry below ATH for Buy / above ALL for Sell).
    """
    history = df.loc[df.index <= entry_time]
    if len(history) == 0:
        return "—"

    if direction == "buy":
        ath = float(history["high"].max())
        if ath <= 0:
            return "—"
        pct = (entry_price - ath) / ath * 100
    else:
        all_low = float(history["low"].min())
        if all_low <= 0:
            return "—"
        pct = (all_low - entry_price) / all_low * 100

    return f"{pct:+.2f}%"
