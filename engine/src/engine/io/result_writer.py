"""Serialize trade outcomes to result.json in the user's exact schema."""

from __future__ import annotations

import json
from pathlib import Path
from collections import Counter, defaultdict

import pandas as pd

from .. import config
from ..detectors import liquidity as liq
from ..filters import schedule as sched
from ..simulator.trade import TradeOutcome


def _format_duration(td: pd.Timedelta) -> str:
    return liq.format_age(td)  # reuse the same compact format


def trade_to_dict(t: TradeOutcome, *,
                  bias: str | None = None,
                  volatility: str | None = None,
                  rvol: str | None = None,
                  ath: str | None = None,
                  news: str = "None",
                  photo_url: str = "",
                  liquidity_url: str = "",
                  info: str = "") -> dict:
    """Convert TradeOutcome → output schema dict."""
    sweep = t.setup.displacement.sweep
    chosen = t.setup.chosen_gap
    mss_kind = t.setup.mss.mss_kind if t.setup.mss is not None else "—"
    entry_local = t.entry_time.tz_convert(config.TIMEZONE)
    return {
        "id": str(int(t.entry_time.timestamp() * 1000)),
        "market": config.MARKET_LABEL,
        "year": entry_local.strftime("%Y"),
        "ddMm": entry_local.strftime("%d/%m"),
        "time": entry_local.strftime("%H:%M"),
        "Bias": bias or "neutral",
        "order": "Buy" if t.direction == "buy" else "Sell",
        "liquidity": sweep.liquidity_type,
        "age": liq.format_age(sweep.age),
        "tradeduration": _format_duration(t.duration),
        "mss": mss_kind,
        "additionalLiquidity": sweep.additional_liquidity or "None",
        "setup": t.setup.name,
        "setuptime": _format_duration(t.setup_time_td),
        "volatility": volatility or "—",
        "Rvol": rvol or "—",
        "gapsize": f"{chosen.size_points:.1f}",
        "gapfill": _format_duration(t.gapfill_time_td),
        "slPoints": f"{t.sl_points:.1f}",
        "result": t.result,
        "news": news,
        "session": sched.label_session(t.entry_time),
        "photoUrl": photo_url,
        "liquidityUrl": liquidity_url,
        "ath": ath or "—",
        "info": info or "",
    }


def write(path: str | Path, trades: list[dict]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(trades, f, indent=2, ensure_ascii=False)


def write_summary(path: str | Path, trades: list[dict], df: pd.DataFrame) -> None:
    """Aggregate stats summary."""
    if not trades:
        summary = {"total_trades": 0}
    else:
        results = [t["result"] for t in trades]
        wins = sum(1 for r in results if r == "Win")
        losses = sum(1 for r in results if r == "Loss")
        be = sum(1 for r in results if r == "Break Even")
        opens = sum(1 for r in results if r == "Open")
        decided = wins + losses + be

        # Compute account return at 1% risk: each Win = +2%, Loss = -1%, BE = 0
        account_return_pct = wins * config.WIN_PCT + losses * config.LOSS_PCT

        # Group by setup
        by_setup: dict = defaultdict(lambda: {"count": 0, "wins": 0, "losses": 0, "be": 0})
        for t in trades:
            s = by_setup[t["setup"]]
            s["count"] += 1
            if t["result"] == "Win":
                s["wins"] += 1
            elif t["result"] == "Loss":
                s["losses"] += 1
            elif t["result"] == "Break Even":
                s["be"] += 1
        for s in by_setup.values():
            d = s["wins"] + s["losses"] + s["be"]
            s["win_rate_pct"] = round(100 * s["wins"] / d, 1) if d else 0.0

        # Group by session
        by_session = Counter(t["session"] for t in trades)

        # Group by liquidity type
        by_liquidity = Counter(t["liquidity"] for t in trades)

        # Group by news
        by_news_high = sum(1 for t in trades if t["news"] != "None")

        summary = {
            "csv_range": {
                "from": df.index[0].isoformat(),
                "to": df.index[-1].isoformat(),
                "candles": int(len(df)),
            },
            "total_trades": len(trades),
            "decided_trades": decided,
            "wins": wins,
            "losses": losses,
            "break_even": be,
            "open": opens,
            "win_rate_pct": round(100 * wins / decided, 1) if decided else 0.0,
            "account_return_pct_at_1pct_risk": round(account_return_pct, 1),
            "by_setup": dict(by_setup),
            "by_session": dict(by_session),
            "by_liquidity": dict(by_liquidity),
            "trades_with_news_high": by_news_high,
        }

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
