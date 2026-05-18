"""Volatility stat: current-day range vs the median of last N days."""

from __future__ import annotations

import pandas as pd

from .. import config


def compute(df: pd.DataFrame, entry_time: pd.Timestamp,
            lookback_days: int | None = None) -> str:
    """Return e.g. '1.34x' meaning current day's range is 134% of the lookback median."""
    lookback_days = lookback_days or config.VOLATILITY_LOOKBACK_DAYS

    entry_local = entry_time.tz_convert(config.TIMEZONE)
    today = pd.Timestamp(entry_local.date(), tz=config.TIMEZONE)
    today_end = today + pd.Timedelta(days=1)

    # Today's range up to entry
    today_window = df.loc[(df.index >= today) & (df.index <= entry_time)]
    if len(today_window) == 0:
        return "—"
    today_range = float(today_window["high"].max() - today_window["low"].min())

    # Previous N full days (excluding today)
    lookback_start = today - pd.Timedelta(days=lookback_days)
    lookback = df.loc[(df.index >= lookback_start) & (df.index < today)]
    if len(lookback) == 0:
        return "—"
    daily = lookback.groupby(lookback.index.date).agg(
        high=("high", "max"), low=("low", "min")
    )
    daily["range"] = daily["high"] - daily["low"]
    median_range = float(daily["range"].median())
    if median_range <= 0:
        return "—"

    ratio = today_range / median_range
    return f"{ratio:.2f}x"
