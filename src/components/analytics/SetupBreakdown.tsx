import { motion } from "framer-motion";
import type { StatsSummary } from "../../types";
import { GlassCard } from "../ui/GlassCard";
import { cn } from "../../lib/cn";

const SETUP_COLORS: Record<string, string> = {
  OSG: "#3B82E0",
  "2G": "#7BA8D9",
  "2CG": "#1FB85C",
  "3G": "#F4B83A",
  "3CG": "#E89B5C",
  MG: "#A86CD9",
  "SLG + OSG": "#5B9CD8",
  "SLG + 2G": "#9BC0E2",
  "SLG + 2CG": "#34CC74",
  "SLG + 3G": "#F9CC72",
  "SLG + 3CG": "#EFAE74",
  "SLG + MG": "#BA8AE2",
};

function colorFor(setup: string): string {
  return SETUP_COLORS[setup] || "#7A7368";
}

export function SetupBreakdown({ summary }: { summary: StatsSummary }) {
  const entries = Object.entries(summary.by_setup).sort((a, b) => b[1].count - a[1].count);
  const total = entries.reduce((s, [, v]) => s + v.count, 0);

  // Build cumulative arc data
  let cum = 0;
  const SIZE = 180;
  const STROKE = 28;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const arcs = entries.map(([name, v]) => {
    const frac = v.count / Math.max(1, total);
    const arc = {
      name,
      count: v.count,
      win_rate: v.win_rate_pct,
      color: colorFor(name),
      offset: cum * C,
      length: frac * C,
    };
    cum += frac;
    return arc;
  });

  return (
    <GlassCard className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[15px] font-semibold tracking-tight">Setup distribution</h3>
        <span className="text-[11px] text-ink-muted tnum">{total} trades</span>
      </div>
      <div className="flex items-center gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke="rgba(31,29,26,0.06)"
              strokeWidth={STROKE}
              fill="none"
            />
            {arcs.map((a, i) => (
              <motion.circle
                key={a.name}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={a.color}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${a.length} ${C - a.length}`}
                strokeDashoffset={-a.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                initial={{ strokeDasharray: `0 ${C}` }}
                animate={{ strokeDasharray: `${a.length} ${C - a.length}` }}
                transition={{ duration: 0.7, delay: 0.1 + i * 0.05, ease: [0.2, 0, 0, 1] }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[28px] font-bold tnum leading-none">{total}</div>
            <div className="text-[10px] text-ink-muted uppercase tracking-wider mt-1">
              Setups
            </div>
          </div>
        </div>
        <ul className="flex-1 space-y-2 min-w-0">
          {arcs.map((a) => (
            <li key={a.name} className="flex items-center gap-2 text-[12px]">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: a.color }}
              />
              <span className="font-medium truncate">{a.name}</span>
              <span className="ml-auto text-ink-muted tnum tabular-nums">
                {a.count}
              </span>
              <span
                className={cn(
                  "tnum text-[11px] font-semibold w-12 text-right",
                  a.win_rate >= 50 ? "text-win-dark" : a.win_rate > 0 ? "text-be-dark" : "text-loss-dark",
                )}
              >
                {a.win_rate.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}
