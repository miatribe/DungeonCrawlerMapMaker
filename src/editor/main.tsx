import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EXAMPLES, useEditor } from "./store";
import "./styles.css";

// Handy for poking at state from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { dcmm: typeof useEditor }).dcmm = useEditor;

// Maps aren't kept in the browser, so warn before closing or reloading with unsaved changes.
window.addEventListener("beforeunload", (e) => {
  if (useEditor.getState().dirty) e.preventDefault();
});

function boot() {
  // Every visit opens the Keep of Echoes example.
  const s = useEditor.getState();
  s.loadText(EXAMPLES["keep-of-echoes"]!.text, { silent: true });
  s.set({ tool: "select" });
  s.notify("Welcome! This is the Keep of Echoes example. Press F5 to play it, or File → New map to start fresh.");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
