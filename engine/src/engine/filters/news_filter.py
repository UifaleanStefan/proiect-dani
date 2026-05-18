"""News filter — placeholder until investing.com scraper is wired up.

Currently uses a JSON file with a list of events:
    [{"datetime_local": "2026-04-15T15:30", "name": "US CPI", "category": "cpi"}]

Categories in ALL_DAY_HIGH_NEWS_CATEGORIES (config) taint the entire trading day.
Other "high impact" events only taint trades within ±NEWS_WINDOW_MINUTES.
"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pandas as pd

from .. import config


def load_news(path: str | Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as f:
        events = json.load(f)
    # Parse datetimes to tz-aware
    for e in events:
        dt = pd.Timestamp(e["datetime_local"])
        if dt.tz is None:
            dt = dt.tz_localize(config.TIMEZONE)
        e["_dt"] = dt
    return events


def label_news(news: list[dict], trade_time: pd.Timestamp) -> str:
    """Return the news label for a given trade time, or 'None'.

    Logic:
      - If any all-day-high event happens on the same calendar day → return its name.
      - Else if a window-high event is within ±30 min → return its name.
      - Else "None".
    """
    if not news:
        return "None"

    local = trade_time.tz_convert(config.TIMEZONE) if trade_time.tz else trade_time
    trade_date = local.date()

    # All-day-high check
    for e in news:
        if e.get("category") in config.ALL_DAY_HIGH_NEWS_CATEGORIES:
            if e["_dt"].date() == trade_date:
                return e["name"]

    # Window-high check
    window = timedelta(minutes=config.NEWS_WINDOW_MINUTES)
    for e in news:
        if e.get("category") in config.ALL_DAY_HIGH_NEWS_CATEGORIES:
            continue  # already checked
        diff = abs((local - e["_dt"]).total_seconds())
        if diff <= window.total_seconds():
            return e["name"]

    return "None"
