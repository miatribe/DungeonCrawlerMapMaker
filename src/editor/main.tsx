import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadLast } from "./persistence";
import { EXAMPLES, useEditor } from "./store";
import "./styles.css";

// Handy for poking at state from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { dcmm: typeof useEditor }).dcmm = useEditor;

async function boot() {
  // Reopen the last autosaved map; first visit gets the Keep of Echoes example.
  const last = await loadLast();
  const s = useEditor.getState();
  if (!(last && s.loadText(last.text, { uid: last.uid, silent: true }))) {
    s.loadText(EXAMPLES["keep-of-echoes"]!.text, { silent: true });
    s.set({ tool: "select" });
    s.notify("Welcome! This is the Keep of Echoes example. Press F5 to play it, or File → New map to start fresh.");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
