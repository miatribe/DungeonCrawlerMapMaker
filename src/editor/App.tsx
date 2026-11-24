import { useEffect } from "react";
import { openProject, saveProject } from "./actions";
import { Dock } from "./components/Dock";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { MenuBar } from "./components/MenuBar";
import { Palette } from "./components/Palette";
import { StatusBar, Toast } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { fitCurrent, Viewport } from "./components/Viewport";
import { useEditor } from "./store";
import { deleteSelection, TOOLS } from "./tools";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") { e.preventDefault(); void saveProject(e.shiftKey); return; }
      if (mod && k === "o") { e.preventDefault(); void openProject(); return; }
      if (mod && k === "e") { e.preventDefault(); s.set({ exportOpen: true }); return; }
      if (typing || s.exportOpen) return;
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && k === "a") { e.preventDefault(); s.select({ cells: Object.keys(s.doc.cells).filter((c) => c.endsWith(`,${s.level}`)) }); return; }
      if (mod || e.altKey) return;
      if (e.key === "PageUp") { e.preventDefault(); s.setLevel(s.level + 1); return; }
      if (e.key === "PageDown") { e.preventDefault(); s.setLevel(s.level - 1); return; }
      if (e.key === "Home") { e.preventDefault(); fitCurrent(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
      if (e.key === "Escape") { s.clearSelection(); return; }
      const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (tool) { s.setTool(tool.id); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  useShortcuts();
  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <main className="center">
        <Viewport />
        <Dock />
      </main>
      <aside className="sidebar">
        <Palette />
        <Inspector />
      </aside>
      <StatusBar />
      <ExportDialog />
      <Toast />
    </div>
  );
}
