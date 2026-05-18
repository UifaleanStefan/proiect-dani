"""Relative volume vs same-slot median over last N days."""

from __future__ import annotations

import pandas as pd

from .. import config


def compute(df: pd.DataFrame, entry_time: pd.Timestamp,
            lookback_days: int | None = None,
            window_minutes: int = 5) -> str:
    """Compare last `window_minutes` minutes of TICKVOL up to entry_time
    against the median TICKVOL for the same minute-of-day slot over the last
    N trading days.

    Returns string like '1.85' (1.85x normal) or '—' if no data.
    """
    lookback_days = lookback_days or config.RVOL_LOOKBACK_DAYS

    entry_local = entry_time.tz_convert(config.TIMEZONE)
    minute_of_day = entry_local.hour * 60 + entry_local.minute

    # Current 5-min window TICKVOL (use TICKVOL for off-hours coverage)
    cur_start = entry_time - pd.Timedelta(minutes=window_minutes)
    cur_window = df.loc[(df.index > cur_start) & (df.index <= entry_time)]
    if len(cur_window) == 0:
        return "—"
    cur_vol = float(cur_window["tickvol"].sum())
    if cur_vol <= 0:
        return "—"

    # Lookback windows: same time-of-day slot for past N days
    today = pd.Timestamp(entry_local.date(), tz=config.TIMEZONE)
    past_vols = []
    for d in range(1, lookback_days + 1):
        slot_end = today - pd.Timedelta(days=d) + pd.Timedelta(minutes=minute_of_day)
        slot_start = slot_end - pd.Timedelta(minutes=window_minutes)
        past = df.loc[(df.index > slot_start) & (df.index <= slot_end)]
        if len(past) == 0:
            continue
        past_vols.append(float(past["tickvol"].sum()))

    if not past_vols:
        return "—"
    past_series = pd.Series(past_vols)
    median = float(past_series.median())
    if median <= 0:
        return "—"

    return f"{cur_vol / median:.2f}"
