import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Trade } from "../../types";

type Point = { idx: number; date: string; pct: number; trade: Trade };

const WIDTH = 720;
const HEIGHT = 220;
const PAD_X = 16;
const PAD_TOP = 16;
const PAD_BOT = 28;

function smoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

const RESULT_PCT: Record<Trade["result"], number> = {
  Win: 2,
  Loss: -1,
  "Break Even": 0,
  Open: 0,
};

export function EquityCurve({ trades }: { trades: Trade[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo<Point[]>(() => {
    let cum = 0;
    const arr: Point[] = [];
    // Sort trades chronologically by id (which is ms timestamp)
    const sorted = [...trades].sort((a, b) => Number(a.id) - Number(b.id));
    sorted.forEach((t, i) => {
      cum += RESULT_PCT[t.result];
      arr.push({ idx: i, date: `${t.ddMm}/${t.year.slice(2)}`, pct: cum, trade: t });
    });
    return arr;
  }, [trades]);

  const { min, max, projected } = useMemo(() => {
    if (!points.length) {
      return { min: 0, max: 0, projected: [] as { x: number; y: number }[] };
    }
    let lo = 0;
    let hi = 0;
    for (const p of points) {
      if (p.pct < lo) lo = p.pct;
      if (p.pct > hi) hi = p.pct;
    }
    // Pad the y-range a bit
    const range = Math.max(2, hi - lo);
    const padded = range * 0.15;
    const yMin = lo - padded;
    const yMax = hi + padded;

    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOT;
    const proj = points.map((p) => {
      const x =
        points.length === 1
          ? PAD_X + innerW / 2
          : PAD_X + (innerW * p.idx) / (points.length - 1);
      const y =
        PAD_TOP + innerH - ((p.pct - yMin) / (yMax - yMin)) * innerH;
      return { x, y };
    });
    return { min: yMin, max: yMax, projected: proj };
  }, [points]);

  const path = useMemo(() => smoothPath(projected), [projected]);
  const areaPath = useMemo(() => {
    if (!projected.length) return "";
    const last = projected[projected.length - 1];
    const baselineY = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOT) - ((0 - min) / (max - min)) * (HEIGHT - PAD_TOP - PAD_BOT);
    return `${path} L${last.x},${baselineY} L${projected[0].x},${baselineY} Z`;
  }, [path, projected, min, max]);

  const finalPct = points.length ? points[points.length - 1].pct : 0;
  const isPositive = finalPct >= 0;
  const stroke = isPositive ? "#1FB85C" : "#E14A38";
  const fillStop = isPositive ? "#83E6A8" : "#F2A395";

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || !points.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const t = (x - PAD_X) / (WIDTH - PAD_X * 2);
    const idx = Math.round(t * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  }

  // Zero baseline
  const zeroY =
    PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOT) - ((0 - min) / (max - min)) * (HEIGHT - PAD_TOP - PAD_BOT);

  const hovered = hover !== null ? points[hover] : null;
  const hoveredXY = hover !== null ? projected[hover] : null;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full h-[220px] cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="eqArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillStop} stopOpacity="0.55" />
            <stop offset="100%" stopColor={fillStop} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.7" />
            <stop offset="100%" stopColor={stroke} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Zero baseline */}
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(31,29,26,0.18)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text
          x={WIDTH - PAD_X - 4}
          y={zeroY - 4}
          fontSize="10"
          fill="rgba(31,29,26,0.5)"
          textAnchor="end"
          fontWeight={500}
        >
          0%
        </text>

        {/* Area */}
        <path d={areaPath} fill="url(#eqArea)" />
        {/* Line */}
        <path
          d={path}
          fill="none"
          stroke="url(#eqStroke)"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Trade dots */}
        {projected.map((p, i) => {
          const t = points[i].trade;
          const c =
            t.result === "Win"
              ? "#1FB85C"
              : t.result === "Loss"
                ? "#E14A38"
                : "#F4B83A";
          return (
            <circle
              key={t.id}
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5 : 3}
              fill="white"
              stroke={c}
              strokeWidth={hover === i ? 2.5 : 1.6}
              style={{ transition: "all 120ms cubic-bezier(0.2,0,0,1)" }}
            />
          );
        })}

        {/* Hover guide */}
        {hoveredXY && (
          <line
            x1={hoveredXY.x}
            x2={hoveredXY.x}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOT}
            stroke="rgba(31,29,26,0.25)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
      </svg>

      {/* Tooltip */}
      {hovered && hoveredXY && (
        <div
          className="absolute pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(hoveredXY.x / WIDTH) * 100}%`,
            top: `${(hoveredXY.y / HEIGHT) * 100}%`,
            marginTop: -10,
          }}
        >
          <div className="rounded-xl bg-ink text-white px-3 py-2 shadow-pop text-[11px] tnum">
            <div className="opacity-60 text-[10px] mb-0.5">{hovered.date}</div>
            <div className="font-semibold text-[13px]">
              {hovered.pct >= 0 ? "+" : ""}
              {hovered.pct.toFixed(1)}%
            </div>
            <div className="opacity-70 mt-0.5">
              #{hovered.trade.id.slice(-5)} · {hovered.trade.result}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
