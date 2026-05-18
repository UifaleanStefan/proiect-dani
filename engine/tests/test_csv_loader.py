"""Tests for the CSV loader."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from engine.io import csv_loader

# Real production CSV (read-only)
REAL_CSV = Path("D:/ProiectDani/1.csv")


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_load_real_csv_smoke():
    df = csv_loader.load(REAL_CSV)
    # Sanity
    assert len(df) > 50_000, "Expected at least 50k candles"
    assert df.index.tz is not None, "Index must be tz-aware"
    assert str(df.index.tz) in ("Europe/Bucharest", "Europe/Bucharest")
    assert list(df.columns) == ["open", "high", "low", "close", "tickvol", "vol", "spread"]

    # OHLC sanity: high >= max(open, close), low <= min(open, close)
    assert (df["high"] >= df[["open", "close"]].max(axis=1)).all()
    assert (df["low"] <= df[["open", "close"]].min(axis=1)).all()

    # Index is monotonic
    assert df.index.is_monotonic_increasing


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_load_with_slice():
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-01", slice_end="2026-04-03")
    assert len(df) > 0
    # Both inclusive: should not have data from 2026-04-04
    assert df.index[0].date().isoformat() >= "2026-04-01"
    assert df.index[-1].date().isoformat() <= "2026-04-03"


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_summary():
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-01", slice_end="2026-04-01")
    s = csv_loader.summary(df)
    assert s["rows"] > 0
    assert "Europe/Bucharest" in s["from"] or "+0" in s["from"]
    assert s["columns"] == ["open", "high", "low", "close", "tickvol", "vol", "spread"]
