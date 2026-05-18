# Trading Engine — Automated Statistics for DE30EUR

Detects trade setups in M1 candle data based on the rule set agreed in
`C:/Users/User/.claude/plans/trading-engine-statistics.md`.

## Status

**v0.2 — feature complete.** All 8 user rules implemented, full schema populated,
chart snapshots rendered, news scraper live. **23 tests passing.**

## Rules implemented

- **Trading hours** (rule 2): 10:15–16:15 + 16:45–22:30 Europe/Bucharest, applied to ENTRY time.
- **Liquidity** (rule 3):
  - HOD/LOD — extreme between previous-day-last-candle and 10:00; must be swept 10:00–12:00.
  - Local — swing extremum aged 3h–3d at sweep.
  - Major — swing extremum aged 3d–8w with valid pivot structure.
  - Older Locals without structure stay Local; >8w expire and are not tradeable.
  - `additionalLiquidity` set when 2+ levels of different classes are swept within ±2 candles.
- **MSS** (rule 4): break of last "valid" swing (≥2 greens + ≥2 reds in surrounding window) on the side opposite the sweep. Body or Wick.
- **Displacement** (rule 5): ≥2 prominent candles in trade direction after MSS, where prominent = range ≥ 1.5×ATR(14). Up to 1 pause candle allowed.
- **FVG / Simple Gaps** (rule 6): 3-candle gap; FVG when middle candle is in displacement, Simple Gap otherwise.
- **Setups** (rule 7): OSG, 2G, 2CG, 3G, 3CG, MG (with 50% discount rule), SLG+ prefixes.
- **TP**: fixed 1:2 RR, no exceptions.
- **BE move** (rule 8): at 1.4 RR, SL → entry. After BE, outcome is Win or Break Even only.
- **News** (rule 1):
  - **Live scraper** for investing.com economic calendar (`--refresh-news`).
  - CPI/NFP/FOMC/Bank Holiday taint the entire trading day.
  - Other high-impact events use ±30 min window around the trade.
- **Snapshots**: chart screenshots with sweep level, MSS line, displacement zone, gap zones, entry/SL/TP lines, BE marker.

## Setup

```powershell
cd D:\ProiectDani\engine
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

### Full run with live news + chart snapshots (recommended)

```powershell
.venv\Scripts\python -m engine `
  --csv ..\1.csv `
  --news data\news_cache.json `
  --refresh-news `
  --news-window-days 180 `
  --render-snapshots `
  --out data\runs\latest
```

### Quick run on a slice (no scraping, no snapshots)

```powershell
.venv\Scripts\python -m engine `
  --csv ..\1.csv `
  --news data\news_cache.json `
  --out data\runs\april `
  --from-date 2026-04-01 `
  --to-date 2026-04-30
```

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--csv PATH` | required | Path to MetaTrader-style M1 TSV |
| `--out DIR` | required | Output directory (created if missing) |
| `--news PATH` | none | Path to `news_cache.json` |
| `--from-date YYYY-MM-DD` | none | Inclusive start date |
| `--to-date YYYY-MM-DD` | none | Inclusive end date |
| `--render-snapshots` | off | Generate PNG chart snapshots per trade (~150ms each) |
| `--refresh-news` | off | Scrape investing.com before running and merge into `--news` cache |
| `--news-window-days N` | 180 | When refreshing news, how many days back to fetch |

## Outputs

```
data/runs/<run>/
├── result.json               # one entry per trade in your exact schema
├── stats_summary.json        # aggregates: win rate, account return, breakdowns
└── snapshots/                # PNG charts (if --render-snapshots)
    ├── 1768565220000.png
    └── ...
```

### `result.json` schema

```json
{
  "id":                  "1771332960000",         // ms timestamp at entry
  "market":              "DE30EUR",
  "year":                "2026",
  "ddMm":                "17/02",
  "time":                "14:56",                 // Europe/Bucharest
  "Bias":                "negative",              // positive/neutral/negative (daily EMA + slope)
  "order":               "Buy",                   // Buy/Sell
  "liquidity":           "Local",                 // HOD/LOD/Local/Major
  "age":                 "5h12m",                 // sweep age at trigger
  "tradeduration":       "1h47m",                 // entry to exit
  "mss":                 "Body",                  // Body/Wick
  "additionalLiquidity": "None",                  // None/Local/Major
  "setup":               "OSG",                   // OSG/2G/2CG/3G/3CG/MG/SLG + ...
  "volatility":          "0.87x",                 // current day range vs 7-day median
  "Rvol":                "2.13",                  // current 5min vol vs same-slot 14-day median
  "gapsize":             "11.4",                  // chosen gap size in points
  "gapfill":             "79%",                   // how much of gap traversed at exit
  "slPoints":            "15.7",                  // |entry - SL| in points
  "result":              "Win",                   // Win/Loss/Break Even/Open
  "news":                "US CPI",                // event name or "None"
  "session":             "London",                // London/New York
  "photoUrl":            "snapshots/1771332960000.png",
  "ath":                 "-2.97%",                // signed % from rolling ATH/ALL
  "info":                "Market structure shift decent, displacement bun, ..."
}
```

## Test

```powershell
.venv\Scripts\python -m pytest tests\ -v
```

Currently **23 tests** across:
- `test_csv_loader.py` (3)
- `test_swings.py` (5)
- `test_liquidity.py` (4)
- `test_news_scraper.py` (9) — uses mocked HTML, no network
- `test_snapshot.py` (2) — renders one trade and asserts PNG exists

## Last run on supplied dataset (`D:/ProiectDani/1.csv`, Jan-May 2026, 100k M1 candles)

```
Total: 13 trades
Win rate: 30.8% (4W / 8L / 1BE)
Account return @ 1% risk: +0.0%
News-tagged trades: 3 (US CPI, FOMC Minutes, EU CPI)
News cache populated with 109 events from investing.com
All 13 trades have rendered chart snapshots
```

## Project layout

```
src/engine/
  config.py                # all knobs
  pipeline.py              # end-to-end orchestrator
  cli.py + __main__.py     # argparse entrypoint
  io/
    csv_loader.py          # tab-separated MetaTrader CSV parser
    news_scraper.py        # investing.com calendar scraper (NEW v0.2)
    result_writer.py       # result.json + stats_summary.json
  detectors/
    swings.py              # swing high/low + valid-swing + ATR
    liquidity.py           # HOD/LOD/Local/Major sweep events
    mss.py                 # market structure shift
    displacement.py        # impulsive move detection
    fvg.py                 # FVG + simple gap detection
    setup_classifier.py    # OSG/2G/2CG/3G/3CG/MG + SLG prefix
  filters/
    schedule.py            # 10:15-16:15 + 16:45-22:30
    news_filter.py         # JSON-cache lookup
  simulator/
    trade.py               # entry, BE @ 1.4 RR, fixed 1:2 TP, exit
  stats/
    volatility.py          # day range vs 7-day median
    rvol.py                # current 5min vs same-slot 14d median
    gap.py                 # gap fill %
    ath.py                 # rolling ATH/ALL distance
    bias.py                # daily EMA + slope -> positive/negative/neutral
  rendering/
    snapshot.py            # mplfinance + custom annotations (NEW v0.2)
  narrative/
    info_text.py           # Romanian auto-info per trade

tests/
  test_csv_loader.py
  test_swings.py
  test_liquidity.py
  test_news_scraper.py     (NEW v0.2)
  test_snapshot.py         (NEW v0.2)
```

## Notes on the live news scraper

investing.com is behind Cloudflare. The scraper:
- Sets realistic browser headers + cookies via a primer GET
- Throttles to 1.5s between requests
- Walks the date window in 7-day chunks
- Fails gracefully — if Cloudflare blocks (HTTP 403), the existing cache is preserved
  and the run continues with whatever events were already there

A clean run on a fresh IP fetches **30+ events per week** (high-impact, US/DE/EU) including
CPI, NFP, FOMC, Trump speeches, ECB Rate, Retail Sales, etc.

After several minutes of repeated requests Cloudflare may rate-limit. You can:
- Wait a few minutes and re-run with `--refresh-news`
- Run the scraper less aggressively (smaller `--news-window-days`)
- Manually edit `data/news_cache.json` to add specific events

## Tweaking detection sensitivity

All thresholds live in `src/engine/config.py`:

- `DISPLACEMENT_ATR_MULTIPLIER` (default 1.5) — lower = more displacements detected
- `LIQUIDITY_LOCAL_MIN_HOURS` (default 3) — minimum age for a sweep to qualify
- `MSS_LOOKFORWARD_LIMIT` (default 30 candles) — how long to wait for MSS after sweep
- `BE_RR_TRIGGER` (default 1.4) — when to move SL to BE
- `TP_RR_RATIO` (default 2.0) — fixed 1:2 RR
- `BIAS_EMA_PERIOD` (default 50) — bump to 200 once CSV covers ≥1 year
- `SNAPSHOT_CANDLES_BEFORE` / `_AFTER` (default 20) — chart context window
