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
  JournalEvent,
  JournalEventsFile,
  JournalMeta,
} from "../types";
import { deriveStats } from "../lib/journalOutcome";

type SaveState = "idle" | "saving" | "saved" | "error";

type Ctx = {
  meta: JournalMeta | null;
  events: JournalEvent[] | null;
  eventsError: string | null;
  selectedId: string | null;
  selectedEvent: JournalEvent | null;
  select: (id: string | null) => void;
  candles: Candle[] | null;
  candlesLoading: boolean;
  annotation: Annotation;
  updateAnnotation: (patch: Partial<Annotation>) => void;
  clearAnnotation: () => void;
  saveState: SaveState;
  statsIndex: Annotation[];
};

const JournalCtx = createContext<Ctx | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<JournalMeta | null>(null);
  const [events, setEvents] = useState<JournalEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [annotation, setAnnotation] = useState<Annotation>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statsIndex, setStatsIndex] = useState<Annotation[]>([]);

  const candleCache = useRef<Map<string, Candle[]>>(new Map());
  const annRef = useRef<Annotation>({});
  const saveTimer = useRef<number | undefined>(undefined);

  const loadEvents = useCallback(async () => {
    try {
      const r = await fetch("/engine-data/journal/events.json", { cache: "no-store" });
      if (!r.ok) {
        setEventsError(`events.json: ${r.status}`);
        setEvents([]);
        return;
      }
      const d: JournalEventsFile = await r.json();
      setMeta(d.meta);
      setEvents(d.events);
      setEventsError(null);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const r = await fetch("/api/journal/index", { cache: "no-store" });
      if (r.ok) setStatsIndex(await r.json());
    } catch {
      /* save-endpoint not running — stats stay empty */
    }
  }, []);

  useEffect(() => {
    void loadEvents();
    void refreshStats();
  }, [loadEvents, refreshStats]);

  const selectedEvent = useMemo(
    () => events?.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );

  // Load candles + saved annotation whenever the selection changes
  useEffect(() => {
    if (!selectedId) {
      setCandles(null);
      setAnnotation({});
      annRef.current = {};
      return;
    }
    let cancelled = false;

    const cached = candleCache.current.get(selectedId);
    if (cached) {
      setCandles(cached);
    } else {
      setCandlesLoading(true);
      void (async () => {
        try {
          const r = await fetch(`/engine-data/journal/candles/${selectedId}.json`, {
            cache: "force-cache",
          });
          const c: Candle[] = r.ok ? await r.json() : [];
          if (!cancelled) {
            candleCache.current.set(selectedId, c);
            setCandles(c);
          }
        } catch {
          if (!cancelled) setCandles([]);
        } finally {
          if (!cancelled) setCandlesLoading(false);
        }
      })();
    }

    void (async () => {
      try {
        const r = await fetch(`/api/journal/load/${selectedId}`, { cache: "no-store" });
        const a: Annotation = r.ok ? await r.json() : {};
        const next = a && a.id ? a : { id: selectedId };
        if (!cancelled) {
          annRef.current = next;
          setAnnotation(next);
          setSaveState("idle");
        }
      } catch {
        if (!cancelled) {
          annRef.current = { id: selectedId };
          setAnnotation({ id: selectedId });
          setSaveState("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const persist = useCallback(
    (next: Annotation) => {
      if (!selectedId || !selectedEvent) return;
      setSaveState("saving");
      const candlesForCalc = candleCache.current.get(selectedId) ?? null;
      const derived = deriveStats(next, selectedEvent, candlesForCalc, meta);
      const payload: Annotation = { ...next, ...derived, id: selectedId, updatedMs: Date.now() };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const r = await fetch(`/api/journal/save/${selectedId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          setSaveState(r.ok ? "saved" : "error");
          void refreshStats();
        } catch {
          setSaveState("error");
        }
      }, 400);
    },
    [selectedId, selectedEvent, meta, refreshStats],
  );

  const updateAnnotation = useCallback(
    (patch: Partial<Annotation>) => {
      const next: Annotation = { ...annRef.current, ...patch, id: selectedId ?? annRef.current.id };
      annRef.current = next;
      setAnnotation(next);
      persist(next);
    },
    [persist, selectedId],
  );

  const clearAnnotation = useCallback(() => {
    const cleared: Annotation = { id: selectedId ?? undefined };
    annRef.current = cleared;
    setAnnotation(cleared);
    persist(cleared);
  }, [persist, selectedId]);

  const value: Ctx = {
    meta,
    events,
    eventsError,
    selectedId,
    selectedEvent,
    select: setSelectedId,
    candles,
    candlesLoading,
    annotation,
    updateAnnotation,
    clearAnnotation,
    saveState,
    statsIndex,
  };

  return <JournalCtx.Provider value={value}>{children}</JournalCtx.Provider>;
}

export function useJournal(): Ctx {
  const ctx = useContext(JournalCtx);
  if (!ctx) throw new Error("useJournal must be used inside <JournalProvider>");
  return ctx;
}
