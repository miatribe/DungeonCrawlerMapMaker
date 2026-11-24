/** Flags tab: map-level variables with their type and starting value. */
import { useState } from "react";
import { type FlagDef } from "../../core";
import * as ops from "../../core/ops";
import { useEditor } from "../store";
import { NumberField, Select, TextField } from "./fields";

const ID_RE = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

export function FlagsPanel() {
  const flags = useEditor((s) => s.doc.flags);
  const links = useEditor((s) => s.links);
  const exec = useEditor((s) => s.exec);
  const notify = useEditor((s) => s.notify);
  const doc = useEditor((s) => s.doc);
  const [name, setName] = useState("");

  const add = () => {
    const n = name.trim();
    if (!ID_RE.test(n)) { notify("Flag names start with a letter or _ and use letters, digits, _ . -", "error"); return; }
    if (flags[n]) { notify(`Flag "${n}" already exists`, "error"); return; }
    exec(ops.define("flag", n, { type: "bool", initial: false }));
    setName("");
  };
  const uses = (n: string) => links.filter((l) => l.target.kind === "flag" && l.target.name === n);

  return (
    <div className="flags">
      <div className="split-tools">
        <input placeholder="new flag name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New flag name" />
        <button className="btn small" onClick={add} disabled={!name.trim()}>+ Add flag</button>
        <span className="muted small">Flags are map variables events can set and check (keys found, puzzle steps, counters).</span>
      </div>
      <table className="grid-table">
        <thead><tr><th>Name</th><th>Type</th><th>Starts as</th><th>Used by</th><th /></tr></thead>
        <tbody>
          {Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)).map(([n, f]) => {
            const u = uses(n);
            const setDef = (d: FlagDef) => exec(ops.define("flag", n, d));
            return (
              <tr key={n}>
                <td><TextField mono value={n} onCommit={(nn) => { if (nn === n) return; try { if (!ID_RE.test(nn)) throw new Error("Invalid flag name"); exec(ops.renameId(doc, "flag", n, nn)); } catch (e) { notify((e as Error).message, "error"); } }} /></td>
                <td>
                  <Select value={f.type} options={[{ value: "bool", label: "true/false" }, { value: "int", label: "number" }, { value: "string", label: "text" }]}
                    onChange={(t) => t && t !== f.type && setDef(t === "bool" ? { type: "bool", initial: false } : t === "int" ? { type: "int", initial: 0 } : { type: "string", initial: "" })} />
                </td>
                <td>
                  {f.type === "bool" && <Select value={String(f.initial)} options={[{ value: "false", label: "false" }, { value: "true", label: "true" }]} onChange={(v) => setDef({ type: "bool", initial: v === "true" })} />}
                  {f.type === "int" && <NumberField value={f.initial} onCommit={(v) => setDef({ type: "int", initial: Math.round(v) })} />}
                  {f.type === "string" && <TextField value={f.initial} onCommit={(v) => setDef({ type: "string", initial: v })} />}
                </td>
                <td className="muted small">{u.length ? `${u.filter((l) => l.effect === "write").length} set · ${u.filter((l) => l.effect === "read").length} check` : "unused"}</td>
                <td><button className="btn small danger" onClick={() => { if (!u.length || window.confirm(`Flag "${n}" is used by events. Delete anyway?`)) exec(ops.undefine("flag", n)); }}>Delete</button></td>
              </tr>
            );
          })}
          {!Object.keys(flags).length && <tr><td colSpan={5} className="muted">No flags yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
