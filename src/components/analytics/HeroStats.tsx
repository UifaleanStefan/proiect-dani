import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Target, TrendingUp } from "lucide-react";
import type { StatsSummary } from "../../types";
import { GlassCard } from "../ui/GlassCard";
import { fmtPct } from "../../lib/format";
import { cn } from "../../lib/cn";

type CardProps = {
  label: string;
  value: string;
  sub?: string;
  Icon?: typeof TrendingUp;
  tint?: "neutral" | "win" | "loss" | "be";
  delay?: number;
};

function StatCard({ label, value, sub, Icon, tint = "neutral", delay = 0 }: CardProps) {
  const valColor = {
    neutral: "text-ink",
    win: "text-win-dark",
    loss: "text-loss-dark",
    be: "text-be-dark",
  }[tint];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0, 0, 1] }}
    >
      <GlassCard tint={tint} className="px-5 py-4 h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            {label}
          </div>
          {Icon && (
            <div className="w-7 h-7 rounded-full bg-white/40 flex items-center justify-center text-ink/70">
              <Icon size={14} strokeWidth={2.2} />
            </div>
          )}
        </div>
        <div
          className={cn(
            "mt-2 text-[34px] font-bold leading-none tnum tracking-[-0.02em]",
            valColor,
          )}
        >
          {value}
        </div>
        {sub && (
          <div className="mt-2 text-[12px] text-ink-muted leading-snug">{sub}</div>
        )}
      </GlassCard>
    </motion.div>
  );
}

export function HeroStats({ summary }: { summary: StatsSummary }) {
  const accountReturn = summary.account_return_pct_at_1pct_risk;
  const isUp = accountReturn >= 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Account Return"
        value={fmtPct(accountReturn, true)}
        sub={`At 1% risk per trade · ${summary.decided_trades} decided`}
        Icon={isUp ? ArrowUpRight : ArrowDownRight}
        tint={isUp ? "win" : "loss"}
        delay={0}
      />
      <StatCard
        label="Win Rate"
        value={`${summary.win_rate_pct.toFixed(1)}%`}
        sub={`${summary.wins}W · ${summary.losses}L · ${summary.break_even}BE`}
        Icon={Target}
        tint="neutral"
        delay={0.06}
      />
      <StatCard
        label="Total Trades"
        value={String(summary.total_trades)}
        sub={`Out of ${summary.csv_range.candles.toLocaleString()} M1 candles`}
        Icon={TrendingUp}
        tint="neutral"
        delay={0.12}
      />
      <StatCard
        label="News-Tagged"
        value={String(summary.trades_with_news_high)}
        sub={`Trades on/around major events`}
        tint="be"
        delay={0.18}
      />
    </div>
  );
}
