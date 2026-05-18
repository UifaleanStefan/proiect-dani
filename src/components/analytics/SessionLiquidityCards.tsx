import { motion } from "framer-motion";
import { Building2, Clock4, Layers } from "lucide-react";
import type { StatsSummary } from "../../types";
import { GlassCard } from "../ui/GlassCard";

const LIQ_COLORS: Record<string, string> = {
  HOD: "#7BA8D9",
  LOD: "#7BA8D9",
  Local: "#A86CD9",
  Major: "#1FB85C",
};

function StackedBar({ data }: { data: { name: string; count: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) {
    return <div className="h-2 rounded-full bg-ink/10" />;
  }
  return (
    <div className="flex h-2 rounded-full overflow-hidden">
      {data.map((d) => (
        <motion.div
          key={d.name}
          initial={{ width: 0 }}
          animate={{ width: `${(d.count / total) * 100}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
          style={{ background: d.color }}
        />
      ))}
    </div>
  );
}

export function SessionLiquidityCards({ summary }: { summary: StatsSummary }) {
  const sessionData = [
    { name: "London", count: summary.by_session["London"] || 0, color: "#3B82E0" },
    { name: "New York", count: summary.by_session["New York"] || 0, color: "#E89B5C" },
  ];
  const liquidityData = ["HOD", "LOD", "Local", "Major"]
    .map((k) => ({ name: k, count: summary.by_liquidity[k] || 0, color: LIQ_COLORS[k] }))
    .filter((d) => d.count > 0);

  const sessionTotal = sessionData.reduce((s, d) => s + d.count, 0);
  const liqTotal = liquidityData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Session */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-white/40 flex items-center justify-center">
            <Clock4 size={14} className="text-ink/70" />
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight">By session</h3>
          <span className="ml-auto text-[11px] text-ink-muted tnum">
            {sessionTotal} trades
          </span>
        </div>
        <StackedBar data={sessionData} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {sessionData.map((d) => (
            <div key={d.name} className="flex items-baseline gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: d.color }}
              />
              <span className="text-[11.5px] font-medium">{d.name}</span>
              <span className="ml-auto text-[12px] font-semibold tnum">
                {d.count}
              </span>
              <span className="text-[10px] text-ink-muted tnum w-9 text-right">
                {sessionTotal ? Math.round((d.count / sessionTotal) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Liquidity tier */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-white/40 flex items-center justify-center">
            <Layers size={14} className="text-ink/70" />
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight">By liquidity</h3>
          <span className="ml-auto text-[11px] text-ink-muted tnum">
            {liqTotal} trades
          </span>
        </div>
        <StackedBar data={liquidityData} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {liquidityData.map((d) => (
            <div key={d.name} className="flex items-baseline gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: d.color }}
              />
              <span className="text-[11.5px] font-medium">{d.name}</span>
              <span className="ml-auto text-[12px] font-semibold tnum">
                {d.count}
              </span>
              <span className="text-[10px] text-ink-muted tnum w-9 text-right">
                {liqTotal ? Math.round((d.count / liqTotal) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Brand spacer */}
      <GlassCard className="p-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-ink text-white flex items-center justify-center">
          <Building2 size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">DE30EUR · M1</div>
          <div className="text-[11px] text-ink-muted truncate tnum">
            {summary.csv_range.from.slice(0, 10)} → {summary.csv_range.to.slice(0, 10)}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
