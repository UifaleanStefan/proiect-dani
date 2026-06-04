import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Manifest, StatsSummary, Trade, TradeFilter } from "../types";
import { DEFAULT_FILTER as DEFAULT } from "../types";

const POLL_MS = 4000;

type State = {
  trades: Trade[] | null;
  summary: StatsSummary | null;
  manifest: Manifest | null;
  filter: TradeFilter;
  selectedId: string | null;
  loading: boolean;
  lastError: string | null;
  lastUpdatedMs: number;
};

type Action =
  | { type: "FETCH_OK"; trades: Trade[]; summary: StatsSummary; manifest: Manifest }
  | { type: "FETCH_ERR"; error: string }
  | { type: "SET_FILTER"; filter: Partial<TradeFilter> }
  | { type: "RESET_FILTER" }
  | { type: "SELECT"; id: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FETCH_OK":
      return {
        ...state,
        trades: action.trades,
        summary: action.summary,
        manifest: action.manifest,
        loading: false,
        lastError: null,
        lastUpdatedMs: Date.now(),
      };
    case "FETCH_ERR":
      return { ...state, loading: false, lastError: action.error };
    case "SET_FILTER":
      return { ...state, filter: { ...state.filter, ...action.filter } };
    case "RESET_FILTER":
      return { ...state, filter: DEFAULT };
    case "SELECT":
      return { ...state, selectedId: action.id };
    default:
      return state;
  }
}

const initial: State = {
  trades: null,
  summary: null,
  manifest: null,
  filter: DEFAULT,
  selectedId: null,
  loading: true,
  lastError: null,
  lastUpdatedMs: 0,
};

type Ctx = State & {
  filtered: Trade[];
  selectedTrade: Trade | null;
  setFilter: (f: Partial<TradeFilter>) => void;
  resetFilter: () => void;
  select: (id: string | null) => void;
  refetch: () => Promise<void>;
};

const TradesCtx = createContext<Ctx | null>(null);

export function TradesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const lastPublishedRef = useRef(0);

  const fetchData = useCallback(async () => {
    try {
      const [trades, summary, manifest] = await Promise.all([
        fetch("/engine-data/result.json", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`result.json: ${r.status}`)),
        ),
        fetch("/engine-data/stats_summary.json", { cache: "no-store" }).then(
          (r) => (r.ok ? r.json() : Promise.reject(new Error(`stats: ${r.status}`))),
        ),
        fetch("/engine-data/manifest.json", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`manifest: ${r.status}`)),
        ),
      ]);
      dispatch({ type: "FETCH_OK", trades, summary, manifest });
      lastPublishedRef.current = manifest.published_at;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "FETCH_ERR", error: msg });
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll manifest every POLL_MS — only refetch heavy data if published_at changed
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/engine-data/manifest.json", { cache: "no-store" });
        if (!r.ok) return;
        const m: Manifest = await r.json();
        if (m.published_at !== lastPublishedRef.current) {
          await fetchData();
        }
      } catch {
        /* swallow — next tick will retry */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // Refetch on tab focus too
  useEffect(() => {
    const onFocus = () => {
      void fetchData();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  const setFilter = useCallback(
    (f: Partial<TradeFilter>) => dispatch({ type: "SET_FILTER", filter: f }),
    [],
  );
  const resetFilter = useCallback(() => dispatch({ type: "RESET_FILTER" }), []);
  const select = useCallback(
    (id: string | null) => dispatch({ type: "SELECT", id }),
    [],
  );

  const filtered = useMemo<Trade[]>(() => {
    const t = state.trades || [];
    return t.filter((tr) => {
      if (state.filter.result !== "all" && tr.result !== state.filter.result) return false;
      if (state.filter.side !== "all" && tr.order !== state.filter.side) return false;
      if (state.filter.setup !== "all" && tr.setup !== state.filter.setup) return false;
      if (state.filter.session !== "all" && tr.session !== state.filter.session) return false;
      if (state.filter.liquidity !== "all" && tr.liquidity !== state.filter.liquidity) return false;
      if (state.filter.withNews && tr.news === "None") return false;
      return true;
    });
  }, [state.trades, state.filter]);

  const selectedTrade = useMemo(
    () => state.trades?.find((t) => t.id === state.selectedId) ?? null,
    [state.trades, state.selectedId],
  );

  const value: Ctx = {
    ...state,
    filtered,
    selectedTrade,
    setFilter,
    resetFilter,
    select,
    refetch: fetchData,
  };

  return <TradesCtx.Provider value={value}>{children}</TradesCtx.Provider>;
}

export function useTrades(): Ctx {
  const ctx = useContext(TradesCtx);
  if (!ctx) throw new Error("useTrades must be used inside <TradesProvider>");
  return ctx;
}
