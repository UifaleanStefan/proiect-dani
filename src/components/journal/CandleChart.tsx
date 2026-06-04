import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Annotation, Candle, JournalEvent } from "../../types";

type Tool = "none" | "fvg" | "entry" | "sl" | "tp" | "mss";

const W = 1160;
const H = 620;
const PAD_L = 12;
const PAD_R = 72;
const PAD_T = 16;
const PAD_B = 26;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;

const UP = "#26A69A";
const DOWN = "#EF5350";
const HOD_C = "#7BA8D9";
const LOD_C = "#E89B5C";
const ENTRY_C = "#FFFFFF";
const SL_C = "#EF5350";
const TP_C = "#26A69A";
const MSS_C = "#C9A8FF";
const FVG_FILL = "rgba(255,255,255,0.12)";
const FVG_EDGE = "rgba(255,255,255,0.5)";

const TZ = "Europe/Bucharest";
const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(ms),
  );
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const TOOLS: { key: Tool; label: string; color: string }[] = [
  { key: "fvg", label: "FVG", color: FVG_EDGE },
  { key: "entry", label: "Entry", color: ENTRY_C },
  { key: "sl", label: "SL", color: SL_C },
  { key: "tp", label: "TP", color: TP_C },
  { key: "mss", label: "MSS", color: MSS_C },
];

export function CandleChart({
  candles,
  event,
  annotation,
  update,
  onClear,
}: {
  candles: Candle[];
  event: JournalEvent;
  annotation: Annotation;
  update: (patch: Partial<Annotation>) => void;
  onClear: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  const n = candles.length;

  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    // include marked levels so nothing is clipped
    for (const p of [
      event.hodPrice,
      event.lodPrice,
      annotation.entry,
      annotation.sl,
      annotation.tp,
      annotation.fvg?.top,
      annotation.fvg?.bottom,
    ]) {
      if (p == null || !isFinite(p)) continue;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    if (!isFinite(lo) || !isFinite(hi)) return { yMin: 0, yMax: 1 };
    const pad = Math.max(1, (hi - lo) * 0.06);
    return { yMin: lo - pad, yMax: hi + pad };
  }, [candles, event, annotation]);

  const candleW = n > 0 ? INNER_W / n : INNER_W;
  const xForIdx = (i: number) => PAD_L + (i + 0.5) * candleW;
  const yForPrice = (p: number) => PAD_T + ((yMax - p) / (yMax - yMin)) * INNER_H;
  const bodyW = Math.max(1, candleW * 0.68);

  // Candle layer — memoized so annotation edits don't re-tessellate the candles
  const candleLayer = useMemo(() => {
    return candles.map((c, i) => {
      const x = xForIdx(i);
      const up = c.c >= c.o;
      const col = up ? UP : DOWN;
      const yHigh = yForPrice(c.h);
      const yLow = yForPrice(c.l);
      const yo = yForPrice(c.o);
      const yc = yForPrice(c.c);
      const yTop = Math.min(yo, yc);
      const hgt = Math.max(0.6, Math.abs(yc - yo));
      return (
        <g key={i}>
          <line
            x1={x}
            x2={x}
            y1={yHigh}
            y2={yLow}
            stroke={col}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <rect x={x - bodyW / 2} y={yTop} width={bodyW} height={hgt} fill={col} />
        </g>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, yMin, yMax, candleW]);

  function pointFromEvent(e: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    const yv = ((e.clientY - rect.top) / rect.height) * H;
    const price = yMax - ((yv - PAD_T) / INNER_H) * (yMax - yMin);
    const idx = clamp(Math.round((xv - PAD_L) / candleW - 0.5), 0, Math.max(0, n - 1));
    return { price, idx };
  }

  function handleDown(e: PointerEvent<SVGSVGElement>) {
    if (tool === "none") return;
    const { price, idx } = pointFromEvent(e);
    if (tool === "fvg") {
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events / unsupported — drag still works via move/up */
      }
      setDrag({ a: price, b: price });
    } else if (tool === "entry" || tool === "sl" || tool === "tp") {
      update({ [tool]: r1(price) } as Partial<Annotation>);
    } else if (tool === "mss") {
      update({ mss: { idx, kind: annotation.mss?.kind ?? "Body" } });
    }
  }

  function handleMove(e: PointerEvent<SVGSVGElement>) {
    const { price } = pointFromEvent(e);
    setHoverPrice(price);
    if (drag) setDrag({ a: drag.a, b: price });
  }

  function handleUp() {
    if (drag) {
      const top = r1(Math.max(drag.a, drag.b));
      const bottom = r1(Math.min(drag.a, drag.b));
      if (Math.abs(top - bottom) > 0.05) update({ fvg: { top, bottom } });
      setDrag(null);
    }
  }

  // time-axis ticks
  const ticks = useMemo(() => {
    if (n === 0) return [];
    const step = Math.max(1, Math.floor(n / 8));
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < n; i += step) out.push({ x: xForIdx(i), label: fmtTime(candles[i].t) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, candleW]);

  const grabbed = event.liquidity; // "HOD" | "LOD"
  const priceLine = (
    p: number | null | undefined,
    color: string,
    label: string,
    dashed = false,
    bright = true,
  ) => {
    if (p == null || !isFinite(p)) return null;
    const y = yForPrice(p);
    return (
      <g key={label} opacity={bright ? 1 : 0.55}>
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={y}
          y2={y}
          stroke={color}
          strokeWidth={1.4}
          strokeDasharray={dashed ? "5 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
        <rect x={W - PAD_R + 2} y={y - 8} width={PAD_R - 4} height={16} fill={color} rx={3} />
        <text
          x={W - PAD_R / 2}
          y={y + 3.5}
          fontSize={10.5}
          textAnchor="middle"
          fill="#000"
          fontWeight={700}
        >
          {label} {r1(p)}
        </text>
      </g>
    );
  };

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[11px] text-ink-muted mr-1">Draw:</span>
        {TOOLS.map((t) => {
          const active = tool === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTool(active ? "none" : t.key)}
              className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors"
              style={{
                transitionDuration: "180ms",
                transitionTimingFunction: "cubic-bezier(0.2,0,0,1)",
                background: active ? t.color : "rgba(0,0,0,0.06)",
                color: active ? (t.key === "entry" ? "#000" : "#fff") : "var(--ink)",
              }}
            >
              {t.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold text-loss-dark bg-loss/10 hover:bg-loss/20"
          style={{ transitionDuration: "180ms", transitionTimingFunction: "cubic-bezier(0.2,0,0,1)" }}
        >
          Clear
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full rounded-xl"
        style={{
          aspectRatio: `${W} / ${H}`,
          background: "#000000",
          cursor: tool === "none" ? "default" : "crosshair",
          touchAction: "none",
        }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={() => setHoverPrice(null)}
      >
        {candleLayer}

        {/* Sweep marker */}
        <line
          x1={xForIdx(event.sweepIdx)}
          x2={xForIdx(event.sweepIdx)}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />

        {/* HOD / LOD context lines (grabbed one brighter) */}
        {priceLine(event.hodPrice, HOD_C, "HOD", true, grabbed === "HOD")}
        {priceLine(event.lodPrice, LOD_C, "LOD", true, grabbed === "LOD")}

        {/* FVG zone (committed) */}
        {annotation.fvg && (
          <g>
            <rect
              x={PAD_L}
              y={yForPrice(annotation.fvg.top)}
              width={INNER_W}
              height={Math.abs(yForPrice(annotation.fvg.bottom) - yForPrice(annotation.fvg.top))}
              fill={FVG_FILL}
              stroke={FVG_EDGE}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text x={PAD_L + 6} y={yForPrice(annotation.fvg.top) + 13} fontSize={11} fill={FVG_EDGE} fontWeight={700}>
              FVG {r1(Math.abs(annotation.fvg.top - annotation.fvg.bottom))}p
            </text>
          </g>
        )}

        {/* FVG drag preview */}
        {drag && (
          <rect
            x={PAD_L}
            y={yForPrice(Math.max(drag.a, drag.b))}
            width={INNER_W}
            height={Math.abs(yForPrice(drag.b) - yForPrice(drag.a))}
            fill="rgba(255,255,255,0.08)"
            stroke="rgba(255,255,255,0.4)"
            strokeDasharray="4 4"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* MSS marker */}
        {annotation.mss && (
          <g>
            <line
              x1={xForIdx(annotation.mss.idx)}
              x2={xForIdx(annotation.mss.idx)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke={MSS_C}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            <rect x={xForIdx(annotation.mss.idx) + 2} y={PAD_T + 2} width={70} height={16} rx={3} fill={MSS_C} />
            <text x={xForIdx(annotation.mss.idx) + 6} y={PAD_T + 13.5} fontSize={10.5} fill="#000" fontWeight={700}>
              MSS {annotation.mss.kind}
            </text>
          </g>
        )}

        {/* entry / sl / tp lines */}
        {priceLine(annotation.entry, ENTRY_C, "Entry")}
        {priceLine(annotation.sl, SL_C, "SL")}
        {priceLine(annotation.tp, TP_C, "TP")}

        {/* hover crosshair */}
        {hoverPrice != null && (
          <g>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yForPrice(hoverPrice)}
              y2={yForPrice(hoverPrice)}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <text x={W - PAD_R + 4} y={yForPrice(hoverPrice) - 3} fontSize={10} fill="rgba(255,255,255,0.6)">
              {r1(hoverPrice)}
            </text>
          </g>
        )}

        {/* time ticks */}
        {ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 8} fontSize={10} textAnchor="middle" fill="#787B86">
            {t.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
