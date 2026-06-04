import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useJournal } from "../../store/useJournal";
import type { Annotation, JournalEvent } from "../../types";
import { GlassCard } from "../ui/GlassCard";
import { CandleChart } from "./CandleChart";
import { LogPanel } from "./LogPanel";
import { JournalStats } from "./JournalStats";

type Status = "none" | "partial" | "done";

function statusOf(a: Annotation | undefined): Status {
  if (!a) return "none";
  if (a.outcome && a.outcome !== "Open") return "done";
  if (a.fvg || a.entry != null || a.sl != null || a.tp != null || a.mss) return "partial";
  return "none";
}

export function JournalView() {
  const {
    meta,
    events,
    eventsError,
    selectedId,
    selectedEvent,
    select,
    candles,
    candlesLoading,
    annotation,
    updateAnnotation,
    clearAnnotation,
    saveState,
    statsIndex,
  } = useJournal();

  const statusById = useMemo(() => {
    const m = new Map<string, Status>();
    for (const a of statsIndex) if (a.id) m.set(a.id, statusOf(a));
    return m;
  }, [statsIndex]);

  // auto-select the newest event once loaded
  useEffect(() => {
    if (!selectedId && events && events.length) select(events[0].id);
  }, [events, selectedId, select]);

  if (eventsError && (!events || events.length === 0)) {
    return (
      <div className="w-full px-6 lg:px-10 py-8 max-w-[1600px] mx-auto">
        <GlassCard className="px-6 py-5 max-w-xl">
          <h2 className="text-[15px] font-semibold mb-2">No journal data yet</h2>
          <p className="text-[12.5px] text-ink-muted leading-relaxed">
            Run the engine with{" "}
            <code className="px-1.5 py-0.5 rounded bg-ink/10 text-[11.5px] font-mono">
              --export-journal
            </code>{" "}
            (and <code className="font-mono">--publish-to …/public/engine-data</code>) so{" "}
            <code className="font-mono">/engine-data/journal/events.json</code> exists.
          </p>
          <p className="text-[11px] text-loss-dark font-mono mt-2">{eventsError}</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="w-full px-6 lg:px-10 py-6 lg:py-8 max-w-[1600px] mx-auto">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Manual Journal</h1>
        <span className="text-[12px] text-ink-muted tnum">
          {events?.length ?? 0} HOD/LOD grabs · you mark the setup, the bot measures
        </span>
      </div>

      <div className="mt-4">
        <JournalStats index={statsIndex} />
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
        {/* Event list */}
        <GlassCard className="p-2 h-[720px] overflow-y-auto slim-scroll">
          <div className="px-2 py-1.5 text-[11px] text-ink-muted sticky top-0">Liquidity grabs</div>
          <div className="flex flex-col gap-1">
            {(events ?? []).map((e) => (
              <EventRow
                key={e.id}
                ev={e}
                active={e.id === selectedId}
                status={statusById.get(e.id) ?? "none"}
                onClick={() => select(e.id)}
              />
            ))}
          </div>
        </GlassCard>

        {/* Chart + log */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
          <GlassCard className="p-4">
            {!selectedEvent ? (
              <div className="h-[560px] flex items-center justify-center text-ink-muted text-[13px]">
                Select a liquidity grab to start
              </div>
            ) : candlesLoading || !candles ? (
              <div className="h-[560px] flex items-center justify-center text-ink-muted text-[13px] animate-pulse">
                Loading candles…
              </div>
            ) : (
              <motion.div
                key={selectedEvent.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
              >
                <div className="text-[13px] font-semibold mb-1 tnum">
                  {selectedEvent.date} · sweep {selectedEvent.sweepTime} ·{" "}
                  <span style={{ color: selectedEvent.liquidity === "HOD" ? "#3B82E0" : "#E89B5C" }}>
                    {selectedEvent.liquidity} {selectedEvent.level.toFixed(1)}
                  </span>
                </div>
                <CandleChart
                  candles={candles}
                  event={selectedEvent}
                  annotation={annotation}
                  update={updateAnnotation}
                  onClear={clearAnnotation}
                />
              </motion.div>
            )}
          </GlassCard>

          <GlassCard className="p-4">
            {selectedEvent ? (
              <LogPanel
                annotation={annotation}
                event={selectedEvent}
                meta={meta}
                candles={candles}
                update={updateAnnotation}
                saveState={saveState}
              />
            ) : (
              <div className="text-ink-muted text-[13px]">No event selected</div>
            )}
          </GlassCard>
        </div>
      </div>
      <div className="h-12" />
    </div>
  );
}

const STATUS_DOT: Record<Status, string> = {
  none: "rgba(31,29,26,0.18)",
  partial: "#F4B83A",
  done: "#1FB85C",
};

function EventRow({
  ev,
  active,
  status,
  onClick,
}: {
  ev: JournalEvent;
  active: boolean;
  status: Status;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors"
      style={{
        transitionDuration: "180ms",
        transitionTimingFunction: "cubic-bezier(0.2,0,0,1)",
        background: active ? "rgba(255,255,255,0.85)" : "transparent",
      }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: STATUS_DOT[status] }}
        title={status}
      />
      <span className="text-[12.5px] font-semibold tnum w-[68px]">
        {ev.ddMm}/{ev.year.slice(2)}
      </span>
      <span className="text-[11.5px] text-ink-muted tnum w-[42px]">{ev.sweepTime}</span>
      <span
        className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md ml-auto"
        style={{
          background: ev.liquidity === "HOD" ? "rgba(59,130,224,0.14)" : "rgba(232,155,92,0.16)",
          color: ev.liquidity === "HOD" ? "#1F58B0" : "#B36C30",
        }}
      >
        {ev.liquidity}
      </span>
    </button>
  );
}
