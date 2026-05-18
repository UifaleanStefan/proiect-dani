import { motion } from "framer-motion";
import { Activity, RefreshCw } from "lucide-react";
import { useTrades } from "../../store/useTrades";
import { GlassCard } from "../ui/GlassCard";
import { useEffect, useState } from "react";

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const sec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function TopBar() {
  const { manifest, lastUpdatedMs, refetch, loading } = useTrades();
  const [, force] = useState(0);

  // Re-render every 10s so the "X s ago" counter ticks
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-ink text-white flex items-center justify-center shadow-card">
          <Activity size={18} strokeWidth={2.4} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] leading-tight">
            DE30EUR Analytics
          </h1>
          <div className="text-[12px] text-ink-muted leading-tight tnum">
            Trade-setup engine · published {timeAgo(manifest?.published_at || 0)}
          </div>
        </div>
      </div>
      <GlassCard className="px-3 py-1.5 flex items-center gap-2">
        <span className="text-[11px] text-ink-muted tnum">
          Last sync {timeAgo(lastUpdatedMs)}
        </span>
        <motion.button
          onClick={() => void refetch()}
          whileTap={{ scale: 0.92 }}
          aria-label="Refresh"
          className="h-7 w-7 rounded-full bg-white/55 hover:bg-white flex items-center justify-center text-ink"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </motion.button>
      </GlassCard>
    </div>
  );
}
