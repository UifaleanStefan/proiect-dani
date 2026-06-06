/**
 * Drawing helpers: id generation, position TP (auto 1:2), outcome derivation, and
 * assembling the persisted Annotation (drawings + manual + denormalized auto fields).
 */
import type {
  Annotation,
  Candle,
  Drawing,
  JournalEvent,
  JournalMeta,
  Manual,
  Outcome,
  PositionDrawing,
} from "../types";
import { findEntryIdx, simulateOutcome } from "./journalOutcome";
import { nearestIdx } from "./chartCoords";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

const _clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit" });
/** HH:MM (market tz) for an epoch-ms candle time. */
export const fmtClock = (ms: number) => _clock.format(new Date(ms));

let _seq = 0;
export function newId(prefix: string): string {
  _seq = (_seq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

/** Auto take-profit at fixed 1:2 RR from entry + SL. */
export function positionTP(p: Pick<PositionDrawing, "direction" | "entry" | "sl">): number {
  const risk = Math.abs(p.entry - p.sl);
  return p.direction === "buy" ? p.entry + 2 * risk : p.entry - 2 * risk;
}

export type PositionDerived = {
  tp: number;
  slPoints: number | null;
  rr: number;
  outcome: Outcome | null;
  entryIdx: number | null;
  valid: boolean;
};

/** Derive TP / SL points / RR / simulated outcome for a position drawing. */
export function derivePosition(
  p: PositionDrawing,
  ev: JournalEvent,
  candles: Candle[],
  times: number[],
  meta: JournalMeta | null,
): PositionDerived {
  const risk = Math.abs(p.entry - p.sl);
  const wrongSide = p.direction === "buy" ? p.sl >= p.entry : p.sl <= p.entry;
  const tp = positionTP(p);
  if (risk <= 0 || wrongSide) {
    return { tp, slPoints: risk > 0 ? round1(risk) : null, rr: 2, outcome: null, entryIdx: null, valid: false };
  }
  const beRr = meta?.beRr ?? 1.4;
  const anchorIdx = nearestIdx(times, p.time);
  const fromIdx = Math.max(anchorIdx, ev.touchIdx ?? ev.sweepIdx ?? 0);
  const start = findEntryIdx(candles, fromIdx, p.direction, p.entry);
  let outcome: Outcome | null = "Open";
  let entryIdx: number | null = null;
  if (start != null) {
    entryIdx = start;
    outcome = simulateOutcome(candles, start, p.direction, p.entry, p.sl, tp, beRr)?.outcome ?? null;
  }
  return { tp, slPoints: round1(risk), rr: 2, outcome, entryIdx, valid: true };
}

/** Entry distance below/above the running ATH, as a signed percent (negative = below). */
export function athPct(entry: number, ath: number): number | null {
  if (!ath || !isFinite(ath)) return null;
  return round2((entry / ath - 1) * 100);
}

/** The position that drives the saved trade outcome (explicit primary, else first). */
export function primaryPosition(drawings: Drawing[], primaryId?: string | null): PositionDrawing | null {
  const positions = drawings.filter((d): d is PositionDrawing => d.type === "position");
  if (!positions.length) return null;
  return positions.find((p) => p.id === primaryId) ?? positions[0];
}

/** Assemble the full Annotation to persist (drawings + manual + denormalized auto fields). */
export function buildAnnotation(
  ev: JournalEvent,
  drawings: Drawing[],
  manual: Manual,
  candles: Candle[],
  times: number[],
  meta: JournalMeta | null,
): Annotation {
  const pos = primaryPosition(drawings);
  const der = pos ? derivePosition(pos, ev, candles, times, meta) : null;
  const order: "Buy" | "Sell" = (pos ? pos.direction : ev.direction) === "buy" ? "Buy" : "Sell";
  const entryForAth = pos?.entry ?? ev.level;
  const [dd, mm, yyyy] = [ev.ddMm.slice(0, 2), ev.ddMm.slice(3, 5), ev.year];
  // Time = the entry candle (where price reaches the drawn entry), not the sweep time.
  const entryIdx = der?.entryIdx ?? null;
  const time = entryIdx != null && candles[entryIdx] ? fmtClock(candles[entryIdx].t) : ev.sweepTime;

  return {
    id: ev.id,
    drawings,
    primaryPositionId: pos?.id ?? null,
    // manual
    mssKind: manual.mssKind ?? null,
    setup: manual.setup ?? null,
    news: manual.news ?? null,
    // denormalized auto / computed
    market: ev.market,
    date: `${dd}/${mm}/${yyyy}`,
    time,
    order,
    liquidity: ev.liquidity,
    ageStr: ev.age,
    session: ev.session,
    level: ev.level,
    slPoints: der?.slPoints ?? null,
    rr: der && der.valid ? der.rr : null,
    outcome: der?.outcome ?? null,
    athPct: athPct(entryForAth, ev.athToDate),
    updatedMs: Date.now(),
  };
}
