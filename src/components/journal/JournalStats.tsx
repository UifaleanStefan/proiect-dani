import { useMemo } from "react";
import type { Annotation } from "../../types";
import { GlassCard } from "../ui/GlassCard";

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <GlassCard className="px-4 py-3">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="text-[24px] font-bold tnum leading-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-muted tnum">{sub}</div>}
    </GlassCard>
  );
}

export function JournalStats({ index }: { index: Annotation[] }) {
  const s = useMemo(() => {
    const decided = index.filter((a) => a.outcome && a.outcome !== "Open");
    const wins = decided.filter((a) => a.outcome === "Win").length;
    const losses = decided.filter((a) => a.outcome === "Loss").length;
    const be = decided.filter((a) => a.outcome === "Break Even").length;
    const rrs = index.map((a) => a.rr).filter((x): x is number => x != null);
    const avgRr = rrs.length ? rrs.reduce((p, c) => p + c, 0) / rrs.length : null;
    const ret = wins * 2 + losses * -1;
    const wr = decided.length ? (100 * wins) / decided.length : null;
    return { total: index.length, decided: decided.length, wins, losses, be, avgRr, ret, wr };
  }, [index]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <Kpi label="Journaled" value={String(s.total)} sub={`${s.decided} decided`} />
      <Kpi
        label="Win rate"
        value={s.wr != null ? `${s.wr.toFixed(1)}%` : "—"}
        sub={`${s.wins}W · ${s.losses}L · ${s.be}BE`}
        color={s.wr != null ? (s.wr >= 33.3 ? "#127A3D" : "#9C2A1D") : undefined}
      />
      <Kpi
        label="Return @1% risk"
        value={`${s.ret >= 0 ? "+" : ""}${s.ret.toFixed(0)}%`}
        color={s.ret >= 0 ? "#127A3D" : "#9C2A1D"}
      />
      <Kpi label="Avg R:R" value={s.avgRr != null ? `1:${s.avgRr.toFixed(2)}` : "—"} />
      <Kpi label="Wins" value={String(s.wins)} color="#127A3D" />
      <Kpi label="Losses" value={String(s.losses)} color="#9C2A1D" />
    </div>
  );
}
