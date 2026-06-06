import { useMemo, type ReactNode } from "react";
import { useJournal } from "../../store/useJournal";
import { athPct, derivePosition, primaryPosition } from "../../lib/drawings";
import { slBand } from "../../lib/journalOutcome";
import type { Outcome } from "../../types";

const OUTCOME_COLOR: Record<Outcome, string> = {
  Win: "#16c784", Loss: "#ea3943", "Break Even": "#f0b90b", Open: "#8a8d96",
};

function Row({ label, children, accent }: { label: string; children: ReactNode; accent?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
      <span className="text-[11.5px] text-[#8a8d96]">{label}</span>
      <span className="text-[12.5px] font-semibold tnum" style={{ color: accent || "#e7eaf0" }}>{children}</span>
    </div>
  );
}

export function DataTable() {
  const { selectedEvent: ev, drawings, candles, times, meta, manual, setManual } = useJournal();

  const d = useMemo(() => {
    if (!ev) return null;
    const pos = primaryPosition(drawings);
    const der = pos ? derivePosition(pos, ev, candles ?? [], times, meta) : null;
    const order = (pos ? pos.direction : ev.direction) === "buy" ? "Buy" : "Sell";
    const entry = pos?.entry ?? ev.level;
    const ap = athPct(entry, ev.athToDate);
    const band = pos && meta ? slBand(pos.entry, meta) : null;
    const slPts = der?.slPoints ?? null;
    const inBand = band && slPts != null ? slPts >= band[0] - 1e-6 && slPts <= band[1] + 1e-6 : null;
    return { pos, der, order, ap, band, slPts, inBand };
  }, [ev, drawings, candles, times, meta, manual]);

  if (!ev || !d) return <div className="p-4 text-[#8a8d96] text-[13px]">No event selected</div>;

  const outcome = (d.der?.outcome ?? null) as Outcome | null;

  return (
    <div className="flex flex-col h-full overflow-y-auto slim-scroll">
      <div className="px-3 py-2.5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold text-black"
            style={{ background: d.order === "Buy" ? "#16c784" : "#ffffff" }}>{d.order.toUpperCase()}</span>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold"
            style={{ background: "rgba(255,255,255,0.1)", color: "#e7eaf0" }}>{ev.liquidity}</span>
          <span className="text-[12px] text-[#8a8d96] tnum ml-auto">{ev.level.toFixed(1)}</span>
        </div>
      </div>

      {/* ---- AUTO (bot-filled) ---- */}
      <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wide text-[#5f636c]">Auto · the bot fills</div>
      <Row label="Market">{ev.market}</Row>
      <Row label="Date">{`${ev.ddMm}/${ev.year}`}</Row>
      <Row label="Time">{ev.sweepTime}</Row>
      <Row label="Order">{d.order}</Row>
      <Row label="Liquidity">{ev.liquidity}</Row>
      <Row label="Liquidity age">{ev.age}</Row>
      <Row label="SL points" accent={d.inBand === false ? "#ea3943" : undefined}>
        {d.slPts != null ? `${d.slPts.toFixed(1)} p` : "—"}
      </Row>
      <Row label="SL band">{d.band ? `${d.band[0].toFixed(1)}–${d.band[1].toFixed(1)} p` : "—"}</Row>
      <Row label="R:R">{d.der && d.der.valid ? "1 : 2" : "—"}</Row>
      <Row label="Result" accent={outcome ? OUTCOME_COLOR[outcome] : undefined}>{outcome ?? "—"}</Row>
      <Row label="Session">{ev.session}</Row>
      <Row label="−ATH %">{d.ap != null ? `${d.ap.toFixed(2)}%` : "—"}</Row>

      {/* ---- MANUAL (you fill) ---- */}
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-[#5f636c]">Manual · you fill</div>

      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-[11.5px] text-[#8a8d96]">MSS</span>
        <div className="flex gap-1">
          {(["Body", "Wick"] as const).map((k) => {
            const active = manual.mssKind === k;
            return (
              <button key={k} onClick={() => setManual({ mssKind: active ? null : k })}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
                style={{ transition: "background 180ms cubic-bezier(0.2,0,0,1)", background: active ? "#089981" : "rgba(255,255,255,0.08)", color: active ? "#001b15" : "#cfd3da" }}>
                {k}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-[11.5px] text-[#8a8d96]">Setup</span>
        <select value={manual.setup ?? ""} onChange={(e) => setManual({ setup: e.target.value || null })}
          className="bg-[#11141a] border border-white/10 rounded-md text-[12px] text-[#e7eaf0] px-2 py-1 outline-none">
          <option value="">—</option>
          {(meta?.setups ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="px-3 py-2">
        <span className="text-[11.5px] text-[#8a8d96] block mb-1">News</span>
        <input value={manual.news ?? ""} onChange={(e) => setManual({ news: e.target.value || null })}
          placeholder="e.g. CPI, none…"
          className="w-full bg-[#11141a] border border-white/10 rounded-md text-[12px] text-[#e7eaf0] px-2 py-1.5 outline-none" />
      </div>

      <div className="px-3 py-2 text-[10.5px] text-[#5f636c] leading-relaxed">
        Draw a <b className="text-[#8a8d96]">Long/Short</b> position (entry + SL) — TP auto-sets at 1:2 and the
        result is walked from the real candles. Everything auto-saves.
      </div>
    </div>
  );
}
