"""Centralized configuration. Tweak here, not in business logic."""

from __future__ import annotations
from dataclasses import dataclass, field

# Timezone the CSV timestamps are already in (broker server time = Europe/Bucharest).
TIMEZONE = "Europe/Bucharest"

# Trading windows in local time (HH:MM, inclusive)
# v0.6: morning window starts at 10:00 so post-HOD/LOD-touch setups aren't rejected.
TRADING_WINDOWS = [
    ("10:00", "16:15"),  # London → early NY
    ("16:45", "22:30"),  # NY full session
]

# Sessions for labelling (entry time → label)
SESSION_BOUNDS = {
    "London": ("10:00", "16:45"),  # before NY open
    "New York": ("16:45", "22:30"),  # after NY open
}

# News categories that taint the entire trading day (any trade that day → news=high)
ALL_DAY_HIGH_NEWS_CATEGORIES = {"cpi", "nfp", "fomc", "bank_holiday"}

# Window in minutes around any other "high impact" news event
NEWS_WINDOW_MINUTES = 30

# Liquidity classification thresholds
LIQUIDITY_LOCAL_MIN_HOURS = 3
LIQUIDITY_LOCAL_MAX_DAYS = 3
LIQUIDITY_MAJOR_MIN_DAYS = 3      # business days (Mon-Fri only) per user spec
LIQUIDITY_MAJOR_MAX_WEEKS = 8

# v0.5 — qualitative level detection (touch-based, not sweep-based)
# Local: smaller window, modest prominence — "internal" extreme
LOCAL_LOOKBACK = 12               # candles on each side
LOCAL_PROMINENCE_ATR = 1.2        # extreme must stick out by >= 1.2x ATR
# Major: wider window, stronger prominence — "external" extreme
MAJOR_LOOKBACK = 50
MAJOR_PROMINENCE_ATR = 2.5
# Heuristic for "this is a spike, use wick price" vs "this is a body cluster":
# if the wick above body / below body > this fraction of ATR, treat as spike.
LIQ_SPIKE_BODY_GAP_ATR = 0.6

# HOD/LOD window (v0.6 — the ONLY liquidity source):
#   - Formation: extreme between previous-day-last-candle (22:59) and 09:59 inclusive
#   - Touch: must be touched (>=, no sweep needed) in 10:00..12:00; else skip the day
HOD_LOD_FORMATION_END_HOUR = 10  # extremes form before 10:00
HOD_LOD_SWEEP_DEADLINE_HOUR = 12  # touch must happen before 12:00
# Liquidity-context photo window (time-of-day slice, prev-day -> touch-day)
LIQ_PHOTO_START = "22:55"  # on the previous day
LIQ_PHOTO_END = "10:05"    # on the touch day

# Swing point detection: lookback candles on each side that must be exceeded
SWING_LOOKBACK = 3

# Valid swing for MSS: requires >=N greens AND >=N reds within window of M candles around it
MSS_VALID_GREEN_COUNT = 2
MSS_VALID_RED_COUNT = 2
MSS_VALID_WINDOW = 10  # candles on each side

# Maximum candles to look forward for MSS confirmation after a sweep
MSS_LOOKFORWARD_LIMIT = 30

# Displacement: candle is "prominent" if range >= ATR_MULTIPLIER * ATR(ATR_PERIOD)
# v0.6: looser so HOD/LOD reversals (which can take longer + be less explosive than
# swing-pivot sweeps) are captured. Tuned on 2026 slice: 90/1.2 surfaces ~30/64 touches.
ATR_PERIOD = 14
DISPLACEMENT_ATR_MULTIPLIER = 1.2
DISPLACEMENT_MIN_CANDLES = 2
DISPLACEMENT_MAX_PAUSE = 2  # allow up to 2 non-prominent candles between prominent ones
DISPLACEMENT_LOOKFORWARD_LIMIT = 90  # look up to 90 min after the touch

# Setup execution
TP_RR_RATIO = 2.0  # fixed 1:2 RR, no exceptions
BE_RR_TRIGGER = 1.4  # at 1.4 RR move SL to entry
SL_BUFFER_POINTS = 2.0  # SL placed exactly this many points beyond the relevant high/low
GAP_ENTRY_TIMEOUT_MINUTES = 60  # skip trade if price doesn't enter the gap in this window

# v0.7 — minimum FVG/gap size (points). Smaller gaps are not tradeable.
MIN_FVG_SIZE_POINTS = 1.5

# v0.7 — dynamic SL size band, scaled with price.
# At SL_REF_PRICE the band is [SL_MIN_AT_REF, SL_MAX_AT_REF]. For price P the band is
# X*min, X*max where X = floor(P / SL_QUANTIZE_STEP) * SL_QUANTIZE_STEP / SL_REF_PRICE.
# (Recomputed each SL_QUANTIZE_STEP move, not per trade.) Out-of-band trades are skipped.
SL_REF_PRICE = 15000.0
SL_MIN_AT_REF = 10.0
SL_MAX_AT_REF = 35.0
SL_QUANTIZE_STEP = 1000.0

# v0.7 — load-time timestamp shift (minutes). The broker data is 1h behind TradingView,
# so we add 60 at load. Overridable via --shift-minutes.
CSV_SHIFT_MINUTES_DEFAULT = 0

# MG (Multiple Gaps) discount rule
MG_CORRECTION_THRESHOLD = 0.5  # 50% retracement of displacement
MG_CORRECTION_TIMEOUT_CANDLES = 120  # candles to wait for correction before invalidating

# SLG window: a single liquidity grab may precede a displacement by at most this many candles
SLG_LOOKBACK_CANDLES = 5

# Risk model
RISK_PER_TRADE_PCT = 1.0  # 1% account risk
WIN_PCT = 2.0  # +2% on Win (TP at 2RR)
LOSS_PCT = -1.0  # -1% on Loss
BE_PCT = 0.0  # 0% on Break Even

# Stats
RVOL_LOOKBACK_DAYS = 14  # compare current 5-min volume vs same-slot median over last N days
VOLATILITY_LOOKBACK_DAYS = 7
ATH_ENABLED = True

# Bias (daily)
# Using EMA(50) instead of EMA(200) so it works on shorter datasets (4 months ~= 80 trading days).
# Bump to 200 if/when CSV covers >= 1 year.
BIAS_EMA_PERIOD = 50
BIAS_SLOPE_LOOKBACK_DAYS = 5

# News scraping
INVESTING_CALENDAR_URL = "https://www.investing.com/economic-calendar/"
NEWS_CACHE_TTL_HOURS = 24

# Rendering
SNAPSHOT_CANDLES_BEFORE = 20
SNAPSHOT_CANDLES_AFTER = 20

# v0.8 — Manual journal: per-event interactive-chart window (local time).
#   start = touch-day JOURNAL_WINDOW_PRE_HOUR:00 ; end = sweep_time + JOURNAL_WINDOW_POST_HOURS
# Wide enough to see the overnight HOD/LOD context tail + the post-sweep setup play out.
JOURNAL_WINDOW_PRE_HOUR = 7
JOURNAL_WINDOW_POST_HOURS = 4

# CSV format
CSV_DELIMITER = "\t"
CSV_DATE_FORMAT = "%Y.%m.%d"
CSV_TIME_FORMAT = "%H:%M:%S"
CSV_COLUMNS = {
    "date": "<DATE>",
    "time": "<TIME>",
    "open": "<OPEN>",
    "high": "<HIGH>",
    "low": "<LOW>",
    "close": "<CLOSE>",
    "tickvol": "<TICKVOL>",
    "vol": "<VOL>",
    "spread": "<SPREAD>",
}

MARKET_LABEL = "DE30EUR"


# Default CSV path — full 2020-2026 history
DEFAULT_CSV_PATH = "D:/Downloads/DE30EUR.csv"


@dataclass
class RuntimeConfig:
    """Runtime-overridable subset (CLI flags can mutate this)."""
    csv_path: str = DEFAULT_CSV_PATH
    news_cache_path: str = "data/news_cache.json"
    out_dir: str = "data/runs/latest"
    refresh_news: bool = False
    render_snapshots: bool = True
    slice_start: str | None = None  # "YYYY-MM-DD" inclusive
    slice_end: str | None = None    # "YYYY-MM-DD" inclusive
    market: str = MARKET_LABEL
    extra: dict = field(default_factory=dict)
