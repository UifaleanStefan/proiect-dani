/**
 * Pure coordinate helpers for anchoring drawings in {time(ms), price}.
 *
 * lightweight-charts' `timeToCoordinate` returns null for any time not exactly a bar,
 * so we convert via the LOGICAL (fractional index) axis instead: ms → fractional logical
 * → `logicalToCoordinate`. These helpers map between ms and fractional logical over the
 * sorted candle times (interpolating between bars, extrapolating beyond them).
 */

/** Build the sorted ascending list of candle times (ms). */
export function buildTimes(candles: { t: number }[]): number[] {
  return candles.map((c) => c.t);
}

/** ms → fractional logical index (interpolate between bars, extrapolate at the edges). */
export function timeToLogical(times: number[], ms: number): number {
  const n = times.length;
  if (n <= 1) return 0;
  const spacing = (times[n - 1] - times[0]) / (n - 1) || 60_000;
  if (ms <= times[0]) return (ms - times[0]) / spacing;
  if (ms >= times[n - 1]) return n - 1 + (ms - times[n - 1]) / spacing;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return lo + (span > 0 ? (ms - times[lo]) / span : 0);
}

/** fractional logical index → ms (inverse of timeToLogical). */
export function logicalToTime(times: number[], logical: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return times[0];
  const spacing = (times[n - 1] - times[0]) / (n - 1) || 60_000;
  if (logical <= 0) return Math.round(times[0] + logical * spacing);
  if (logical >= n - 1) return Math.round(times[n - 1] + (logical - (n - 1)) * spacing);
  const lo = Math.floor(logical);
  const hi = Math.min(n - 1, lo + 1);
  return Math.round(times[lo] + (logical - lo) * (times[hi] - times[lo]));
}

/** Nearest candle index to a given ms. */
export function nearestIdx(times: number[], ms: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (ms <= times[0]) return 0;
  if (ms >= times[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid;
    else hi = mid;
  }
  return ms - times[lo] <= times[hi] - ms ? lo : hi;
}
