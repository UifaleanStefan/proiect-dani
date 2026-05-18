/** Tiny formatting helpers used across the analytics view. */

export function fmtPct(n: number, signed = false): string {
  const v = n.toFixed(1);
  if (signed && n > 0) return `+${v}%`;
  return `${v}%`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtCount(n: number, label: string): string {
  return `${fmtNumber(n)} ${label}${n === 1 ? "" : "s"}`;
}
