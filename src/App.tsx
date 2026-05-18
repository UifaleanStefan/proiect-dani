import { AnalyticsView } from "./components/analytics/AnalyticsView";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { TradesProvider } from "./store/useTrades";

export default function App() {
  return (
    <TradesProvider>
      <div className="relative min-h-screen w-full select-none">
        <BackgroundLayer />
        <AnalyticsView />
      </div>
    </TradesProvider>
  );
}
