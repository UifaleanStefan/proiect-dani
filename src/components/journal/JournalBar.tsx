import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Upload, FileSpreadsheet, Check, Loader2 } from "lucide-react";
import { useJournal } from "../../store/useJournal";

function marketFromName(name: string): string {
  return (
    name.replace(/\.[^.]+$/, "").replace(/\(.*?\)/g, "").replace(/[^0-9A-Za-z_-]/g, "").trim() || "MARKET"
  ).toUpperCase();
}

export function JournalBar() {
  const {
    meta, events, selectedEvent, selectedIndex, next, prev,
    saveState, scanning, scan, exportXlsx, statusById,
  } = useJournal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [shift, setShift] = useState(60);

  const total = events?.length ?? 0;
  const pos = selectedIndex >= 0 ? selectedIndex + 1 : 0;
  const done = events ? events.filter((e) => statusById.get(e.id) === "done").length : 0;

  const onPick = (f: File | null) => {
    if (!f) return;
    void scan(f, marketFromName(f.name), shift);
  };

  return (
    <div className="flex items-center gap-3 px-4 h-12 bg-[#0c0e12] border-b border-white/10 shrink-0">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-[#089981] text-black flex items-center justify-center font-bold text-[13px]">J</div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold text-[#e7eaf0]">{meta?.market ?? "—"}</div>
          <div className="text-[10px] text-[#5f636c]">manual journal</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 ml-2">
        <button onClick={prev} disabled={pos <= 1} className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-[#cfd3da]">
          <ChevronLeft size={16} />
        </button>
        <div className="text-[12.5px] text-[#cfd3da] tnum tabular-nums min-w-[88px] text-center">
          {pos} / {total}
        </div>
        <button onClick={next} disabled={pos >= total} className="h-8 px-3 rounded-lg bg-[#089981] hover:brightness-110 disabled:opacity-30 flex items-center gap-1 text-black text-[12.5px] font-semibold">
          Next <ChevronRight size={15} />
        </button>
      </div>

      {selectedEvent && (
        <div className="text-[12px] text-[#8a8d96] tnum">
          {selectedEvent.date} · {selectedEvent.sweepTime} · {selectedEvent.liquidity}
        </div>
      )}

      <div className="flex items-center gap-1.5 ml-1">
        {saveState === "saving" && <span className="text-[11px] text-[#8a8d96] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> saving</span>}
        {saveState === "saved" && <span className="text-[11px] text-[#16c784] flex items-center gap-1"><Check size={12} /> saved</span>}
        {saveState === "error" && <span className="text-[11px] text-[#ea3943]">save failed</span>}
      </div>

      <div className="flex-1" />

      <div className="text-[11px] text-[#5f636c] tnum mr-1">{done} journaled</div>

      <label className="flex items-center gap-1 text-[11px] text-[#8a8d96]">
        +min
        <input type="number" value={shift} onChange={(e) => setShift(parseInt(e.target.value || "0", 10) || 0)}
          className="w-12 bg-[#11141a] border border-white/10 rounded-md px-1.5 py-1 text-[12px] text-[#e7eaf0] outline-none tnum" />
      </label>

      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <button onClick={() => fileRef.current?.click()} disabled={scanning}
        className="h-8 px-3 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 flex items-center gap-1.5 text-[12px] text-[#cfd3da]">
        <Upload size={14} /> Upload CSV
      </button>
      <button onClick={() => void exportXlsx()}
        className="h-8 px-3 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1.5 text-[12px] text-[#cfd3da]">
        <FileSpreadsheet size={14} /> Excel
      </button>
    </div>
  );
}
