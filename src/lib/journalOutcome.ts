/**
 * Client-side mirror of the engine's trade walk (engine/src/engine/simulator/trade.py):
 * fixed 1:2 RR, break-even moved to entry at 1.4R. Used to auto-score hand-drawn positions.
 */
import type { Candle, JournalMeta, Outcome } from "../types";

/** First candle at/after `startIdx` where price reaches the entry (a limit). */
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
