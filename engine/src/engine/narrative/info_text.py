"""Auto-generate the 'info' field in Romanian, in the style of logs-backup288.json.

Looks at multiple metrics and assembles short descriptive phrases.
"""

from __future__ import annotations

import pandas as pd

from ..simulator.trade import TradeOutcome


def generate(t: TradeOutcome, *, ath_pct: float | None = None,
             volatility_ratio: float | None = None) -> str:
    """Compose a sentence describing the setup quality."""
    parts: list[str] = []
    setup = t.setup
    disp = setup.displacement
    mss = setup.mss  # may be None

    # MSS quality
    if mss is not None:
        mss_strength = _mss_strength(mss)
        if mss_strength == "weak":
            parts.append("market structure shift slab")
        elif mss_strength == "strong":
            parts.append("market structure shift bun")
        else:
            parts.append("market structure shift decent")

    # Displacement quality
    if disp.candle_count >= 4:
        parts.append("displacement bun cu mai multe candele puternice")
    elif disp.candle_count == 3:
        parts.append("displacement decent")
    else:
        parts.append("displacement slab format din doar 2 candele")

    # Setup type comment
    if setup.has_slg:
        parts.append("preceded de un single liquidity grab")

    # Gap quality
    chosen = setup.chosen_gap
    if chosen.size_points < 5:
        parts.append("gap mic vizual")
    elif chosen.size_points > 25:
        parts.append("gap mare cu spațiu generos")

    # ATH proximity
    if ath_pct is not None:
        if abs(ath_pct) < 0.3:
            parts.append(f"distanță foarte mică de all-time-extreme ({ath_pct:+.2f}%)")
        elif abs(ath_pct) < 1.0:
            parts.append(f"aproape de all-time-extreme ({ath_pct:+.2f}%)")

    # Volatility comment
    if volatility_ratio is not None:
        if volatility_ratio > 1.5:
            parts.append("volatilitate ridicată în piață")
        elif volatility_ratio < 0.6:
            parts.append("volatilitate scăzută")

    # Result framing
    if t.result == "Win":
        parts.append("trade-ul a atins TP fără retest semnificativ")
    elif t.result == "Loss":
        if t.be_armed:
            parts.append("a ajuns la BE dar a revenit înainte de TP")
        else:
            parts.append("invalidat înainte de a ajunge la BE")
    elif t.result == "Break Even":
        parts.append("scos pe BE după ce SL a fost mutat")

    sentence = ", ".join(parts).capitalize() + "."
    # Capitalize first word only; keep rest lowercase per Romanian convention
    return sentence


def _mss_strength(mss) -> str:
    """Heuristic for MSS quality based on:
        - whether mss is body or wick
        - how quickly MSS confirms after sweep (closer = stronger)
    """
    candles_to_confirm = mss.mss_idx - mss.sweep.sweep_idx
    if mss.mss_kind == "Body" and candles_to_confirm <= 5:
        return "strong"
    if mss.mss_kind == "Wick" and candles_to_confirm > 10:
        return "weak"
    return "decent"
