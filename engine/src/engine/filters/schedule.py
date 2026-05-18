"""Trading-hours filter: 10:15-16:15 + 16:45-22:30 Europe/Bucharest."""

from __future__ import annotations

import pandas as pd

from .. import config


def _to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


_TRADING_WINDOWS_MINUTES = [
    (_to_minutes(start), _to_minutes(end))
    for start, end in config.TRADING_WINDOWS
]


def is_in_trading_hours(ts: pd.Timestamp) -> bool:
    """True if the timestamp's local-time falls inside any trading window."""
    local = ts.tz_convert(config.TIMEZONE) if ts.tz is not None else ts
    minutes = local.hour * 60 + local.minute
    for start, end in _TRADING_WINDOWS_MINUTES:
        if start <= minutes <= end:
            return True
    return False


def label_session(ts: pd.Timestamp) -> str:
    """Return 'London' or 'New York' based on local time. Used for output."""
    local = ts.tz_convert(config.TIMEZONE) if ts.tz is not None else ts
    minutes = local.hour * 60 + local.minute
    london_start = _to_minutes(config.SESSION_BOUNDS["London"][0])
    london_end = _to_minutes(config.SESSION_BOUNDS["London"][1])
    if london_start <= minutes < london_end:
        return "London"
    return "New York"
