"""Command-line interface."""

from __future__ import annotations

import argparse
import sys

from . import pipeline


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="engine",
        description="Trading-engine: detect setups, simulate, and produce result.json",
    )
    p.add_argument("--csv", required=True, help="Path to MetaTrader-style M1 TSV (e.g., D:/ProiectDani/1.csv)")
    p.add_argument("--out", required=True, help="Output directory (will be created)")
    p.add_argument("--news", default=None, help="Path to news_cache.json (optional)")
    p.add_argument("--from-date", default=None, help="ISO date YYYY-MM-DD (inclusive, optional)")
    p.add_argument("--to-date", default=None, help="ISO date YYYY-MM-DD (inclusive, optional)")
    p.add_argument("--render-snapshots", action="store_true", help="Render chart snapshots (slower)")
    p.add_argument("--refresh-news", action="store_true",
                   help="Scrape investing.com economic calendar before run and merge into --news")
    p.add_argument("--news-window-days", type=int, default=180,
                   help="When --refresh-news is set, how many days of history to fetch (default 180)")
    p.add_argument("--publish-to", default=None,
                   help="After run, copy result.json + snapshots to this directory "
                        "(typically D:/ProiectDani/public/engine-data) so the React "
                        "dashboard at port 5173 picks them up.")
    p.add_argument("--shift-minutes", type=int, default=0,
                   help="Add N minutes to every CSV timestamp before processing "
                        "(use 60 when broker data is 1h behind TradingView).")
    p.add_argument("--export-journal", action="store_true",
                   help="Export manual-journal events (HOD/LOD grabs + OHLC windows) "
                        "to <out>/journal for the React journaling page.")
    p.add_argument("--journal-only", action="store_true",
                   help="Scan ONLY for manual-journal grabs (skip the backtest, setups, "
                        "simulation and snapshots). Fast path for CSV-upload scanning.")
    p.add_argument("--market", default=None,
                   help="Market label to tag journal events with (default DE30EUR). "
                        "Use the instrument name when scanning other CSVs.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    summary = pipeline.run(
        csv_path=args.csv,
        out_dir=args.out,
        news_path=args.news,
        slice_start=args.from_date,
        slice_end=args.to_date,
        render_snapshots=args.render_snapshots,
        refresh_news=args.refresh_news,
        news_window_days=args.news_window_days,
        publish_to=args.publish_to,
        shift_minutes=args.shift_minutes,
        export_journal=args.export_journal,
        journal_only=args.journal_only,
        market=args.market,
    )
    print()
    print(f"DONE: {summary['n_trades']} trades written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
