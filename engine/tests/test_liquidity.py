"""Tests for liquidity detector."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from engine.detectors import liquidity
from engine.io import csv_loader

REAL_CSV = Path("D:/ProiectDani/1.csv")


def test_format_age():
    assert liquidity.format_age(pd.Timedelta("20h52m")) == "20h52m"
    assert liquidity.format_age(pd.Timedelta("3h47m")) == "3h47m"
    assert liquidity.format_age(pd.Timedelta("1d8h")) == "1d8h0m"
    assert liquidity.format_age(pd.Timedelta("0h30m")) == "30m"


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_find_sweeps_one_day_smoke():
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-15", slice_end="2026-04-15")
    events = liquidity.find_sweep_events(df)
    # v0.6: HOD/LOD only — at most one event per day
    assert len(events) <= 1, "v0.6 emits at most one HOD/LOD touch per day"
    for e in events:
        assert e.direction in ("buy", "sell")
        assert e.liquidity_type in ("HOD", "LOD")  # v0.6: only these
        assert e.sweep_idx > e.pivot_idx
        assert e.age >= pd.Timedelta(0)


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_only_hod_lod_types():
    """v0.6: every event must be HOD or LOD — no Local/Major."""
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-01", slice_end="2026-04-30")
    events = liquidity.find_sweep_events(df)
    types = {e.liquidity_type for e in events}
    assert types.issubset({"HOD", "LOD"}), f"unexpected types: {types}"


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_one_event_per_day_and_touch_window():
    """At most one event per calendar day, and each touch is in 10:00..12:00 local."""
    import collections
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-01", slice_end="2026-04-30")
    events = liquidity.find_sweep_events(df)
    per_day = collections.Counter(e.sweep_time.tz_convert("Europe/Bucharest").date() for e in events)
    assert all(c <= 1 for c in per_day.values()), "more than one event in a day"
    for e in events:
        local = e.sweep_time.tz_convert("Europe/Bucharest")
        assert 10 <= local.hour < 12, f"touch outside 10:00-12:00: {local}"
        assert e.age >= pd.Timedelta(0)
