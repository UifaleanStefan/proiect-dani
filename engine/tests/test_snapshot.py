"""Tests for snapshot rendering."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from engine.io import csv_loader
from engine.detectors import (
    swings as sw,
    liquidity as liq_mod,
    mss as mss_mod,
    displacement as disp_mod,
    fvg as fvg_mod,
    setup_classifier as sc_mod,
)
from engine.simulator import trade as sim_mod
from engine.rendering import snapshot as snap_mod
from engine.stats import bias as bias_mod


REAL_CSV = Path("D:/ProiectDani/1.csv")


def _build_one_trade():
    """Build a real TradeOutcome from the supplied CSV."""
    df = csv_loader.load(REAL_CSV, slice_start="2026-04-15", slice_end="2026-04-17")
    df = sw.annotate_valid_swings(df)
    df = sw.annotate_atr(df)
    df = bias_mod.annotate_daily_bias(df)
    sweeps = liq_mod.find_sweep_events(df)
    for sweep in sweeps:
        mss = mss_mod.find_mss_after(df, sweep)
        if mss is None:
            continue
        disp = disp_mod.find_displacement_after(df, mss)
        if disp is None:
            continue
        gaps = fvg_mod.find_gaps_in(df, disp)
        if not gaps:
            continue
        setup = sc_mod.classify(df, disp, gaps)
        if setup is None:
            continue
        outcome = sim_mod.simulate(df, setup)
        if outcome:
            return df, outcome
    return df, None


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_render_one_trade_creates_png(tmp_path: Path):
    df, outcome = _build_one_trade()
    if outcome is None:
        pytest.skip("No setup found in this slice")
    out = tmp_path / "snap.png"
    snap_mod.render_trade(df, outcome, out)
    assert out.exists()
    # Reasonable file size: PNGs at this resolution are >5KB and <500KB
    size = out.stat().st_size
    assert 5_000 < size < 500_000, f"Suspicious PNG size: {size}"


@pytest.mark.skipif(not REAL_CSV.exists(), reason="Real CSV not available")
def test_render_all_returns_paths(tmp_path: Path):
    df, outcome = _build_one_trade()
    if outcome is None:
        pytest.skip("No setup found")
    paths = snap_mod.render_all(df, [outcome], tmp_path)
    assert len(paths) == 1
    trade_id = list(paths.keys())[0]
    entry = paths[trade_id]
    assert entry["trade"].startswith("snapshots/")
    assert entry["liquidity"].startswith("snapshots/")
    assert entry["liquidity"].endswith("_liq.png")
    assert (tmp_path / f"{trade_id}.png").exists()
    assert (tmp_path / f"{trade_id}_liq.png").exists()
