/**
 * Client-side mirror of the engine's trade walk (engine/src/engine/simulator/trade.py).
 *
 * Given hand-marked entry / SL / TP on a liquidity-grab window, walk the REAL candles
 * forward to decide Win / Loss / Break Even — using the same fixed 1:2 RR and the
 * break-even-at-1.4R rule the auto-backtest uses (constants come from events.json meta).
 */
import type { Annotation, Candle, JournalEvent, JournalMeta, Outcome } from "../types";

/** First candle at/after `startIdx` where price reaches the entry price. */
export function findEntryIdx(
  candles: Candle[],
  startIdx: number,
  dir: "buy" | "sell",
  entry: number,
): number | null {
  for (let i = Math.max(0, startIdx); i < candles.length; i++) {
    const c = candles[i];
    if (dir === "buy" ? c.l <= entry : c.h >= entry) return i;
  }
  return null;
}

/** Walk from entryIdx → first TP/SL/BE hit. Same candle-priority as the engine. */
export function simulateOutcome(
  candles: Candle[],
  entryIdx: number,
  dir: "buy" | "sell",
  entry: number,
  sl: number,
  tp: number,
  beRr: number,
): { outcome: Outcome; exitIdx: number } | null {
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  const beThreshold = beRr * risk;
  let curSl = sl;
  let armed = false;

  for (let j = entryIdx + 1; j < candles.length; j++) {
    const c = candles[j];
    if (dir === "buy") {
      if (c.h >= tp) return { outcome: "Win", exitIdx: j };
      if (c.l <= curSl) return { outcome: armed ? "Break Even" : "Loss", exitIdx: j };
      if (!armed && c.h - entry >= beThreshold) { armed = true; curSl = entry; }
    } else {
      if (c.l <= tp) return { outcome: "Win", exitIdx: j };
      if (c.h >= curSl) return { outcome: armed ? "Break Even" : "Loss", exitIdx: j };
      if (!armed && entry - c.l >= beThreshold) { armed = true; curSl = entry; }
    }
  }
  return { outcome: "Open", exitIdx: candles.length - 1 };
}

/** Dynamic SL band [min,max] in points at a given price (v0.7 rule). */
export function slBand(price: number, meta: JournalMeta): [number, number] {
  const ref = Math.floor(price / meta.slQuantizeStep) * meta.slQuantizeStep || meta.slQuantizeStep;
  const x = ref / meta.slRefPrice;
  return [x * meta.slMinAtRef, x * meta.slMaxAtRef];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Compute the measured fields + auto-outcome from a hand-marked annotation. */
export function deriveStats(
  a: Annotation,
  ev: JournalEvent,
  candles: Candle[] | null,
  meta: JournalMeta | null,
): Pick<
  Annotation,
  "fvgSize" | "slSize" | "rr" | "outcome" | "entryIdx" | "date" | "ddMm" | "year" | "liquidity" | "direction" | "level"
> {
  const fvgSize = a.fvg ? r1(Math.abs(a.fvg.top - a.fvg.bottom)) : null;
  const slSize = a.entry != null && a.sl != null ? r1(Math.abs(a.entry - a.sl)) : null;
  const rr =
    a.entry != null && a.sl != null && a.tp != null && Math.abs(a.entry - a.sl) > 0
      ? r2(Math.abs(a.tp - a.entry) / Math.abs(a.entry - a.sl))
      : null;

  let outcome: Outcome | null = null;
  let entryIdx: number | null = a.entryIdx ?? null;
  if (a.entry != null && a.sl != null && a.tp != null && candles && candles.length && meta) {
    const start = entryIdx ?? findEntryIdx(candles, ev.sweepIdx, ev.direction, a.entry);
    if (start != null) {
      entryIdx = start;
      const res = simulateOutcome(candles, start, ev.direction, a.entry, a.sl, a.tp, meta.beRr);
      outcome = res?.outcome ?? null;
    }
  }

  return {
    fvgSize,
    slSize,
    rr,
    outcome,
    entryIdx,
    date: ev.date,
    ddMm: ev.ddMm,
    year: ev.year,
    liquidity: ev.liquidity,
    direction: ev.direction,
    level: ev.level,
  };
}
