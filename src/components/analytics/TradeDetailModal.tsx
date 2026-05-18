import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Newspaper, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Trade } from "../../types";
import { useTrades } from "../../store/useTrades";
import { StatBadge } from "../ui/StatBadge";
import { cn } from "../../lib/cn";

const TINT: Record<Trade["result"], "win" | "loss" | "be" | "neutral"> = {
  Win: "win",
  Loss: "loss",
  "Break Even": "be",
  Open: "neutral",
};

type SnapTab = "trade" | "liquidity";

export function TradeDetailModal() {
  const { selectedTrade, select } = useTrades();
  const [tab, setTab] = useState<SnapTab>("trade");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") select(null);
    }
    if (selectedTrade) {
      document.addEventListener("keydown", onKey);
      setTab("trade"); // reset to trade tab on each open
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [selectedTrade, select]);

  return (
    <AnimatePresence>
      {selectedTrade && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-md flex items-center justify-center p-4 md:p-8"
          onClick={() => select(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong rounded-3xl shadow-pop max-w-[1280px] w-full max-h-[92vh] overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(380px,1fr)]"
          >
            {/* LEFT — snapshot with tabs */}
            <div className="bg-[#131722] relative flex flex-col min-h-[420px]">
              {/* Tab switcher */}
              <div className="absolute top-3 left-3 z-20 flex items-center gap-0.5 bg-black/40 backdrop-blur rounded-full p-0.5 border border-white/10">
                <SnapTabBtn
                  active={tab === "trade"}
                  onClick={() => setTab("trade")}
                  label="Setup"
                />
                <SnapTabBtn
                  active={tab === "liquidity"}
                  onClick={() => setTab("liquidity")}
                  label="Liquidity context"
                  disabled={!selectedTrade.liquidityUrl}
                />
              </div>

              <div className="flex-1 flex items-center justify-center overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={tab}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    src={`/engine-data/${tab === "trade" ? selectedTrade.photoUrl : selectedTrade.liquidityUrl}`}
                    alt={tab === "trade" ? "Setup snapshot" : "Liquidity context"}
                    className="w-full h-full max-h-[92vh] object-contain"
                  />
                </AnimatePresence>
              </div>
            </div>

            {/* RIGHT — metadata */}
            <div className="overflow-y-auto slim-scroll p-6 relative">
              <button
                onClick={() => select(null)}
                aria-label="Close"
                className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/60 hover:bg-white shadow-card flex items-center justify-center text-ink z-10"
              >
                <X size={15} />
              </button>

              {/* Header */}
              <div className="mb-5">
                <div className="text-[11px] text-ink-muted font-semibold uppercase tracking-wider tnum">
                  #{selectedTrade.id}
                </div>
                <h2 className="mt-1 text-[26px] font-bold tracking-[-0.02em] leading-tight">
                  {selectedTrade.setup}
                </h2>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <StatBadge variant={selectedTrade.order === "Buy" ? "buy" : "sell"}>
                    {selectedTrade.order === "Buy" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                    {selectedTrade.order}
                  </StatBadge>
                  <StatBadge variant={TINT[selectedTrade.result]}>{selectedTrade.result}</StatBadge>
                  <StatBadge variant="neutral">{selectedTrade.session}</StatBadge>
                  {selectedTrade.news !== "None" && (
                    <StatBadge variant="news">
                      <Newspaper size={10} />
                      {selectedTrade.news}
                    </StatBadge>
                  )}
                </div>
                <div className="mt-3 text-[12px] text-ink-muted tnum">
                  {selectedTrade.ddMm}/{selectedTrade.year} at {selectedTrade.time}
                  {" · "}
                  {selectedTrade.market}
                </div>
              </div>

              {/* Performance */}
              <Section title="Performance">
                <Row label="Result" value={selectedTrade.result} highlight={TINT[selectedTrade.result]} />
                <Row label="SL points" value={`${selectedTrade.slPoints} p`} />
                <Row label="Trade duration" value={selectedTrade.tradeduration} />
                <Row
                  label="Account return"
                  value={
                    selectedTrade.result === "Win"
                      ? "+2.0% (1:2 RR)"
                      : selectedTrade.result === "Loss"
                        ? "−1.0%"
                        : "0.0%"
                  }
                  highlight={TINT[selectedTrade.result]}
                />
              </Section>

              {/* Setup */}
              <Section title="Setup">
                <Row label="Liquidity" value={`${selectedTrade.liquidity} (age ${selectedTrade.age})`} />
                <Row label="Add. liquidity" value={selectedTrade.additionalLiquidity} />
                <Row label="MSS" value={selectedTrade.mss} />
                <Row label="Setup formed" value={`${selectedTrade.setuptime} after sweep`} />
                <Row label="Gap size" value={`${selectedTrade.gapsize} p`} />
                <Row label="Gap-fill time" value={`${selectedTrade.gapfill} (entry trigger)`} />
              </Section>

              {/* Context */}
              <Section title="Market context">
                <Row label="Bias" value={capitalize(selectedTrade.Bias)} />
                <Row label="Volatility" value={selectedTrade.volatility} />
                <Row label="Rvol" value={selectedTrade.Rvol} />
                <Row label="ATH distance" value={selectedTrade.ath} />
                <Row label="News" value={selectedTrade.news} />
              </Section>

              {/* Auto-info */}
              {selectedTrade.info && (
                <Section title="Auto-info">
                  <p className="text-[12px] leading-relaxed text-ink/85 bg-white/40 p-3 rounded-xl border-l-2 border-ink/20">
                    {selectedTrade.info}
                  </p>
                </Section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SnapTabBtn({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 rounded-full text-[11.5px] font-medium leading-none transition-colors",
        active
          ? "bg-white text-ink shadow-card"
          : disabled
            ? "text-white/30 cursor-not-allowed"
            : "text-white/70 hover:text-white",
      )}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "win" | "loss" | "be" | "neutral";
}) {
  const valColor = highlight
    ? highlight === "win"
      ? "text-win-dark"
      : highlight === "loss"
        ? "text-loss-dark"
        : highlight === "be"
          ? "text-be-dark"
          : "text-ink"
    : "text-ink";
  return (
    <div className="flex items-center justify-between text-[12.5px] py-1 border-b border-ink/5 last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className={cn("font-semibold tnum text-right", valColor)}>{value}</span>
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
