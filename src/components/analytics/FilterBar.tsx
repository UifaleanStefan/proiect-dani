import { motion } from "framer-motion";
import { Newspaper, RotateCcw } from "lucide-react";
import { useTrades } from "../../store/useTrades";
import { GlassCard } from "../ui/GlassCard";
import { cn } from "../../lib/cn";

type Group<T extends string> = {
  key: keyof import("../../types").TradeFilter;
  options: { label: string; value: T }[];
};

const RESULT: Group<"all" | "Win" | "Loss" | "Break Even"> = {
  key: "result",
  options: [
    { label: "All", value: "all" },
    { label: "Wins", value: "Win" },
    { label: "Losses", value: "Loss" },
    { label: "BE", value: "Break Even" },
  ],
};
const SIDE: Group<"all" | "Buy" | "Sell"> = {
  key: "side",
  options: [
    { label: "All", value: "all" },
    { label: "Buy", value: "Buy" },
    { label: "Sell", value: "Sell" },
  ],
};
const SESSION: Group<"all" | "London" | "New York"> = {
  key: "session",
  options: [
    { label: "All", value: "all" },
    { label: "London", value: "London" },
    { label: "New York", value: "New York" },
  ],
};
const LIQ: Group<"all" | "HOD" | "LOD" | "Local" | "Major"> = {
  key: "liquidity",
  options: [
    { label: "All", value: "all" },
    { label: "HOD/LOD", value: "HOD" },
    { label: "Local", value: "Local" },
    { label: "Major", value: "Major" },
  ],
};

function ChipRow<T extends string>({
  label,
  group,
  current,
  onChange,
}: {
  label: string;
  group: Group<T>;
  current: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-center gap-0.5 bg-white/40 rounded-full p-0.5 relative">
        {group.options.map((o) => {
          const active = current === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative px-3 py-1 rounded-full text-[11.5px] font-medium leading-none transition-colors",
                active ? "text-white" : "text-ink/70 hover:text-ink",
              )}
            >
              {active && (
                <motion.div
                  layoutId={`filter-${group.key}`}
                  className="absolute inset-0 rounded-full bg-ink shadow-card"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10 whitespace-nowrap">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FilterBar() {
  const { filter, setFilter, resetFilter, trades, filtered } = useTrades();
  const total = trades?.length || 0;
  const showing = filtered.length;
  const isActive = JSON.stringify(filter) !== JSON.stringify({
    result: "all", side: "all", setup: "all", session: "all", liquidity: "all", withNews: false,
  });

  return (
    <GlassCard className="px-4 py-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-baseline gap-2">
        <span className="text-[20px] font-bold tnum">{showing}</span>
        <span className="text-[12px] text-ink-muted">
          / {total} trade{total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="h-5 w-px bg-ink/15" />
      <div className="flex items-center gap-4 flex-wrap">
        <ChipRow
          label="Result"
          group={RESULT}
          current={filter.result}
          onChange={(v) => setFilter({ result: v })}
        />
        <ChipRow
          label="Side"
          group={SIDE}
          current={filter.side}
          onChange={(v) => setFilter({ side: v })}
        />
        <ChipRow
          label="Session"
          group={SESSION}
          current={filter.session}
          onChange={(v) => setFilter({ session: v })}
        />
        <ChipRow
          label="Liquidity"
          group={LIQ}
          current={filter.liquidity === "LOD" ? ("HOD" as never) : filter.liquidity}
          onChange={(v) => setFilter({ liquidity: v })}
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setFilter({ withNews: !filter.withNews })}
          className={cn(
            "h-8 px-3 rounded-full text-[11.5px] font-medium leading-none flex items-center gap-1.5 transition-colors",
            filter.withNews
              ? "bg-ink text-white shadow-card"
              : "bg-white/45 hover:bg-white/65 text-ink",
          )}
        >
          <Newspaper size={12} />
          News only
        </button>
        {isActive && (
          <button
            onClick={resetFilter}
            className="h-8 w-8 rounded-full bg-white/45 hover:bg-white/70 flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
            title="Reset filters"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </GlassCard>
  );
}
