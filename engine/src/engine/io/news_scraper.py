"""investing.com economic-calendar scraper.

Hits the AJAX endpoint that powers the calendar UI:

    POST https://www.investing.com/economic-calendar/Service/getCalendarFilteredData
    Form data:
        country[]=5            (USA)
        country[]=4            (Germany)
        country[]=72           (Eurozone)
        importance[]=3         (high impact only)
        timeFilter=timeRemain
        currentTab=<thisWeek|nextWeek|lastWeek|...>
        limit_from=0

The response is JSON: { "data": "<html>", "rows_num": int, ... }. We parse
the HTML table rows with BeautifulSoup.

If the request is blocked (CF challenge, 403, etc.), we fall back gracefully —
the existing news_cache.json keeps working, and the run prints a warning.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from .. import config


_ENDPOINT = "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData"
_REFERER = "https://www.investing.com/economic-calendar/"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
_ACCEPT_LANG = "en-US,en;q=0.9"

_REQUEST_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": _ACCEPT_LANG,
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://www.investing.com",
    "Referer": _REFERER,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}

# Country codes used by investing.com filter
_COUNTRY_CODES = {
    "US": 5,    # United States
    "DE": 4,    # Germany
    "EU": 72,   # Eurozone
    "GB": 4,    # United Kingdom (also gives EUR-impactful events)
}


@dataclass
class NewsEvent:
    """Normalized news event."""
    datetime_local: datetime  # Europe/Bucharest
    name: str
    category: str             # "cpi" | "nfp" | "fomc" | "bank_holiday" | "high"
    country: str
    impact: str               # "high"

    def to_dict(self) -> dict:
        return {
            "datetime_local": self.datetime_local.strftime("%Y-%m-%dT%H:%M"),
            "name": self.name,
            "category": self.category,
            "country": self.country,
            "impact": self.impact,
        }


# -----------------------------------------------------------------------------
# Categorization
# -----------------------------------------------------------------------------


_CAT_PATTERNS = [
    ("cpi", re.compile(r"\b(CPI|Consumer Price|Inflation Rate)\b", re.IGNORECASE)),
    ("nfp", re.compile(r"\b(Nonfarm|Non-Farm|NFP|Employment Change)\b", re.IGNORECASE)),
    ("fomc", re.compile(r"\b(FOMC|Fed (?:Interest )?Rate|Fed Chair|Powell Speaks|Federal Reserve)\b", re.IGNORECASE)),
    ("bank_holiday", re.compile(r"\b(Bank Holiday|Holiday)\b", re.IGNORECASE)),
]


def categorize(name: str) -> str:
    for cat, pat in _CAT_PATTERNS:
        if pat.search(name):
            return cat
    return "high"


# -----------------------------------------------------------------------------
# HTTP fetch
# -----------------------------------------------------------------------------


def _build_form_data(time_zone: int = 21, current_tab: str = "thisWeek",
                     countries: tuple[str, ...] = ("US", "DE", "EU"),
                     date_from: str | None = None, date_to: str | None = None) -> dict:
    """Build the POST body. time_zone=21 -> Bucharest (UTC+2/+3).

    For custom date ranges set current_tab='custom' and provide date_from/date_to.
    """
    data = []
    for c in countries:
        if c in _COUNTRY_CODES:
            data.append(("country[]", str(_COUNTRY_CODES[c])))
    data.append(("importance[]", "3"))   # high impact only
    data.append(("timeZone", str(time_zone)))
    data.append(("timeFilter", "timeRemain"))
    if current_tab == "custom" and date_from and date_to:
        data.append(("currentTab", "custom"))
        data.append(("dateFrom", date_from))
        data.append(("dateTo", date_to))
    else:
        data.append(("currentTab", current_tab))
    data.append(("limit_from", "0"))
    return data


def _fetch_one(session: requests.Session, form_data: list[tuple[str, str]],
               timeout: int = 20) -> str | None:
    """POST and return the embedded HTML, or None if blocked."""
    try:
        r = session.post(_ENDPOINT, data=form_data, headers=_REQUEST_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        print(f"      [scraper] request error: {e}")
        return None
    if r.status_code != 200:
        print(f"      [scraper] HTTP {r.status_code} (likely blocked by Cloudflare)")
        return None
    try:
        payload = r.json()
    except ValueError:
        print(f"      [scraper] non-JSON response (likely a CF challenge page)")
        return None
    return payload.get("data", "")


# -----------------------------------------------------------------------------
# HTML parsing
# -----------------------------------------------------------------------------


def parse_rows(html: str) -> list[NewsEvent]:
    """Parse the HTML row fragment from getCalendarFilteredData."""
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    events: list[NewsEvent] = []

    for tr in soup.find_all("tr", {"data-event-datetime": True}):
        try:
            dt_str = tr.get("data-event-datetime")  # e.g. "2025/01/14 13:30:00"
            if not dt_str:
                continue
            # investing.com returns timestamps in the requested timeZone (we set 21 = Bucharest)
            dt = datetime.strptime(dt_str, "%Y/%m/%d %H:%M:%S")

            # Country flag / currency
            flag_cell = tr.find("td", class_="flagCur")
            country_code = ""
            if flag_cell and flag_cell.find("span"):
                title = flag_cell.find("span").get("title", "")
                country_code = _country_code_from_title(title)

            # Event name
            event_a = tr.find("td", class_="event")
            event_name = ""
            if event_a:
                a = event_a.find("a")
                event_name = a.text.strip() if a else event_a.text.strip()
                event_name = re.sub(r"\s+", " ", event_name)
            if not event_name:
                continue

            # Importance: 3 bull icons present
            sentiment = tr.find("td", class_="sentiment")
            n_bulls = len(sentiment.find_all("i", class_="grayFullBullishIcon")) if sentiment else 3
            if n_bulls < 3:
                continue  # only keep high impact

            events.append(NewsEvent(
                datetime_local=dt,
                name=event_name,
                category=categorize(event_name),
                country=country_code,
                impact="high",
            ))
        except Exception as e:
            print(f"      [scraper] row parse error: {e}")
            continue
    return events


def _country_code_from_title(title: str) -> str:
    title = title.strip().lower()
    return {
        "united states": "US",
        "germany": "DE",
        "euro zone": "EU",
        "european monetary union": "EU",
        "united kingdom": "GB",
    }.get(title, title[:2].upper())


# -----------------------------------------------------------------------------
# High-level: scrape a date window
# -----------------------------------------------------------------------------


def scrape_window(date_from: datetime, date_to: datetime,
                  countries: tuple[str, ...] = ("US", "DE", "EU"),
                  *, throttle_seconds: float = 1.5,
                  step_days: int = 7) -> list[NewsEvent]:
    """Walk [date_from..date_to] in step_days chunks, scraping each.

    Returns a deduplicated list.
    """
    session = requests.Session()
    # Prime the session by hitting the calendar page first (to set CF cookies)
    try:
        session.get(_REFERER, headers={"User-Agent": _USER_AGENT,
                                       "Accept-Language": _ACCEPT_LANG}, timeout=15)
    except requests.RequestException:
        pass

    all_events: list[NewsEvent] = []
    cur = date_from
    n_chunks = 0
    while cur <= date_to:
        chunk_end = min(cur + timedelta(days=step_days - 1), date_to)
        form = _build_form_data(
            current_tab="custom",
            countries=countries,
            date_from=cur.strftime("%Y-%m-%d"),
            date_to=chunk_end.strftime("%Y-%m-%d"),
        )
        n_chunks += 1
        html = _fetch_one(session, form)
        events = parse_rows(html or "")
        all_events.extend(events)
        print(f"      [scraper] {cur.date()}..{chunk_end.date()}: {len(events)} events")
        cur = chunk_end + timedelta(days=1)
        time.sleep(throttle_seconds)
    if not all_events:
        print(f"      [scraper] WARNING: 0 events from {n_chunks} requests "
              f"(likely blocked by Cloudflare). Existing news_cache.json untouched.")
    return _dedupe(all_events)


def _dedupe(events: list[NewsEvent]) -> list[NewsEvent]:
    seen: set[tuple[str, str]] = set()
    out: list[NewsEvent] = []
    for e in events:
        key = (e.datetime_local.isoformat(), e.name)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    out.sort(key=lambda e: e.datetime_local)
    return out


# -----------------------------------------------------------------------------
# Cache merge
# -----------------------------------------------------------------------------


def merge_with_cache(events: list[NewsEvent], cache_path: str | Path) -> int:
    """Merge new events into the existing JSON cache. Returns # added."""
    p = Path(cache_path)
    existing: list[dict] = []
    if p.exists():
        try:
            with p.open(encoding="utf-8") as f:
                existing = json.load(f)
        except (json.JSONDecodeError, OSError):
            existing = []

    seen_keys: set[tuple[str, str]] = {(e["datetime_local"], e["name"]) for e in existing}
    added = 0
    for ev in events:
        key = (ev.datetime_local.strftime("%Y-%m-%dT%H:%M"), ev.name)
        if key in seen_keys:
            continue
        existing.append(ev.to_dict())
        seen_keys.add(key)
        added += 1

    # Sort by datetime
    existing.sort(key=lambda d: d["datetime_local"])

    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    return added
