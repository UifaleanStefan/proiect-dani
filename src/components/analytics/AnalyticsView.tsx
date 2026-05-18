import { motion } from "framer-motion";
import { useTrades } from "../../store/useTrades";
import { GlassCard } from "../ui/GlassCard";
import { EquityCurve } from "./EquityCurve";
import { FilterBar } from "./FilterBar";
import { HeroStats } from "./HeroStats";
import { SessionLiquidityCards } from "./SessionLiquidityCards";
import { SetupBreakdown } from "./SetupBreakdown";
import { TopBar } from "./TopBar";
import { TradeDetailModal } from "./TradeDetailModal";
import { TradeGrid } from "./TradeGrid";

export function AnalyticsView() {
  const { trades, summary, loading, lastError } = useTrades();

  if (lastError && !trades) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <GlassCard className="px-6 py-5 max-w-md">
          <h2 className="text-[15px] font-semibold mb-2">Couldn't load engine data</h2>
          <p className="text-[12.5px] text-ink-muted leading-relaxed mb-3">
            Make sure the engine has run with{" "}
            <code className="px-1.5 py-0.5 rounded bg-ink/10 text-[11.5px] font-mono">
              --publish-to D:/ProiectDani/public/engine-data
            </code>{" "}
            and that the Vite dev server is serving <code>/engine-data/</code>.
          </p>
          <p className="text-[11px] text-loss-dark font-mono break-all">{lastError}</p>
        </GlassCard>
      </div>
    );
  }

  if (loading || !trades || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-ink-muted text-[13px] animate-pulse">
          Loading engine results…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative w-full min-h-screen px-6 lg:px-10 py-6 lg:py-8 max-w-[1600px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
        >
          <TopBar />
        </motion.div>

        {/* Hero stats */}
        <div className="mt-5">
          <HeroStats summary={summary} />
        </div>

        {/* Equity curve + breakdowns */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: [0.2, 0, 0, 1] }}
          >
            <GlassCard className="p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  Equity curve
                </h3>
                <div className="text-[11px] text-ink-muted tnum">
                  Cumulative % at 1% risk per trade
                </div>
              </div>
              <EquityCurve trades={trades} />
            </GlassCard>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.28, ease: [0.2, 0, 0, 1] }}
            >
              <div className="mt-4">
                <SetupBreakdown summary={summary} />
              </div>
            </motion.div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <SessionLiquidityCards summary={summary} />
          </motion.div>
        </div>

        {/* Filter bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.36, ease: [0.2, 0, 0, 1] }}
          className="mt-6"
        >
          <FilterBar />
        </motion.div>

        {/* Trade grid */}
        <div className="mt-4">
          <TradeGrid />
        </div>

        {/* Footer spacing */}
        <div className="h-12" />
      </div>

      <TradeDetailModal />
    </>
  );
}
