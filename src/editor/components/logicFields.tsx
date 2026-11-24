/** Form fields for logic data: positions, targets, typed params, event references. */
import { useId } from "react";
import { FACINGS, type GridPos, type ParamDefSchema, type ParamValue, type Target } from "../../core";
import * as ops from "../../core/ops";
import { useEditor, type PickKind } from "../store";
import { NumberField, Select, TextField } from "./fields";
import type { z } from "zod";

type ParamDef = z.infer<typeof ParamDefSchema>;
const DIRS = ["north", "east", "south", "west", "up", "down"] as const;

type PickResult = { kind: "cell"; pos: GridPos } | { kind: "edge"; key: string } | { kind: "prop"; id: string };

/** Ask the user to click something on the map. */
export function requestPick(kinds: PickKind[], prompt: string, owner?: string): Promise<PickResult | null> {
  return new Promise((resolve) => {
    // A new request replaces any pending one (which then resolves null below).
    useEditor.getState().set({ pick: { kinds, prompt, resolve, ...(owner && { owner }) } });
    // Cancelling (Esc, right-click, another request) clears or replaces `pick`: resolve null.
    // After a successful pick, resolve() has already run, so this null is ignored.
    const unsub = useEditor.subscribe((st) => {
      if (!st.pick || st.pick.resolve !== resolve) { unsub(); resolve(null); }
    });
  });
}

export function PickButton({ kinds, prompt, onPick, title }: { kinds: PickKind[]; prompt: string; onPick: (r: PickResult) => void; title?: string }) {
  const owner = useId();
  const active = useEditor((s) => s.pick?.owner === owner);
  return (
    <button
      type="button"
      className={`btn small pick${active ? " active" : ""}`}
      title={title ?? "Pick on the map"}
      aria-label={title ?? "Pick on the map"}
      aria-pressed={active}
      onClick={async () => {
        if (active) { useEditor.getState().set({ pick: null }); return; }
        const r = await requestPick(kinds, prompt, owner);
        if (r) onPick(r);
      }}
    >
      ⌖
    </button>
  );
}

export function PosField({ value, onChange }: { value: GridPos; onChange: (p: GridPos) => void }) {
  return (
    <span className="pos-field">
      <NumberField value={value.x} onCommit={(x) => onChange({ ...value, x })} />
      <NumberField value={value.y} onCommit={(y) => onChange({ ...value, y })} />
      <NumberField value={value.z} onCommit={(z) => onChange({ ...value, z })} />
      <PickButton kinds={["cell"]} prompt="Click a cell." onPick={(r) => r.kind === "cell" && onChange(r.pos)} />
    </span>
  );
}

/** Make sure an edge has an id (naming it if needed) and return that id. */
export function nameEdge(key: string): string | null {
  const s = useEditor.getState();
  const e = s.doc.edges[key];
  if (!e) return null;
  if (e.id) return e.id;
  const { command, id } = ops.ensureEdgeId(s.doc, key);
  s.exec(command);
  return id;
}

export type TargetKind = Target["kind"];
const TARGET_LABEL: Record<TargetKind, string> = {
  edge: "Connection (by id)",
  edgeAt: "Connection (at position)",
  prop: "Prop",
  cell: "Cell",
  player: "Player",
};

export function defaultTarget(kind: TargetKind): Target {
  const s = useEditor.getState();
  switch (kind) {
    case "edge": return { kind, id: Object.values(s.doc.edges).find((e) => e.id)?.id ?? "" };
    case "prop": return { kind, id: Object.keys(s.doc.props)[0] ?? "" };
    case "cell": return { kind, pos: s.doc.start?.cell ?? { x: 0, y: 0, z: s.level } };
    case "edgeAt": return { kind, cell: s.doc.start?.cell ?? { x: 0, y: 0, z: s.level }, dir: "east" };
    case "player": return { kind };
  }
}

export function TargetField({ value, kinds, onChange }: { value: Target; kinds: TargetKind[]; onChange: (t: Target) => void }) {
  const doc = useEditor((s) => s.doc);
  const edgeIds = Object.values(doc.edges).flatMap((e) => (e.id ? [e.id] : []));
  return (
    <span className="target-field">
      {kinds.length > 1 && (
        <Select<TargetKind> value={value.kind} options={kinds.map((k) => ({ value: k, label: TARGET_LABEL[k] }))} onChange={(k) => k && onChange(defaultTarget(k))} />
      )}
      {value.kind === "edge" && (
        <>
          <Select value={value.id} empty="choose…" options={edgeIds.map((id) => ({ value: id, label: id }))} onChange={(id) => onChange({ kind: "edge", id })} />
          <PickButton kinds={["edge"]} prompt="Click a connection (cell edge)." onPick={(r) => { if (r.kind === "edge") { const id = nameEdge(r.key); if (id) onChange({ kind: "edge", id }); } }} />
        </>
      )}
      {value.kind === "prop" && (
        <>
          <Select value={value.id} empty="choose…" options={Object.keys(doc.props).sort().map((id) => ({ value: id, label: id }))} onChange={(id) => onChange({ kind: "prop", id })} />
          <PickButton kinds={["prop"]} prompt="Click a prop." onPick={(r) => r.kind === "prop" && onChange({ kind: "prop", id: r.id })} />
        </>
      )}
      {value.kind === "cell" && <PosField value={value.pos} onChange={(pos) => onChange({ kind: "cell", pos })} />}
      {value.kind === "edgeAt" && (
        <>
          <PosField value={value.cell} onChange={(cell) => onChange({ ...value, cell })} />
          <Select value={value.dir} options={DIRS.map((d) => ({ value: d, label: d }))} onChange={(dir) => dir && onChange({ ...value, dir })} />
        </>
      )}
    </span>
  );
}

/** The state names of whatever a target points at, if known. */
export function useTargetStates(t: Target | undefined): string[] {
  const doc = useEditor((s) => s.doc);
  const resolved = useEditor((s) => s.resolved);
  if (!t) return [];
  if (t.kind === "edge" || t.kind === "edgeAt") {
    let e;
    try { e = t.kind === "edge" ? resolved.edgeById(t.id) : resolved.edgeAt(t.cell, t.dir, t.toZ); } catch { /* invalid */ }
    return e ? Object.keys(doc.connectionTypes[e.type]?.states ?? {}) : [];
  }
  if (t.kind === "prop") {
    const p = doc.props[t.id];
    return p ? doc.propTypes[p.type]?.states ?? [] : [];
  }
  return [];
}

export function StateField({ value, states, onChange }: { value: string; states: string[]; onChange: (s: string) => void }) {
  if (!states.length) return <TextField value={value} placeholder="state" onCommit={onChange} />;
  return <Select value={value} options={states.map((s) => ({ value: s, label: s }))} onChange={(v) => v && onChange(v)} />;
}

export function FlagValueField({ flag, value, onChange }: { flag: string; value: boolean | number | string; onChange: (v: boolean | number | string) => void }) {
  const def = useEditor((s) => s.doc.flags[flag]);
  const type = def?.type ?? (typeof value === "boolean" ? "bool" : typeof value === "number" ? "int" : "string");
  if (type === "bool") return <Select value={String(value === true)} options={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} onChange={(v) => onChange(v === "true")} />;
  if (type === "int") return <NumberField value={typeof value === "number" ? value : 0} onCommit={onChange} />;
  return <TextField value={String(value)} onCommit={onChange} />;
}

// ---------- typed params ----------

function refOptions(type: ParamDef["type"]): { value: string; label: string }[] {
  const doc = useEditor.getState().doc;
  switch (type) {
    case "ref:edge": return Object.values(doc.edges).flatMap((e) => (e.id ? [{ value: e.id, label: e.id }] : []));
    case "ref:prop": return Object.keys(doc.props).sort().map((id) => ({ value: id, label: id }));
    case "ref:event": return Object.keys(doc.events).sort().map((id) => ({ value: id, label: id }));
    case "ref:flag": return Object.keys(doc.flags).sort().map((id) => ({ value: id, label: id }));
    case "ref:material": return Object.entries(doc.materials).map(([id, m]) => ({ value: id, label: `${m.name} (${id})` }));
    default: return [];
  }
}

export function ParamInput({ def, value, onChange }: { def: ParamDef; value: ParamValue | undefined; onChange: (v: ParamValue | undefined) => void }) {
  useEditor((s) => s.doc); // re-render when ids change
  const v = value ?? def.default ?? undefined;
  switch (def.type) {
    case "string": return <TextField value={typeof v === "string" ? v : ""} onCommit={(t) => onChange(t)} />;
    case "int": case "float":
      return <NumberField value={typeof v === "number" ? v : ""} step={def.type === "int" ? 1 : 0.1} placeholder={def.default !== undefined ? String(def.default) : ""} onCommit={(n) => onChange(def.type === "int" ? Math.round(n) : n)} />;
    case "bool": return <input type="checkbox" checked={v === true} onChange={(e) => onChange(e.target.checked)} />;
    case "enum": return <Select value={typeof v === "string" ? v : ""} empty="(unset)" options={(def.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(x) => onChange(x || undefined)} />;
    case "direction": return <Select value={typeof v === "string" ? v : ""} empty="(unset)" options={DIRS.map((d) => ({ value: d, label: d }))} onChange={(x) => onChange(x || undefined)} />;
    case "color": return <input type="color" value={typeof v === "string" ? v : "#808080"} onChange={(e) => onChange(e.target.value)} />;
    case "gridPos": return <PosField value={v && typeof v === "object" ? v : { x: 0, y: 0, z: 0 }} onChange={onChange} />;
    default:
      return (
        <>
          <Select value={typeof v === "string" ? v : ""} empty="(unset)" options={refOptions(def.type)} onChange={(x) => onChange(x || undefined)} />
          {def.type === "ref:edge" && <PickButton kinds={["edge"]} prompt={`Click a connection for "${def.name}".`} onPick={(r) => { if (r.kind === "edge") { const id = nameEdge(r.key); if (id) onChange(id); } }} />}
          {def.type === "ref:prop" && <PickButton kinds={["prop"]} prompt={`Click a prop for "${def.name}".`} onPick={(r) => r.kind === "prop" && onChange(r.id)} />}
        </>
      );
  }
}

/** A form for a set of typed parameters. Unknown keys are shown so they can be removed. */
export function ParamForm({ defs, values, onChange }: { defs: ParamDef[] | undefined; values: Record<string, ParamValue> | undefined; onChange: (v: Record<string, ParamValue> | undefined) => void }) {
  const vals = values ?? {};
  const set = (name: string, v: ParamValue | undefined) => {
    const next = { ...vals };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const unknown = Object.keys(vals).filter((k) => !(defs ?? []).some((d) => d.name === k));
  if (!defs?.length && !unknown.length) return null;
  return (
    <div className="param-form">
      {(defs ?? []).map((d) => (
        <label key={d.name} className="row" title={d.description}>
          <span className="row-label">{d.name}{d.required ? " *" : ""}</span>
          <span className="row-field"><ParamInput def={d} value={vals[d.name]} onChange={(v) => set(d.name, v)} /></span>
        </label>
      ))}
      {unknown.map((k) => (
        <div key={k} className="row">
          <span className="row-label warn-text">{k} ?</span>
          <span className="row-field"><span className="mono small">{JSON.stringify(vals[k])}</span><button className="btn small" onClick={() => set(k, undefined)}>Remove</button></span>
        </div>
      ))}
    </div>
  );
}

/** Pick a named event, or create one on the spot. */
export function EventRefField({ value, onChange, suggest }: { value: string | undefined | object; onChange: (id: string | undefined) => void; suggest: string }) {
  const events = useEditor((s) => s.doc.events);
  if (value !== undefined && typeof value !== "string") {
    return <span className="muted small">inline event (edit in the file) <button className="btn small" onClick={() => onChange(undefined)}>Clear</button></span>;
  }
  const open = (id: string) => useEditor.getState().set({ dockTab: "events", editingEvent: id });
  return (
    <span className="event-ref">
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__new") {
            const s = useEditor.getState();
            let id = suggest.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[^A-Za-z_]/, "_");
            for (let i = 2; s.doc.events[id]; i++) id = `${suggest}_${i}`;
            s.exec(ops.define("event", id, { actions: [] }));
            onChange(id);
            open(id);
          } else onChange(v || undefined);
        }}
      >
        <option value="">(none)</option>
        {value && !events[value] && <option value={value}>{value} (missing)</option>}
        {Object.keys(events).sort().map((id) => <option key={id} value={id}>{id}</option>)}
        <option value="__new">+ New event…</option>
      </select>
      {value && events[value] && <button className="btn small" title="Edit this event" onClick={() => open(value)}>Edit</button>}
    </span>
  );
}

export const cellLabel = (p: GridPos) => `(${p.x}, ${p.y}, ${p.z})`;
export const FACING_OPTIONS = FACINGS.map((f) => ({ value: f, label: f }));
