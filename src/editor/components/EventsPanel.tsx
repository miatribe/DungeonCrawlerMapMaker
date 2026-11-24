/** Events tab: list of named events and a structured editor for conditions and actions. */
import { useState } from "react";
import {
  describeAction, describeCondition, eventUsages, FACINGS, nextId, SIDES,
  type Action, type Condition, type MapEvent,
} from "../../core";
import * as ops from "../../core/ops";
import { useEditor } from "../store";
import { NumberField, Select, TextField } from "./fields";
import {
  defaultTarget, FlagValueField, ParamForm, PosField, StateField, TargetField, useTargetStates,
} from "./logicFields";

const ID_RE = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

export function EventsPanel() {
  const events = useEditor((s) => s.doc.events);
  const editing = useEditor((s) => s.editingEvent);
  const set = useEditor((s) => s.set);
  const exec = useEditor((s) => s.exec);
  const [q, setQ] = useState("");
  const ids = Object.keys(events).sort().filter((id) => id.toLowerCase().includes(q.toLowerCase()));
  const current = editing && events[editing] ? editing : null;

  const add = () => {
    const id = nextId("event", Object.keys(events));
    exec(ops.define("event", id, { actions: [] }));
    set({ editingEvent: id });
  };

  return (
    <div className="split">
      <div className="split-list">
        <div className="split-tools">
          <input placeholder="Search events" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search events" />
          <button className="btn small" onClick={add}>+ New</button>
        </div>
        <ul className="pick-list">
          {ids.map((id) => (
            <li key={id}>
              <button className={id === current ? "active" : ""} onClick={() => set({ editingEvent: id })}>
                <span className="mono">{id}</span>
                <span className="muted small">{events[id]!.actions.length} action{events[id]!.actions.length === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
          {!ids.length && <li className="muted small pad">{q ? "No match." : "No events yet. Create one here, or pick “+ New event…” in a trigger field in the Inspector."}</li>}
        </ul>
      </div>
      <div className="split-main">{current ? <EventEditor id={current} /> : <p className="muted">Select an event to edit it.</p>}</div>
    </div>
  );
}

function EventEditor({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const set = useEditor((s) => s.set);
  const ev = doc.events[id]!;
  const usages = eventUsages(doc, id);
  const save = (next: MapEvent) => exec(ops.define("event", id, next));
  const patch = (p: Partial<MapEvent>) => {
    const next = { ...ev, ...p } as MapEvent & Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    save(next);
  };

  const rename = (n: string) => {
    if (n === id) return;
    if (!ID_RE.test(n)) { notify("Ids start with a letter or _ and use letters, digits, _ . -", "error"); return; }
    try {
      exec(ops.renameId(doc, "event", id, n));
      set({ editingEvent: n });
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  const remove = () => {
    if (usages.length && !window.confirm(`"${id}" is used by ${usages.length} trigger(s)/event(s). Delete it anyway? Those references will show as problems.`)) return;
    exec(ops.undefine("event", id));
    set({ editingEvent: null });
  };

  return (
    <div className="event-editor">
      <div className="event-head">
        <label className="inline"><span className="muted small">Id</span><TextField mono value={id} onCommit={rename} /></label>
        <label className="inline check"><input type="checkbox" checked={!!ev.once} onChange={(e) => patch({ once: e.target.checked || undefined })} /> Only once</label>
        <span className="spacer" />
        <button className="btn small danger" onClick={remove}>Delete</button>
      </div>
      <p className="muted small">
        {usages.length ? <>Used by: {usages.join(" · ")}</> : "Not used by any trigger yet. Set it as a cell's On enter, or a connection's or prop's On use, in the Inspector."}
      </p>
      <label className="inline wide"><span className="muted small">Notes</span><TextField value={ev.notes ?? ""} placeholder="(for designers; exported)" onCommit={(notes) => patch({ notes: notes || undefined })} /></label>

      <h3>When all of these are true</h3>
      <ConditionList list={ev.conditions ?? []} onChange={(c) => patch({ conditions: c.length ? c : undefined })} emptyText="No conditions: the actions always run." />

      <h3>Do</h3>
      <ActionList list={ev.actions} onChange={(actions) => patch({ actions })} />

      <h3>Otherwise</h3>
      <ActionList list={ev.else ?? []} onChange={(a) => patch({ else: a.length ? a : undefined })} emptyText={ev.conditions?.length ? "Nothing happens when the conditions fail." : "Only runs when conditions fail."} />
    </div>
  );
}

// ---------- lists ----------

function moveItem<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function RowControls({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (d: number) => void; onRemove: () => void }) {
  return (
    <span className="row-controls">
      <button className="btn small" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up" title="Move up">↑</button>
      <button className="btn small" disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Move down" title="Move down">↓</button>
      <button className="btn small danger" onClick={onRemove} aria-label="Remove" title="Remove">✕</button>
    </span>
  );
}

const ACTION_TYPES: { value: Action["type"]; label: string }[] = [
  { value: "setConnectionState", label: "Set connection state" },
  { value: "toggleConnectionState", label: "Toggle connection" },
  { value: "setPropState", label: "Set prop state" },
  { value: "setFlag", label: "Set flag" },
  { value: "addFlag", label: "Add to flag" },
  { value: "showMessage", label: "Show message" },
  { value: "teleport", label: "Teleport player" },
  { value: "runEvent", label: "Run event" },
  { value: "setSurface", label: "Change surface material" },
  { value: "custom", label: "Custom action" },
];

const CONDITION_TYPES: { value: Condition["type"]; label: string }[] = [
  { value: "state", label: "Thing is in state" },
  { value: "flag", label: "Flag compares" },
  { value: "playerAt", label: "Player is at" },
  { value: "playerFacing", label: "Player faces" },
  { value: "eventFired", label: "Event has fired" },
  { value: "any", label: "Any of…" },
  { value: "not", label: "None of…" },
  { value: "custom", label: "Custom condition" },
];

function defaultAction(type: Action["type"]): Action {
  const s = useEditor.getState();
  const doc = s.doc;
  const flag = Object.keys(doc.flags)[0] ?? "";
  const here = doc.start?.cell ?? { x: 0, y: 0, z: s.level };
  switch (type) {
    case "setConnectionState": return { type, target: defaultTarget("edge"), state: "open" };
    case "toggleConnectionState": return { type, target: defaultTarget("edge"), states: ["closed", "open"] };
    case "setPropState": return { type, target: defaultTarget("prop"), state: "on" };
    case "setFlag": return { type, name: flag, value: doc.flags[flag]?.type === "int" ? 0 : doc.flags[flag]?.type === "string" ? "" : true };
    case "addFlag": return { type, name: Object.entries(doc.flags).find(([, f]) => f.type === "int")?.[0] ?? flag, amount: 1 };
    case "showMessage": return { type, text: "" };
    case "teleport": return { type, to: here };
    case "runEvent": return { type, event: Object.keys(doc.events)[0] ?? "" };
    case "setSurface": return { type, cell: here, side: "north", material: doc.defaults.wall };
    case "custom": return { type, custom: Object.entries(doc.customTypes).find(([, c]) => c.category === "action")?.[0] ?? "" };
  }
}

function defaultCondition(type: Condition["type"]): Condition {
  const doc = useEditor.getState().doc;
  const flag = Object.keys(doc.flags)[0] ?? "";
  switch (type) {
    case "state": return { type, target: defaultTarget("edge"), equals: "closed" };
    case "flag": return { type, name: flag, op: "==", value: doc.flags[flag]?.type === "int" ? 0 : doc.flags[flag]?.type === "string" ? "" : true };
    case "playerAt": return { type, pos: doc.start?.cell ?? { x: 0, y: 0, z: 0 } };
    case "playerFacing": return { type, facing: "north" };
    case "eventFired": return { type, event: Object.keys(doc.events)[0] ?? "" };
    case "any": case "not": return { type, conditions: [] };
    case "custom": return { type, custom: Object.entries(doc.customTypes).find(([, c]) => c.category === "condition")?.[0] ?? "" };
  }
}

function AddSelect<T extends string>({ label, options, onAdd }: { label: string; options: { value: T; label: string }[]; onAdd: (t: T) => void }) {
  return (
    <select className="add-select" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as T); }} aria-label={label}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ActionList({ list, onChange, emptyText }: { list: Action[]; onChange: (l: Action[]) => void; emptyText?: string }) {
  const doc = useEditor((s) => s.doc);
  return (
    <div className="logic-list">
      {list.length === 0 && emptyText && <p className="muted small">{emptyText}</p>}
      {list.map((a, i) => (
        <div key={i} className="logic-row" title={describeAction(doc, a)}>
          <Select value={a.type} options={ACTION_TYPES} onChange={(t) => t && t !== a.type && onChange(list.map((x, j) => (j === i ? defaultAction(t) : x)))} />
          <span className="logic-fields"><ActionFields a={a} onChange={(n) => onChange(list.map((x, j) => (j === i ? n : x)))} /></span>
          <RowControls i={i} n={list.length} onMove={(d) => onChange(moveItem(list, i, d))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddSelect label="+ Add action…" options={ACTION_TYPES} onAdd={(t) => onChange([...list, defaultAction(t)])} />
    </div>
  );
}

function ConditionList({ list, onChange, emptyText }: { list: Condition[]; onChange: (l: Condition[]) => void; emptyText?: string }) {
  const doc = useEditor((s) => s.doc);
  return (
    <div className="logic-list">
      {list.length === 0 && emptyText && <p className="muted small">{emptyText}</p>}
      {list.map((c, i) => (
        <div key={i} className="logic-row" title={describeCondition(doc, c)}>
          <Select value={c.type} options={CONDITION_TYPES} onChange={(t) => t && t !== c.type && onChange(list.map((x, j) => (j === i ? defaultCondition(t) : x)))} />
          <span className="logic-fields"><ConditionFields c={c} onChange={(n) => onChange(list.map((x, j) => (j === i ? n : x)))} /></span>
          <RowControls i={i} n={list.length} onMove={(d) => onChange(moveItem(list, i, d))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddSelect label="+ Add condition…" options={CONDITION_TYPES} onAdd={(t) => onChange([...list, defaultCondition(t)])} />
    </div>
  );
}

// ---------- fields per type ----------

function FlagSelect({ value, onChange, onlyInt }: { value: string; onChange: (v: string) => void; onlyInt?: boolean }) {
  const flags = useEditor((s) => s.doc.flags);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const ids = Object.keys(flags).filter((k) => !onlyInt || flags[k]!.type === "int").sort();
  return (
    <select
      value={value}
      aria-label="Flag"
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "__new") { onChange(v); return; }
        const name = window.prompt("New flag name:");
        if (!name) return;
        if (!ID_RE.test(name) || flags[name]) { notify(flags[name] ? `Flag "${name}" already exists` : "Flag names start with a letter or _", "error"); return; }
        exec(ops.define("flag", name, onlyInt ? { type: "int", initial: 0 } : { type: "bool", initial: false }));
        onChange(name);
      }}
    >
      {!value && <option value="">choose flag…</option>}
      {value && !flags[value] && <option value={value}>{value} (missing)</option>}
      {ids.map((k) => <option key={k} value={k}>{k}</option>)}
      <option value="__new">+ New flag…</option>
    </select>
  );
}

function EventSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const events = useEditor((s) => s.doc.events);
  return <Select value={value} empty="choose event…" options={Object.keys(events).sort().map((k) => ({ value: k, label: k }))} onChange={(v) => onChange(v)} />;
}

function CustomSelect({ value, category, onChange }: { value: string; category: "action" | "condition"; onChange: (v: string) => void }) {
  const types = useEditor((s) => s.doc.customTypes);
  const set = useEditor((s) => s.set);
  const opts = Object.entries(types).filter(([, t]) => t.category === category).map(([k, t]) => ({ value: k, label: t.name }));
  if (!opts.length && !value) return <span className="muted small">No custom {category}s yet. <button className="link" onClick={() => set({ dockTab: "types" })}>Define one in Types</button></span>;
  return <Select value={value} empty={`choose ${category}…`} options={opts} onChange={(v) => onChange(v)} />;
}

function ActionFields({ a, onChange }: { a: Action; onChange: (a: Action) => void }) {
  const doc = useEditor((s) => s.doc);
  const targetStates = useTargetStates("target" in a ? a.target : undefined);
  switch (a.type) {
    case "setConnectionState":
      return <><TargetField value={a.target} kinds={["edge", "edgeAt"]} onChange={(target) => onChange({ ...a, target })} /> → <StateField value={a.state} states={targetStates} onChange={(state) => onChange({ ...a, state })} /></>;
    case "toggleConnectionState":
      return <><TargetField value={a.target} kinds={["edge", "edgeAt"]} onChange={(target) => onChange({ ...a, target })} /> between <StateField value={a.states[0]} states={targetStates} onChange={(s0) => onChange({ ...a, states: [s0, a.states[1]] })} /> and <StateField value={a.states[1]} states={targetStates} onChange={(s1) => onChange({ ...a, states: [a.states[0], s1] })} /></>;
    case "setPropState":
      return <><TargetField value={a.target} kinds={["prop"]} onChange={(target) => onChange({ ...a, target })} /> → <StateField value={a.state} states={targetStates} onChange={(state) => onChange({ ...a, state })} /></>;
    case "setFlag":
      return <><FlagSelect value={a.name} onChange={(name) => onChange({ ...a, name })} /> = <FlagValueField flag={a.name} value={a.value} onChange={(value) => onChange({ ...a, value })} /></>;
    case "addFlag":
      return <><FlagSelect onlyInt value={a.name} onChange={(name) => onChange({ ...a, name })} /> += <NumberField value={a.amount} onCommit={(amount) => onChange({ ...a, amount: Math.round(amount) })} /></>;
    case "showMessage":
      return <span className="grow"><TextField value={a.text} placeholder="Message text" onCommit={(text) => onChange({ ...a, text })} /></span>;
    case "teleport":
      return <><PosField value={a.to} onChange={(to) => onChange({ ...a, to })} /> facing <Select value={a.facing ?? ""} empty="(keep)" options={FACINGS.map((f) => ({ value: f, label: f }))} onChange={(f) => { const n = { ...a }; if (f) n.facing = f; else delete n.facing; onChange(n); }} /></>;
    case "runEvent":
      return <><EventSelect value={a.event} onChange={(event) => onChange({ ...a, event })} /> after <NumberField value={a.delayMs ?? 0} min={0} step={100} onCommit={(ms) => { const n = { ...a }; if (ms > 0) n.delayMs = Math.round(ms); else delete n.delayMs; onChange(n); }} /> ms</>;
    case "setSurface":
      return (
        <>
          <PosField value={a.cell} onChange={(cell) => onChange({ ...a, cell })} />
          <Select value={a.side} options={SIDES.map((s) => ({ value: s, label: s }))} onChange={(side) => side && onChange({ ...a, side })} />
          → <Select value={a.material} options={Object.entries(doc.materials).map(([k, m]) => ({ value: k, label: m.name }))} onChange={(material) => material && onChange({ ...a, material })} />
        </>
      );
    case "custom":
      return (
        <>
          <CustomSelect category="action" value={a.custom} onChange={(custom) => onChange({ type: "custom", custom })} />
          {a.custom && <ParamForm defs={doc.customTypes[a.custom]?.params} values={a.params} onChange={(params) => { const n = { ...a }; if (params) n.params = params; else delete n.params; onChange(n); }} />}
        </>
      );
  }
}

function ConditionFields({ c, onChange }: { c: Condition; onChange: (c: Condition) => void }) {
  const doc = useEditor((s) => s.doc);
  const targetStates = useTargetStates(c.type === "state" ? c.target : undefined);
  switch (c.type) {
    case "state":
      return <><TargetField value={c.target} kinds={["edge", "edgeAt", "prop"]} onChange={(target) => onChange({ ...c, target })} /> is <StateField value={c.equals} states={targetStates} onChange={(equals) => onChange({ ...c, equals })} /></>;
    case "flag":
      return (
        <>
          <FlagSelect value={c.name} onChange={(name) => onChange({ ...c, name })} />
          <Select value={c.op} options={(["==", "!=", ">", "<", ">=", "<="] as const).map((o) => ({ value: o, label: o }))} onChange={(op) => op && onChange({ ...c, op })} />
          <FlagValueField flag={c.name} value={c.value} onChange={(value) => onChange({ ...c, value })} />
        </>
      );
    case "playerAt":
      return <><PosField value={c.pos} onChange={(pos) => onChange({ ...c, pos })} /> facing <Select value={c.facing ?? ""} empty="(any)" options={FACINGS.map((f) => ({ value: f, label: f }))} onChange={(f) => { const n = { ...c }; if (f) n.facing = f; else delete n.facing; onChange(n); }} /></>;
    case "playerFacing":
      return <Select value={c.facing} options={FACINGS.map((f) => ({ value: f, label: f }))} onChange={(facing) => facing && onChange({ ...c, facing })} />;
    case "eventFired":
      return <EventSelect value={c.event} onChange={(event) => onChange({ ...c, event })} />;
    case "any": case "not":
      return <div className="nested"><ConditionList list={c.conditions} onChange={(conditions) => onChange({ ...c, conditions })} /></div>;
    case "custom":
      return (
        <>
          <CustomSelect category="condition" value={c.custom} onChange={(custom) => onChange({ type: "custom", custom })} />
          {c.custom && <ParamForm defs={doc.customTypes[c.custom]?.params} values={c.params} onChange={(params) => { const n = { ...c }; if (params) n.params = params; else delete n.params; onChange(n); }} />}
        </>
      );
  }
}
