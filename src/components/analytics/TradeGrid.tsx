import { AnimatePresence, motion } from "framer-motion";
import { useTrades } from "../../store/useTrades";
import { TradeCard } from "./TradeCard";

export function TradeGrid() {
  const { filtered, select } = useTrades();

  if (!filtered.length) {
    return (
      <div className="text-center py-16 text-ink-muted">
        <div className="text-[15px] font-medium">No trades match the current filters</div>
        <div className="text-[12px] mt-1">Loosen one or two chips above.</div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <AnimatePresence mode="popLayout">
        {filtered.map((t, i) => (
          <TradeCard
            key={t.id}
            trade={t}
            index={i}
            onClick={() => select(t.id)}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
