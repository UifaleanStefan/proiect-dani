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
