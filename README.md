# DE30EUR Trading Engine + Analytics Dashboard

A backtest engine and analytics dashboard for an institutional-style intraday strategy on
**DE30EUR** (German DAX, M1 candles). Detects liquidity touches, validates with market
structure shifts, executes on FVG-based entries at fixed 1:2 RR.

> Latest backtest: **2020-01 → 2026-05** (1.94M M1 candles) → **89 trades, 27% win rate,
> −7.0% account return** at 1% risk per trade. The unfiltered strategy is below the
> 33.3% break-even threshold; see [Tuning the strategy](#tuning-the-strategy) for ideas.

```
┌─────────────────────────┐         ┌──────────────────────────┐
│ engine/  (Python)       │  ───►   │ public/engine-data/      │
│ - Loads M1 CSV          │ publish │ result.json + snapshots  │
│ - Detects liquidity     │         └──────────────────────────┘
│ - Simulates trades      │                       │ auto-refresh (4s poll)
│ - Renders dark snapshots│                       ▼
└─────────────────────────┘         ┌──────────────────────────┐
                                    │ src/  (React + Vite)     │
                                    │ Analytics dashboard      │
                                    │ http://localhost:5173    │
                                    └──────────────────────────┘
```

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [First-run walkthrough (clone to dashboard live)](#first-run-walkthrough)
3. [Exporting M1 candles from MetaTrader](#exporting-m1-candles-from-metatrader)
4. [Engine CLI reference](#engine-cli-reference)
5. [Dashboard usage](#dashboard-usage)
6. [Strategy rules](#strategy-rules)
7. [Output schema](#output-schema)
8. [Tuning the strategy](#tuning-the-strategy)
9. [Troubleshooting](#troubleshooting)
10. [Project structure](#project-structure)

---

## Prerequisites

| Tool | Version | Verify |
|---|---|---|
| Python | 3.11 or newer | `python --version` |
| Node.js | 20 or newer | `node --version` |
| npm | 10 or newer | `npm --version` |
| Git | any recent | `git --version` |
| MetaTrader 4 or 5 | for CSV export | account from any broker that has DE30EUR |

Tested on Windows 11 (PowerShell). Should work on macOS / Linux too — just adapt the
backtick line continuations to backslashes and `.venv\Scripts\activate` to
`source .venv/bin/activate`.

---

## First-run walkthrough

This is the fastest path from `git clone` to seeing your first 13 trades in the browser.
Allow ~15 minutes the first time (most of it is `npm install` + `pip install`).

### Step 1 — clone & enter

```powershell
git clone https://github.com/UifaleanStefan/proiect-dani.git
cd proiect-dani
```

### Step 2 — install React dashboard deps

```powershell
npm install
```

(One-time. Takes 1–2 min, downloads ~360 MB into `node_modules/`.)

### Step 3 — install Python engine deps

```powershell
cd engine
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

(One-time. Takes 2–3 min, downloads ~250 MB into `engine/.venv/`. Heaviest packages
are pandas, numpy, matplotlib, mplfinance.)

### Step 4 — get an M1 candle CSV

You need a tab-separated CSV in MetaTrader export format. See the dedicated
[section below](#exporting-m1-candles-from-metatrader) — quickest path is to ask
the colleague who set this up to email you the file they used (typically
`DE30EUR.csv`, ~100 MB for 6 years of data).

Place it anywhere; for the default settings, the engine looks at
`D:/Downloads/DE30EUR.csv`. You can override this with the `--csv` flag.

### Step 5 — run the engine for the first time

From the `engine/` folder with the venv active:

```powershell
cd engine
.venv\Scripts\activate

# Smoke test: just 1 month of 2026, no news scrape (uses cached news), with snapshots
python -m engine `
  --csv D:\Downloads\DE30EUR.csv `
  --from-date 2026-04-01 --to-date 2026-04-30 `
  --news data\news_cache.json `
  --render-snapshots `
  --publish-to ..\public\engine-data `
  --out data\runs\first_run
```

You should see output like:

```
[1/7] Loading CSV: D:\Downloads\DE30EUR.csv
      23,667 candles, 2026-04-01 02:15:00+03:00 -> 2026-04-30 21:58:00+03:00
[2/7] Annotating swings + ATR + daily bias
[3/7] Detecting liquidity sweeps
      ... sweep events
[4/7] Building setups (MSS + displacement + FVG + classifier)
      ... candidate setups
[5/7] Simulating trades
      ... trades after dedupe + schedule filter
[6/7] Rendering N chart snapshots (trade + liquidity)
[7/7] Computing per-trade stats + narrative + writing output
      -> data\runs\first_run\result.json
      -> data\runs\first_run\stats_summary.json
      -> published to D:\ProiectDani\public\engine-data

DONE: N trades written
```

### Step 6 — launch the dashboard

In a **second terminal** (the first is still in `engine/`):

```powershell
# from repo root
npm run dev
```

Open **http://localhost:5173** in your browser. You should see:

- A hero row with 4 stat cards (Account Return, Win Rate, Total Trades, News-Tagged)
- A green/red equity-curve area chart
- A donut chart of setup distribution
- A grid of trade cards each with a dark-themed chart snapshot
- Click any card → full-size modal with two snapshot tabs (Setup + Liquidity context)

### Step 7 — full historical run

When you're ready, run on the full dataset and publish:

```powershell
cd engine
.venv\Scripts\activate

python -m engine `
  --csv D:\Downloads\DE30EUR.csv `
  --news data\news_cache.json `
  --refresh-news `
  --render-snapshots `
  --publish-to ..\public\engine-data `
  --out data\runs\full
```

Expect 5–10 minutes for ~2M candles. The dashboard auto-refreshes within 4 seconds
of `--publish-to` writing the new `manifest.json` — no need to reload the browser tab.

---

## Exporting M1 candles from MetaTrader

The engine needs M1 OHLCV in MetaTrader's standard CSV export format. **You cannot
use the official `Tools → History Center → Export` flow alone — it stops at ~512 K bars
unless you raise the limit.** Steps:

### MT5

1. Open MT5 → log in to your broker account
2. **Tools** → **Options** → **Charts** tab → set "Max bars in chart" to **9999999999**
   (or as high as the slider allows). Restart MT5.
3. Open a DE30 chart at the M1 timeframe (`Ctrl+M` to show Market Watch, drag `Germany 30`
   onto chart, press `M1` button at top).
4. Scroll the chart all the way to the left until you reach the earliest data your broker
   has. The chart will request the full history from the server.
5. **File** → **Save as** → CSV. Pick a filename like `DE30EUR.csv`.
6. Open the file in a text editor — confirm it's **tab-separated** with the header row:

   ```
   <DATE>  <TIME>  <OPEN>  <HIGH>  <LOW>   <CLOSE> <TICKVOL>       <VOL>   <SPREAD>
   ```

7. Confirm date format is `2025.05.10` (with dots) and time is `14:30:00`. If your broker
   uses commas, open the file in Excel and re-export as `Text (Tab delimited)`.

### MT4

Same as MT5 except: **Tools → History Center → DE30EUR → M1 → Export**. May need
[FXReplay](https://fxreplay.com) or a similar add-on to get longer history.

### File size sanity

| Period | Approx size |
|---|---|
| 1 month | ~2 MB |
| 4 months | ~6 MB |
| 1 year | ~20 MB |
| 6 years | ~115 MB |

Save anywhere — pass the path with `--csv`. Default is `D:/Downloads/DE30EUR.csv`.

---

## Engine CLI reference

Run from `engine/` with the venv activated.

```
python -m engine --help
```

| Flag | Default | Description |
|---|---|---|
| `--csv PATH` | `D:/Downloads/DE30EUR.csv` | Tab-separated MetaTrader M1 CSV |
| `--out DIR` | required | Where to write `result.json`, `stats_summary.json`, `snapshots/` |
| `--news PATH` | none | JSON file of news events; if `--refresh-news` is also set, this file is updated in place |
| `--from-date YYYY-MM-DD` | none | Slice start (inclusive) |
| `--to-date YYYY-MM-DD` | none | Slice end (inclusive) |
| `--render-snapshots` | off | Generate PNG charts (~50 KB each, dark theme) |
| `--refresh-news` | off | Scrape investing.com economic calendar before running |
| `--news-window-days N` | 180 | How many days back to fetch when refreshing news |
| `--publish-to PATH` | none | After run, copy outputs into the React app's `public/engine-data/` so the dashboard picks them up |

### Common recipes

**Full backtest, no snapshots (fastest)**:
```powershell
python -m engine --csv D:\Downloads\DE30EUR.csv --out data\runs\fast
```

**Slice + snapshots + publish to dashboard**:
```powershell
python -m engine `
  --csv D:\Downloads\DE30EUR.csv `
  --from-date 2026-01-01 --to-date 2026-05-14 `
  --news data\news_cache.json `
  --render-snapshots `
  --publish-to ..\public\engine-data `
  --out data\runs\q1q2_2026
```

**Refresh news (Cloudflare-protected, may rate-limit)**:
```powershell
python -m engine --refresh-news --news-window-days 90 --news data\news_cache.json --out tmp --csv D:\Downloads\DE30EUR.csv
```

---

## Dashboard usage

The dashboard is a single-page React app that reads `public/engine-data/result.json`
and `stats_summary.json`. Auto-refresh: it polls `manifest.json` every 4 seconds and
re-fetches when `published_at` changes.

### Hero stats (top)

- **Account Return @ 1% risk** — sum of all outcomes assuming 1% risk per trade
  (Win = +2%, Loss = −1%, BE = 0%)
- **Win Rate** — wins / decided. Must exceed 33.3% to be net-profitable at 1:2 RR.
- **Total Trades** — count vs `csv_range.candles`
- **News-Tagged** — how many trades touched a major news event

### Equity curve

Smooth area chart of cumulative % at 1% risk. Hover for tooltip with date + trade
result + cumulative %.

### Setup distribution donut

Per-setup count and per-setup win rate side-by-side. Helps spot which setups carry
the strategy.

### Filter bar

Chip selectors for Result / Side / Session / Liquidity tier + a "News only" toggle.
The grid below filters live with framer-motion layout transitions.

### Trade grid

Each card shows the chart snapshot + key fields (setup, liquidity tier + age, MSS
type, session, news, SL points, gap size/fill time, Rvol, ATH distance). Click a
card to open the detail modal.

### Detail modal

Two snapshot tabs:
- **Setup** — 20 candles before sweep → 20 candles after exit, with liquidity line,
  MSS arrow (white horizontal), gap rectangles (white semi-transparent + dotted
  midline), TP box (green), SL box (white), entry triangle, exit X marker, BE dot
  if armed
- **Liquidity context** — wider view showing the level formation + touch point

Plus a sidebar with all schema fields organized by Performance / Setup / Market context /
Auto-info sections. Press `Escape` to close.

---

## Strategy rules

(See `engine/README.md` for full implementation details.)

1. **Trading hours** (entry time only): 10:15–16:15 + 16:45–22:30 Europe/Bucharest
2. **Liquidity zones** (qualitative ATR-prominence over a bilateral window):
   - **Local** — 1.2× ATR over ±12-candle window, ≥ 3h old when touched
   - **Major** — 2.5× ATR over ±50-candle window, ≥ 3 business days old
   - **HOD/LOD** — extreme between previous day's last candle and 10:00, touched 10:00–12:00
3. **Touch, not sweep** — price reaches the level; no need to cross
4. **MSS** — last valid swing (≥ 2 green + ≥ 2 red surrounding) broken in trade direction
5. **Displacement + FVG** — ≥ 2 prominent candles after touch; gap direction + c2 candle
   color must match trade (bullish gap on green c2 for Buy, bearish gap on red c2 for Sell)
6. **Setup classification** — OSG / 2G / 2CG / 3G / 3CG / MG, optional SLG prefix
7. **Entry** — at chosen-gap midpoint; skipped if not filled within 60 min
8. **Exit** — fixed **1:2 RR**, SL moved to entry at 1.4 RR (break-even)

---

## Output schema

Each entry in `public/engine-data/result.json`:

```json
{
  "id":                  "1771332960000",
  "market":              "DE30EUR",
  "year":                "2026",
  "ddMm":                "17/02",
  "time":                "14:56",
  "Bias":                "negative",
  "order":               "Buy",
  "liquidity":           "Local",
  "age":                 "5h12m",
  "tradeduration":       "1h47m",
  "mss":                 "Body",
  "additionalLiquidity": "None",
  "setup":               "OSG",
  "setuptime":           "20m",
  "volatility":          "0.87x",
  "Rvol":                "2.13",
  "gapsize":             "11.4",
  "gapfill":             "5m",
  "slPoints":            "15.7",
  "result":              "Win",
  "news":                "US CPI",
  "session":             "London",
  "photoUrl":            "snapshots/<id>.png",
  "liquidityUrl":        "snapshots/<id>_liq.png",
  "ath":                 "-2.97%",
  "info":                "Romanian auto-info text"
}
```

`stats_summary.json` adds: total/wins/losses/BE/win_rate_pct/account_return_pct_at_1pct_risk +
per-setup, per-session, per-liquidity breakdowns.

---

## Tuning the strategy

All thresholds live in **`engine/src/engine/config.py`**. After editing, re-run the
engine; no rebuild needed.

| What to change | Variable | Default | Effect |
|---|---|---|---|
| More tradeable Local liquidities | `LOCAL_PROMINENCE_ATR` | `1.2` | Lower → more levels |
| More Major liquidities | `MAJOR_PROMINENCE_ATR` | `2.5` | Lower → more Majors |
| Wider gap-fill window | `GAP_ENTRY_TIMEOUT_MINUTES` | `60` | Higher → fewer skips |
| Looser displacement | `DISPLACEMENT_ATR_MULTIPLIER` | `1.5` | Lower → more displacements |
| Tighter SL buffer | `SL_BUFFER_POINTS` | `2.0` | Lower → smaller risk per trade |
| Different TP ratio | `TP_RR_RATIO` | `2.0` | 1.5 = easier win, 3.0 = bigger wins |
| Earlier BE trigger | `BE_RR_TRIGGER` | `1.4` | Lower → BE armed sooner |
| Trading windows | `TRADING_WINDOWS` | London + NY | Trim hours |

### Ideas for boosting win rate above 33.3%

The current 27% on the unfiltered strategy is below break-even. Most-likely high-yield
filters (not yet implemented in the pipeline — add them in `pipeline.py` between the
`outcomes` list and the dedupe step):

1. **Bias filter** — only Buy when `daily_bias=positive`, only Sell when `daily_bias=negative`
2. **News filter** — skip trades where `news != "None"` (or specifically skip CPI/NFP/FOMC days)
3. **HOD/LOD only** — these tier-2 sweeps usually have better R/R than internal Locals
4. **Volatility filter** — skip trades where `volatility < 0.7x` (low-volatility days
   stall and never reach TP)
5. **Setup-type filter** — drop setup types whose `by_setup.win_rate_pct` is < 30%
   from the published `stats_summary.json`

---

## Troubleshooting

### `FileNotFoundError: D:/Downloads/DE30EUR.csv`
Pass `--csv <your-actual-path>` or move the file there.

### `ValueError: unable to parse string "2020-01-02"`
Your CSV is comma-separated or uses a different date format. Re-export from MT
as "Tab delimited" with `YYYY.MM.DD` dates.

### Engine takes forever on big CSVs
For initial testing, always use `--from-date` / `--to-date` to slice. A full 6-year
run takes 5–10 minutes; a 1-month slice takes <1 minute.

### `[scraper] HTTP 403 (likely blocked by Cloudflare)`
investing.com is rate-limiting your IP. The run continues with whatever events
were already in `news_cache.json`. Wait a few minutes and retry, or run with a
smaller `--news-window-days`.

### Dashboard shows "Couldn't load engine data"
Either:
- Engine never ran with `--publish-to ../public/engine-data`
- Vite isn't running (`npm run dev`)
- Open the browser dev console (F12) — the React app prints the exact fetch error

### Port 5173 already in use
Some other Vite project. `netstat -ano | findstr :5173` → `taskkill /PID <pid> /F`.

### Snapshot rendering crashes with `KeyError: 'High'`
Make sure your CSV columns include `<HIGH>` exactly (not `<HIG>` or `<H>`).
Open the file's first line in a text editor.

---

## Project structure

```
proiect-dani/
├── README.md                          ← you are here
├── package.json                       ← React deps + scripts
├── vite.config.ts                     ← Vite config
├── tailwind.config.js                 ← design tokens
├── tsconfig*.json
├── index.html                         ← Vite entrypoint
├── src/                               ← React dashboard
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── types.ts
│   ├── lib/                           ← cn, format, geo helpers
│   ├── store/useTrades.tsx            ← state + auto-refresh polling
│   └── components/
│       ├── BackgroundLayer.tsx
│       ├── ui/                        ← GlassCard, Pill, StatBadge
│       └── analytics/
│           ├── AnalyticsView.tsx      ← page orchestrator
│           ├── TopBar.tsx
│           ├── HeroStats.tsx
│           ├── EquityCurve.tsx        ← smooth area chart
│           ├── SetupBreakdown.tsx     ← donut chart
│           ├── SessionLiquidityCards.tsx
│           ├── FilterBar.tsx          ← chip filters
│           ├── TradeGrid.tsx
│           ├── TradeCard.tsx          ← per-trade card with snapshot
│           └── TradeDetailModal.tsx   ← lightbox modal
├── public/
│   ├── favicon.svg
│   └── engine-data/                   ← engine output lands here (gitignored except .gitkeep)
└── engine/                            ← Python backtest engine
    ├── README.md                      ← engine-specific docs
    ├── pyproject.toml
    ├── requirements.txt
    ├── src/engine/
    │   ├── __main__.py
    │   ├── cli.py
    │   ├── config.py                  ← ALL TUNABLE THRESHOLDS
    │   ├── pipeline.py                ← end-to-end orchestrator
    │   ├── io/                        ← csv_loader, news_scraper, result_writer
    │   ├── detectors/                 ← liquidity, mss, displacement, fvg, setup_classifier, swings
    │   ├── filters/                   ← schedule, news_filter
    │   ├── simulator/trade.py         ← entry, SL, TP, BE simulator
    │   ├── stats/                     ← volatility, rvol, gap, ath, bias
    │   ├── rendering/snapshot.py      ← mplfinance dark-theme charts
    │   └── narrative/info_text.py     ← auto-generated Romanian trade summaries
    ├── tests/                         ← pytest, 23 tests
    └── data/
        ├── news_cache.json            ← 109 investing.com events (committed)
        └── runs/                      ← per-run outputs (gitignored)
```

---

## Contributing / next steps

- Open issues at https://github.com/UifaleanStefan/proiect-dani/issues
- Run tests before pushing: `cd engine && .venv\Scripts\python -m pytest tests/`
- The engine is designed to be modular — each detector is one file with clear in/out;
  swapping or extending a detector should not require changes elsewhere
- The dashboard is purely presentational — it reads from `public/engine-data/` and
  doesn't know anything about strategy logic

Have fun.
