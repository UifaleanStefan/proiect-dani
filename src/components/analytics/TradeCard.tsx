import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Calendar, Clock4, Newspaper } from "lucide-react";
import type { Trade } from "../../types";
import { cn } from "../../lib/cn";
import { GlassCard } from "../ui/GlassCard";
import { StatBadge } from "../ui/StatBadge";

const SIDE_BORDER: Record<Trade["result"], string> = {
  Win: "before:bg-win",
  Loss: "before:bg-loss",
  "Break Even": "before:bg-be",
  Open: "before:bg-ink-muted",
};

const TINT: Record<Trade["result"], "win" | "loss" | "be" | "neutral"> = {
  Win: "win",
  Loss: "loss",
  "Break Even": "be",
  Open: "neutral",
};

export function TradeCard({
  trade,
  onClick,
  index,
}: {
  trade: Trade;
  onClick: () => void;
  index: number;
}) {
  const isBuy = trade.order === "Buy";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index, 8) * 0.04,
        ease: [0.2, 0, 0, 1],
      }}
      whileHover={{ y: -2, transition: { duration: 0.18 } }}
      className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/60 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-100 rounded-2.5xl"
    >
      <GlassCard
        tint={TINT[trade.result]}
        className={cn(
          "relative overflow-hidden p-0 transition-shadow hover:shadow-pop",
          "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
          SIDE_BORDER[trade.result],
        )}
      >
        {/* Snapshot */}
        {trade.photoUrl ? (
          <div className="relative w-full aspect-[16/10] overflow-hidden">
            <img
              src={`/engine-data/${trade.photoUrl}`}
              alt={`Setup ${trade.id}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <StatBadge variant={isBuy ? "buy" : "sell"}>
                {isBuy ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {trade.order}
              </StatBadge>
              <StatBadge variant={TINT[trade.result]}>{trade.result}</StatBadge>
            </div>
            <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2">
              <div>
                <div className="text-[11px] text-white/80 font-medium tnum">
                  #{trade.id.slice(-7)}
                </div>
                <div className="text-[15px] text-white font-bold tracking-tight">
                  {trade.setup}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-white/80 font-medium tnum">
                  {trade.ddMm}/{trade.year.slice(2)}
                </div>
                <div className="text-[12px] text-white font-semibold tnum">
                  {trade.time}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="aspect-[16/10] bg-ink/5 flex items-center justify-center text-ink-muted text-[12px]">
            No snapshot
          </div>
        )}

        {/* Body */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <StatBadge variant="neutral">{trade.liquidity}</StatBadge>
            <StatBadge variant="neutral">MSS {trade.mss}</StatBadge>
            <StatBadge variant="neutral">{trade.session}</StatBadge>
            {trade.news !== "None" && (
              <StatBadge variant="news">
                <Newspaper size={10} />
                {trade.news.length > 18 ? trade.news.slice(0, 18) + "…" : trade.news}
              </StatBadge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Stat label="Age" value={trade.age} icon={Clock4} />
            <Stat label="Setup in" value={trade.setuptime} />
            <Stat label="Gap-fill" value={trade.gapfill} />
            <Stat label="SL" value={`${trade.slPoints}p`} />
            <Stat label="Gap size" value={`${trade.gapsize}p`} />
            <Stat label="Rvol" value={trade.Rvol} />
          </div>
        </div>
      </GlassCard>
    </motion.button>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Calendar;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] text-ink-muted uppercase tracking-wider font-semibold flex items-center gap-1">
        {Icon && <Icon size={9} />}
        {label}
      </div>
      <div className="text-[12px] font-semibold text-ink tnum truncate mt-0.5">
        {value}
      </div>
    </div>
  );
}
