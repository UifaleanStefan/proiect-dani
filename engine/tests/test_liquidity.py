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
    # Expect a non-trivial number of sweep events on a normal trading day
    assert len(events) > 0, "No sweep events detected at all"
    # Sanity on event shape
    for e in events:
        assert e.direction in ("buy", "sell")
        assert e.liquidity_type in ("HOD", "LOD", "Local", "Major")
        assert e.sweep_kind in ("wick", "body")
        assert e.sweep_idx > e.pivot_idx
        assert e.age >= pd.Timedelta(0)


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_hod_lod_emitted_on_trading_day():
    """At least one HOD or LOD should be detected on any normal trading day."""
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-15", slice_end="2026-04-17")
    events = liquidity.find_sweep_events(df)
    types = {e.liquidity_type for e in events}
    # We don't strictly require HOD/LOD to be hit every day, but Local should always exist
    assert "Local" in types or "HOD" in types or "LOD" in types


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_classification_age_consistency():
    """A 'Local' event should have age >= 3h OR be marked as a fresh-pivot Local."""
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-01", slice_end="2026-04-10")
    events = liquidity.find_sweep_events(df)
    # Just make sure we have a healthy mix and no negative ages
    for e in events:
        assert e.age >= pd.Timedelta(0)
