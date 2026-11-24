/** "Logic" panel under the Inspector: what this thing's triggers do, and what affects it. */
import { cellKey, linksFrom, linksTo, sameRef, type Link, type LogicRef, type MapDoc } from "../../core";
import { useEditor } from "../store";

const TRIGGER_LABEL: Record<Link["trigger"], string> = {
  onLoad: "On load",
  onEnter: "On enter",
  onExit: "On exit",
  onUse: "On use",
  onBump: "On bump",
};

export function refLabel(doc: MapDoc, r: LogicRef): string {
  switch (r.kind) {
    case "map": return "map";
    case "cell": return `cell (${r.pos.x}, ${r.pos.y}, ${r.pos.z})`;
    case "edge": {
      const e = doc.edges[r.key];
      return e?.id ?? `${e ? doc.connectionTypes[e.type]?.name ?? e.type : "connection"} at ${r.key}`;
    }
    case "prop": return r.id;
    case "flag": return `flag ${r.name}`;
  }
}

/** Select and center the view on a logic ref. */
export function focusRef(r: LogicRef): void {
  const s = useEditor.getState();
  switch (r.kind) {
    case "cell":
      if (s.doc.cells[cellKey(r.pos)]) s.select({ cells: [cellKey(r.pos)] });
      s.focusCell(r.pos.x, r.pos.y, r.pos.z);
      break;
    case "edge": {
      const e = s.doc.edges[r.key];
      if (!e) return;
      s.select({ edges: [r.key] });
      s.focusCell(e.from.x, e.from.y, e.from.z);
      break;
    }
    case "prop": {
      const p = s.doc.props[r.id];
      if (!p) return;
      s.select({ props: [r.id] });
      s.focusCell(p.cell.x, p.cell.y, p.cell.z);
      break;
    }
    case "flag":
      s.set({ dockTab: "flags" });
      break;
  }
}

function RefLink({ r }: { r: LogicRef }) {
  const doc = useEditor((s) => s.doc);
  if (r.kind === "map") return <span>map</span>;
  return <button className="link" onClick={() => focusRef(r)}>{refLabel(doc, r)}</button>;
}

function EventLink({ id }: { id: string }) {
  return <button className="link mono" onClick={() => useEditor.getState().set({ dockTab: "events", editingEvent: id })}>{id}</button>;
}

export function LogicSection({ target }: { target: LogicRef }) {
  const links = useEditor((s) => s.links);
  const out = linksFrom(links, target);
  const inc = linksTo(links, target).filter((l) => !sameRef(l.source, target));
  if (!out.length && !inc.length) return null;

  // Group outgoing links by trigger + top-level event.
  const groups = new Map<string, Link[]>();
  for (const l of out) {
    const k = `${l.trigger}|${l.via[0] ?? "(inline)"}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }

  return (
    <section className="panel">
      <header className="panel-head"><h2>Logic</h2><span className="muted small">arrows on the map</span></header>
      <div className="panel-body logic">
        {[...groups.entries()].map(([k, ls]) => {
          const [trigger, ev] = k.split("|") as [Link["trigger"], string];
          return (
            <div key={k} className="logic-group">
              <div className="logic-head">{TRIGGER_LABEL[trigger]} → {ev === "(inline)" ? <span className="muted">inline event</span> : <EventLink id={ev} />}</div>
              <ul>
                {ls.map((l, i) => (
                  <li key={i} className={l.effect}>
                    <span className="effect">{l.effect === "write" ? "changes" : "checks"}</span> <RefLink r={l.target} />
                    <span className="muted small"> · {l.text}{l.via.length > 1 ? ` (via ${l.via.slice(1).join(" → ")})` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {inc.length > 0 && (
          <div className="logic-group">
            <div className="logic-head">Affected by</div>
            <ul>
              {inc.map((l, i) => (
                <li key={i} className={l.effect}>
                  <RefLink r={l.source} /> <span className="muted small">{TRIGGER_LABEL[l.trigger].toLowerCase()}{l.via[0] ? <> → <EventLink id={l.via[0]} /></> : ""} · {l.effect === "write" ? l.text : `checks: ${l.text.replace(/^if /, "")}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
