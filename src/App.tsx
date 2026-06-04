import { useState } from "react";
import { BarChart3, PenLine } from "lucide-react";
import { AnalyticsView } from "./components/analytics/AnalyticsView";
import { JournalView } from "./components/journal/JournalView";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { TradesProvider } from "./store/useTrades";
import { JournalProvider } from "./store/useJournal";

type View = "analytics" | "journal";

const TABS: { key: View; label: string; Icon: typeof BarChart3 }[] = [
  { key: "analytics", label: "Analytics", Icon: BarChart3 },
  { key: "journal", label: "Manual Journal", Icon: PenLine },
];

function NavTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="sticky top-0 z-30 w-full">
      <div className="glass-strong border-b border-[var(--card-border)] px-6 lg:px-10 py-2.5 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-2xl bg-white/40 p-1">
          {TABS.map(({ key, label, Icon }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className="relative flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[13px] font-semibold"
                style={{
                  transitionDuration: "180ms",
                  transitionTimingFunction: "cubic-bezier(0.2,0,0,1)",
                  background: active ? "#15130f" : "transparent",
                  color: active ? "#fff" : "var(--ink-muted)",
                }}
              >
                <Icon size={14} strokeWidth={2.4} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("analytics");

  return (
    <TradesProvider>
      <JournalProvider>
        <div className="relative min-h-screen w-full select-none">
          <BackgroundLayer />
          <NavTabs view={view} onChange={setView} />
          {view === "analytics" ? <AnalyticsView /> : <JournalView />}
        </div>
      </JournalProvider>
    </TradesProvider>
  );
}
