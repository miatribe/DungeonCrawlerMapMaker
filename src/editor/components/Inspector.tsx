import type { ReactNode } from "react";
import {
  batch, FACINGS, type Cell, type CellShape, type Command, type EventRef, type Facing, type GridPos, type Side,
} from "../../core";
import * as ops from "../../core/ops";
import { useEditor } from "../store";
import { deleteSelection } from "../tools";
import { NumberField, Row, Select, Swatch, TextField } from "./fields";

const SIDE_LABEL: Record<Side, string> = { north: "North wall", east: "East wall", south: "South wall", west: "West wall", up: "Ceiling", down: "Floor" };

function useMaterialOptions() {
  const materials = useEditor((s) => s.doc.materials);
  return Object.entries(materials).map(([id, m]) => ({ value: id, label: `${m.name} (${id})` }));
}

function EventPicker({ value, onChange }: { value: EventRef | undefined; onChange: (v: string | undefined) => void }) {
  const events = useEditor((s) => s.doc.events);
  if (value !== undefined && typeof value !== "string") return <span className="muted">inline event</span>;
  return (
    <Select
      value={value ?? ""}
      empty="(none)"
      options={Object.keys(events).map((id) => ({ value: id, label: id }))}
      onChange={(v) => onChange(v || undefined)}
    />
  );
}

export function Inspector() {
  const sel = useEditor((s) => s.selection);
  if (sel.edges.length === 1 && !sel.cells.length) return <EdgeInspector edgeKey={sel.edges[0]!} />;
  if (sel.cells.length === 1) return <CellInspector cellKeyStr={sel.cells[0]!} />;
  if (sel.cells.length > 1 || sel.edges.length > 1) return <MultiInspector />;
  return <MapInspector />;
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head"><h2>{title}</h2>{actions}</header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

// ---------- map ----------

function MapInspector() {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const mats = useMaterialOptions();
  const r = useEditor((s) => s.resolved);
  return (
    <Section title="Map settings">
      <Row label="Name"><TextField value={doc.name} onCommit={(name) => exec(ops.setMapMeta({ name }))} /></Row>
      <Row label="Id" hint="Used as the export file name and by engines"><TextField mono value={doc.id} onCommit={(id) => /^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(id) ? exec(ops.setMapMeta({ id })) : useEditor.getState().notify("Ids start with a letter or _ and use letters, digits, _ . -", "error")} /></Row>
      <Row label="Steps per level" hint="Vertical resolution: how many height steps make one level">
        <NumberField value={doc.stepsPerLevel} min={1} max={64} onCommit={(n) => exec(ops.setMapMeta({ stepsPerLevel: n, stepHeight: 1 / n }))} />
      </Row>
      <Row label="Max step" hint="Largest floor step the player can walk up or down (playtest hint for engines)">
        <NumberField value={doc.rules.maxStep} min={0} max={64} onCommit={(n) => exec(ops.setMapMeta({ rules: { maxStep: n } }))} />
      </Row>
      <Row label="Cell size" hint="Engine hint: world units per cell"><NumberField value={doc.cellSize} min={0.01} step={0.25} onCommit={(n) => exec(ops.setMapMeta({ cellSize: n }))} /></Row>
      <h3>Default materials</h3>
      {(["wall", "floor", "ceiling"] as const).map((k) => (
        <Row key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
          <Swatch color={doc.materials[doc.defaults[k]]?.color ?? "#f0f"} />
          <Select value={doc.defaults[k]} options={mats} onChange={(v) => v && exec(ops.setMapMeta({ defaults: { ...doc.defaults, [k]: v } }))} />
        </Row>
      ))}
      <Row label="Start">
        <span className="muted">{doc.start ? `(${doc.start.cell.x}, ${doc.start.cell.y}, ${doc.start.cell.z}) facing ${doc.start.facing}` : "not set (use the Start tool)"}</span>
      </Row>
      <p className="muted small">
        {r.cells.length} cells · {r.edges.length} connections · {r.props.length} props · {Object.keys(doc.events).length} events · {r.levels.length} level(s)
      </p>
      <p className="muted small">Select a cell or connection to edit it.</p>
    </Section>
  );
}

// ---------- cell ----------

function CellInspector({ cellKeyStr }: { cellKeyStr: string }) {
  const doc = useEditor((s) => s.doc);
  const r = useEditor((s) => s.resolved);
  const exec = useEditor((s) => s.exec);
  const mats = useMaterialOptions();
  const cell = doc.cells[cellKeyStr];
  const rc = r.cellAt(cell?.pos ?? { x: 0, y: 0, z: 0 });
  if (!cell || !rc) return <MapInspector />;
  const pos = cell.pos;
  const upd = (patch: Partial<Omit<Cell, "pos">>) => exec(ops.updateCells([pos], patch));
  const props = Object.values(doc.props).filter((p) => p.cell.x === pos.x && p.cell.y === pos.y && p.cell.z === pos.z);
  const verticalTypes = Object.entries(doc.connectionTypes).filter(([, t]) => t.axis !== "horizontal").map(([id, t]) => ({ value: id, label: t.name }));
  const vertical = (dir: "up" | "down") => r.edgesOf(pos).find((e) => e.dir === dir)?.edge;

  return (
    <Section title={`Cell (${pos.x}, ${pos.y}, ${pos.z})`} actions={<button className="btn small danger" onClick={deleteSelection}>Delete</button>}>
      <Row label="Floor" hint="Steps above this level's base">
        <NumberField value={rc.floor} onCommit={(n) => upd({ floor: n === 0 ? undefined : n })} />
      </Row>
      <Row label="Ceiling" hint={`Steps above this level's base (default ${doc.stepsPerLevel})`}>
        <NumberField value={rc.ceiling} onCommit={(n) => upd({ ceiling: n === doc.stepsPerLevel ? undefined : n })} />
      </Row>
      <p className="muted small">Absolute height {rc.abs.floor}–{rc.abs.ceiling} steps</p>
      <ShapeEditor shape={rc.shape} onChange={(shape) => upd({ shape: shape.kind === "flat" ? undefined : shape })} />

      <h3>Surfaces</h3>
      {(["down", "up", ...FACINGS] as Side[]).map((side) => {
        const own = cell.surfaces?.[side];
        return (
          <Row key={side} label={SIDE_LABEL[side]}>
            <Swatch color={doc.materials[rc.surfaces[side]]?.color ?? "#f0f"} />
            <Select value={own ?? ""} empty={`default (${rc.surfaces[side]})`} options={mats} onChange={(v) => exec(ops.setSurface([pos], side, v || null))} />
          </Row>
        );
      })}

      <h3>Vertical connections</h3>
      {(["up", "down"] as const).map((dir) => {
        const e = vertical(dir);
        return (
          <Row key={dir} label={dir === "up" ? "Up" : "Down"} hint={dir === "up" ? "Connection through the ceiling to the cell above" : "Connection through the floor to the cell below"}>
            <Select
              value={e?.type ?? ""}
              empty="solid"
              options={verticalTypes}
              onChange={(v) => exec(ops.setEdge({ cell: pos, dir, ...(e && { toZ: dir === "up" ? e.to.z : e.from.z }) }, v || null))}
            />
            {e && <span className="muted small">{r.cellAt(dir === "up" ? e.to : e.from) ? "" : " no cell there"}</span>}
          </Row>
        );
      })}

      <h3>Triggers</h3>
      <Row label="On enter"><EventPicker value={cell.onEnter} onChange={(v) => upd({ onEnter: v })} /></Row>
      <Row label="On exit"><EventPicker value={cell.onExit} onChange={(v) => upd({ onExit: v })} /></Row>
      <Row label="Tags" hint="Comma-separated"><TextField value={(cell.tags ?? []).join(", ")} onCommit={(t) => { const tags = t.split(",").map((x) => x.trim()).filter(Boolean); upd({ tags: tags.length ? tags : undefined }); }} /></Row>

      {props.length > 0 && (
        <>
          <h3>Props here</h3>
          {props.map((p) => (
            <div key={p.id} className="list-row">
              <Swatch color={doc.propTypes[p.type]?.preview?.color ?? "#e0a050"} />
              <span className="mono">{p.id}</span>
              <span className="muted">{doc.propTypes[p.type]?.name ?? p.type} · {p.state}{p.side ? ` · ${p.side}` : ""}{typeof p.onUse === "string" ? ` · ${p.onUse}` : ""}</span>
              <button className="btn small" onClick={() => exec(ops.removeProp(p.id))} title="Delete prop">✕</button>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

function ShapeEditor({ shape, onChange }: { shape: CellShape; onChange: (s: CellShape) => void }) {
  const dirs = FACINGS.map((f) => ({ value: f, label: f }));
  return (
    <>
      <Row label="Shape">
        <Select
          value={shape.kind}
          options={[{ value: "flat", label: "Flat" }, { value: "ramp", label: "Ramp" }, { value: "stairs", label: "Stairs" }]}
          onChange={(k) => {
            if (k === "flat" || k === "") onChange({ kind: "flat" });
            else if (k === "ramp") onChange({ kind: "ramp", rise: shape.kind === "flat" ? 1 : shape.rise, toward: shape.kind === "flat" ? "east" : shape.toward });
            else onChange({ kind: "stairs", rise: shape.kind === "flat" ? 2 : shape.rise, toward: shape.kind === "flat" ? "east" : shape.toward, treads: shape.kind === "stairs" ? shape.treads : 4 });
          }}
        />
      </Row>
      {shape.kind !== "flat" && (
        <>
          <Row label="Rises toward"><Select value={shape.toward} options={dirs} onChange={(v) => v && onChange({ ...shape, toward: v as Facing })} /></Row>
          <Row label="Rise (steps)"><NumberField value={shape.rise} min={1} onCommit={(n) => onChange({ ...shape, rise: n })} /></Row>
          {shape.kind === "stairs" && <Row label="Treads"><NumberField value={shape.treads} min={1} onCommit={(n) => onChange({ ...shape, treads: n })} /></Row>}
        </>
      )}
    </>
  );
}

// ---------- edge ----------

function EdgeInspector({ edgeKey }: { edgeKey: string }) {
  const doc = useEditor((s) => s.doc);
  const r = useEditor((s) => s.resolved);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const e = doc.edges[edgeKey];
  const re = r.edges.find((x) => x.key === edgeKey);
  if (!e || !re) return <MapInspector />;
  const ct = doc.connectionTypes[e.type];
  const at = { cell: e.from, dir: e.dir, ...(e.toZ !== undefined && { toZ: e.toZ }) };
  const types = Object.entries(doc.connectionTypes)
    .filter(([, t]) => t.axis === "both" || (t.axis === "vertical") === re.vertical)
    .map(([id, t]) => ({ value: id, label: t.name }));
  const fmt = (p: GridPos) => `(${p.x}, ${p.y}, ${p.z})`;

  const setId = (id: string) => {
    if (id === (e.id ?? "")) return;
    try {
      if (!id) { exec(ops.updateEdge(edgeKey, { id: undefined })); return; }
      if (!/^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(id)) throw new Error("Ids start with a letter or _ and use letters, digits, _ . -");
      exec(e.id ? ops.renameId(doc, "edge", e.id, id) : ops.updateEdge(edgeKey, { id }));
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <Section title={ct?.name ?? e.type} actions={<button className="btn small danger" onClick={() => exec(ops.setEdge(at, null))}>Make wall</button>}>
      <p className="muted small">{fmt(re.from)} → {fmt(re.to)} · {re.vertical ? "vertical" : re.from.z !== re.to.z ? "crosses levels" : re.dir === "east" ? "east–west boundary" : "north–south boundary"}</p>
      <Row label="Id" hint="Needed when events target this connection. Renaming updates references.">
        <TextField mono value={e.id ?? ""} placeholder="(none)" onCommit={setId} />
      </Row>
      <Row label="Type"><Select value={e.type} options={types} onChange={(v) => v && exec(ops.setEdge(at, v))} /></Row>
      <Row label="State">
        <Select value={e.state} options={Object.keys(ct?.states ?? {}).map((s) => ({ value: s, label: s }))} onChange={(v) => v && exec(ops.updateEdge(edgeKey, { state: v }))} />
      </Row>
      {ct?.states[e.state] && (
        <p className="muted small">{ct.states[e.state]!.passable ? "Passable" : "Blocks movement"} · {ct.states[e.state]!.blocksSight ? "blocks sight" : "see-through"}</p>
      )}
      <h3>Triggers</h3>
      <Row label="On use"><EventPicker value={e.onUse} onChange={(v) => exec(ops.updateEdge(edgeKey, { onUse: v }))} /></Row>
      <Row label="On bump" hint="Fires when the player walks into it while it's impassable"><EventPicker value={e.onBump} onChange={(v) => exec(ops.updateEdge(edgeKey, { onBump: v }))} /></Row>
      <Row label="Tags"><TextField value={(e.tags ?? []).join(", ")} onCommit={(t) => { const tags = t.split(",").map((x) => x.trim()).filter(Boolean); exec(ops.updateEdge(edgeKey, { tags: tags.length ? tags : undefined })); }} /></Row>
    </Section>
  );
}

// ---------- multi ----------

function MultiInspector() {
  const sel = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const mats = useMaterialOptions();
  const cells = sel.cells.map((k) => doc.cells[k]?.pos).filter((p): p is GridPos => !!p);
  const apply = (label: string, cmds: Command[]) => exec(batch(label, cmds));
  return (
    <Section title={`${cells.length} cells${sel.edges.length ? `, ${sel.edges.length} connections` : ""}`} actions={<button className="btn small danger" onClick={deleteSelection}>Delete</button>}>
      {cells.length > 0 && (
        <>
          <Row label="Floor (all)"><NumberField value="" placeholder="mixed" onCommit={(n) => exec(ops.updateCells(cells, { floor: n === 0 ? undefined : n }))} /></Row>
          <Row label="Ceiling (all)"><NumberField value="" placeholder="mixed" onCommit={(n) => exec(ops.updateCells(cells, { ceiling: n === doc.stepsPerLevel ? undefined : n }))} /></Row>
          <Row label="Raise / lower">
            <span className="btn-group">
              <button className="btn small" onClick={() => exec(ops.adjustHeights(cells, { floor: -1 }))}>Floor −</button>
              <button className="btn small" onClick={() => exec(ops.adjustHeights(cells, { floor: 1 }))}>Floor +</button>
              <button className="btn small" onClick={() => exec(ops.adjustHeights(cells, { ceiling: -1 }))}>Ceil −</button>
              <button className="btn small" onClick={() => exec(ops.adjustHeights(cells, { ceiling: 1 }))}>Ceil +</button>
            </span>
          </Row>
          <h3>Paint all</h3>
          {(["down", "up", "walls"] as const).map((t) => (
            <Row key={t} label={t === "down" ? "Floors" : t === "up" ? "Ceilings" : "Walls"}>
              <Select value="" empty="choose…" options={mats} onChange={(v) => v && apply("Paint material", [ops.setSurface(cells, t, v)])} />
            </Row>
          ))}
          <Row label="Reset">
            <button className="btn small" onClick={() => exec(ops.setSurface(cells, "all", null))}>All surfaces to default</button>
          </Row>
          <Row label="Open inside" hint="Replace walls between the selected cells with openings">
            <button className="btn small" onClick={() => exec(ops.paintCells(cells))}>Join into one room</button>
          </Row>
        </>
      )}
      <p className="muted small">Selected: {sel.cells.slice(0, 6).join("  ")}{sel.cells.length > 6 ? " …" : ""}</p>
    </Section>
  );
}
