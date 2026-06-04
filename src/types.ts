/** Shape of a single trade in result.json (matches engine's output schema). */
export type Trade = {
  id: string;
  market: string;
  year: string;
  ddMm: string;
  time: string;
  Bias: "positive" | "negative" | "neutral";
  order: "Buy" | "Sell";
  liquidity: "HOD" | "LOD" | "Local" | "Major";
  age: string;
  tradeduration: string;
  mss: "Body" | "Wick";
  additionalLiquidity: string;
  setup: string;
  setuptime: string;        // e.g. "28m" — time from sweep to setup formation
  volatility: string;
  Rvol: string;
  gapsize: string;
  gapfill: string;          // e.g. "5m" — time from gap forming to entry trigger
  slPoints: string;
  result: "Win" | "Loss" | "Break Even" | "Open";
  news: string;
  session: "London" | "New York";
  photoUrl: string;
  liquidityUrl: string;     // wider context snapshot showing liquidity formation + sweep
  ath: string;
  info: string;
};

export type StatsSummary = {
  csv_range: { from: string; to: string; candles: number };
  total_trades: number;
  decided_trades: number;
  wins: number;
  losses: number;
  break_even: number;
  open: number;
  win_rate_pct: number;
  account_return_pct_at_1pct_risk: number;
  by_setup: Record<
    string,
    { count: number; wins: number; losses: number; be: number; win_rate_pct: number }
  >;
  by_session: Record<string, number>;
  by_liquidity: Record<string, number>;
  trades_with_news_high: number;
};

export type Manifest = {
  published_at: number;
  run_dir: string;
  n_trades: number;
};

/** Filter state for the trade grid. */
export type TradeFilter = {
  result: "all" | "Win" | "Loss" | "Break Even";
  side: "all" | "Buy" | "Sell";
  setup: "all" | string;
  session: "all" | "London" | "New York";
  liquidity: "all" | "HOD" | "LOD" | "Local" | "Major";
  withNews: boolean;
};

export const DEFAULT_FILTER: TradeFilter = {
  result: "all",
  side: "all",
  setup: "all",
  session: "all",
  liquidity: "all",
  withNews: false,
};

/* ------------------------------------------------------------------ *
 * Manual journal (v0.8): hand-marked setups on liquidity-grab charts  *
 * ------------------------------------------------------------------ */

/** Strategy constants embedded by the engine so the UI's outcome-sim stays in sync. */
export type JournalMeta = {
  market: string;
  timezone: string;
  tpRr: number;
  beRr: number;
  slBuffer: number;
  slRefPrice: number;
  slMinAtRef: number;
  slMaxAtRef: number;
  slQuantizeStep: number;
  minFvgSize: number;
  generatedMs: number;
  count: number;
};

/** One HOD/LOD liquidity grab (10:00–12:00) the user journals by hand. */
export type JournalEvent = {
  id: string;
  date: string; // YYYY-MM-DD (local)
  ddMm: string;
  year: string;
  sweepTime: string; // HH:MM local
  sweepMs: number;
  direction: "buy" | "sell";
  liquidity: "HOD" | "LOD";
  level: number; // the grabbed level (exact)
  hodPrice: number;
  lodPrice: number;
  sweepIdx: number; // sweep candle position within the window
  candles: number;
};

export type JournalEventsFile = { meta: JournalMeta; events: JournalEvent[] };

export type Candle = { t: number; o: number; h: number; l: number; c: number };

export type Outcome = "Win" | "Loss" | "Break Even" | "Open";

/** Hand-marked geometry + computed measurements, persisted per event. */
export type Annotation = {
  id?: string;
  fvg?: { top: number; bottom: number } | null;
  entry?: number | null;
  sl?: number | null;
  tp?: number | null;
  mss?: { idx: number; kind: "Body" | "Wick" } | null;
  entryIdx?: number | null;
  note?: string;
  // denormalized context + computed (filled at save time for /api/journal/index)
  date?: string;
  ddMm?: string;
  year?: string;
  liquidity?: string;
  direction?: string;
  level?: number;
  fvgSize?: number | null;
  slSize?: number | null;
  rr?: number | null;
  outcome?: Outcome | null;
  updatedMs?: number;
};
