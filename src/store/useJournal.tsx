import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Annotation,
  Candle,
  Drawing,
  JournalEvent,
  JournalEventsFile,
  JournalMeta,
  Manual,
} from "../types";
import { buildTimes } from "../lib/chartCoords";
import { buildAnnotation, normalizeDrawings } from "../lib/drawings";

type SaveState = "idle" | "saving" | "saved" | "error";
type Status = "none" | "partial" | "done";

function statusOf(a: Annotation | undefined): Status {
  if (!a) return "none";
  if (a.outcome && a.outcome !== "Open") return "done";
  if ((a.drawings && a.drawings.length) || a.setup || a.mssKind) return "partial";
  return "none";
}

type Ctx = {
  meta: JournalMeta | null;
  events: JournalEvent[] | null;
  eventsError: string | null;
  selectedId: string | null;
  selectedEvent: JournalEvent | null;
  selectedIndex: number;
  select: (id: string | null) => void;
  next: () => void;
  prev: () => void;
  candles: Candle[] | null;
  times: number[];
  candlesLoading: boolean;
  drawings: Drawing[];
  setDrawings: (d: Drawing[]) => void;
  manual: Manual;
  setManual: (patch: Partial<Manual>) => void;
  clearAll: () => void;
  saveState: SaveState;
  statsIndex: Annotation[];
  statusById: Map<string, Status>;
  scanning: boolean;
  scanMsg: string | null;
  scan: (file: File, market: string, shift: number) => Promise<void>;
  exportXlsx: () => Promise<void>;
};

const JournalCtx = createContext<Ctx | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<JournalMeta | null>(null);
  const [events, setEvents] = useState<JournalEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [manual, setManualState] = useState<Manual>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statsIndex, setStatsIndex] = useState<Annotation[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const candleCache = useRef<Map<string, Candle[]>>(new Map());
  const drawingsRef = useRef<Drawing[]>([]);
  const manualRef = useRef<Manual>({});
  const candlesRef = useRef<Candle[] | null>(null);
  const timesRef = useRef<number[]>([]);
  const eventRef = useRef<JournalEvent | null>(null);
  const metaRef = useRef<JournalMeta | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const times = useMemo(() => buildTimes(candles ?? []), [candles]);
  useEffect(() => { timesRef.current = times; }, [times]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { metaRef.current = meta; }, [meta]);

  const loadEvents = useCallback(async () => {
    try {
      const r = await fetch("/engine-data/journal/events.json", { cache: "no-store" });
      if (!r.ok) { setEventsError(`events.json: ${r.status}`); setEvents([]); return null; }
      const d: JournalEventsFile = await r.json();
      setMeta(d.meta);
      setEvents(d.events);
      setEventsError(null);
      return d;
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e));
      setEvents([]);
      return null;
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const r = await fetch("/api/journal/index", { cache: "no-store" });
      if (r.ok) setStatsIndex(await r.json());
    } catch { /* save-endpoint offline */ }
  }, []);

  useEffect(() => { void loadEvents(); void refreshStats(); }, [loadEvents, refreshStats]);

  const selectedEvent = useMemo(
    () => events?.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );
  useEffect(() => { eventRef.current = selectedEvent; }, [selectedEvent]);

  const selectedIndex = useMemo(
    () => (events && selectedId ? events.findIndex((e) => e.id === selectedId) : -1),
    [events, selectedId],
  );

  const statusById = useMemo(() => {
    const m = new Map<string, Status>();
    for (const a of statsIndex) if (a.id) m.set(a.id, statusOf(a));
    return m;
  }, [statsIndex]);

  // auto-select newest on load
  useEffect(() => {
    if (!selectedId && events && events.length) setSelectedId(events[0].id);
  }, [events, selectedId]);

  // Load candles + saved annotation on selection change
  useEffect(() => {
    if (!selectedId) { setCandles(null); setDrawingsState([]); setManualState({}); return; }
    let cancelled = false;

    const cached = candleCache.current.get(selectedId);
    if (cached) setCandles(cached);
    else {
      setCandlesLoading(true);
      void (async () => {
        try {
          const v = metaRef.current?.generatedMs ?? 0;
          const r = await fetch(`/engine-data/journal/candles/${selectedId}.json?v=${v}`, { cache: "force-cache" });
          const c: Candle[] = r.ok ? await r.json() : [];
          if (!cancelled) { candleCache.current.set(selectedId, c); setCandles(c); }
        } catch { if (!cancelled) setCandles([]); }
        finally { if (!cancelled) setCandlesLoading(false); }
      })();
    }

    void (async () => {
      try {
        const r = await fetch(`/api/journal/load/${selectedId}`, { cache: "no-store" });
        const a: Annotation = r.ok ? await r.json() : {};
        if (cancelled) return;
        const dr = normalizeDrawings(a.drawings);
        const mn: Manual = { mssKind: a.mssKind ?? null, setup: a.setup ?? null, news: a.news ?? null };
        drawingsRef.current = dr; manualRef.current = mn;
        setDrawingsState(dr); setManualState(mn); setSaveState("idle");
      } catch {
        if (cancelled) return;
        drawingsRef.current = []; manualRef.current = {};
        setDrawingsState([]); setManualState({}); setSaveState("idle");
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId]);

  const persist = useCallback(() => {
    const ev = eventRef.current;
    if (!ev) return;
    setSaveState("saving");
    const ann = buildAnnotation(
      ev, drawingsRef.current, manualRef.current,
      candlesRef.current ?? [], timesRef.current, metaRef.current,
    );
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/journal/save/${ev.id}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(ann),
        });
        setSaveState(r.ok ? "saved" : "error");
        void refreshStats();
      } catch { setSaveState("error"); }
    }, 400);
  }, [refreshStats]);

  const setDrawings = useCallback((d: Drawing[]) => {
    drawingsRef.current = d; setDrawingsState(d); persist();
  }, [persist]);

  const setManual = useCallback((patch: Partial<Manual>) => {
    const next = { ...manualRef.current, ...patch };
    manualRef.current = next; setManualState(next); persist();
  }, [persist]);

  const clearAll = useCallback(() => {
    drawingsRef.current = []; manualRef.current = {};
    setDrawingsState([]); setManualState({}); persist();
  }, [persist]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const next = useCallback(() => {
    setSelectedId((cur) => {
      if (!events || !events.length) return cur;
      const i = events.findIndex((e) => e.id === cur);
      return events[Math.min(events.length - 1, i + 1)]?.id ?? cur;
    });
  }, [events]);
  const prev = useCallback(() => {
    setSelectedId((cur) => {
      if (!events || !events.length) return cur;
      const i = events.findIndex((e) => e.id === cur);
      return events[Math.max(0, i - 1)]?.id ?? cur;
    });
  }, [events]);

  const scan = useCallback(async (file: File, market: string, shift: number) => {
    setScanning(true); setScanMsg(`Scanning ${market}…`);
    try {
      const r = await fetch(`/api/journal/scan?market=${encodeURIComponent(market)}&shift=${shift}`, {
        method: "POST", body: file,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `scan: ${r.status}`);
      candleCache.current.clear();
      setSelectedId(null);
      const d = await loadEvents();
      if (d && d.events.length) setSelectedId(d.events[0].id);
      await refreshStats();
      setScanMsg(`Loaded ${j.count} grabs for ${j.market}`);
    } catch (e) {
      setScanMsg(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }, [loadEvents, refreshStats]);

  const exportXlsx = useCallback(async () => {
    const r = await fetch("/api/journal/index", { cache: "no-store" });
    const idx: Annotation[] = r.ok ? await r.json() : [];
    const items = idx
      .filter((a) => a.outcome || (a.drawings && a.drawings.length) || a.setup)
      .sort((a, b) => (a.updatedMs ?? 0) - (b.updatedMs ?? 0));

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Journal");
    ws.columns = [
      { header: "Chart", key: "chart", width: 48 },
      { header: "Market", key: "market", width: 11 },
      { header: "Date", key: "date", width: 12 },
      { header: "Time", key: "time", width: 8 },
      { header: "Order", key: "order", width: 8 },
      { header: "Liquidity", key: "liquidity", width: 10 },
      { header: "Liquidity Age", key: "age", width: 14 },
      { header: "SL Points", key: "sl", width: 10 },
      { header: "R:R", key: "rr", width: 7 },
      { header: "Result", key: "result", width: 11 },
      { header: "Session", key: "session", width: 11 },
      { header: "ATH %", key: "ath", width: 9 },
      { header: "MSS", key: "mss", width: 8 },
      { header: "Setup", key: "setup", width: 14 },
      { header: "News", key: "news", width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Fetch one chart PNG → raw base64 (null if the trade was never opened/captured).
    const fetchPhoto = async (id?: string): Promise<string | null> => {
      if (!id) return null;
      try {
        const pr = await fetch(`/api/journal/photo/${id}`, { cache: "no-store" });
        if (!pr.ok) return null;
        const bytes = new Uint8Array(await pr.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      } catch { return null; }
    };

    for (const a of items) {
      const row = ws.addRow({
        market: a.market ?? "", date: a.date ?? "", time: a.time ?? "",
        order: a.order ?? "", liquidity: a.liquidity ?? "", age: a.ageStr ?? "",
        sl: a.slPoints ?? "", rr: a.rr ?? "", result: a.outcome ?? "",
        session: a.session ?? "", ath: a.athPct ?? "", mss: a.mssKind ?? "",
        setup: a.setup ?? "", news: a.news ?? "",
      });
      row.alignment = { vertical: "middle" };
      const b64 = await fetchPhoto(a.id);
      if (b64) {
        row.height = 150; // ~200px tall for the embedded chart
        const imgId = wb.addImage({ base64: `data:image/png;base64,${b64}`, extension: "png" });
        ws.addImage(imgId, {
          tl: { col: 0.04, row: row.number - 1 + 0.04 },
          ext: { width: 330, height: 188 },
        });
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal_${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const value: Ctx = {
    meta, events, eventsError,
    selectedId, selectedEvent, selectedIndex, select, next, prev,
    candles, times, candlesLoading,
    drawings, setDrawings, manual, setManual, clearAll,
    saveState, statsIndex, statusById,
    scanning, scanMsg, scan, exportXlsx,
  };
  return <JournalCtx.Provider value={value}>{children}</JournalCtx.Provider>;
}

export function useJournal(): Ctx {
  const ctx = useContext(JournalCtx);
  if (!ctx) throw new Error("useJournal must be used inside <JournalProvider>");
  return ctx;
}
