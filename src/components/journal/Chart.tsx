import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import {
  createChart, CandlestickSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type Logical, type UTCTimestamp, type Time,
} from "lightweight-charts";
import { MousePointer2, Minus, Square, Ruler, TrendingUp, TrendingDown, Trash2, Eraser } from "lucide-react";
import type { Anchor, Candle, Drawing, JournalEvent, JournalMeta } from "../../types";
import { logicalToTime, timeToLogical, nearestIdx } from "../../lib/chartCoords";
import { newId, derivePosition, POS_DEFAULT_WIDTH_MS } from "../../lib/drawings";
import { slBand } from "../../lib/journalOutcome";

type Tool = "select" | "mss" | "fvg" | "fib" | "long" | "short";

const UP = "#089981";
const DOWN = "#ffffff";
const MIN_WIDTH_MS = 8 * 60_000; // shapes never collapse to zero width
const r1 = (n: number) => Math.round(n * 10) / 10;

// lightweight-charts labels the time axis in UTC; format ticks/crosshair in the
// market timezone so the axis reads 10:00 (not 07:00 UTC).
const TZ = "Europe/Bucharest";
const _hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtHM = (t: unknown) => (typeof t === "number" ? _hm.format(new Date(t * 1000)) : String(t));

const TOOLS: { key: Tool; Icon: typeof Minus; label: string }[] = [
  { key: "select", Icon: MousePointer2, label: "Cursor" },
  { key: "mss", Icon: Minus, label: "MSS arrow  ·  Ctrl = snap to candle, Shift = horizontal" },
  { key: "fvg", Icon: Square, label: "FVG box  ·  Ctrl = snap to candle" },
  { key: "fib", Icon: Ruler, label: "Fibonacci  ·  Ctrl = snap to candle" },
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
  const [draft, setDraft] = useState<{ a: Anchor; b: Anchor; tool: Tool } | null>(null);
  const [capturing, setCapturing] = useState(false); // hide handles/hint while snapshotting

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

  // Snap an anchor to the nearest candle's high/low while Ctrl/Cmd is held.
  const snapAnchor = useCallback((px: number, py: number, ev?: { ctrlKey?: boolean; metaKey?: boolean }): Anchor | null => {
    const base = toAnchor(px, py);
    if (!base) return null;
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      const c = candles[nearestIdx(timesRef.current, base.time)];
      if (c) {
        const toHigh = Math.abs(base.price - c.h), toLow = Math.abs(base.price - c.l);
        return { time: c.t, price: toHigh <= toLow ? c.h : c.l };
      }
    }
    return base;
  }, [toAnchor, candles]);

  const evtXY = (e: RPE): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // ---- chart photo capture (debounced) → POST /api/journal/photo/:id ----
  // Composite the chart's own screenshot (candles) with a rasterized copy of the SVG
  // overlay (drawings). This is native + instant — html-to-image hangs on the
  // lightweight-charts canvas, which would freeze the overlay (capturing stuck true).
  const capture = useCallback(async () => {
    if (!api || !svgRef.current) return;
    setCapturing(true);
    // let React flush the handle-free render before rasterizing (setTimeout, not rAF —
    // rAF can be paused when the tab is backgrounded; React's scheduler doesn't need it)
    await new Promise((res) => setTimeout(res, 60));
    try {
      const shot = api.chart.takeScreenshot(); // candles, at bitmap resolution
      const svgEl = svgRef.current;
      const cssW = svgEl.clientWidth, cssH = svgEl.clientHeight;
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(cssW));
      clone.setAttribute("height", String(cssH));
      const xml = new XMLSerializer().serializeToString(clone);
      const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      const overlay = await new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = svgUrl;
      });
      const out = document.createElement("canvas");
      out.width = shot.width; out.height = shot.height;
      const ctx = out.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(shot, 0, 0);
        if (overlay) ctx.drawImage(overlay, 0, 0, out.width, out.height); // CSS px → bitmap px
      }
      const url = out.toDataURL("image/png");
      await fetch(`/api/journal/photo/${event.id}`, {
        method: "POST", headers: { "content-type": "text/plain" }, body: url,
      });
    } catch { /* ignore capture/network errors — drawings still persist as data */ }
    finally { setCapturing(false); }
  }, [api, event.id]);

  const captureTimer = useRef(0);
  const scheduleCapture = useCallback(() => {
    window.clearTimeout(captureTimer.current);
    captureTimer.current = window.setTimeout(() => { void capture(); }, 800);
  }, [capture]);
  useEffect(() => () => window.clearTimeout(captureTimer.current), []);

  // ---- create-by-drag / click-to-place (tool armed) ----
  const onSvgDown = (e: RPE) => {
    if (toolRef.current === "select") return;
    e.preventDefault();
    const [px, py] = evtXY(e);
    const a = snapAnchor(px, py, e);
    if (!a) return;
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setPan(false);
    setDraft({ a, b: a, tool: toolRef.current });
    const startPx = px, startPy = py;
    let lastB = a;
    const resolve = (ev: globalThis.PointerEvent): Anchor => {
      const rect = svgRef.current!.getBoundingClientRect();
      let b = snapAnchor(ev.clientX - rect.left, ev.clientY - rect.top, ev) ?? lastB;
      if (toolRef.current === "mss" && ev.shiftKey) b = { time: b.time, price: a.price }; // horizontal
      return b;
    };
    const move = (ev: globalThis.PointerEvent) => {
      const b = resolve(ev);
      lastB = b; setDraft({ a, b, tool: toolRef.current });
    };
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const rect = svgRef.current!.getBoundingClientRect();
      const b = resolve(ev);
      const moved = Math.hypot(ev.clientX - rect.left - startPx, ev.clientY - rect.top - startPy);
      const created = commitCreate(toolRef.current, a, b, moved);
      setDraft(null);
      if (created) { setTool("select"); scheduleCapture(); }
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
      const entry = a.price;
      let sl = b.price;
      if (moved < CLICK) {
        const off = meta ? slBand(entry, meta)[0] : 12;
        sl = dir === "buy" ? entry - off : entry + off;
      }
      d = { type: "position", id: newId("pos"), direction: dir, entry, sl, t0: a.time, t1: a.time + POS_DEFAULT_WIDTH_MS };
    } else if (moved < CLICK) {
      return false; // MSS/FVG/Fib need a real drag — ignore stray clicks, keep tool armed
    } else if (t === "mss") {
      d = { type: "mss", id: newId("mss"), a, b };
    } else if (t === "fvg") {
      const t0 = Math.min(a.time, b.time);
      const t1 = Math.max(Math.max(a.time, b.time), t0 + MIN_WIDTH_MS);
      d = { type: "fvg", id: newId("fvg"), t0, t1, top: Math.max(a.price, b.price), bottom: Math.min(a.price, b.price) };
    } else if (t === "fib") {
      const t0 = Math.min(a.time, b.time);
      const t1 = Math.max(Math.max(a.time, b.time), t0 + MIN_WIDTH_MS);
      d = { type: "fib", id: newId("fib"), t0, t1, hi: Math.max(a.price, b.price), lo: Math.min(a.price, b.price) };
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
    const startA = snapAnchor(e.clientX - rect.left, e.clientY - rect.top, e);
    const base = liveRef.current.find((d) => d.id === id);
    if (!startA || !base) return;
    const priceHandle = handle === "sl" || handle === "entry";
    const move = (ev: globalThis.PointerEvent) => {
      const cur = snapAnchor(ev.clientX - rect.left, ev.clientY - rect.top, ev);
      if (!cur) return;
      const dt = cur.time - startA.time;
      const dp = cur.price - startA.price;
      setLive((arr) => arr.map((d) => (d.id === id ? applyEdit(d, base, handle, cur, dt, dp) : d)));
      // show the chart crosshair while dragging SL/entry so the user aligns to levels
      if (priceHandle && api) {
        const ct = candles[nearestIdx(timesRef.current, cur.time)]?.t;
        if (ct != null) api.chart.setCrosshairPosition(cur.price, Math.floor(ct / 1000) as Time, api.series);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (priceHandle) api?.chart.clearCrosshairPosition();
      onChange(liveRef.current);
      setPan(true);
      scheduleCapture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const deleteSel = useCallback(() => {
    if (!selId) return;
    const next = liveRef.current.filter((d) => d.id !== selId);
    setLive(next); setSelId(null); onChange(next); scheduleCapture();
  }, [selId, onChange, scheduleCapture]);

  const clearAllShapes = useCallback(() => {
    setLive([]); setSelId(null); onChange([]); scheduleCapture();
  }, [onChange, scheduleCapture]);

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
  const effSel = capturing ? null : selId; // clean photo: no handles
  const segs = computeShapes(live, capturing ? null : draft, event, candles, times, meta, X, Y, W, effSel);

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
          title="Delete selected (Del)"
          onClick={deleteSel}
          disabled={!selId}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-[#e26d5c] disabled:opacity-30 hover:bg-white/5"
        >
          <Trash2 size={16} />
        </button>
        <button
          title="Clear all drawings on this chart"
          onClick={clearAllShapes}
          disabled={live.length === 0}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-[#e26d5c] disabled:opacity-30 hover:bg-white/5"
        >
          <Eraser size={16} />
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
        {tool === "select" && live.length === 0 && !capturing && (
          <div className="absolute top-3 left-3 text-[11px] text-[#aeb4bf] bg-black/55 border border-white/10 px-2.5 py-1.5 rounded-lg pointer-events-none">
            Pick a tool on the left → <b className="text-white">click</b> for Long/Short, or{" "}
            <b className="text-white">drag</b> for FVG / MSS / Fibonacci.  Hold <b className="text-white">Ctrl</b> to snap to a candle.
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- geometry ----------------------------- */

type Conv = (v: number) => number | null;
type Seg =
  | { kind: "liq"; x1: number; x2: number; y: number; liq: "HOD" | "LOD" }
  | { kind: "mss"; id: string; x1: number; y1: number; x2: number; y2: number; sel: boolean }
  | { kind: "fvg"; id: string; x0: number; x1: number; yTop: number; yBottom: number; sel: boolean; size: number }
  | { kind: "fib"; id: string; xL: number; xR: number; y0: number; y50: number; y100: number; sel: boolean }
  | { kind: "pos"; id: string; x0: number; x1: number; yEntry: number; ySl: number; yTp: number; dir: "buy" | "sell"; sel: boolean; label: string }
  | { kind: "draft"; tool: Tool; x1: number; y1: number; x2: number; y2: number };

function applyEdit(d: Drawing, base: Drawing, handle: string, cur: Anchor, dt: number, dp: number): Drawing {
  if (d.type === "mss" && base.type === "mss") {
    if (handle === "a") return { ...d, a: cur };
    if (handle === "b") return { ...d, b: cur };
    return { ...d, a: { time: base.a.time + dt, price: base.a.price + dp }, b: { time: base.b.time + dt, price: base.b.price + dp } };
  }
  if (d.type === "fvg" && base.type === "fvg") {
    if (handle === "top") return { ...d, top: cur.price };
    if (handle === "bottom") return { ...d, bottom: cur.price };
    if (handle === "right") return { ...d, t1: Math.max(cur.time, base.t0 + MIN_WIDTH_MS) };
    return { ...d, t0: base.t0 + dt, t1: base.t1 + dt, top: base.top + dp, bottom: base.bottom + dp };
  }
  if (d.type === "fib" && base.type === "fib") {
    if (handle === "hi") return { ...d, hi: cur.price };
    if (handle === "lo") return { ...d, lo: cur.price };
    if (handle === "right") return { ...d, t1: Math.max(cur.time, base.t0 + MIN_WIDTH_MS) };
    return { ...d, t0: base.t0 + dt, t1: base.t1 + dt, hi: base.hi + dp, lo: base.lo + dp };
  }
  if (d.type === "position" && base.type === "position") {
    if (handle === "entry") return { ...d, entry: cur.price };
    if (handle === "sl") return { ...d, sl: cur.price };
    if (handle === "right") return { ...d, t1: Math.max(cur.time, base.t0 + MIN_WIDTH_MS) };
    return { ...d, t0: base.t0 + dt, t1: base.t1 + dt, entry: base.entry + dp, sl: base.sl + dp };
  }
  return d;
}

function computeShapes(
  live: Drawing[], draft: { a: Anchor; b: Anchor; tool: Tool } | null, event: JournalEvent,
  candles: Candle[], times: number[], meta: JournalMeta | null,
  X: Conv, Y: Conv, _width: number, selId: string | null,
): Seg[] {
  const out: Seg[] = [];
  const ok = (v: number | null): v is number => v != null && isFinite(v);

  // auto HOD/LOD level line: a white line from the left edge (10:00) to the liquidation
  // candle, then stop — no marker, no price, no continuation right.
  const tIdx = event.touchIdx;
  if (candles.length && candles[tIdx]) {
    const x1 = X(candles[0].t), x2 = X(candles[tIdx].t), y = Y(event.level);
    if (ok(x1) && ok(x2) && ok(y)) out.push({ kind: "liq", x1, x2, y, liq: event.liquidity });
  }

  for (const d of live) {
    const sel = d.id === selId;
    if (d.type === "mss") {
      const x1 = X(d.a.time), y1 = Y(d.a.price), x2 = X(d.b.time), y2 = Y(d.b.price);
      if (ok(x1) && ok(y1) && ok(x2) && ok(y2)) out.push({ kind: "mss", id: d.id, x1, y1, x2, y2, sel });
    } else if (d.type === "fvg") {
      const xa = X(d.t0), xb = X(d.t1), ya = Y(d.top), yb = Y(d.bottom);
      if (ok(xa) && ok(xb) && ok(ya) && ok(yb)) {
        out.push({ kind: "fvg", id: d.id, x0: Math.min(xa, xb), x1: Math.max(xa, xb), yTop: Math.min(ya, yb), yBottom: Math.max(ya, yb), sel, size: r1(Math.abs(d.top - d.bottom)) });
      }
    } else if (d.type === "fib") {
      const xa = X(d.t0), xb = X(d.t1), y0 = Y(d.hi), y100 = Y(d.lo), y50 = Y((d.hi + d.lo) / 2);
      if (ok(xa) && ok(xb) && ok(y0) && ok(y50) && ok(y100)) out.push({ kind: "fib", id: d.id, xL: Math.min(xa, xb), xR: Math.max(xa, xb), y0, y50, y100, sel });
    } else if (d.type === "position") {
      const der = derivePosition(d, event, candles, times, meta);
      const xa = X(d.t0), xb = X(d.t1), yEntry = Y(d.entry), ySl = Y(d.sl), yTp = Y(der.tp);
      if (ok(xa) && ok(xb) && ok(yEntry) && ok(ySl) && ok(yTp)) {
        const label = `${d.direction === "buy" ? "LONG" : "SHORT"} · 1:2 · SL ${der.slPoints ?? "?"}p · ${der.outcome ?? "—"}`;
        out.push({ kind: "pos", id: d.id, x0: Math.min(xa, xb), x1: Math.max(xa, xb), yEntry, ySl, yTp, dir: d.direction, sel, label });
      }
    }
  }

  if (draft) {
    const x1 = X(draft.a.time), y1 = Y(draft.a.price), x2 = X(draft.b.time), y2 = Y(draft.b.price);
    if (ok(x1) && ok(y1) && ok(x2) && ok(y2)) out.push({ kind: "draft", tool: draft.tool, x1, y1, x2, y2 });
  }
  return out;
}

function renderSeg(
  s: Seg,
  startEdit: (e: RPE, id: string, handle: string) => void,
) {
  const handle = (id: string, h: string, cx: number, cy: number, cursor = "grab") => (
    <g key={`${id}-${h}`} style={{ cursor }} onPointerDown={(e) => startEdit(e, id, h)}>
      {/* fat invisible grab area */}
      <circle cx={cx} cy={cy} r={13} fill="transparent" style={{ pointerEvents: "auto" }} />
      <circle cx={cx} cy={cy} r={5} fill="#089981" stroke="#fff" strokeWidth={1.5} style={{ pointerEvents: "none" }} />
    </g>
  );

  if (s.kind === "liq") {
    // white level line from the left edge to the liquidation candle; label HOD/LOD only.
    const labelY = s.liq === "LOD" ? s.y + 14 : s.y - 6;
    return (
      <g key="liq">
        <line x1={s.x1} y1={s.y} x2={s.x2} y2={s.y} stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
        <text x={s.x1 + 6} y={labelY} fontSize={11} fill="#ffffff" fontWeight={700} style={{ pointerEvents: "none" }}>{s.liq}</text>
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
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
        <polygon points={`${s.x2},${s.y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill="rgba(255,255,255,0.55)" />
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={18}
          style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        {s.sel && <>{handle(s.id, "a", s.x1, s.y1)}{handle(s.id, "b", s.x2, s.y2)}</>}
      </g>
    );
  }
  if (s.kind === "fvg") {
    const midY = (s.yTop + s.yBottom) / 2;
    return (
      <g key={s.id}>
        {/* no border — fill + dotted gray middle line */}
        <rect x={s.x0} y={s.yTop} width={s.x1 - s.x0} height={s.yBottom - s.yTop} fill="rgba(255,255,255,0.22)"
          style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        <line x1={s.x0} y1={midY} x2={s.x1} y2={midY} stroke="rgba(150,154,164,0.9)" strokeWidth={1} strokeDasharray="3 3" style={{ pointerEvents: "none" }} />
        <text x={s.x0 + 5} y={s.yTop + 13} fontSize={10.5} fill="#fff" style={{ pointerEvents: "none" }}>FVG {s.size}p</text>
        {s.sel && <>
          {handle(s.id, "top", (s.x0 + s.x1) / 2, s.yTop, "ns-resize")}
          {handle(s.id, "bottom", (s.x0 + s.x1) / 2, s.yBottom, "ns-resize")}
          {handle(s.id, "right", s.x1, midY, "ew-resize")}
        </>}
      </g>
    );
  }
  if (s.kind === "fib") {
    const row = (y: number, color: string, label: string) => (
      <g key={label}>
        <line x1={s.xL} y1={y} x2={s.xR} y2={y} stroke={color} strokeWidth={1} />
        {/* fat invisible grab area so every level is easy to click */}
        <line x1={s.xL} y1={y} x2={s.xR} y2={y} stroke="transparent" strokeWidth={16}
          style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        <text x={s.xR + 4} y={y + 3} fontSize={9.5} fill={color} style={{ pointerEvents: "none" }}>{label}</text>
      </g>
    );
    return (
      <g key={s.id}>
        {row(s.y0, "#9aa0aa", "0%")}
        {row(s.y50, "#ff3b3b", "50%")}
        {row(s.y100, "#9aa0aa", "100%")}
        {s.sel && <>
          {handle(s.id, "hi", s.xL, s.y0, "ns-resize")}
          {handle(s.id, "lo", s.xL, s.y100, "ns-resize")}
          {handle(s.id, "right", s.xR, s.y50, "ew-resize")}
        </>}
      </g>
    );
  }
  if (s.kind === "pos") {
    const rewardTop = Math.min(s.yEntry, s.yTp), rewardH = Math.abs(s.yTp - s.yEntry);
    const riskTop = Math.min(s.yEntry, s.ySl), riskH = Math.abs(s.ySl - s.yEntry);
    const w = s.x1 - s.x0;
    const midY = (Math.min(s.yTp, s.ySl) + Math.max(s.yTp, s.ySl)) / 2;
    return (
      <g key={s.id}>
        <rect x={s.x0} y={rewardTop} width={w} height={rewardH} fill="rgba(8,153,129,0.20)" />
        <rect x={s.x0} y={riskTop} width={w} height={riskH} fill="rgba(255,255,255,0.20)" />
        <line x1={s.x0} y1={s.yEntry} x2={s.x1} y2={s.yEntry} stroke="#cfd3da" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={s.x0} y1={s.yTp} x2={s.x1} y2={s.yTp} stroke="#089981" strokeWidth={1} />
        <line x1={s.x0} y1={s.ySl} x2={s.x1} y2={s.ySl} stroke="#ffffff" strokeWidth={1} />
        <text x={s.x0 + 6} y={s.yEntry - 6} fontSize={10.5} fill="#e7eaf0" style={{ pointerEvents: "none" }}>{s.label}</text>
        {/* drag targets — fat invisible lines so the entry/SL are easy to grab + select */}
        <line x1={s.x0} y1={s.yEntry} x2={s.x1} y2={s.yEntry} stroke="transparent" strokeWidth={16}
          style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={(e) => startEdit(e, s.id, "body")} />
        <line x1={s.x0} y1={s.ySl} x2={s.x1} y2={s.ySl} stroke="transparent" strokeWidth={16}
          style={{ pointerEvents: "stroke", cursor: "crosshair" }} onPointerDown={(e) => startEdit(e, s.id, "sl")} />
        {/* drag points — only while selected (clean chart otherwise) */}
        {s.sel && <>
          {handle(s.id, "entry", s.x0 + 26, s.yEntry, "ns-resize")}
          {handle(s.id, "sl", s.x0 + 26, s.ySl, "crosshair")}
          {handle(s.id, "right", s.x1, midY, "ew-resize")}
        </>}
      </g>
    );
  }
  if (s.kind === "draft") {
    if (s.tool === "fvg" || s.tool === "fib") {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
      return <rect key="draft" x={x} y={y} width={w} height={h} fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.6)" strokeWidth={1} strokeDasharray="4 4" />;
    }
    return <line key="draft" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(255,255,255,0.6)" strokeWidth={1} strokeDasharray="4 4" />;
  }
  return null;
}
