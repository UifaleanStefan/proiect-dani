"""Setup classifier: from FVGs in a displacement, decide which setup it is and
where the entry price goes.

Setups (per user rules):
    OSG  — exactly 1 gap in displacement; entry = midpoint of that gap
    2G   — exactly 2 gaps (any spacing); entry = midpoint of the LAST gap
    2CG  — exactly 2 consecutive gaps; entry = midpoint of the LAST gap
    3G   — exactly 3 gaps; entry = midpoint of the MIDDLE gap
    3CG  — 3 consecutive gaps; entry = midpoint of the MIDDLE gap
    MG   — 4+ gaps; entry = midpoint of the FIRST gap chronologically AFTER
           the price retraces >=50% of the displacement

SLG ("Single Liquidity Grab") prefix:
    If there is a small Simple Gap within SLG_LOOKBACK_CANDLES BEFORE the
    displacement, the setup is named "SLG + <basename>".
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .. import config
from .displacement import Displacement
from .fvg import Gap, find_simple_gaps


@dataclass
class Setup:
    name: str                # "OSG", "2G", "2CG", "3G", "3CG", "MG", or "SLG + X"
    entry_price: float       # midpoint of the chosen gap
    entry_idx_hint: int      # candle index AT WHICH the chosen gap completes
                             # (entry triggers when price returns to mid)
    chosen_gap: Gap          # the gap whose mid was used
    all_gaps: list[Gap]      # all gaps within the displacement (excluding SLG)
    has_slg: bool
    slg_gap: Gap | None
    displacement: Displacement
    mss: object = None       # MSSEvent — populated by pipeline AFTER classification
                             # (using find_last_mss_in_range up to chosen_gap.c3_idx)


def classify(df: pd.DataFrame, disp: Displacement, gaps: list[Gap]) -> Setup | None:
    """Return a Setup or None if no setup applies."""
    # Order gaps chronologically
    gaps = sorted(gaps, key=lambda g: g.c2_idx)
    if not gaps:
        return None

    # Detect SLG: any simple gap in the SLG_LOOKBACK_CANDLES BEFORE the displacement
    slg_gap = _find_slg(df, disp)
    has_slg = slg_gap is not None

    n = len(gaps)
    base: str
    chosen: Gap

    if n == 1:
        base = "OSG"
        chosen = gaps[0]
    elif n == 2:
        base = "2CG" if _all_consecutive(gaps) else "2G"
        chosen = gaps[-1]  # last (most recent in direction)
    elif n == 3:
        base = "3CG" if _all_consecutive(gaps) else "3G"
        chosen = gaps[1]   # middle
    else:  # >= 4
        base = "MG"
        mg_chosen = _mg_choose_gap(df, disp, gaps)
        if mg_chosen is None:
            return None  # no 50% retracement happened in time
        chosen = mg_chosen

    name = f"SLG + {base}" if has_slg else base
    return Setup(
        name=name,
        entry_price=chosen.midpoint,
        entry_idx_hint=chosen.c3_idx,
        chosen_gap=chosen,
        all_gaps=gaps,
        has_slg=has_slg,
        slg_gap=slg_gap,
        displacement=disp,
    )


def _all_consecutive(gaps: list[Gap]) -> bool:
    """True if all c2 indices are adjacent (no candle gap between)."""
    for prev, curr in zip(gaps, gaps[1:]):
        if curr.c2_idx - prev.c2_idx != 1:
            return False
    return True


def _find_slg(df: pd.DataFrame, disp: Displacement) -> Gap | None:
    """Search for a single simple gap in the SLG_LOOKBACK_CANDLES BEFORE the displacement."""
    lookback = config.SLG_LOOKBACK_CANDLES
    start = max(1, disp.start_idx - lookback)
    end = max(1, disp.start_idx - 1)
    if end < start:
        return None
    simple_gaps = find_simple_gaps(df, start, end)
    if not simple_gaps:
        return None
    # SLG = last (closest to displacement) simple gap aligned with trade direction
    direction_match = "bearish" if disp.direction == "sell" else "bullish"
    aligned = [g for g in simple_gaps if g.direction == direction_match]
    return aligned[-1] if aligned else None


def _mg_choose_gap(df: pd.DataFrame, disp: Displacement, gaps: list[Gap]) -> Gap | None:
    """For MG setup, find the first gap after a 50% retracement of the displacement.

    Steps:
      1. Compute 50% level of [disp.high, disp.low] in the trade direction.
      2. Walk forward from disp.end_idx for MG_CORRECTION_TIMEOUT_CANDLES.
      3. The 50% level must be retraced (price returns through it).
      4. After that retracement, return the first gap whose c2_idx >= retrace_idx.
    """
    direction = disp.direction
    threshold = config.MG_CORRECTION_THRESHOLD
    if direction == "buy":
        # Displacement was bullish: from disp.low (start) to disp.high (end).
        # 50% retrace = disp.high - 0.5 * (disp.high - disp.low)
        level_50 = disp.high - threshold * (disp.high - disp.low)
    else:  # sell
        level_50 = disp.low + threshold * (disp.high - disp.low)

    retrace_idx = _find_retracement(df, disp, level_50)
    if retrace_idx is None:
        return None

    # The chosen gap is the first gap (by c2_idx) AT or AFTER retrace_idx.
    # If no gap satisfies that (which shouldn't happen if displacement has >=4 gaps),
    # fall back to the last gap before retracement.
    candidates = [g for g in gaps if g.c2_idx >= retrace_idx]
    if candidates:
        return candidates[0]
    return gaps[-1]


def _find_retracement(df: pd.DataFrame, disp: Displacement, level: float) -> int | None:
    """Find the first candle index after disp.end_idx where price crosses `level`
    in the corrective direction."""
    n = len(df)
    end = min(n, disp.end_idx + config.MG_CORRECTION_TIMEOUT_CANDLES + 1)
    for j in range(disp.end_idx + 1, end):
        candle = df.iloc[j]
        if disp.direction == "buy":
            if candle["low"] <= level:
                return j
        else:
            if candle["high"] >= level:
                return j
    return None
