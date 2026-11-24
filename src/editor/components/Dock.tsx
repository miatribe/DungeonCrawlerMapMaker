import { useState } from "react";
import { parseCellKey, type Problem } from "../../core";
import * as ops from "../../core/ops";
import { useEditor } from "../store";
import { TextField } from "./fields";

export function Dock() {
  const [tab, setTab] = useState<"levels" | "problems">("levels");
  const problems = useEditor((s) => s.problems);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  return (
    <section className="dock">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "levels"} className={tab === "levels" ? "active" : ""} onClick={() => setTab("levels")}>Levels</button>
        <button role="tab" aria-selected={tab === "problems"} className={tab === "problems" ? "active" : ""} onClick={() => setTab("problems")}>
          Problems
          {errors > 0 && <span className="badge error">{errors}</span>}
          {warnings > 0 && <span className="badge warning">{warnings}</span>}
        </button>
      </div>
      <div className="dock-body">{tab === "levels" ? <Levels /> : <Problems problems={problems} />}</div>
    </section>
  );
}

function Levels() {
  const levels = useEditor((s) => s.doc.levels);
  const cells = useEditor((s) => s.resolved.cells);
  const level = useEditor((s) => s.level);
  const setLevel = useEditor((s) => s.setLevel);
  const exec = useEditor((s) => s.exec);
  const count = (z: number) => cells.filter((c) => c.pos.z === z).length;
  // Show the defined levels plus the one being viewed, if it's new.
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
    if (edgeKey && s.doc.edges[edgeKey]) s.select({ edges: [edgeKey] });
    else if (cellKey && s.doc.cells[cellKey]) s.select({ cells: [cellKey] });
    const c = p.cell ?? (cellKey ? parseCellKey(cellKey) : undefined);
    if (c) s.focusCell(c.x, c.y, c.z);
  };
  return (
    <ul className="problems">
      {sorted.map((p, i) => (
        <li key={i} className={p.severity}>
          <button onClick={() => focus(p)} disabled={!p.cell && !p.where?.startsWith("cells") && !p.where?.startsWith("edges")}>
            <span className={`sev ${p.severity}`}>{p.severity}</span>
            <span className="code mono">{p.code}</span>
            <span className="msg">{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
