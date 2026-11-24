import { nextId } from "../../core";
import * as ops from "../../core/ops";
import { useEditor, type HeightTarget, type MaterialTarget, type RampKind } from "../store";
import { TOOLS } from "../tools";
import { NumberField, Swatch, TextField } from "./fields";

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
        {tool === "height" && <HeightPalette />}
        {tool === "ramp" && <RampPalette />}
        {tool === "vertical" && <VerticalPalette />}
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
      <p className="muted small">Hatches, pits and ladders go through floors and ceilings: use the Vertical connections tool (U).</p>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "active" : ""} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function HeightPalette() {
  const s = useEditor();
  const spl = s.doc.stepsPerLevel;
  return (
    <>
      <Segmented<HeightTarget>
        label="Height target"
        value={s.heightTarget}
        onChange={(heightTarget) => s.set({ heightTarget })}
        options={[{ id: "floor", label: "Floor" }, { id: "ceiling", label: "Ceiling" }, { id: "both", label: "Whole cell" }]}
      />
      <Segmented<"step" | "set">
        label="Height mode"
        value={s.heightMode}
        onChange={(heightMode) => s.set({ heightMode })}
        options={[{ id: "step", label: "Raise / lower" }, { id: "set", label: "Set to value" }]}
      />
      {s.heightMode === "set" ? (
        <div className="row">
          <span className="row-label">{s.heightTarget === "ceiling" ? "Ceiling" : "Floor"}</span>
          <span className="row-field">
            <NumberField value={s.heightValue} min={-64} max={128} onCommit={(heightValue) => s.set({ heightValue })} />
            <span className="muted small">steps</span>
          </span>
        </div>
      ) : null}
      <p className="muted small">
        {s.heightMode === "step"
          ? `Left-click raises by one step, right-click lowers. `
          : `Left-click sets the value, right-click resets to the default. `}
        {s.heightTarget === "both" ? "Whole cell moves floor and ceiling together. " : ""}
        One level is {spl} steps. A ceiling above {spl} makes a tall cell that reaches into the level above.
      </p>
    </>
  );
}

function RampPalette() {
  const s = useEditor();
  const spl = s.doc.stepsPerLevel;
  return (
    <>
      <Segmented<RampKind>
        label="Ramp kind"
        value={s.rampKind}
        onChange={(rampKind) => s.set({ rampKind })}
        options={[{ id: "stairs", label: "Stairs" }, { id: "ramp", label: "Ramp" }, { id: "levelStairs", label: "Up a level" }]}
      />
      {s.rampKind !== "levelStairs" ? (
        <>
          <div className="row">
            <span className="row-label">Rise per cell</span>
            <span className="row-field">
              <NumberField value={s.rampRise} min={1} max={spl * 2} onCommit={(rampRise) => s.set({ rampRise })} />
              <span className="muted small">steps</span>
            </span>
          </div>
          <p className="muted small">Each cell in the run starts where the previous one ended, so a drag over {spl} cells at rise 1 climbs one level ({spl} steps). Ceilings are raised where a cell's top would hit them.</p>
        </>
      ) : (
        <p className="muted small">Click or drag one cell in the uphill direction. It becomes a staircase climbing a full level, with headroom, and joins the cell beyond it on the level above. That cell is created if it doesn't exist.</p>
      )}
    </>
  );
}

function VerticalPalette() {
  const types = useEditor((s) => s.doc.connectionTypes);
  const s = useEditor();
  return (
    <>
      <Segmented<"down" | "up">
        label="Direction"
        value={s.verticalDir}
        onChange={(verticalDir) => s.set({ verticalDir })}
        options={[{ id: "down", label: "Down through floor" }, { id: "up", label: "Up through ceiling" }]}
      />
      <div className="choice-list" role="listbox" aria-label="Vertical connection types">
        {Object.entries(types)
          .filter(([, t]) => t.axis !== "horizontal")
          .map(([id, t]) => (
            <button key={id} role="option" aria-selected={s.activeVertical === id} className={`choice${s.activeVertical === id ? " active" : ""}`} onClick={() => s.set({ activeVertical: id })}>
              <Swatch color={(t.material && s.doc.materials[t.material]?.color) || (t.kind === "pit" ? "#000000" : "#5fd36b")} />
              <span className="lbl">{t.name}</span>
              <span className="muted small">{Object.keys(t.states).join(" / ")}</span>
            </button>
          ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={s.createMissing} onChange={(e) => s.set({ createMissing: e.target.checked })} />
        <span>Create the cell on the other side if it's missing</span>
      </label>
      <p className="muted small">Connections find the cell whose floor meets this ceiling (or whose ceiling meets this floor), even across tall cells.</p>
    </>
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
