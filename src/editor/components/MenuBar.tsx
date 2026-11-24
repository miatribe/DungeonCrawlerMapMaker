import { useEffect, useRef, useState } from "react";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../core";
import { listRecent, newProject, openExample, openProject, openRecent, saveProject } from "../actions";
import type { Saved } from "../persistence";
import { EXAMPLES, useEditor } from "../store";
import { deleteSelection } from "../tools";
import { fitCurrent } from "./Viewport";
import { startPlaytest, startPlaytestHere, stopPlaytest } from "../playtest";

type Item = { label: string; shortcut?: string; action?: () => void; disabled?: boolean; checked?: boolean } | "sep";

function Menu({ label, items, open, onOpen, onClose }: { label: string; items: Item[]; open: boolean; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="menu">
      <button className={`menu-title${open ? " open" : ""}`} onClick={() => (open ? onClose() : onOpen())} onMouseEnter={(e) => { if (document.querySelector(".menu-title.open") && !open) { onOpen(); (e.target as HTMLElement).focus(); } }}>
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className="menu-item"
                disabled={it.disabled}
                onClick={() => { onClose(); it.action?.(); }}
              >
                <span className="check">{it.checked ? "✓" : ""}</span>
                <span className="lbl">{it.label}</span>
                {it.shortcut && <span className="kbd">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [recent, setRecent] = useState<Saved[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const s = useEditor();

  useEffect(() => {
    if (!open) return;
    if (open === "File") void listRecent().then(setRecent);
    const onDoc = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const menus: Record<string, Item[]> = {
    File: [
      { label: "New map", action: newProject },
      { label: "Open…", shortcut: "Ctrl+O", action: () => void openProject() },
      { label: "Save", shortcut: "Ctrl+S", action: () => void saveProject() },
      { label: "Save as…", shortcut: "Ctrl+Shift+S", action: () => void saveProject(true) },
      "sep",
      { label: "Export…", shortcut: "Ctrl+E", action: () => s.set({ exportOpen: true }) },
      "sep",
      ...Object.entries(EXAMPLES).map(([id, ex]): Item => ({ label: `Example: ${ex.name}`, action: () => openExample(id) })),
      ...(recent.length ? (["sep"] as Item[]) : []),
      ...recent.slice(0, 8).map((r): Item => ({
        label: `${r.name}${r.uid === s.docUid ? " (current)" : ""} — ${new Date(r.savedAt).toLocaleString()}`,
        action: () => void openRecent(r.uid),
        disabled: r.uid === s.docUid,
      })),
    ],
    Edit: [
      { label: canUndo(s.history) ? `Undo ${undoLabel(s.history)}` : "Undo", shortcut: "Ctrl+Z", action: s.undo, disabled: !canUndo(s.history) },
      { label: canRedo(s.history) ? `Redo ${redoLabel(s.history)}` : "Redo", shortcut: "Ctrl+Shift+Z", action: s.redo, disabled: !canRedo(s.history) },
      "sep",
      { label: "Delete selection", shortcut: "Del", action: deleteSelection, disabled: !s.selection.cells.length && !s.selection.edges.length && !s.selection.props.length },
      { label: "Select all on level", shortcut: "Ctrl+A", action: () => s.select({ cells: Object.keys(s.doc.cells).filter((k) => k.endsWith(`,${s.level}`)) }) },
      { label: "Clear selection", shortcut: "Esc", action: s.clearSelection },
    ],
    View: [
      { label: "2D editor", checked: s.viewMode === "2d", action: () => { if (s.viewMode === "play") stopPlaytest(); s.set({ viewMode: "2d" }); } },
      { label: "3D overview", shortcut: "F6", checked: s.viewMode === "3d", action: () => { if (s.viewMode === "play") stopPlaytest(); s.set({ viewMode: "3d" }); } },
      { label: "Playtest from start", shortcut: "F5", checked: s.viewMode === "play", action: () => startPlaytest() },
      { label: "Playtest from selected cell", shortcut: "Shift+F5", action: startPlaytestHere },
      "sep",
      { label: "Fit level", shortcut: "Home", action: fitCurrent, disabled: s.viewMode !== "2d" },
      { label: "Level up", shortcut: "PgUp", action: () => s.setLevel(s.level + 1) },
      { label: "Level down", shortcut: "PgDn", action: () => s.setLevel(s.level - 1) },
      "sep",
      { label: "Ghost level below", checked: s.ghostBelow, action: () => s.set({ ghostBelow: !s.ghostBelow }) },
      { label: "Ghost level above", checked: s.ghostAbove, action: () => s.set({ ghostAbove: !s.ghostAbove }) },
      { label: "Height labels", checked: s.showHeights, action: () => s.set({ showHeights: !s.showHeights }) },
      { label: "Show all logic links", shortcut: "L", checked: s.showAllLinks, action: () => s.set({ showAllLinks: !s.showAllLinks }) },
    ],
    Help: [
      { label: "Keyboard shortcuts & guide", shortcut: "F1", action: () => s.set({ helpOpen: true }) },
      { label: "Export format (for engines)", action: () => window.open("https://github.com/miatribe/DungeonCrawlerMapMaker/blob/master/docs/EXPORT_FORMAT.md", "_blank", "noopener") },
      { label: "Project on GitHub", action: () => window.open("https://github.com/miatribe/DungeonCrawlerMapMaker", "_blank", "noopener") },
    ],
  };

  return (
    <div className="menubar" ref={bar}>
      <div className="brand" title="Dungeon Crawler Map Maker">DCMM</div>
      {Object.entries(menus).map(([label, items]) => (
        <Menu key={label} label={label} items={items} open={open === label} onOpen={() => setOpen(label)} onClose={() => setOpen(null)} />
      ))}
      <div className="doc-title">
        {s.doc.name}
        <span className="file">{s.fileName ? ` · ${s.fileName}${s.dirty ? " •" : ""}` : " · autosaved in browser"}</span>
      </div>
      <button className="btn primary" onClick={() => s.set({ exportOpen: true })}>Export</button>
    </div>
  );
}
