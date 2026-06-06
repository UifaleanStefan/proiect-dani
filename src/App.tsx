import { JournalView } from "./components/journal/JournalView";
import { JournalProvider } from "./store/useJournal";

export default function App() {
  return (
    <JournalProvider>
      <JournalView />
    </JournalProvider>
  );
}
