import { useRef, type ReactNode } from "react";
import { parseCellKey, type Problem } from "../../core";
import * as ops from "../../core/ops";
import { useEditor, type DockTab } from "../store";
import { EventsPanel } from "./EventsPanel";
import { TextField } from "./fields";
import { FlagsPanel } from "./FlagsPanel";
import { TypesPanel } from "./TypesPanel";

export function Dock() {
  const tab = useEditor((s) => s.dockTab);
  const set = useEditor((s) => s.set);
  const problems = useEditor((s) => s.problems);
  const nEvents = useEditor((s) => Object.keys(s.doc.events).length);
  const nFlags = useEditor((s) => Object.keys(s.doc.flags).length);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const tabs: { id: DockTab; label: string; extra?: ReactNode }[] = [
    { id: "levels", label: "Levels" },
    { id: "events", label: "Events", extra: nEvents ? <span className="count">{nEvents}</span> : null },
    { id: "flags", label: "Flags", extra: nFlags ? <span className="count">{nFlags}</span> : null },
    { id: "types", label: "Types" },
    {
      id: "problems", label: "Problems", extra: (
        <>
          {errors > 0 && <span className="badge error">{errors}</span>}
          {warnings > 0 && <span className="badge warning">{warnings}</span>}
        </>
      ),
    },
  ];
  return (
    <section className="dock">
      <Resizer />
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => set({ dockTab: t.id })}>
            {t.label}{t.extra}
          </button>
        ))}
      </div>
      <div className="dock-body">
        {tab === "levels" && <Levels />}
        {tab === "events" && <EventsPanel />}
        {tab === "flags" && <FlagsPanel />}
        {tab === "types" && <TypesPanel />}
        {tab === "problems" && <Problems problems={problems} />}
      </div>
    </section>
  );
}

/** Drag handle on the dock's top edge. */
function Resizer() {
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      className="dock-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: useEditor.getState().dockHeight };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const max = window.innerHeight - 200;
        const h = Math.max(110, Math.min(max, start.current.h + (start.current.y - e.clientY)));
        useEditor.getState().set({ dockHeight: h });
      }}
      onPointerUp={() => { start.current = null; }}
      onDoubleClick={() => { const s = useEditor.getState(); s.set({ dockHeight: s.dockHeight > 300 ? 210 : Math.round(window.innerHeight * 0.5) }); }}
      title="Drag to resize · double-click to toggle"
    />
  );
}

function Levels() {
  const levels = useEditor((s) => s.doc.levels);
  const cells = useEditor((s) => s.resolved.cells);
  const level = useEditor((s) => s.level);
  const setLevel = useEditor((s) => s.setLevel);
  const exec = useEditor((s) => s.exec);
  const count = (z: number) => cells.filter((c) => c.pos.z === z).length;
  const zs = [...new Set([...levels.map((l) => l.z), level])].sort((a, b) => b - a);
  return (
    <div className="levels">
      <div className="level-actions">
        <button className="btn small" onClick={() => setLevel(Math.max(...zs) + 1)}>+ Level above</button>
        <button className="btn small" onClick={() => setLevel(Math.min(...zs) - 1)}>+ Level below</button>
        <span className="muted small">PgUp / PgDn to switch. A level is saved once it has cells or a name.</span>
      </div>
      <ul>
        {zs.map((z) => {
          const def = levels.find((l) => l.z === z);
          return (
            <li key={z} className={z === level ? "active" : ""}>
              <button className="level-pick" onClick={() => setLevel(z)} aria-current={z === level}>z = {z}</button>
              <TextField value={def?.name ?? ""} placeholder="(unnamed)" onCommit={(name) => exec(ops.setLevelName(z, name))} />
              <span className="muted small">{count(z)} cells</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Problems({ problems }: { problems: Problem[] }) {
  const s = useEditor();
  if (!problems.length) return <p className="muted">No problems. The map is ready to export.</p>;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...problems].sort((a, b) => order[a.severity] - order[b.severity]);
  const focus = (p: Problem) => {
    const edgeKey = p.where?.match(/^edges\[(.+?)\]/)?.[1];
    const cellKey = p.where?.match(/^cells\[(.+?)\]/)?.[1];
    const propId = p.where?.match(/^props\.([^.]+)/)?.[1];
    const eventId = p.where?.match(/^events\.([^.[]+)/)?.[1];
    if (eventId && s.doc.events[eventId]) { s.set({ dockTab: "events", editingEvent: eventId }); return; }
    if (edgeKey && s.doc.edges[edgeKey]) s.select({ edges: [edgeKey] });
    else if (propId && s.doc.props[propId]) s.select({ props: [propId] });
    else if (cellKey && s.doc.cells[cellKey]) s.select({ cells: [cellKey] });
    const c = p.cell ?? (cellKey ? parseCellKey(cellKey) : propId ? s.doc.props[propId]?.cell : undefined);
    if (c) s.focusCell(c.x, c.y, c.z);
  };
  const focusable = (p: Problem) => !!p.cell || /^(cells|edges|props|events)/.test(p.where ?? "");
  return (
    <ul className="problems">
      {sorted.map((p, i) => (
        <li key={i} className={p.severity}>
          <button onClick={() => focus(p)} disabled={!focusable(p)}>
            <span className={`sev ${p.severity}`}>{p.severity}</span>
            <span className="code mono">{p.code}</span>
            <span className="msg">{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
