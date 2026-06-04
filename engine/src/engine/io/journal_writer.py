"""Export manual-journal events for the React journaling page (v0.8).

For every HOD/LOD liquidity grab from `find_sweep_events` (one per day, touched in
10:00..12:00) we emit:
  - a per-event raw OHLC window  -> journal/candles/{id}.json  = [{t,o,h,l,c}]
  - a metadata row in            -> journal/events.json        = {meta, events:[...]}

Unlike result.json (auto-detected *trades*), this export is UNFILTERED by setup:
the user judges MSS/FVG/entry/SL/TP by hand on the chart, and the UI measures them.

`t` is epoch-milliseconds (UTC); the UI formats labels in the Europe/Bucharest tz.
Prices are kept exact. HOD/LOD context levels are computed in one vectorized pass
(no per-event full-frame masking — that would re-introduce the O(days*n) hang).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config


def _hod_lod_per_day(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Vectorized per-day overnight extremes (morning < 10:00), for drawing context
    lines. The *swept* level itself comes exact from the event; this just supplies the
    opposite line. Returns (hod_by_date, lod_by_date) indexed by python date."""
    times = df.index.tz_convert(config.TIMEZONE)
    date_arr = np.asarray(times.date)
    hour_arr = np.asarray(times.hour)
    morning = hour_arr < config.HOD_LOD_FORMATION_END_HOUR
    md = pd.DataFrame({
        "d": date_arr[morning],
        "h": df["high"].to_numpy()[morning],
        "l": df["low"].to_numpy()[morning],
    })
    if md.empty:
        return pd.Series(dtype=float), pd.Series(dtype=float)
    return md.groupby("d")["h"].max(), md.groupby("d")["l"].min()


def _window_bounds(df: pd.DataFrame, sweep_time: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[touch-day PRE_HOUR:00 .. sweep_time + POST_HOURS] in the data's tz."""
    tz = df.index.tz
    local = sweep_time.tz_convert(config.TIMEZONE)
    start = pd.Timestamp(local.date(), tz=tz) + pd.Timedelta(hours=config.JOURNAL_WINDOW_PRE_HOUR)
    end = sweep_time + pd.Timedelta(hours=config.JOURNAL_WINDOW_POST_HOURS)
    return start, end


def _candles(window: pd.DataFrame) -> list[dict]:
    """Serialize an OHLC window to [{t(ms), o, h, l, c}].

    `t` = epoch milliseconds (UTC), consistent with event `sweepMs` and trade ids.
    Built from int64 ns via Timestamp.value (resolution-independent — this index is
    datetime64[us], so .asi8 would be microseconds and mis-scale)."""
    ms = [int(ts.value // 1_000_000) for ts in window.index]  # Timestamp.value is always ns
    o = window["open"].to_numpy()
    h = window["high"].to_numpy()
    low = window["low"].to_numpy()
    c = window["close"].to_numpy()
    return [
        {"t": ms[i], "o": float(o[i]), "h": float(h[i]), "l": float(low[i]), "c": float(c[i])}
        for i in range(len(ms))
    ]


def export(df: pd.DataFrame, sweeps: list, out_dir: str | Path) -> int:
    """Write journal/events.json + journal/candles/{id}.json. Returns event count."""
    out_dir = Path(out_dir)
    jdir = out_dir / "journal"
    cdir = jdir / "candles"
    cdir.mkdir(parents=True, exist_ok=True)

    hod_map, lod_map = _hod_lod_per_day(df)
    events: list[dict] = []

    for sweep in sweeps:
        st = sweep.sweep_time
        start, end = _window_bounds(df, st)
        window = df.loc[start:end]
        if len(window) == 0:
            continue

        local = st.tz_convert(config.TIMEZONE)
        d = local.date()
        eid = str(int(st.timestamp() * 1000))

        hod_price = float(hod_map.get(d, sweep.swept_price))
        lod_price = float(lod_map.get(d, sweep.swept_price))
        if sweep.liquidity_type == "HOD":
            hod_price = float(sweep.swept_price)
        else:
            lod_price = float(sweep.swept_price)

        sweep_pos = int(window.index.searchsorted(st))

        candles = _candles(window)
        with (cdir / f"{eid}.json").open("w", encoding="utf-8") as f:
            json.dump(candles, f, separators=(",", ":"))

        events.append({
            "id": eid,
            "date": local.strftime("%Y-%m-%d"),
            "ddMm": local.strftime("%d/%m"),
            "year": local.strftime("%Y"),
            "sweepTime": local.strftime("%H:%M"),
            "sweepMs": int(st.timestamp() * 1000),
            "direction": sweep.direction,          # "buy" | "sell"
            "liquidity": sweep.liquidity_type,      # "HOD" | "LOD"
            "level": float(sweep.swept_price),      # the grabbed level (exact)
            "hodPrice": hod_price,
            "lodPrice": lod_price,
            "sweepIdx": sweep_pos,                  # sweep candle position within window
            "candles": len(candles),
        })

    # newest first — the user journals recent days most
    events.sort(key=lambda e: e["sweepMs"], reverse=True)

    payload = {
        "meta": {
            "market": config.MARKET_LABEL,
            "timezone": config.TIMEZONE,
            "tpRr": config.TP_RR_RATIO,
            "beRr": config.BE_RR_TRIGGER,
            "slBuffer": config.SL_BUFFER_POINTS,
            "slRefPrice": config.SL_REF_PRICE,
            "slMinAtRef": config.SL_MIN_AT_REF,
            "slMaxAtRef": config.SL_MAX_AT_REF,
            "slQuantizeStep": config.SL_QUANTIZE_STEP,
            "minFvgSize": config.MIN_FVG_SIZE_POINTS,
            "generatedMs": int(time.time() * 1000),
            "count": len(events),
        },
        "events": events,
    }
    with (jdir / "events.json").open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    return len(events)
