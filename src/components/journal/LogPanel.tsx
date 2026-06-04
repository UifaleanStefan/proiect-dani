import { useMemo, type ReactNode } from "react";
import type { Annotation, Candle, JournalEvent, JournalMeta, Outcome } from "../../types";
import { deriveStats, slBand } from "../../lib/journalOutcome";

const OUTCOME_COLOR: Record<Outcome, string> = {
  Win: "#1FB85C",
  Loss: "#E14A38",
  "Break Even": "#F4B83A",
  Open: "#7A7368",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink/5 last:border-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="text-[13px] font-semibold tnum">{children}</span>
    </div>
  );
}

export function LogPanel({
  annotation,
  event,
  meta,
  candles,
  update,
  saveState,
}: {
  annotation: Annotation;
  event: JournalEvent;
  meta: JournalMeta | null;
  candles: Candle[] | null;
  update: (patch: Partial<Annotation>) => void;
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  const d = useMemo(
    () => deriveStats(annotation, event, candles, meta),
    [annotation, event, candles, meta],
  );

  const band = meta && annotation.entry != null ? slBand(annotation.entry, meta) : null;
  const slInBand =
    band && d.slSize != null ? d.slSize >= band[0] - 1e-6 && d.slSize <= band[1] + 1e-6 : null;
  const fvgTooSmall = meta && d.fvgSize != null ? d.fvgSize < meta.minFvgSize : false;

  const isSell = event.direction === "sell";

  return (
    <div className="flex flex-col gap-3">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-md text-[11px] font-bold text-white"
            style={{ background: isSell ? "#B36C30" : "#1F58B0" }}
          >
            {isSell ? "SELL" : "BUY"}
          </span>
          <span className="text-[12.5px] text-ink-muted tnum">
            {event.ddMm}/{event.year.slice(2)} · {event.sweepTime} · {event.liquidity}
          </span>
        </div>
        <SaveBadge state={saveState} />
      </div>

      {/* measurements — auto-written by the bot from your hand-marked levels */}
      <div className="rounded-xl bg-white/40 px-3 py-1">
        <Row label="FVG size">
          {d.fvgSize != null ? (
            <span style={{ color: fvgTooSmall ? "#E14A38" : undefined }}>
              {d.fvgSize.toFixed(1)} p{fvgTooSmall ? " ⚠" : ""}
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row label="SL size">
          {d.slSize != null ? (
            <span style={{ color: slInBand === false ? "#E14A38" : undefined }}>
              {d.slSize.toFixed(1)} p
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row label="SL band (price-scaled)">
          {band ? `${band[0].toFixed(1)}–${band[1].toFixed(1)} p` : "—"}
        </Row>
        <Row label="Risk : Reward">{d.rr != null ? `1 : ${d.rr.toFixed(2)}` : "—"}</Row>
        <Row label="Entry">{annotation.entry != null ? annotation.entry.toFixed(1) : "—"}</Row>
        <Row label="Stop loss">{annotation.sl != null ? annotation.sl.toFixed(1) : "—"}</Row>
        <Row label="Take profit">{annotation.tp != null ? annotation.tp.toFixed(1) : "—"}</Row>
      </div>

      {/* MSS kind toggle */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] text-ink-muted">MSS type</span>
        <div className="flex gap-1">
          {(["Body", "Wick"] as const).map((k) => {
            const active = annotation.mss?.kind === k;
            const disabled = !annotation.mss;
            return (
              <button
                key={k}
                disabled={disabled}
                onClick={() => annotation.mss && update({ mss: { ...annotation.mss, kind: k } })}
                className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold disabled:opacity-40"
                style={{
                  transitionDuration: "180ms",
                  transitionTimingFunction: "cubic-bezier(0.2,0,0,1)",
                  background: active ? "#C9A8FF" : "rgba(0,0,0,0.06)",
                  color: active ? "#000" : "var(--ink)",
                }}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {/* auto-outcome */}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between"
        style={{ background: `${OUTCOME_COLOR[(d.outcome ?? "Open") as Outcome]}1A` }}
      >
        <div>
          <div className="text-[11px] text-ink-muted">Auto outcome (real candles)</div>
          <div className="text-[10.5px] text-ink-muted/80">
            {annotation.entry != null && annotation.sl != null && annotation.tp != null
              ? "Walked forward at fixed 1:2 RR, BE at 1.4R"
              : "Mark entry, SL & TP to simulate"}
          </div>
        </div>
        <span
          className="text-[16px] font-bold"
          style={{ color: OUTCOME_COLOR[(d.outcome ?? "Open") as Outcome] }}
        >
          {d.outcome ?? "—"}
        </span>
      </div>

      <p className="text-[11px] text-ink-muted leading-relaxed px-1">
        Pick a tool, then click the chart to place <b>Entry / SL / TP</b> lines, drag to draw the{" "}
        <b>FVG</b> zone, or click a candle for <b>MSS</b>. Everything auto-saves.
      </p>
    </div>
  );
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const map = {
    idle: { t: "", c: "" },
    saving: { t: "Saving…", c: "text-ink-muted" },
    saved: { t: "Saved ✓", c: "text-win-dark" },
    error: { t: "Save failed", c: "text-loss-dark" },
  } as const;
  const m = map[state];
  if (!m.t) return <span className="text-[11px] text-ink-muted/50">Auto-saves</span>;
  return <span className={`text-[11px] font-semibold ${m.c}`}>{m.t}</span>;
}
