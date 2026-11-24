import { useEffect } from "react";
import { useEditor } from "../store";

export function StatusBar() {
  const cursor = useEditor((s) => s.cursor);
  const level = useEditor((s) => s.level);
  const zoom = useEditor((s) => s.view.zoom);
  const hover = useEditor((s) => s.hover);
  const resolved = useEditor((s) => s.resolved);
  const levelName = useEditor((s) => s.doc.levels.find((l) => l.z === s.level)?.name);
  const cell = cursor ? resolved.cellAt({ x: cursor.x, y: cursor.y, z: level }) : undefined;
  return (
    <footer className="statusbar">
      <span>Level {level}{levelName ? ` · ${levelName}` : ""}</span>
      <span>{cursor ? `x ${cursor.x}, y ${cursor.y}` : "—"}</span>
      <span>{cell ? `floor ${cell.floor} · ceiling ${cell.ceiling} · ${resolved.materials[cell.surfaces.down]?.name ?? cell.surfaces.down}` : cursor ? "empty" : ""}</span>
      <span>{hover?.kind === "edge" ? `${hover.dir} edge` : ""}</span>
      <span className="spacer" />
      <span className="muted">Middle-drag or Space+drag to pan · wheel to zoom · Home to fit</span>
      <span>{Math.round(zoom)} px/cell</span>
    </footer>
  );
}

export function Toast() {
  const toast = useEditor((s) => s.toast);
  const set = useEditor((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => set({ toast: null }), toast.kind === "error" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast, set]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} onClick={() => set({ toast: null })}>
      {toast.text}
    </div>
  );
}
