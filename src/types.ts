/* ================================================================== *
 *  Manual journaling workstation (v0.9) — types                       *
 * ================================================================== */

export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type Outcome = "Win" | "Loss" | "Break Even" | "Open";

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
  postHours: number;
  setups: string[];
  generatedMs: number;
  count: number;
};

/** One HOD/LOD liquidity grab (touched 10:00–12:00) to journal by hand. */
export type JournalEvent = {
  id: string;
  market: string;
  date: string; // YYYY-MM-DD (local)
  ddMm: string;
  year: string;
  sweepTime: string; // HH:MM local
  sweepMs: number;
  direction: "buy" | "sell";
  liquidity: "HOD" | "LOD";
  level: number;
  formationIdx: number; // window-local index of the formation extreme
  touchIdx: number; // window-local index where it was liquidated
  sweepIdx: number; // alias of touchIdx
  age: string;
  session: string;
  athToDate: number; // running all-time-high up to the grab
  candles: number;
};

export type JournalEventsFile = { meta: JournalMeta; events: JournalEvent[] };

/* ---- Drawings (all control points anchored in {time(ms), price}) ---- */

export type Anchor = { time: number; price: number };

export type MssDrawing = { type: "mss"; id: string; a: Anchor; b: Anchor };
// Box-like shapes carry an explicit time-extent [t0,t1] (ms) so they are finite and
// resizable from the right edge (width) independently of their price height.
export type FvgDrawing = { type: "fvg"; id: string; t0: number; t1: number; top: number; bottom: number };
export type FibDrawing = { type: "fib"; id: string; t0: number; t1: number; hi: number; lo: number };
export type PositionDrawing = {
  type: "position";
  id: string;
  direction: "buy" | "sell";
  entry: number;
  sl: number;
  t0: number; // left edge (ms)
  t1: number; // right edge (ms)
};
export type Drawing = MssDrawing | FvgDrawing | FibDrawing | PositionDrawing;
export type DrawingType = Drawing["type"];

/** Manual fields the user fills in. */
export type Manual = {
  mssKind?: "Body" | "Wick" | null;
  setup?: string | null;
  news?: string | null;
};

/** Persisted per event: drawings + manual + denormalized auto/computed fields
 *  (the flat fields feed /api/journal/index and the Excel export). */
export type Annotation = Manual & {
  id?: string;
  drawings?: Drawing[];
  primaryPositionId?: string | null;
  // denormalized for the index + xlsx:
  market?: string;
  date?: string; // DD/MM/YYYY
  time?: string; // HH:MM
  order?: "Buy" | "Sell" | null;
  liquidity?: string;
  ageStr?: string;
  session?: string;
  level?: number;
  slPoints?: number | null;
  rr?: number | null;
  outcome?: Outcome | null;
  athPct?: number | null;
  updatedMs?: number;
};
