"""Tests for the investing.com news scraper.

We don't hit the live API in tests — instead we feed a representative HTML
fragment to the parser and verify normalization + categorization.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json

import pytest

from engine.io import news_scraper as ns


SAMPLE_HTML = """
<tr id="eventRowId_456" data-event-datetime="2025/01/14 13:30:00" class="js-event-item">
  <td class="first left time js-time">13:30</td>
  <td class="left flagCur noWrap"><span title="United States" class="ceFlags US"></span> USD</td>
  <td class="left textNum sentiment noWrap" title="High Volatility Expected">
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
  </td>
  <td class="left event">
    <a href="/economic-calendar/cpi-733">Core CPI (MoM)</a>
  </td>
  <td class="bold act blackFont event-733-actual">0.3%</td>
  <td class="fore">0.3%</td>
  <td class="prev">0.2%</td>
</tr>
<tr id="eventRowId_457" data-event-datetime="2025/01/15 13:30:00" class="js-event-item">
  <td class="first left time js-time">13:30</td>
  <td class="left flagCur noWrap"><span title="Germany" class="ceFlags DE"></span> EUR</td>
  <td class="left textNum sentiment noWrap" title="High Volatility Expected">
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
  </td>
  <td class="left event">
    <a href="/economic-calendar/german-gdp-126">German GDP (QoQ)</a>
  </td>
</tr>
<tr id="eventRowId_458" data-event-datetime="2025/01/15 19:00:00" class="js-event-item">
  <td class="first left time js-time">19:00</td>
  <td class="left flagCur noWrap"><span title="United States" class="ceFlags US"></span> USD</td>
  <td class="left textNum sentiment noWrap" title="High Volatility Expected">
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
    <i class="grayFullBullishIcon"></i>
  </td>
  <td class="left event">
    <a href="/economic-calendar/fomc-statement">FOMC Statement</a>
  </td>
</tr>
<tr id="eventRowId_459" data-event-datetime="2025/01/16 09:00:00" class="js-event-item">
  <td class="first left time js-time">09:00</td>
  <td class="left flagCur noWrap"><span title="Germany" class="ceFlags DE"></span> EUR</td>
  <td class="left textNum sentiment noWrap" title="Low Volatility Expected">
    <i class="grayFullBullishIcon"></i>
  </td>
  <td class="left event">
    <a href="/economic-calendar/low-impact">Some Minor Event</a>
  </td>
</tr>
"""


def test_categorize():
    assert ns.categorize("Core CPI (MoM)") == "cpi"
    assert ns.categorize("Consumer Price Index") == "cpi"
    assert ns.categorize("Nonfarm Payrolls") == "nfp"
    assert ns.categorize("Non-Farm Payrolls") == "nfp"
    assert ns.categorize("FOMC Statement") == "fomc"
    assert ns.categorize("FOMC Meeting Minutes") == "fomc"
    assert ns.categorize("Fed Chair Powell Speaks") == "fomc"
    assert ns.categorize("Bank Holiday - Christmas") == "bank_holiday"
    assert ns.categorize("German GDP (QoQ)") == "high"
    assert ns.categorize("Retail Sales") == "high"


def test_parse_rows_extracts_high_impact_only():
    events = ns.parse_rows(SAMPLE_HTML)
    # 3 high-impact events; the 1-bull row should be dropped
    assert len(events) == 3
    names = [e.name for e in events]
    assert "Core CPI (MoM)" in names
    assert "German GDP (QoQ)" in names
    assert "FOMC Statement" in names
    assert "Some Minor Event" not in names


def test_parse_rows_categorizes():
    events = ns.parse_rows(SAMPLE_HTML)
    by_name = {e.name: e for e in events}
    assert by_name["Core CPI (MoM)"].category == "cpi"
    assert by_name["FOMC Statement"].category == "fomc"
    assert by_name["German GDP (QoQ)"].category == "high"


def test_parse_rows_country_codes():
    events = ns.parse_rows(SAMPLE_HTML)
    by_name = {e.name: e for e in events}
    assert by_name["Core CPI (MoM)"].country == "US"
    assert by_name["German GDP (QoQ)"].country == "DE"


def test_parse_rows_datetime():
    events = ns.parse_rows(SAMPLE_HTML)
    by_name = {e.name: e for e in events}
    assert by_name["Core CPI (MoM)"].datetime_local == datetime(2025, 1, 14, 13, 30)


def test_parse_rows_empty_input():
    assert ns.parse_rows("") == []
    assert ns.parse_rows("<html></html>") == []


def test_merge_with_cache(tmp_path: Path):
    cache = tmp_path / "news.json"
    # Pre-existing cache with one event
    cache.write_text(json.dumps([{
        "datetime_local": "2025-01-14T13:30",
        "name": "Core CPI (MoM)",
        "category": "cpi",
        "country": "US",
        "impact": "high",
    }]))
    new_events = ns.parse_rows(SAMPLE_HTML)
    added = ns.merge_with_cache(new_events, cache)
    # 3 in HTML, 1 already in cache (Core CPI MoM same dt+name) -> 2 added
    assert added == 2

    final = json.loads(cache.read_text())
    # Total = 3 unique events
    assert len(final) == 3
    # Should be sorted by datetime
    dts = [e["datetime_local"] for e in final]
    assert dts == sorted(dts)


def test_merge_with_cache_creates_dir(tmp_path: Path):
    cache = tmp_path / "subdir" / "news.json"
    new_events = ns.parse_rows(SAMPLE_HTML)
    added = ns.merge_with_cache(new_events, cache)
    assert added == 3
    assert cache.exists()


def test_merge_with_cache_handles_missing_cache(tmp_path: Path):
    cache = tmp_path / "missing.json"
    new_events = ns.parse_rows(SAMPLE_HTML)
    added = ns.merge_with_cache(new_events, cache)
    assert added == 3
