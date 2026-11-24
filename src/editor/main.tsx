import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadLast } from "./persistence";
import { EXAMPLES, useEditor } from "./store";
import "./styles.css";

// Handy for poking at state from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { dcmm: typeof useEditor }).dcmm = useEditor;

async function boot() {
  // Reopen the last autosaved map; first visit gets the Three Rooms example.
  const last = await loadLast();
  const s = useEditor.getState();
  if (!(last && s.loadText(last.text, { uid: last.uid, silent: true }))) {
    s.loadText(EXAMPLES["three-rooms"]!.text, { silent: true });
    s.set({ tool: "select" });
    s.notify("Welcome! This is the Three Rooms example. File → New map starts from scratch.");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
