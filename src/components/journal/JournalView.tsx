import { Loader2 } from "lucide-react";
import { useJournal } from "../../store/useJournal";
import { JournalBar } from "./JournalBar";
import { Chart } from "./Chart";
import { DataTable } from "./DataTable";

export function JournalView() {
  const {
    events, eventsError, selectedEvent, candles, times, candlesLoading,
    drawings, setDrawings, meta, scanning, scanMsg,
  } = useJournal();

  return (
    <div className="flex flex-col h-screen w-screen bg-[#05070a] text-[#e7eaf0] overflow-hidden">
      <JournalBar />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative">
          {eventsError && (!events || events.length === 0) ? (
            <div className="h-full flex items-center justify-center p-8">
              <div className="max-w-md rounded-xl border border-white/10 bg-[#0c0e12] p-5">
                <div className="text-[14px] font-semibold mb-2">No journal data yet</div>
                <div className="text-[12.5px] text-[#8a8d96] leading-relaxed">
                  Click <b>Upload CSV</b> to scan a market, or run the engine with{" "}
                  <code className="text-[#cfd3da]">--journal-only --publish-to …/public/engine-data</code>.
                </div>
                <div className="text-[11px] text-[#ea3943] mt-2 font-mono">{eventsError}</div>
              </div>
            </div>
          ) : !selectedEvent || candlesLoading || !candles ? (
            <div className="h-full flex items-center justify-center text-[#8a8d96] text-[13px]">
              {candlesLoading ? (
                <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> loading candles…</span>
              ) : (
                "Select or scan a liquidity grab"
              )}
            </div>
          ) : (
            <Chart
              key={selectedEvent.id}
              event={selectedEvent}
              candles={candles}
              times={times}
              drawings={drawings}
              meta={meta}
              onChange={setDrawings}
            />
          )}
        </div>

        <div className="w-[320px] shrink-0 bg-[#0a0c10] border-l border-white/10">
          <DataTable />
        </div>
      </div>

      {scanning && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={36} className="animate-spin text-[#089981]" />
            <div className="text-[14px] text-[#e7eaf0]">{scanMsg ?? "Scanning…"}</div>
            <div className="text-[11px] text-[#5f636c]">scanning the CSV on the local engine — this can take a minute</div>
          </div>
        </div>
      )}

      {!scanning && scanMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-[#0c0e12] border border-white/10 text-[12px] text-[#cfd3da]">
          {scanMsg}
        </div>
      )}
    </div>
  );
}
