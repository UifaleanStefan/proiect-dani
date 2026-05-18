# DE30EUR Trading Engine + Analytics Dashboard

A backtest engine and analytics dashboard for an institutional-style intraday strategy on
DE30EUR (German DAX, M1 candles). The strategy follows liquidity-touch +
market-structure-shift + FVG entry rules.

```
┌─────────────────────────┐         ┌──────────────────────────┐
│ engine/  (Python)       │  ───►   │ public/engine-data/      │
│ - Loads M1 candles      │ publish │ result.json + snapshots  │
│ - Detects liquidity     │         └──────────────────────────┘
│ - Simulates trades      │                       │ fetch (auto-refresh)
│ - Renders snapshots     │                       ▼
└─────────────────────────┘         ┌──────────────────────────┐
                                    │ src/  (React + Vite)     │
                                    │ Analytics dashboard      │
                                    └──────────────────────────┘
```

## What's inside

| Folder | What |
|---|---|
| `engine/` | Python backtest engine (pandas + mplfinance + investing.com scraper) |
| `src/` | React + Vite + TypeScript + Tailwind analytics dashboard |
| `public/engine-data/` | Where the engine publishes `result.json` + snapshots for the dashboard to fetch |

## Strategy rules (v0.5)

1. **Trading hours**: 10:15–16:15 + 16:45–22:30 Europe/Bucharest
2. **Liquidity zones** (qualitative ATR-prominence over a bilateral window):
   - **Local**: 1.2× ATR over ±12-candle window, ≥ 3h old when touched
   - **Major**: 2.5× ATR over ±50-candle window, ≥ 3 business days old
   - **HOD/LOD**: extreme between previous day's last candle and 10:00, touched 10:00–12:00
3. **Touch** (not sweep): price reaches the level — no need to cross
4. **MSS**: last valid swing (≥ 2 green + ≥ 2 red surrounding) broken in trade direction
5. **Displacement + FVG**: ≥ 2 prominent candles after touch; gap direction + c2 candle color
   must match trade (bullish gap on green c2 for Buy, bearish gap on red c2 for Sell)
6. **Setup classification**: OSG / 2G / 2CG / 3G / 3CG / MG, optional SLG prefix
7. **Entry**: at chosen-gap midpoint; skipped if not filled within 60 min
8. **Exit**: fixed **1:2 RR**, SL moved to entry at 1.4 RR (break-even)

## Quick start

### 1. Get the data

The engine needs M1 candles in MetaTrader-export format (tab-separated, columns
`<DATE>` `<TIME>` `<OPEN>` `<HIGH>` `<LOW>` `<CLOSE>` `<TICKVOL>` `<VOL>` `<SPREAD>`).
Export from MT4/MT5 — CSVs are not in the repo (multi-megabyte).

Default expected path: `D:/Downloads/DE30EUR.csv` (configurable in
`engine/src/engine/config.py` → `DEFAULT_CSV_PATH`).

### 2. Run the engine

```powershell
cd engine
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Full run with news scrape + snapshots + publish to React app:
python -m engine `
  --csv D:\Downloads\DE30EUR.csv `
  --news data\news_cache.json `
  --refresh-news `
  --render-snapshots `
  --publish-to ..\public\engine-data `
  --out data\runs\latest
```

CLI flags (full table in `engine/README.md`):
- `--from-date YYYY-MM-DD` / `--to-date YYYY-MM-DD` — slice
- `--refresh-news` — scrape investing.com (Cloudflare-protected; rate-limited)
- `--render-snapshots` — generate PNG chart per trade (~50 KB each, dark theme)
- `--publish-to PATH` — copy `result.json` + snapshots into the React app's public dir

### 3. Launch the dashboard

```powershell
# from repo root
npm install
npm run dev
```

Open http://localhost:5173. The dashboard polls
`public/engine-data/manifest.json` every 4 s and refetches when the engine republishes —
no manual reload needed.

## Output schema

Each trade in `public/engine-data/result.json`:

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

## Tech

- **Python** 3.11 — pandas, numpy, mplfinance, BeautifulSoup, requests, pytest
- **React** 18 + Vite 7 + TypeScript + Tailwind v3 + framer-motion + lucide-react
- 23 unit tests (`engine/tests/`) — all pass

## Project status

v0.5 — liquidity detection is now **touch-based** (was sweep-based in v0.4), with
qualitative ATR-prominence filtering rather than every minor swing pivot.

Latest backtest on 2020-01-02 → 2026-05-14 (1.94M M1 candles):
- **89 trades · 27% win rate · −7.0% account return** at 1% risk

Win rate must clear 33.3 % to break even at 1:2 RR — the unfiltered strategy is currently
below threshold. Likely next steps: bias filter (only Buy in positive bias / only Sell in
negative), news filter (skip CPI/NFP/FOMC days), HOD/LOD-only mode.

See `engine/README.md` for full design notes.
