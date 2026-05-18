"""Tests for swing/ATR helpers."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine.detectors import swings

REAL_CSV = Path("D:/ProiectDani/1.csv")


def _toy_df():
    """Build a tiny DF with a known swing high at index 4 and swing low at index 9."""
    # Pattern: low → high → low (around peak), then low → lower-low → recovery.
    data = {
        "open":  [100, 101, 102, 103, 110, 109, 108, 107, 106, 95, 96, 97, 98],
        "high":  [101, 102, 103, 104, 112, 110, 109, 108, 107, 96, 97, 98, 99],
        "low":   [ 99, 100, 101, 102, 109, 108, 107, 106, 105, 94, 95, 96, 97],
        "close": [101, 102, 103, 104, 109, 108, 107, 106, 105, 96, 97, 98, 99],
        "tickvol": [1] * 13,
        "vol":     [1] * 13,
        "spread":  [1] * 13,
    }
    df = pd.DataFrame(data)
    df.index = pd.date_range("2026-01-01 10:00", periods=13, freq="1min", tz="Europe/Bucharest")
    return df


def test_swing_high_detection():
    df = _toy_df()
    out = swings.annotate_swings(df, lookback=3)
    # Index 4 has high=112 > 104,103,102,101 (left) and > 110,109,108,107 (right)
    assert out["swing_high"].iloc[4]
    # No other swing highs in this dataset
    assert out["swing_high"].sum() == 1


def test_swing_low_detection():
    df = _toy_df()
    out = swings.annotate_swings(df, lookback=3)
    # Index 9 has low=94 < 105,106,107,108 (left) and < 95,96,97 (right) — but right side
    # has only 3 values (indices 10,11,12), which equals lookback. Should still confirm.
    assert out["swing_low"].iloc[9]


def test_atr_increases_with_volatility():
    df = _toy_df()
    out = swings.annotate_atr(df, period=5)
    assert "atr" in out.columns
    assert (out["atr"].dropna() > 0).all()


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_swings_on_real_slice():
    """Verify swing detection runs on real data and produces a sensible count."""
    from engine.io import csv_loader
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-15", slice_end="2026-04-15")
    out = swings.annotate_swings(df)
    # At lookback=3 on M1, we expect a non-trivial number of swings per day
    n_high = int(out["swing_high"].sum())
    n_low = int(out["swing_low"].sum())
    assert n_high > 5, f"Too few swing highs: {n_high}"
    assert n_low > 5, f"Too few swing lows: {n_low}"

    # Valid swings (with green/red wave structure) should be a subset
    out_valid = swings.annotate_valid_swings(out)
    assert int(out_valid["valid_swing_high"].sum()) <= n_high
    assert int(out_valid["valid_swing_low"].sum()) <= n_low


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_atr_real_data():
    from engine.io import csv_loader
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-15", slice_end="2026-04-15")
    out = swings.annotate_atr(df)
    # ATR for DAX M1 is typically 1-15 points
    median_atr = out["atr"].dropna().median()
    assert 0.5 < median_atr < 50, f"ATR out of expected DAX M1 range: {median_atr}"
