"""End-to-end orchestrator: CSV -> trades -> result.json + summary."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pandas as pd

from . import config
from .detectors import displacement as disp_mod
from .detectors import fvg as fvg_mod
from .detectors import liquidity as liq_mod
from .detectors import mss as mss_mod
from .detectors import setup_classifier as sc_mod
from .detectors import swings as sw_mod
from .filters import news_filter as nf_mod
from .filters import schedule as sched_mod
from .io import csv_loader, journal_writer, news_scraper, result_writer
from .narrative import info_text
from .rendering import snapshot as snap_mod
from .simulator import trade as sim_mod
from .stats import ath as ath_mod
from .stats import bias as bias_mod
from .stats import gap as gap_mod
from .stats import rvol as rvol_mod
from .stats import volatility as vol_mod


def _dedupe_outcomes(outcomes: list) -> list:
    """If multiple outcomes share the same entry candle (multiple sweeps in same
    bar), keep the one whose liquidity is the most "structural":
        Major > HOD/LOD > Local
    Tiebreaker: oldest age."""
    LIQ_RANK = {"Major": 3, "HOD": 2, "LOD": 2, "Local": 1}
    by_entry: dict[int, list] = {}
    for o in outcomes:
        by_entry.setdefault(o.entry_idx, []).append(o)
    deduped = []
    for entry_idx, group in by_entry.items():
        if len(group) == 1:
            deduped.append(group[0])
            continue
        # Pick the strongest liquidity, then oldest age
        best = max(
            group,
            key=lambda o: (
                LIQ_RANK.get(o.setup.displacement.sweep.liquidity_type, 0),
                o.setup.displacement.sweep.age,
            ),
        )
        deduped.append(best)
    return sorted(deduped, key=lambda o: o.entry_idx)


def run(
    csv_path: str | Path,
    out_dir: str | Path,
    *,
    news_path: str | Path | None = None,
    slice_start: str | None = None,
    slice_end: str | None = None,
    render_snapshots: bool = False,
    refresh_news: bool = False,
    news_window_days: int = 180,
    publish_to: str | Path | None = None,
    shift_minutes: int = 0,
    export_journal: bool = False,
    journal_only: bool = False,
    market: str | None = None,
) -> dict:
    """Run the engine end-to-end. Returns summary dict and writes result.json."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if refresh_news and news_path:
        print(f"[0/7] Refreshing news cache from investing.com (last {news_window_days} days)")
        from datetime import datetime, timedelta
        end = datetime.now()
        start = end - timedelta(days=news_window_days)
        events = news_scraper.scrape_window(start, end)
        added = news_scraper.merge_with_cache(events, news_path)
        print(f"      {added} new events merged into {news_path}")

    print(f"[1/7] Loading CSV: {csv_path}" + (f"  (+{shift_minutes}min shift)" if shift_minutes else ""))
    df = csv_loader.load(csv_path, slice_start=slice_start, slice_end=slice_end,
                         shift_minutes=shift_minutes)
    print(f"      {len(df):,} candles, {df.index[0]} -> {df.index[-1]}")

    # Fast path: scan only for manual-journal grabs (skip the strategy/backtest/snapshots).
    if journal_only:
        print("[journal-only] Exporting HOD/LOD grabs (10:00-12:00) for manual journaling")
        n_journal = journal_writer.export(df, out_dir, market=market)
        print(f"      {n_journal} grabs exported -> {out_dir / 'journal'}")
        if publish_to:
            _publish_to_react(out_dir, Path(publish_to), [])
        return {"n_trades": 0, "n_journal": n_journal,
                "result_path": "", "summary_path": ""}

    print("[2/7] Annotating swings + ATR + daily bias")
    df = sw_mod.annotate_valid_swings(df)
    df = sw_mod.annotate_atr(df)
    df = bias_mod.annotate_daily_bias(df)

    print("[3/7] Detecting liquidity sweeps")
    sweeps = liq_mod.find_sweep_events(df)
    print(f"      {len(sweeps)} sweep events")

    if export_journal:
        n_journal = journal_writer.export(df, out_dir, market=market)
        print(f"      journal: {n_journal} grabs + OHLC windows -> {out_dir / 'journal'}")

    print("[4/7] Building setups (displacement + FVG + classifier)")
    news = nf_mod.load_news(news_path) if news_path else []
    setups: list = []
    for sweep in sweeps:
        # v0.7 order: sweep -> displacement -> first aligned gaps (>=1.5p) -> setup.
        # MSS is validated inside the simulator: it must form in [touch, entry] in
        # any order relative to the FVG, but before execution (no hindsight).
        disp = disp_mod.find_displacement_after_sweep(df, sweep)
        if disp is None:
            continue
        gaps = fvg_mod.find_gaps_in(df, disp)
        if not gaps:
            continue
        setup = sc_mod.classify(df, disp, gaps)
        if setup is None:
            continue
        setups.append(setup)
    print(f"      {len(setups)} candidate setups")

    print("[5/7] Simulating trades")
    outcomes = []
    for s in setups:
        out = sim_mod.simulate(df, s)
        if out is None:
            continue
        # Filter on ENTRY time, not sweep time
        if not sched_mod.is_in_trading_hours(out.entry_time):
            continue
        outcomes.append(out)

    # De-duplicate: multiple sweeps in the same candle can produce identical entries.
    # Keep the one with the OLDEST liquidity (most "respected" sweep).
    outcomes = _dedupe_outcomes(outcomes)
    print(f"      {len(outcomes)} trades after dedupe + schedule filter")

    snapshot_paths: dict[str, dict[str, str]] = {}
    if render_snapshots and outcomes:
        print(f"[6/7] Rendering {len(outcomes)} chart snapshots (trade + liquidity)")
        snapshot_paths = snap_mod.render_all(df, outcomes, out_dir / "snapshots")

    print("[7/7] Computing per-trade stats + narrative + writing output")
    trade_dicts = []
    for t in outcomes:
        trade_id = str(int(t.entry_time.timestamp() * 1000))
        news_label = nf_mod.label_news(news, t.entry_time)
        # Compute stats
        bias = bias_mod.lookup(df, t.entry_time)
        volatility = vol_mod.compute(df, t.entry_time)
        rvol = rvol_mod.compute(df, t.entry_time)
        ath_str = ath_mod.distance(df, t.entry_time, t.entry_price, t.direction)

        # Parse numeric forms for narrative
        try:
            ath_pct = float(ath_str.rstrip("%")) if ath_str != "—" else None
        except ValueError:
            ath_pct = None
        try:
            vol_ratio = float(volatility.rstrip("x")) if volatility != "—" else None
        except ValueError:
            vol_ratio = None

        info = info_text.generate(t, ath_pct=ath_pct, volatility_ratio=vol_ratio)

        snaps = snapshot_paths.get(trade_id, {"trade": "", "liquidity": ""})
        d = result_writer.trade_to_dict(
            t,
            bias=bias,
            volatility=volatility,
            rvol=rvol,
            ath=ath_str,
            news=news_label,
            photo_url=snaps.get("trade", ""),
            liquidity_url=snaps.get("liquidity", ""),
            info=info,
        )
        trade_dicts.append(d)

    result_path = out_dir / "result.json"
    summary_path = out_dir / "stats_summary.json"
    result_writer.write(result_path, trade_dicts)
    result_writer.write_summary(summary_path, trade_dicts, df)

    print(f"      -> {result_path}")
    print(f"      -> {summary_path}")

    # Publish to React app so the dashboard at http://localhost:5173 picks it up
    if publish_to:
        _publish_to_react(out_dir, Path(publish_to), trade_dicts)

    return {"result_path": str(result_path), "summary_path": str(summary_path),
            "n_trades": len(trade_dicts)}


def _publish_to_react(run_dir: Path, target_dir: Path, trade_dicts: list[dict]) -> None:
    """Copy result.json + stats_summary.json + snapshots into the React app's
    public/engine-data folder so it's served at /engine-data/ by Vite."""
    import shutil

    target_dir.mkdir(parents=True, exist_ok=True)
    snaps_target = target_dir / "snapshots"
    snaps_target.mkdir(exist_ok=True)

    # Copy json files
    for name in ("result.json", "stats_summary.json"):
        src = run_dir / name
        if src.exists():
            shutil.copy2(src, target_dir / name)

    # Copy snapshots that this run produced
    snaps_src = run_dir / "snapshots"
    if snaps_src.exists():
        # Wipe stale snapshots first to avoid orphans
        for p in snaps_target.glob("*.png"):
            p.unlink(missing_ok=True)
        for p in snaps_src.glob("*.png"):
            shutil.copy2(p, snaps_target / p.name)

    # Copy the manual-journal export (events.json + candles/*) if this run produced one
    journal_src = run_dir / "journal"
    if journal_src.exists():
        journal_target = target_dir / "journal"
        candles_target = journal_target / "candles"
        candles_target.mkdir(parents=True, exist_ok=True)
        # Wipe stale candle windows so removed/renamed events don't linger
        for p in candles_target.glob("*.json"):
            p.unlink(missing_ok=True)
        shutil.copy2(journal_src / "events.json", journal_target / "events.json")
        for p in (journal_src / "candles").glob("*.json"):
            shutil.copy2(p, candles_target / p.name)

    # Write a small manifest with mtime for HMR / polling
    import json as _json
    import time
    (target_dir / "manifest.json").write_text(_json.dumps({
        "published_at": int(time.time() * 1000),
        "run_dir": str(run_dir),
        "n_trades": len(trade_dicts),
    }, indent=2))
    print(f"      -> published to {target_dir}")
