/** Types tab: connection, prop and custom types, plus type library import/export. */
import { useState, type ReactNode } from "react";
import {
  BUILTIN_ICONS, CONNECTION_KINDS, exportTypeLibrary, importTypeLibrary, libraryDiff, nextId, PARAM_TYPES, parseTypeLibrary,
  type ConnectionType, type CustomType, type ParamDefSchema, type PropType,
} from "../../core";
import * as ops from "../../core/ops";
import { download, openFile } from "../persistence";
import { useEditor } from "../store";
import { NumberField, Select, TextField } from "./fields";
import type { z } from "zod";

type ParamDef = z.infer<typeof ParamDefSchema>;
type Kind = "connectionType" | "propType" | "customType";
const ID_RE = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

const KIND_LABEL: Record<Kind, string> = { connectionType: "Connections", propType: "Props", customType: "Custom actions & conditions" };

export function TypesPanel() {
  const [kind, setKind] = useState<Kind | "library">("connectionType");
  return (
    <div className="types">
      <div className="subtabs" role="tablist">
        {(["connectionType", "propType", "customType"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
        <button role="tab" aria-selected={kind === "library"} className={kind === "library" ? "active" : ""} onClick={() => setKind("library")}>Type library</button>
      </div>
      {kind === "library" ? <Library /> : <TypeList kind={kind} key={kind} />}
    </div>
  );
}

function table(doc: ReturnType<typeof useEditor.getState>["doc"], kind: Kind): Record<string, ConnectionType | PropType | CustomType> {
  return kind === "connectionType" ? doc.connectionTypes : kind === "propType" ? doc.propTypes : doc.customTypes;
}

function TypeList({ kind }: { kind: Kind }) {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const rec = table(doc, kind);
  const ids = Object.keys(rec).sort();
  const [sel, setSel] = useState<string | null>(ids[0] ?? null);
  const current = sel && rec[sel] ? sel : null;

  const add = () => {
    const id = nextId(kind === "connectionType" ? "connection" : kind === "propType" ? "prop" : "custom", ids);
    if (kind === "connectionType") exec(ops.define("connectionType", id, { name: "New connection", kind: "door", axis: "horizontal", initialState: "closed", states: { closed: { passable: false, blocksSight: true, transitions: ["open"] }, open: { passable: true, blocksSight: false, transitions: ["closed"] } } }));
    else if (kind === "propType") exec(ops.define("propType", id, { name: "New prop", states: ["default"], initialState: "default", preview: { color: "#e0a050", icon: "generic" } }));
    else exec(ops.define("customType", id, { category: "action", name: "New action", params: [] }));
    setSel(id);
  };
  const remove = (id: string) => {
    const n = ops.typeUsage(doc, kind, id);
    if (n && !window.confirm(`"${id}" is used ${n} time(s). Delete it anyway? Those uses will show as problems.`)) return;
    exec(ops.undefine(kind, id));
    setSel(null);
  };
  const rename = (id: string, n: string) => {
    if (n === id) return;
    if (!ID_RE.test(n)) { notify("Ids start with a letter or _ and use letters, digits, _ . -", "error"); return; }
    try { exec(ops.renameId(doc, kind, id, n)); setSel(n); } catch (e) { notify((e as Error).message, "error"); }
  };

  return (
    <div className="split">
      <div className="split-list">
        <div className="split-tools"><button className="btn small" onClick={add}>+ New</button></div>
        <ul className="pick-list">
          {ids.map((id) => (
            <li key={id}>
              <button className={id === current ? "active" : ""} onClick={() => setSel(id)}>
                <span>{rec[id]!.name}</span>
                <span className="muted small mono">{id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="split-main">
        {current ? (
          <div className="type-editor">
            <div className="event-head">
              <label className="inline"><span className="muted small">Id</span><TextField mono value={current} onCommit={(n) => rename(current, n)} /></label>
              <span className="muted small">used {ops.typeUsage(doc, kind, current)}×</span>
              <span className="spacer" />
              <button className="btn small danger" onClick={() => remove(current)}>Delete</button>
            </div>
            {kind === "connectionType" && <ConnectionTypeEditor id={current} />}
            {kind === "propType" && <PropTypeEditor id={current} />}
            {kind === "customType" && <CustomTypeEditor id={current} />}
          </div>
        ) : (
          <p className="muted">Select a type to edit it.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="inline"><span className="muted small">{label}</span>{children}</label>;
}

function ConnectionTypeEditor({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const t = doc.connectionTypes[id]!;
  const save = (n: ConnectionType) => exec(ops.define("connectionType", id, n));
  const states = Object.keys(t.states);
  const [newState, setNewState] = useState("");
  return (
    <>
      <div className="field-row">
        <Field label="Name"><TextField value={t.name} onCommit={(name) => save({ ...t, name })} /></Field>
        <Field label="Kind"><Select value={t.kind} options={CONNECTION_KINDS.map((k) => ({ value: k, label: k }))} onChange={(kind) => kind && save({ ...t, kind })} /></Field>
        <Field label="Goes"><Select value={t.axis} options={[{ value: "horizontal", label: "between cells" }, { value: "vertical", label: "up/down" }, { value: "both", label: "either" }]} onChange={(axis) => axis && save({ ...t, axis })} /></Field>
        <Field label="Material">
          <Select value={t.material ?? ""} empty="(none)" options={Object.entries(doc.materials).map(([k, m]) => ({ value: k, label: m.name }))} onChange={(m) => { const n = { ...t }; if (m) n.material = m; else delete n.material; save(n); }} />
        </Field>
        <Field label="Starts"><Select value={t.initialState} options={states.map((s) => ({ value: s, label: s }))} onChange={(s) => s && save({ ...t, initialState: s })} /></Field>
      </div>
      <h3>States</h3>
      <table className="grid-table">
        <thead><tr><th>State</th><th>Passable</th><th>Blocks sight</th><th>Using it switches to</th><th /></tr></thead>
        <tbody>
          {states.map((s) => {
            const st = t.states[s]!;
            const setSt = (p: Partial<typeof st>) => save({ ...t, states: { ...t.states, [s]: { ...st, ...p } } });
            return (
              <tr key={s}>
                <td><TextField mono value={s} onCommit={(n) => { if (n && n !== s) { if (t.states[n]) notify(`State "${n}" exists`, "error"); else exec(ops.renameState("connectionType", id, s, n)); } }} /></td>
                <td><input type="checkbox" checked={st.passable} onChange={(e) => setSt({ passable: e.target.checked })} aria-label={`${s} passable`} /></td>
                <td><input type="checkbox" checked={st.blocksSight} onChange={(e) => setSt({ blocksSight: e.target.checked })} aria-label={`${s} blocks sight`} /></td>
                <td>
                  {states.filter((o) => o !== s).map((o) => (
                    <label key={o} className="chip"><input type="checkbox" checked={(st.transitions ?? []).includes(o)} onChange={(e) => setSt({ transitions: e.target.checked ? [...(st.transitions ?? []), o] : (st.transitions ?? []).filter((x) => x !== o) })} /> {o}</label>
                  ))}
                  {!(st.transitions ?? []).length && <span className="muted small"> (only events change it)</span>}
                </td>
                <td>
                  <button className="btn small danger" disabled={states.length < 2} onClick={() => {
                    const rest = Object.fromEntries(Object.entries(t.states).filter(([k]) => k !== s));
                    save({ ...t, states: rest, initialState: t.initialState === s ? Object.keys(rest)[0]! : t.initialState });
                  }}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="split-tools">
        <input placeholder="new state" value={newState} onChange={(e) => setNewState(e.target.value)} aria-label="New state name" />
        <button className="btn small" disabled={!newState.trim() || !!t.states[newState.trim()]} onClick={() => { save({ ...t, states: { ...t.states, [newState.trim()]: { passable: false, blocksSight: true, transitions: [] } } }); setNewState(""); }}>+ Add state</button>
      </div>
      <h3>Extra fields per connection</h3>
      <ParamDefsEditor defs={t.params ?? []} onChange={(params) => { const n = { ...t }; if (params.length) n.params = params; else delete n.params; save(n); }} />
    </>
  );
}

function PropTypeEditor({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const t = doc.propTypes[id]!;
  const save = (n: PropType) => exec(ops.define("propType", id, n));
  const [newState, setNewState] = useState("");
  return (
    <>
      <div className="field-row">
        <Field label="Name"><TextField value={t.name} onCommit={(name) => save({ ...t, name })} /></Field>
        <Field label="Starts"><Select value={t.initialState} options={t.states.map((s) => ({ value: s, label: s }))} onChange={(s) => s && save({ ...t, initialState: s })} /></Field>
        <Field label="Map color"><input type="color" value={t.preview?.color ?? "#e0a050"} onChange={(e) => save({ ...t, preview: { ...t.preview, color: e.target.value } })} /></Field>
        <Field label="Icon"><Select value={t.preview?.icon ?? "generic"} options={BUILTIN_ICONS.map((i) => ({ value: i, label: i }))} onChange={(icon) => icon && save({ ...t, preview: { color: t.preview?.color ?? "#e0a050", icon } })} /></Field>
      </div>
      <h3>States</h3>
      <div className="chips">
        {t.states.map((s) => (
          <span key={s} className="chip">
            <TextField mono value={s} onCommit={(n) => { if (n && n !== s && !t.states.includes(n)) exec(ops.renameState("propType", id, s, n)); }} />
            <button className="btn small danger" disabled={t.states.length < 2} onClick={() => {
              const states = t.states.filter((x) => x !== s);
              save({ ...t, states, initialState: t.initialState === s ? states[0]! : t.initialState });
            }} aria-label={`Remove state ${s}`}>✕</button>
          </span>
        ))}
        <input placeholder="new state" value={newState} onChange={(e) => setNewState(e.target.value)} aria-label="New state name" />
        <button className="btn small" disabled={!newState.trim() || t.states.includes(newState.trim())} onClick={() => { save({ ...t, states: [...t.states, newState.trim()] }); setNewState(""); }}>+ Add</button>
      </div>
      <h3>Extra fields per prop</h3>
      <ParamDefsEditor defs={t.params ?? []} onChange={(params) => { const n = { ...t }; if (params.length) n.params = params; else delete n.params; save(n); }} />
    </>
  );
}

function CustomTypeEditor({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const t = doc.customTypes[id]!;
  const save = (n: CustomType) => exec(ops.define("customType", id, n));
  return (
    <>
      <p className="muted small">Custom types are actions or conditions your engine implements. Events can use them with typed parameters; the export passes them through as-is.</p>
      <div className="field-row">
        <Field label="Name"><TextField value={t.name} onCommit={(name) => save({ ...t, name })} /></Field>
        <Field label="Is a"><Select value={t.category} options={[{ value: "action", label: "action" }, { value: "condition", label: "condition" }]} onChange={(c) => c && save({ ...t, category: c })} /></Field>
        <Field label="Description"><TextField value={t.description ?? ""} onCommit={(d) => { const n = { ...t }; if (d) n.description = d; else delete n.description; save(n); }} /></Field>
      </div>
      <h3>Parameters</h3>
      <ParamDefsEditor defs={t.params} onChange={(params) => save({ ...t, params })} />
    </>
  );
}

function ParamDefsEditor({ defs, onChange }: { defs: ParamDef[]; onChange: (d: ParamDef[]) => void }) {
  const set = (i: number, p: Partial<ParamDef>) => onChange(defs.map((d, j) => {
    if (j !== i) return d;
    const n = { ...d, ...p } as ParamDef & Record<string, unknown>;
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
    return n;
  }));
  return (
    <>
      <table className="grid-table">
        <thead><tr><th>Name</th><th>Type</th><th>Options (enum)</th><th>Default</th><th>Required</th><th /></tr></thead>
        <tbody>
          {defs.map((d, i) => (
            <tr key={i}>
              <td><TextField mono value={d.name} onCommit={(name) => ID_RE.test(name) && set(i, { name })} /></td>
              <td><Select value={d.type} options={PARAM_TYPES.map((t) => ({ value: t, label: t }))} onChange={(type) => type && set(i, { type, default: undefined, options: type === "enum" ? d.options ?? [] : undefined })} /></td>
              <td>{d.type === "enum" ? <TextField value={(d.options ?? []).join(", ")} placeholder="a, b, c" onCommit={(o) => set(i, { options: o.split(",").map((x) => x.trim()).filter(Boolean) })} /> : <span className="muted">—</span>}</td>
              <td>
                {d.type === "bool" ? <input type="checkbox" checked={d.default === true} onChange={(e) => set(i, { default: e.target.checked })} />
                  : d.type === "int" || d.type === "float" ? <NumberField value={typeof d.default === "number" ? d.default : ""} placeholder="(none)" onCommit={(n) => set(i, { default: n })} />
                  : d.type === "gridPos" ? <span className="muted">—</span>
                  : <TextField value={typeof d.default === "string" ? d.default : ""} placeholder="(none)" onCommit={(v) => set(i, { default: v || undefined })} />}
              </td>
              <td><input type="checkbox" checked={!!d.required} onChange={(e) => set(i, { required: e.target.checked || undefined })} /></td>
              <td><button className="btn small danger" onClick={() => onChange(defs.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
          {!defs.length && <tr><td colSpan={6} className="muted">No parameters.</td></tr>}
        </tbody>
      </table>
      <button className="btn small" onClick={() => {
        let n = 1; while (defs.some((d) => d.name === `param${n}`)) n++;
        onChange([...defs, { name: `param${n}`, type: "string" }]);
      }}>+ Add parameter</button>
    </>
  );
}

function Library() {
  const doc = useEditor((s) => s.doc);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const exportAll = () => {
    const lib = exportTypeLibrary(doc);
    download(`${doc.id}.dcmm-types.json`, JSON.stringify(lib, null, 2) + "\n", "application/json");
    notify(`Exported ${Object.keys(lib.connectionTypes).length + Object.keys(lib.propTypes).length + Object.keys(lib.customTypes).length} types`);
  };
  const importLib = async () => {
    const f = await openFile();
    if (!f) return;
    const r = parseTypeLibrary(f.text);
    if (!r.ok) { notify(`Not a type library: ${r.message}`, "error"); return; }
    const d = libraryDiff(doc, r.library);
    const added = d.connectionTypes.added.length + d.propTypes.added.length + d.customTypes.added.length;
    const replaced = [...d.connectionTypes.replaced, ...d.propTypes.replaced, ...d.customTypes.replaced];
    if (!added && !replaced.length) { notify("Nothing new in that library."); return; }
    if (replaced.length && !window.confirm(`Import ${added} new type(s) and replace ${replaced.length} existing: ${replaced.join(", ")}?`)) return;
    exec(importTypeLibrary(r.library));
    notify(`Imported ${added} new and ${replaced.length} updated type(s)`);
  };
  return (
    <div className="library">
      <p>A type library is a <span className="mono">.dcmm-types.json</span> file holding connection, prop and custom types, so a team can share their engine's vocabulary across maps.</p>
      <div className="btn-group">
        <button className="btn" onClick={exportAll}>Export this map's types…</button>
        <button className="btn" onClick={() => void importLib()}>Import a library…</button>
      </div>
      <p className="muted small">Importing adds new types and replaces types with the same id. It's one undo step.</p>
      <p className="muted small">This map has {Object.keys(doc.connectionTypes).length} connection, {Object.keys(doc.propTypes).length} prop and {Object.keys(doc.customTypes).length} custom types.</p>
    </div>
  );
}
