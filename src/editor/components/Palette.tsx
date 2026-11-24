import { nextId } from "../../core";
import * as ops from "../../core/ops";
import { useEditor, type MaterialTarget } from "../store";
import { TOOLS } from "../tools";
import { Swatch, TextField } from "./fields";

const KIND_HINT: Record<string, string> = {
  opening: "Open passage",
  door: "Usable door",
  gate: "Opened by events",
  wall: "Looks like a wall",
  custom: "Custom",
};

export function Palette() {
  const tool = useEditor((s) => s.tool);
  const info = TOOLS.find((t) => t.id === tool)!;
  return (
    <section className="panel">
      <header className="panel-head"><h2>{info.name}</h2><span className="kbd">{info.key}</span></header>
      <div className="panel-body">
        <p className="muted small">{info.hint}</p>
        {tool === "edge" && <ConnectionPalette />}
        {tool === "material" && <MaterialPalette />}
      </div>
    </section>
  );
}

function ConnectionPalette() {
  const types = useEditor((s) => s.doc.connectionTypes);
  const materials = useEditor((s) => s.doc.materials);
  const active = useEditor((s) => s.activeConnection);
  const set = useEditor((s) => s.set);
  return (
    <div className="choice-list" role="listbox" aria-label="Connection types">
      {Object.entries(types)
        .filter(([, t]) => t.axis !== "vertical")
        .map(([id, t]) => (
          <button key={id} role="option" aria-selected={active === id} className={`choice${active === id ? " active" : ""}`} onClick={() => set({ activeConnection: id })}>
            <Swatch color={(t.material && materials[t.material]?.color) || (t.kind === "opening" ? "#5fd36b" : "#e0a050")} />
            <span className="lbl">{t.name}</span>
            <span className="muted small">{Object.keys(t.states).join(" / ")}</span>
            <span className="muted small hint">{KIND_HINT[t.kind] ?? t.kind}</span>
          </button>
        ))}
      <p className="muted small">Vertical connections (hatches, pits, ladders) are set per cell in the Inspector.</p>
    </div>
  );
}

const TARGETS: { id: MaterialTarget; label: string }[] = [
  { id: "auto", label: "Face" },
  { id: "floor", label: "Floor" },
  { id: "ceiling", label: "Ceiling" },
  { id: "walls", label: "Walls" },
  { id: "all", label: "All" },
];

function MaterialPalette() {
  const materials = useEditor((s) => s.doc.materials);
  const active = useEditor((s) => s.activeMaterial);
  const target = useEditor((s) => s.materialTarget);
  const set = useEditor((s) => s.set);
  const exec = useEditor((s) => s.exec);
  const mat = materials[active];

  const add = () => {
    const id = nextId("material", Object.keys(materials));
    exec(ops.define("material", id, { name: "New material", color: "#808080" }));
    set({ activeMaterial: id });
  };

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Paint target">
        {TARGETS.map((t) => (
          <button key={t.id} role="radio" aria-checked={target === t.id} className={target === t.id ? "active" : ""} onClick={() => set({ materialTarget: t.id })}>{t.label}</button>
        ))}
      </div>
      <p className="muted small">{target === "auto" ? "Click near a wall to paint that wall face, or the middle of a cell to paint its floor." : `Paints the ${target === "all" ? "whole cell" : target} of each cell you click.`}</p>
      <div className="swatch-grid" role="listbox" aria-label="Materials">
        {Object.entries(materials).map(([id, m]) => (
          <button key={id} role="option" aria-selected={active === id} title={`${m.name} (${id})`} className={`swatch-btn${active === id ? " active" : ""}`} style={{ background: m.color }} onClick={() => set({ activeMaterial: id })} />
        ))}
        <button className="swatch-btn add" title="New material" onClick={add} aria-label="New material">+</button>
      </div>
      {mat && (
        <div className="mat-edit">
          <div className="row"><span className="row-label">Id</span><span className="row-field mono">{active}</span></div>
          <div className="row">
            <span className="row-label">Name</span>
            <span className="row-field"><TextField value={mat.name} onCommit={(name) => exec(ops.define("material", active, { ...mat, name }))} /></span>
          </div>
          <div className="row">
            <span className="row-label">Color</span>
            <span className="row-field">
              <input type="color" value={mat.color} onChange={(e) => exec(ops.define("material", active, { ...mat, color: e.target.value }))} />
              <span className="mono small">{mat.color}</span>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
