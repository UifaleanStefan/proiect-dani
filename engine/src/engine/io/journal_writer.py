"""Export manual-journal events for the TradingView-style journaling UI (v0.9).

For EVERY HOD and LOD grab touched in 10:00..12:00 (up to two per day; see
`liquidity.find_journal_grabs`) we emit:
  - a per-event raw OHLC window  -> journal/candles/{id}.json  = [{t,o,h,l,c}]
  - a metadata row in            -> journal/events.json        = {meta, events:[...]}

The window spans FORMATION -> RESOLUTION (formation_time - pad .. sweep_time + post hours)
so the formation->touch liquidity segment is always visible on the chart.

Auto-fill fields the UI shows read-only: market, date, time, order, liquidity, liquidity
age, session, athToDate (running all-time-high up to the grab; UI computes -ATH% from the
hand-drawn entry). `t` is epoch-milliseconds (UTC); the UI formats in Europe/Bucharest.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..detectors import liquidity as liq
from ..filters import schedule as sched

# Setup vocabulary for the UI's manual "setup" dropdown (mirrors setup_classifier).
SETUP_NAMES = [
    "OSG", "2G", "2CG", "3G", "3CG", "MG",
    "SLG + OSG", "SLG + 2G", "SLG + 2CG", "SLG + 3G", "SLG + 3CG", "SLG + MG",
]


def _window_bounds(sweep_time: pd.Timestamp, tz) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[touch-day 10:00 local .. sweep_time + POST_HOURS].

    The chart starts at 10:00 sharp (the analysis window) — the overnight formation is
    before this and is conveyed by the level line drawn from the left edge to the touch.
    """
    local = sweep_time.tz_convert(config.TIMEZONE)
    start = pd.Timestamp(local.date(), tz=tz) + pd.Timedelta(hours=config.HOD_LOD_FORMATION_END_HOUR)
    end = sweep_time + pd.Timedelta(hours=config.JOURNAL_WINDOW_POST_HOURS)
    return start, end


def _candles(window: pd.DataFrame) -> list[dict]:
    """Serialize an OHLC window to [{t(ms), o, h, l, c}] (Timestamp.value is always ns)."""
    ms = [int(ts.value // 1_000_000) for ts in window.index]
    o = window["open"].to_numpy()
    h = window["high"].to_numpy()
    low = window["low"].to_numpy()
    c = window["close"].to_numpy()
    return [
        {"t": ms[i], "o": float(o[i]), "h": float(h[i]), "l": float(low[i]), "c": float(c[i])}
        for i in range(len(ms))
    ]


def export(df: pd.DataFrame, out_dir: str | Path, *, market: str | None = None) -> int:
    """Write journal/events.json + journal/candles/{id}.json. Returns event count."""
    out_dir = Path(out_dir)
    jdir = out_dir / "journal"
    cdir = jdir / "candles"
    cdir.mkdir(parents=True, exist_ok=True)

    market = market or config.MARKET_LABEL
    grabs = liq.find_journal_grabs(df)
    ath_arr = np.maximum.accumulate(df["high"].to_numpy())  # running all-time-high

    events: list[dict] = []
    for g in grabs:
        st = g.sweep_time
        ft = g.pivot_time  # formation extreme (overnight; before the 10:00 window)
        start, end = _window_bounds(st, df.index.tz)
        window = df.loc[start:end]
        if len(window) == 0:
            continue

        local = st.tz_convert(config.TIMEZONE)
        eid = str(int(st.timestamp() * 1000))
        touch_pos = int(window.index.searchsorted(st))
        formation_pos = int(window.index.searchsorted(ft))

        candles = _candles(window)
        with (cdir / f"{eid}.json").open("w", encoding="utf-8") as f:
            json.dump(candles, f, separators=(",", ":"))

        events.append({
            "id": eid,
            "market": market,
            "date": local.strftime("%Y-%m-%d"),
            "ddMm": local.strftime("%d/%m"),
            "year": local.strftime("%Y"),
            "sweepTime": local.strftime("%H:%M"),
            "sweepMs": int(st.timestamp() * 1000),
            "direction": g.direction,             # "buy" | "sell"
            "liquidity": g.liquidity_type,         # "HOD" | "LOD"
            "level": float(g.swept_price),         # the grabbed level (exact)
            "formationIdx": formation_pos,         # where the extreme formed (window-local)
            "touchIdx": touch_pos,                 # where it was liquidated (window-local)
            "sweepIdx": touch_pos,                 # alias (back-compat)
            "age": liq.format_age(g.age),          # liquidity age string
            "session": sched.label_session(st),    # London / New York
            "athToDate": float(ath_arr[g.sweep_idx]),
            "candles": len(candles),
        })

    # newest first — the user journals recent days most
    events.sort(key=lambda e: e["sweepMs"], reverse=True)

    payload = {
        "meta": {
            "market": market,
            "timezone": config.TIMEZONE,
            "tpRr": config.TP_RR_RATIO,
            "beRr": config.BE_RR_TRIGGER,
            "slBuffer": config.SL_BUFFER_POINTS,
            "slRefPrice": config.SL_REF_PRICE,
            "slMinAtRef": config.SL_MIN_AT_REF,
            "slMaxAtRef": config.SL_MAX_AT_REF,
            "slQuantizeStep": config.SL_QUANTIZE_STEP,
            "minFvgSize": config.MIN_FVG_SIZE_POINTS,
            "postHours": config.JOURNAL_WINDOW_POST_HOURS,
            "setups": SETUP_NAMES,
            "generatedMs": int(time.time() * 1000),
            "count": len(events),
        },
        "events": events,
    }
    with (jdir / "events.json").open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    return len(events)
