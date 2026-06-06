import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import {
  createChart, CandlestickSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type Logical, type UTCTimestamp,
} from "lightweight-charts";
import { MousePointer2, Minus, Square, Ruler, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import type { Anchor, Candle, Drawing, JournalEvent, JournalMeta } from "../../types";
import { logicalToTime, timeToLogical } from "../../lib/chartCoords";
import { newId, derivePosition } from "../../lib/drawings";
import { slBand } from "../../lib/journalOutcome";

type Tool = "select" | "mss" | "fvg" | "fib" | "long" | "short";

const UP = "#089981";
const DOWN = "#ffffff";
const r1 = (n: number) => Math.round(n * 10) / 10;

// lightweight-charts labels the time axis in UTC; format ticks/crosshair in the
// market timezone so the axis reads 10:00 (not 07:00 UTC).
const TZ = "Europe/Bucharest";
const _hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtHM = (t: unknown) => (typeof t === "number" ? _hm.format(new Date(t * 1000)) : String(t));

const TOOLS: { key: Tool; Icon: typeof Minus; label: string }[] = [
  { key: "select", Icon: MousePointer2, label: "Cursor" },
  { key: "mss", Icon: Minus, label: "MSS arrow" },
  { key: "fvg", Icon: Square, label: "FVG box" },
  { key: "fib", Icon: Ruler, label: "Fibonacci" },
  { key: "long", Icon: TrendingUp, label: "Long position" },
  { key: "short", Icon: TrendingDown, label: "Short position" },
];

export function Chart({
  event, candles, times, drawings, meta, onChange,
}: {
  event: JournalEvent;
  candles: Candle[];
  times: number[];
  drawings: Drawing[];
  meta: JournalMeta | null;
  onChange: (d: Drawing[]) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartElRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [api, setApi] = useState<{ chart: IChartApi; series: ISeriesApi<"Candlestick"> } | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [selId, setSelId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [live, setLive] = useState<Drawing[]>(drawings);
  const [draft, setDraft] = useState<{ a: Anchor; b: Anchor } | null>(null);

  const timesRef = useRef(times);
  useEffect(() => { timesRef.current = times; }, [times]);
  useEffect(() => { setLive(drawings); }, [drawings]);
  const toolRef = useRef(tool); useEffect(() => { toolRef.current = tool; }, [tool]);
  const liveRef = useRef(live); useEffect(() => { liveRef.current = live; }, [live]);

  // ---- create chart once; hold it in STATE so converters re-render when ready
  //      (a ref gets nulled by StrictMode's double-mount and the overlay goes blank).
  useEffect(() => {
    if (!chartElRef.current) return;
    const chart = createChart(chartElRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#000000" }, textColor: "#8a8d96", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.22)", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#1c1f26" },
        horzLine: { color: "rgba(255,255,255,0.22)", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#1c1f26" },
      },
      localization: { timeFormatter: fmtHM },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: {
        borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6,
        tickMarkFormatter: fmtHM,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP, wickUpColor: UP, borderUpColor: UP,
      downColor: DOWN, wickDownColor: DOWN, borderDownColor: DOWN,
      borderVisible: true, priceLineVisible: false, lastValueVisible: false,
    });
    setApi({ chart, series });
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { ro.disconnect(); chart.remove(); setApi(null); };
  }, []);

  // ---- set data + rAF watcher, keyed on the live chart ----
  useEffect(() => {
    if (!api) return;
    const { chart, series } = api;
    const seen = new Set<number>();
    const data: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    for (const k of candles) {
      const t = Math.floor(k.t / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      data.push({ time: t as UTCTimestamp, open: k.o, high: k.h, low: k.l, close: k.c });
    }
    series.setData(data);
    setSelId(null);
    setDraft(null);

    const ts = chart.timeScale();
    const redraw = () => setTick((t) => t + 1);
    ts.fitContent();
    // Redraw on user pan/zoom; refit + redraw on resize (also recovers a 0-width mount).
    ts.subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => { ts.fitContent(); redraw(); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    // Settle bumps: the chart paints on its own rAF after this effect, so a single render
    // can race ahead of the first paint (converters null). These post-paint re-renders
    // guarantee the overlay computes once the chart's coordinate space is ready.
    const timers = [60, 160, 320, 550, 850, 1300].map((ms) => window.setTimeout(redraw, ms));
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(redraw);
      ro.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [api, candles]);

  const setPan = useCallback((on: boolean) => {
    api?.chart.applyOptions({ handleScroll: on, handleScale: on });
  }, [api]);

  // ---- converters (depend on `api` so they recompute once the chart exists) ----
  const X = useCallback((ms: number): number | null => {
    if (!api) return null;
    return api.chart.timeScale().logicalToCoordinate(timeToLogical(timesRef.current, ms) as Logical);
  }, [api]);
  const Y = useCallback((p: number): number | null => api?.series.priceToCoordinate(p) ?? null, [api]);
  const toAnchor = useCallback((px: number, py: number): Anchor | null => {
    if (!api) return null;
    const logical = api.chart.timeScale().coordinateToLogical(px);
    const price = api.series.coordinateToPrice(py);
    if (logical == null || price == null) return null;
    return { time: logicalToTime(timesRef.current, logical as number), price: price as number };
  }, [api]);

  const evtXY = (e: RPE): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // ---- create-by-drag / click-to-place (tool armed) ----
  const onSvgDown = (e: RPE) => {
    if (toolRef.current === "select") return;
    e.preventDefault();
    const [px, py] = evtXY(e);
    const a = toAnchor(px, py);
    if (!a) return;
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setPan(false);
    setDraft({ a, b: a });
    const startPx = px;
    let lastB = a;
    const move = (ev: globalThis.PointerEvent) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const b = toAnchor(ev.clientX - rect.left, ev.clientY - rect.top);
      if (b) { lastB = b; setDraft({ a, b }); }
    };
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const rect = svgRef.current!.getBoundingClientRect();
      const b = toAnchor(ev.clientX - rect.left, ev.clientY - rect.top) ?? lastB;
      const moved = Math.hypot(ev.clientX - rect.left - startPx, ev.clientY - rect.top - py);
      const created = commitCreate(toolRef.current, a, b, moved);
      setDraft(null);
      if (created) setTool("select");
      setPan(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // returns true if a shape was created (so the tool resets to select)
  const commitCreate = (t: Tool, a: Anchor, b: Anchor, moved: number): boolean => {
    const CLICK = 5; // px — below this it's a "click", not a drag
    let d: Drawing | null = null;
    if (t === "long" || t === "short") {
      // click-to-place: entry at the click, SL a default (one min-band) away → drag SL to adjust.
      const dir = t === "long" ? "buy" : "sell";
      let entry = a.price, sl = b.price;
      if (moved < CLICK) {
        const off = meta ? slBand(entry, meta)[0] : 12;
        sl = dir === "buy" ? entry - off : entry + off;
      }
      d = { type: "position", id: newId("pos"), direction: dir, entry, sl, time: a.time };
    } else if (moved < CLICK) {
      return false; // MSS/FVG/Fib need a real drag — ignore stray clicks, keep tool armed
    } else if (t === "mss") {
      d = { type: "mss", id: newId("mss"), a, b };
    } else if (t === "fvg") {
      d = { type: "fvg", id: newId("fvg"), p1: a, p2: b };
    } else if (t === "fib") {
      const hi = a.price >= b.price ? a : b;
      const lo = a.price >= b.price ? b : a;
      d = { type: "fib", id: newId("fib"), hi, lo };
    }
    if (!d) return false;
    const next = [...liveRef.current, d];
    setLive(next);
    setSelId(d.id);
    onChange(next);
    return true;
  };

  // ---- edit existing (drag handle / body) ----
  const startEdit = (e: RPE, id: string, handle: string) => {
    e.stopPropagation();
    if (toolRef.current !== "select") return;
    setSelId(id);
    setPan(false);
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = svgRef.current!.getBoundingClientRect();
    const startA = toAnchor(e.clientX - rect.left, e.clientY - rect.top);
    const base = liveRef.current.find((d) => d.id === id);
    if (!startA || !base) return;
    const move = (ev: globalThis.PointerEvent) => {
      const cur = toAnchor(ev.clientX - rect.left, ev.clientY - rect.top);
      if (!cur) return;
      const dt = cur.time - startA.time;
      const dp = cur.price - startA.price;
      setLive((arr) => arr.map((d) => (d.id === id ? applyEdit(d, base, handle, cur, dt, dp) : d)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      onChange(liveRef.current);
      setPan(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const deleteSel = useCallback(() => {
    if (!selId) return;
    const next = liveRef.current.filter((d) => d.id !== selId);
    setLive(next); setSelId(null); onChange(next);
  }, [selId, onChange]);

  // keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selId) { e.preventDefault(); deleteSel(); }
      if (e.key === "Escape") { setTool("select"); setSelId(null); setDraft(null); setPan(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selId, deleteSel, setPan]);

  // ---- render geometry (recomputed each render; bump() re-renders on pan/zoom) ----
  const W = svgRef.current?.clientWidth ?? 0;
  const segs = computeShapes(live, draft, event, candles, times, meta, X, Y, W, selId);

  return (
    <div className="flex h-full w-full">
      {/* tool rail */}
      <div className="flex flex-col gap-1 p-1.5 bg-[#0c0e12] border-r border-white/10">
        {TOOLS.map(({ key, Icon, label }) => (
          <button
            key={key}
            title={label}
            onClick={() => { setTool(key); if (key !== "select") setSelId(null); }}
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{
              transition: "background 180ms cubic-bezier(0.2,0,0,1)",
              background: tool === key ? "#089981" : "transparent",
              color: tool === key ? "#001b15" : "#aeb4bf",
            }}
          >
            <Icon size={17} strokeWidth={2.2} />
          </button>
        ))}
        <div className="flex-1" />
        <button
          title="Delete selected"
          onClick={deleteSel}
          disabled={!selId}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-[#e26d5c] disabled:opacity-30 hover:bg-white/5"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* chart + overlay */}
      <div ref={wrapRef} className="relative flex-1 min-w-0">
        <div ref={chartElRef} className="absolute inset-0" />
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 5, pointerEvents: tool === "select" ? "none" : "auto", cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onSvgDown}
        >
          {segs.map((s) => renderSeg(s, startEdit))}
        </svg>
        {tool === "select" && live.length === 0 && (
          <div className="absolute top-3 left-3 text-[11px] text-[#aeb4bf] bg-black/55 border border-white/10 px-2.5 py-1.5 rounded-lg pointer-events-none">
            Pick a tool on the left → <b className="text-white">click</b> for Long/Short, or{" "}
            <b className="text-white">drag</b> for FVG / MSS / Fibonacci.
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- geometry ----------------------------- */

type Conv = (v: number) => number | null;
type Seg =
  | { kind: "liq"; x1: number; x2: number; y: number; right: number; label: string; liq: "HOD" | "LOD" }
  | { kind: "mss"; id: string; x1: number; y1: number; x2: number; y2: number; sel: boolean }
  | { kind: "fvg"; id: string; x: number; y: number; w: number; h: number; sel: boolean; size: number }
  | { kind: "fib"; id: string; xL: number; xR: number; y0: number; y50: number; y100: number; sel: boolean }
  | { kind: "pos"; id: string; x: number; right: number; yEntry: number; ySl: number; yTp: number; dir: "buy" | "sell"; sel: boolean; label: string }
  | { kind: "draft"; tool: string; x1: number; y1: number; x2: number; y2: number };

function applyEdit(d: Drawing, base: Drawing, handle: string, cur: Anchor, dt: number, dp: number): Drawing {
  if (d.type === "mss" && base.type === "mss") {
    if (handle === "a") return { ...d, a: cur };
    if (handle === "b") return { ...d, b: cur };
    return { ...d, a: { time: base.a.time + dt, price: base.a.price + dp }, b: { time: base.b.time + dt, price: base.b.price + dp } };
  }
  if (d.type === "fvg" && base.type === "fvg") {
    if (handle === "p1") return { ...d, p1: cur };
    if (handle === "p2") return { ...d, p2: cur };
    return { ...d, p1: { time: base.p1.time + dt, price: base.p1.price + dp }, p2: { time: base.p2.time + dt, price: base.p2.price + dp } };
  }
  if (d.type === "fib" && base.type === "fib") {
    if (handle === "hi") return { ...d, hi: cur };
    if (handle === "lo") return { ...d, lo: cur };
    return { ...d, hi: { time: base.hi.time + dt, price: base.hi.price + dp }, lo: { time: base.lo.time + dt, price: base.lo.price + dp } };
  }
  if (d.type === "position" && base.type === "position") {
    if (handle === "entry") return { ...d, entry: cur.price };
    if (handle === "sl") return { ...d, sl: cur.price };
    return { ...d, time: base.time + dt, entry: base.entry + dp, sl: base.sl + dp };
  }
  return d;
}

function computeShapes(
  live: Drawing[], draft: { a: Anchor; b: Anchor } | null, event: JournalEvent,
  candles: Candle[], times: number[], meta: JournalMeta | null,
  X: Conv, Y: Conv, width: number, selId: string | null,
): Seg[] {
  const out: Seg[] = [];
  const ok = (v: number | null): v is number => v != null && isFinite(v);

  // auto HOD/LOD level line: from the left edge (10:00) to the liquidation candle, then stop.
  const tIdx = event.touchIdx;
  if (candles.length && candles[tIdx]) {
    const x1 = X(candles[0].t), x2 = X(candles[tIdx].t), y = Y(event.level);
    if (ok(x1) && ok(x2) && ok(y)) {
      out.push({ kind: "liq", x1, x2, y, right: width, label: `${event.liquidity} ${r1(event.level)}`, liq: event.liquidity });
    }
  }

  for (const d of live) {
    const sel = d.id === selId;
    if (d.type === "mss") {
      const x1 = X(d.a.time), y1 = Y(d.a.price), x2 = X(d.b.time), y2 = Y(d.b.price);
      if (ok(x1) && ok(y1) && ok(x2) && ok(y2)) out.push({ kind: "mss", id: d.id, x1, y1, x2, y2, sel });
    } else if (d.type === "fvg") {
      const xa = X(d.p1.time), xb = X(d.p2.time), ya = Y(d.p1.price), yb = Y(d.p2.price);
      if (ok(xa) && ok(xb) && ok(ya) && ok(yb)) {
        out.push({ kind: "fvg", id: d.id, x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya), sel, size: r1(Math.abs(d.p1.price - d.p2.price)) });
      }
    } else if (d.type === "fib") {
      const xL = X(d.hi.time), xR = X(d.lo.time), y0 = Y(d.hi.price), y100 = Y(d.lo.price), y50 = Y((d.hi.price + d.lo.price) / 2);
      if (ok(xL) && ok(xR) && ok(y0) && ok(y50) && ok(y100)) out.push({ kind: "fib", id: d.id, xL: Math.min(xL, xR), xR: Math.max(xL, xR), y0, y50, y100, sel });
    } else if (d.type === "position") {
      const der = derivePosition(d, event, candles, times, meta);
      const x = X(d.time), yEntry = Y(d.entry), ySl = Y(d.sl), yTp = Y(der.tp);
      if (ok(x) && ok(yEntry) && ok(ySl) && ok(yTp)) {
        const label = `${d.direction === "buy" ? "LONG" : "SHORT"} · 1:2 · SL ${der.slPoints ?? "?"}p · ${der.outcome ?? "—"}`;
        out.push({ kind: "pos", id: d.id, x, right: Math.max(x + 60, width - 4), yEntry, ySl, yTp, dir: d.direction, sel, label });
      }
    }
  }

  if (draft) {
    const x1 = X(draft.a.time), y1 = Y(draft.a.price), x2 = X(draft.b.time), y2 = Y(draft.b.price);
    if (ok(x1) && ok(y1) && ok(x2) && ok(y2)) out.push({ kind: "draft", tool: "d", x1, y1, x2, y2 });
  }
  return out;
}

function renderSeg(
  s: Seg,
  startEdit: (e: RPE, id: string, handle: string) => void,
) {
  const handle = (id: string, h: string, cx: number, cy: number) => (
    <circle key={`${id}-${h}`} cx={cx} cy={cy} r={5} fill="#089981" stroke="#fff" strokeWidth={1}
      style={{ pointerEvents: "auto", cursor: "grab" }} onPointerDown={(e) => startEdit(e, id, h)} />
  );

  if (s.kind === "liq") {
    // LOD = up-side liquidity → marker points up below the line; HOD → points down above.
    const up = s.liq === "LOD";
    const tx = s.x2, ty = s.y;
    const tri = up
      ? `${tx},${ty + 3} ${tx - 5},${ty + 12} ${tx + 5},${ty + 12}`
      : `${tx},${ty - 3} ${tx - 5},${ty - 12} ${tx + 5},${ty - 12}`;
    return (
      <g key="liq">
        {/* faint reference of the level across the analysis area (subtle; the solid
            part + marker mark the actual liquidation) */}
        {s.right > s.x2 + 1 && (
          <line x1={s.x2} y1={s.y} x2={s.right} y2={s.y} stroke="rgba(245,179,1,0.18)" strokeWidth={1} strokeDasharray="3 5" />
        )}
        <line x1={s.x1} y1={s.y} x2={s.x2} y2={s.y} stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
        <polygon points={tri} fill="#f5b301" />
        <circle cx={tx} cy={ty} r={3.5} fill="#f5b301" />
        <text x={tx + 8} y={ty + (up ? 16 : -8)} fontSize={11} fill="#f5b301" fontWeight={700}>{s.label}</text>
      </g>
    );
  }
  if (s.kind === "mss") {
    const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const ah = 9;
    const p1 = [s.x2 - ah * Math.cos(ang - 0.4), s.y2 - ah * Math.sin(ang - 0.4)];
    const p2 = [s.x2 - ah * Math.cos(ang + 0.4), s.y2 - ah * Math.sin(ang + 0.4)];
    return (
      <g key={s.id}>
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
        <polygon points={`${s.x2},${s.y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill="rgba(255,255,255,0.5)" />
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={12}
          style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        {s.sel && <>{handle(s.id, "a", s.x1, s.y1)}{handle(s.id, "b", s.x2, s.y2)}</>}
      </g>
    );
  }
  if (s.kind === "fvg") {
    return (
      <g key={s.id}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="rgba(255,255,255,0.25)" stroke="#ffffff" strokeWidth={1}
          style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        <text x={s.x + 5} y={s.y + 13} fontSize={10.5} fill="#fff" style={{ pointerEvents: "none" }}>FVG {s.size}p</text>
        {s.sel && <>{handle(s.id, "p1", s.x, s.y)}{handle(s.id, "p2", s.x + s.w, s.y + s.h)}</>}
      </g>
    );
  }
  if (s.kind === "fib") {
    const row = (y: number, color: string, label: string) => (
      <g key={label}>
        <line x1={s.xL} y1={y} x2={s.xR} y2={y} stroke={color} strokeWidth={1} />
        <text x={s.xR + 4} y={y + 3} fontSize={9.5} fill={color}>{label}</text>
      </g>
    );
    return (
      <g key={s.id}>
        {row(s.y0, "#9aa0aa", "0%")}
        {row(s.y50, "#ff3b3b", "50%")}
        {row(s.y100, "#9aa0aa", "100%")}
        <line x1={s.xL} y1={s.y0} x2={s.xL} y2={s.y100} stroke="transparent" strokeWidth={12}
          style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        {s.sel && <>{handle(s.id, "hi", s.xL, s.y0)}{handle(s.id, "lo", s.xL, s.y100)}</>}
      </g>
    );
  }
  if (s.kind === "pos") {
    const rewardTop = Math.min(s.yEntry, s.yTp), rewardH = Math.abs(s.yTp - s.yEntry);
    const riskTop = Math.min(s.yEntry, s.ySl), riskH = Math.abs(s.ySl - s.yEntry);
    return (
      <g key={s.id}>
        <rect x={s.x} y={rewardTop} width={s.right - s.x} height={rewardH} fill="rgba(8,153,129,0.20)" />
        <rect x={s.x} y={riskTop} width={s.right - s.x} height={riskH} fill="rgba(255,255,255,0.20)" />
        <line x1={s.x} y1={s.yEntry} x2={s.right} y2={s.yEntry} stroke="#cfd3da" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={s.x} y1={s.yTp} x2={s.right} y2={s.yTp} stroke="#089981" strokeWidth={1} />
        <line x1={s.x} y1={s.ySl} x2={s.right} y2={s.ySl} stroke="#ffffff" strokeWidth={1} />
        <text x={s.x + 6} y={(rewardTop + riskTop + riskH) / 2 + (rewardTop < riskTop ? -4 : 4)} fontSize={10.5} fill="#e7eaf0" style={{ pointerEvents: "none" }}>{s.label}</text>
        {/* drag targets */}
        <rect x={s.x} y={Math.min(rewardTop, riskTop)} width={Math.min(70, s.right - s.x)} height={rewardH + riskH} fill="transparent"
          style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        {handle(s.id, "entry", s.x + 26, s.yEntry)}
        {handle(s.id, "sl", s.x + 26, s.ySl)}
      </g>
    );
  }
  if (s.kind === "draft") {
    return <line key="draft" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(255,255,255,0.6)" strokeWidth={1} strokeDasharray="4 4" />;
  }
  return null;
}
