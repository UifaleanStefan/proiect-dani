"""Chart snapshot renderer — TradingView-style DARK theme.

Two outputs per trade:
  1. Trade snapshot: 20 candles before sweep -> 20 candles after exit
     with full annotations (sweep level truncated at sweep, MSS arrow,
     gap rectangles with dotted midline, TP green box, SL white-transparent box).
  2. Liquidity snapshot: a wider context view that shows where the liquidity
     was formed (the pivot) and where it was swept (no execution annotations).

Style follows TradingView dark template:
  - Background:        #131722
  - Panel/grid:        #1E222D / #2A2E39
  - Up candles:        #26A69A (teal-green)
  - Down candles:      #EF5350 (red)
  - Text/labels:       #D1D4DC
  - Accent annotations:bright cyan #00BCD4
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd

from .. import config
from ..simulator.trade import TradeOutcome


# --- Colors ---------------------------------------------------------------------
BG = "#131722"
PANEL = "#1E222D"
GRID = "#2A2E39"
TEXT = "#D1D4DC"
TEXT_MUTED = "#787B86"
UP = "#26A69A"
DOWN = "#EF5350"
ACCENT = "#FFFFFF"        # MSS arrow — white (per v0.4 spec)
LIQ_LINE = "#FFFFFF"      # liquidity line — white at body level (per v0.4 spec)
GAP_FACE = "rgba(255,255,255,0.10)"  # not used directly, kept for reference
TP_FACE = (0.149, 0.651, 0.604, 0.28)  # #26A69A semi-transparent
SL_FACE = (1.0, 1.0, 1.0, 0.16)         # white 16% (slightly stronger than 50% looks washed)
GAP_FACE_RGBA = (1.0, 1.0, 1.0, 0.14)
GAP_EDGE_RGBA = (1.0, 1.0, 1.0, 0.55)
ENTRY_LINE = "#FFFFFF"
BE_COLOR = "#F4B83A"

_MARKET_COLORS = mpf.make_marketcolors(
    up=UP,
    down=DOWN,
    edge={"up": UP, "down": DOWN},
    wick={"up": UP, "down": DOWN},
    volume={"up": UP, "down": DOWN},
)

_STYLE = mpf.make_mpf_style(
    base_mpf_style="nightclouds",
    marketcolors=_MARKET_COLORS,
    facecolor=BG,
    edgecolor=GRID,
    figcolor=BG,
    gridcolor=GRID,
    gridstyle=":",
    rc={
        "axes.labelcolor": TEXT_MUTED,
        "xtick.color": TEXT_MUTED,
        "ytick.color": TEXT_MUTED,
        "axes.edgecolor": GRID,
        "axes.facecolor": BG,
        "figure.facecolor": BG,
        "savefig.facecolor": BG,
        "font.size": 9,
        "text.color": TEXT,
    },
)

_BEFORE = config.SNAPSHOT_CANDLES_BEFORE
_AFTER = config.SNAPSHOT_CANDLES_AFTER


# --- Helpers --------------------------------------------------------------------


def _setup_figure(window: pd.DataFrame, *, figsize=(12, 7)):
    """Render the candle base and return (fig, ax)."""
    ohlc = window[["open", "high", "low", "close"]].rename(
        columns={"open": "Open", "high": "High", "low": "Low", "close": "Close"}
    )
    fig, axes = mpf.plot(
        ohlc,
        type="candle",
        style=_STYLE,
        figsize=figsize,
        returnfig=True,
        warn_too_much_data=10000,
        tight_layout=False,
        scale_padding={"left": 0.5, "right": 1.6, "top": 0.6, "bottom": 0.4},
        datetime_format="%H:%M",
        xrotation=0,
    )
    return fig, axes[0]


def _set_title(ax, text: str):
    ax.set_title(text, fontsize=11, color=TEXT, fontweight="bold", loc="left", pad=12)


# --- Trade snapshot -------------------------------------------------------------


def render_trade(df: pd.DataFrame, outcome: TradeOutcome, out_path: Path) -> None:
    """Render the full trade snapshot (sweep + MSS + gap + TP/SL boxes)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    setup = outcome.setup
    disp = setup.displacement
    sweep = disp.sweep
    mss = setup.mss  # may be None

    window_start = max(0, sweep.sweep_idx - _BEFORE)
    window_end = min(len(df) - 1, outcome.exit_idx + _AFTER)
    window = df.iloc[window_start : window_end + 1]
    n = len(window)

    fig, ax = _setup_figure(window)

    def rel(idx: int) -> int:
        return idx - window_start

    # --- 1. Liquidity sweep level (TRUNCATED at sweep, drawn at body level) ---
    pivot_x = max(0, rel(sweep.pivot_idx))
    sweep_x = rel(sweep.sweep_idx)
    if 0 <= sweep_x < n:
        ax.plot(
            [pivot_x - 0.5, sweep_x + 0.5],
            [sweep.display_price, sweep.display_price],
            color=LIQ_LINE,
            linewidth=1.2,
            linestyle="-",
            zorder=3,
        )
        label = f"Liq. {sweep.liquidity_type}"
        ax.annotate(
            label,
            xy=(pivot_x + 0.5, sweep.display_price),
            xytext=(0, 8 if sweep.direction == "sell" else -16),
            textcoords="offset points",
            fontsize=9,
            fontweight="bold",
            color=LIQ_LINE,
        )

    # --- 2. MSS arrow — WHITE, perfectly HORIZONTAL at the broken pivot price ---
    if mss is not None:
        mss_pivot_x = rel(mss.broken_swing_idx)
        mss_x = rel(mss.mss_idx)
        if 0 <= mss_pivot_x < n and 0 <= mss_x < n:
            # Horizontal arrow at the broken pivot's price level. The fact that
            # the body/wick of mss candle is past this level is implied by the
            # arrow's destination x-coordinate (the breaking candle).
            ax.annotate(
                "",
                xy=(mss_x, mss.broken_swing_price),
                xytext=(mss_pivot_x, mss.broken_swing_price),
                arrowprops=dict(
                    arrowstyle="-|>",
                    color=ACCENT,
                    lw=1.4,
                    shrinkA=2,
                    shrinkB=2,
                ),
                zorder=4,
            )
            # MSS label centered below (for sells) or above (for buys)
            ax.annotate(
                f"MSS {mss.mss_kind}",
                xy=((mss_pivot_x + mss_x) / 2, mss.broken_swing_price),
                xytext=(0, -14 if outcome.direction == "sell" else 8),
                textcoords="offset points",
                fontsize=8,
                color=ACCENT,
                fontweight="bold",
                ha="center",
            )

    # --- 3. Gap rectangles (semi-transparent white + dotted midline) ----
    for g in setup.all_gaps:
        c1_x = rel(g.c1_idx)
        c3_x = rel(g.c3_idx)
        if c1_x < 0 or c3_x >= n:
            continue
        is_chosen = g is setup.chosen_gap
        # Gap rectangle
        ax.add_patch(mpatches.Rectangle(
            (c1_x - 0.5, g.bottom),
            (c3_x + 0.5) - (c1_x - 0.5),
            g.top - g.bottom,
            facecolor=GAP_FACE_RGBA,
            edgecolor=GAP_EDGE_RGBA if is_chosen else (1, 1, 1, 0.28),
            linewidth=1.1 if is_chosen else 0.6,
            zorder=2,
        ))
        # Dotted midline at execution price (only for chosen gap to reduce noise)
        if is_chosen:
            ax.plot(
                [c1_x - 0.5, c3_x + 0.5],
                [g.midpoint, g.midpoint],
                color="#FFFFFF",
                linewidth=1.0,
                linestyle=(0, (1, 2)),
                zorder=4,
            )

    # SLG (simple gap before displacement) — drawn lighter
    if setup.has_slg and setup.slg_gap:
        g = setup.slg_gap
        c1_x = rel(g.c1_idx)
        c3_x = rel(g.c3_idx)
        if c1_x >= 0 and c3_x < n:
            ax.add_patch(mpatches.Rectangle(
                (c1_x - 0.5, g.bottom),
                (c3_x + 0.5) - (c1_x - 0.5),
                g.top - g.bottom,
                facecolor=(0.0, 0.737, 0.831, 0.16),
                edgecolor=(0.0, 0.737, 0.831, 0.55),
                linewidth=0.9,
                zorder=2,
            ))

    # --- 4. TP / SL boxes (from entry to exit) -----------------------------
    entry_x = rel(outcome.entry_idx)
    exit_x = rel(outcome.exit_idx)
    box_left = max(entry_x - 0.5, 0)
    box_right = min(exit_x + 0.5, n - 0.5)
    if box_right > box_left:
        # TP box (green) — above entry for buy, below for sell
        if outcome.direction == "buy":
            tp_top = outcome.tp_price
            tp_bottom = outcome.entry_price
            sl_top = outcome.entry_price
            sl_bottom = outcome.sl_price
        else:
            tp_top = outcome.entry_price
            tp_bottom = outcome.tp_price
            sl_top = outcome.sl_price
            sl_bottom = outcome.entry_price
        ax.add_patch(mpatches.Rectangle(
            (box_left, tp_bottom),
            box_right - box_left,
            tp_top - tp_bottom,
            facecolor=TP_FACE,
            edgecolor=(0.149, 0.651, 0.604, 0.7),
            linewidth=0.8,
            zorder=1,
        ))
        ax.add_patch(mpatches.Rectangle(
            (box_left, sl_bottom),
            box_right - box_left,
            sl_top - sl_bottom,
            facecolor=SL_FACE,
            edgecolor=(1, 1, 1, 0.4),
            linewidth=0.8,
            zorder=1,
        ))

    # --- 5. Entry marker + price label ------------------------------------
    if 0 <= entry_x < n:
        marker = "^" if outcome.direction == "buy" else "v"
        ax.plot(
            entry_x, outcome.entry_price,
            marker=marker, markersize=11,
            markerfacecolor=ENTRY_LINE,
            markeredgecolor=BG,
            markeredgewidth=1.5,
            zorder=10,
        )

    # --- 6. Right-edge labels for entry / SL / TP -------------------------
    right_x = n - 0.4
    ax.text(right_x, outcome.entry_price, f"  {outcome.entry_price:.1f}",
            color=ENTRY_LINE, fontsize=8.5, va="center", fontweight="bold")
    ax.text(right_x, outcome.sl_price, f"  SL {outcome.sl_points:.1f}p",
            color="#FFFFFF", fontsize=8, va="center", alpha=0.75)
    ax.text(right_x, outcome.tp_price, "  TP 2RR",
            color=UP, fontsize=8, va="center", fontweight="bold")

    # --- 7. Exit marker ----------------------------------------------------
    if 0 <= exit_x < n:
        result_color = {
            "Win": UP, "Loss": DOWN, "Break Even": BE_COLOR, "Open": TEXT_MUTED,
        }.get(outcome.result, TEXT_MUTED)
        ax.plot(
            exit_x, outcome.exit_price,
            marker="X", markersize=11,
            markerfacecolor=result_color,
            markeredgecolor=BG,
            markeredgewidth=1.5,
            zorder=10,
        )

    # --- 8. BE marker ------------------------------------------------------
    if outcome.be_armed:
        be_threshold = config.BE_RR_TRIGGER * outcome.risk_points
        for j in range(outcome.entry_idx + 1, outcome.exit_idx + 1):
            c = df.iloc[j]
            hit = (
                outcome.direction == "buy" and (c["high"] - outcome.entry_price) >= be_threshold
            ) or (
                outcome.direction == "sell" and (outcome.entry_price - c["low"]) >= be_threshold
            )
            if hit:
                be_x = rel(j)
                if 0 <= be_x < n:
                    ax.plot(
                        be_x, outcome.entry_price,
                        marker="o", markersize=7,
                        markerfacecolor=BE_COLOR,
                        markeredgecolor=BG,
                        markeredgewidth=1.2,
                        zorder=9,
                    )
                    ax.annotate("BE", xy=(be_x, outcome.entry_price),
                                xytext=(6, 6), textcoords="offset points",
                                fontsize=7, color=BE_COLOR, fontweight="bold")
                break

    # --- Title -------------------------------------------------------------
    entry_local = outcome.entry_time.tz_convert(config.TIMEZONE)
    title = (
        f"{config.MARKET_LABEL} · M1   "
        f"{outcome.direction.upper()}  {setup.name}   "
        f"{sweep.liquidity_type}   "
        f"{entry_local.strftime('%Y-%m-%d %H:%M')}   "
        f"→ {outcome.result}"
    )
    _set_title(ax, title)

    fig.savefig(out_path, dpi=110, bbox_inches="tight", facecolor=BG)
    plt.close(fig)


# --- Liquidity-only snapshot ----------------------------------------------------


def render_liquidity(df: pd.DataFrame, outcome: TradeOutcome, out_path: Path) -> None:
    """v0.6 liquidity context: the overnight window strictly from
    prev-day 22:55 -> touch-day 10:05, showing BOTH the HOD and LOD levels.
    The level that the trade was taken on is highlighted."""
    from ..detectors.liquidity import _session_hod_lod  # local import to avoid cycle

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sweep = outcome.setup.displacement.sweep

    # --- Time window: 22:55 prev day -> 10:05 touch day ---
    touch_local = sweep.sweep_time.tz_convert(config.TIMEZONE)
    end_h, end_m = (int(x) for x in config.LIQ_PHOTO_END.split(":"))
    photo_end = pd.Timestamp(touch_local.date(), tz=config.TIMEZONE) + pd.Timedelta(
        hours=end_h, minutes=end_m
    )
    # 22:55 of the previous day == photo_end - 11h10m (10:05 - 22:55 = 11h10m)
    photo_start = photo_end - pd.Timedelta(hours=11, minutes=10)

    window = df.loc[(df.index >= photo_start) & (df.index <= photo_end)]
    if len(window) < 3:
        # Fallback to a candle-count window if the time slice is too sparse
        a = max(0, sweep.pivot_idx - 30)
        b = min(len(df) - 1, sweep.pivot_idx + 30)
        window = df.iloc[a : b + 1]
    n = len(window)

    fig, ax = _setup_figure(window, figsize=(12, 6))

    # --- Compute both HOD and LOD for the touch day ---
    day_ts = pd.Timestamp(touch_local.date())
    hod, lod = _session_hod_lod(df, day_ts)
    hod_price = hod[1] if hod is not None else None
    lod_price = lod[1] if lod is not None else None
    touched_is_hod = sweep.direction == "sell"  # sell came from HOD touch

    def draw_level(price, label, highlighted):
        if price is None:
            return
        col = LIQ_LINE if highlighted else "#5C6470"
        lw = 1.6 if highlighted else 1.0
        ax.axhline(price, color=col, linewidth=lw,
                   linestyle="-" if highlighted else "--", zorder=3, alpha=0.95 if highlighted else 0.6)
        ax.text(n - 0.5, price, f"  {label} {price:.1f}",
                color=col, fontsize=9, va="center",
                fontweight="bold" if highlighted else "normal")

    draw_level(hod_price, "HOD", touched_is_hod)
    draw_level(lod_price, "LOD", not touched_is_hod)

    # --- Title ---
    title = (
        f"{config.MARKET_LABEL} · Liquidity context   "
        f"{sweep.liquidity_type} {sweep.direction.upper()}   "
        f"overnight {photo_start.strftime('%m-%d %H:%M')} -> {photo_end.strftime('%m-%d %H:%M')}"
    )
    _set_title(ax, title)

    fig.savefig(out_path, dpi=110, bbox_inches="tight", facecolor=BG)
    plt.close(fig)


# --- Batch ----------------------------------------------------------------------


def render_all(df: pd.DataFrame, outcomes: list[TradeOutcome], out_dir: Path) -> dict[str, dict]:
    """Render snapshot + liquidity for every trade.

    Returns:
        {trade_id: {"trade": "snapshots/<id>.png", "liquidity": "snapshots/<id>_liq.png"}}
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, dict[str, str]] = {}
    total = len(outcomes)
    for i, t in enumerate(outcomes, 1):
        trade_id = str(int(t.entry_time.timestamp() * 1000))
        trade_rel = f"snapshots/{trade_id}.png"
        liq_rel = f"snapshots/{trade_id}_liq.png"
        trade_full = out_dir / f"{trade_id}.png"
        liq_full = out_dir / f"{trade_id}_liq.png"
        try:
            render_trade(df, t, trade_full)
            render_liquidity(df, t, liq_full)
            paths[trade_id] = {"trade": trade_rel, "liquidity": liq_rel}
            print(f"      [{i:>3}/{total}] {trade_id} -> trade + liq")
        except Exception as e:
            print(f"      [{i:>3}/{total}] {trade_id} FAILED: {e}")
            paths[trade_id] = {"trade": "", "liquidity": ""}
    return paths
