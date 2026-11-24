import { lazy, Suspense, useEffect } from "react";
import * as ops from "../core/ops";
import { openProject, saveProject } from "./actions";
import { Dock } from "./components/Dock";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { MenuBar } from "./components/MenuBar";
import { Palette } from "./components/Palette";
import { StatusBar, Toast } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { fitCurrent, Viewport } from "./components/Viewport";
import { PlaytestPanel } from "./components/PlaytestPanel";
// Three.js is large; load the 3D/playtest view only when it's first used.
const View3D = lazy(() => import("./components/View3D").then((m) => ({ default: m.View3D })));
import { ViewHeader } from "./components/ViewHeader";
import { startPlaytest, startPlaytestHere, stopPlaytest } from "./playtest";
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
      if (e.key === "F5") { e.preventDefault(); if (s.viewMode === "play") stopPlaytest(); else if (e.shiftKey) startPlaytestHere(); else startPlaytest(); return; }
      if (e.key === "F6") { e.preventDefault(); if (s.viewMode === "play") stopPlaytest(); s.set({ viewMode: useEditor.getState().viewMode === "3d" ? "2d" : "3d" }); return; }
      if (typing || s.exportOpen || s.viewMode === "play") return;
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && k === "a") { e.preventDefault(); s.select({ cells: Object.keys(s.doc.cells).filter((c) => c.endsWith(`,${s.level}`)) }); return; }
      if (mod || e.altKey) return;
      if (e.key === "PageUp") { e.preventDefault(); s.setLevel(s.level + 1); return; }
      if (e.key === "PageDown") { e.preventDefault(); s.setLevel(s.level - 1); return; }
      if (e.key === "Home") { e.preventDefault(); fitCurrent(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
      if (e.key === "Escape") { if (s.pick) s.set({ pick: null }); else s.clearSelection(); return; }
      if (k === "l" && !e.shiftKey) { s.set({ showAllLinks: !s.showAllLinks }); return; }
      // = / - nudge the floor, Shift (+ / _) the ceiling, of the selection or the hovered cell.
      const nudge = { "=": ["floor", 1], "-": ["floor", -1], "+": ["ceiling", 1], "_": ["ceiling", -1] } as const;
      if (e.key in nudge) {
        const [part, delta] = nudge[e.key as keyof typeof nudge];
        const h = s.hover;
        const cells = s.selection.cells.length
          ? s.selection.cells.map((k) => s.doc.cells[k]?.pos).filter((p) => !!p)
          : h ? [h.kind === "cell" ? h.pos : h.cell].filter((p) => s.doc.cells[`${p.x},${p.y},${p.z}`]) : [];
        if (cells.length) { e.preventDefault(); s.exec(ops.adjustHeights(cells, { [part]: delta })); }
        return;
      }
      const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (tool) { s.setTool(tool.id); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function ThreeDNote() {
  return (
    <section className="panel">
      <header className="panel-head"><h2>3D view</h2></header>
      <div className="panel-body">
        <p className="muted small">Click cells to select and edit them in the Inspector. Edit the map in 2D (F6), and walk it with ▶ Playtest (F5). Faces point inward, so you can see into rooms from outside.</p>
      </div>
    </section>
  );
}

export function App() {
  useShortcuts();
  const dockHeight = useEditor((s) => s.dockHeight);
  const mode = useEditor((s) => s.viewMode);
  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <main className="center" style={{ gridTemplateRows: `auto 1fr ${dockHeight}px` }}>
        <ViewHeader />
        {mode === "2d" ? <Viewport /> : (
          <Suspense fallback={<div className="view3d loading muted">Loading 3D…</div>}>
            <View3D mode={mode} key={mode} />
          </Suspense>
        )}
        <Dock />
      </main>
      <aside className="sidebar">
        {mode === "play" ? <PlaytestPanel /> : (
          <>
            {mode === "2d" ? <Palette /> : <ThreeDNote />}
            <Inspector />
          </>
        )}
      </aside>
      <StatusBar />
      <ExportDialog />
      <Toast />
    </div>
  );
}
