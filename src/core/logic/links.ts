/**
 * Trigger links: what each trigger's event (and the events it runs) reads and changes.
 * Used for the editor's link overlay and the Inspector's "Logic" section, and handy for
 * engines that want a dependency graph.
 */
import { canonicalEdge, cellKey, edgeKey, type EdgeKey, type GridPos } from "../geometry";
import type { MapDoc } from "../model";
import type { Action, Condition, EventRef, MapEvent, ParamValue, Target } from "../schema";

export type LogicRef =
  | { kind: "map" }
  | { kind: "cell"; pos: GridPos }
  | { kind: "edge"; key: EdgeKey }
  | { kind: "prop"; id: string }
  | { kind: "flag"; name: string };

export type Trigger = "onLoad" | "onEnter" | "onExit" | "onUse" | "onBump";

export interface Link {
  source: LogicRef;
  trigger: Trigger;
  /** Named events walked to reach this effect, outermost first (empty for an inline event). */
  via: string[];
  effect: "write" | "read";
  target: LogicRef;
  /** Short human description, e.g. "set gate → open". */
  text: string;
}

export function refKey(r: LogicRef): string {
  switch (r.kind) {
    case "map": return "map";
    case "cell": return `cell:${cellKey(r.pos)}`;
    case "edge": return `edge:${r.key}`;
    case "prop": return `prop:${r.id}`;
    case "flag": return `flag:${r.name}`;
  }
}

export const sameRef = (a: LogicRef, b: LogicRef) => refKey(a) === refKey(b);

const fmtPos = (p: GridPos) => `(${p.x}, ${p.y}, ${p.z})`;

/** Resolve an event Target to a LogicRef, or null when it points at nothing that exists. */
export function targetRef(doc: MapDoc, t: Target): LogicRef | null {
  switch (t.kind) {
    case "edge": {
      const k = Object.entries(doc.edges).find(([, e]) => e.id === t.id)?.[0];
      return k ? { kind: "edge", key: k } : null;
    }
    case "edgeAt": {
      try {
        const k = edgeKey(canonicalEdge(t.cell, t.dir, t.toZ));
        return doc.edges[k] ? { kind: "edge", key: k } : null;
      } catch {
        return null;
      }
    }
    case "prop": return doc.props[t.id] ? { kind: "prop", id: t.id } : null;
    case "cell": return { kind: "cell", pos: t.pos };
    case "player": return null;
  }
}

export function targetLabel(doc: MapDoc, t: Target): string {
  switch (t.kind) {
    case "edge": return t.id;
    case "edgeAt": return `${fmtPos(t.cell)} ${t.dir}`;
    case "prop": return t.id;
    case "cell": return fmtPos(t.pos);
    case "player": return "player";
  }
  void doc;
}

const quote = (s: string, n = 32) => `"${s.length > n ? s.slice(0, n - 1) + "…" : s}"`;

export function describeAction(doc: MapDoc, a: Action): string {
  switch (a.type) {
    case "setConnectionState": return `set ${targetLabel(doc, a.target)} → ${a.state}`;
    case "toggleConnectionState": return `toggle ${targetLabel(doc, a.target)} ${a.states[0]}/${a.states[1]}`;
    case "setPropState": return `set ${targetLabel(doc, a.target)} → ${a.state}`;
    case "setFlag": return `${a.name} = ${JSON.stringify(a.value)}`;
    case "addFlag": return `${a.name} ${a.amount >= 0 ? "+" : "−"}= ${Math.abs(a.amount)}`;
    case "teleport": return `teleport to ${fmtPos(a.to)}${a.facing ? ` facing ${a.facing}` : ""}`;
    case "showMessage": return `message ${quote(a.text)}`;
    case "runEvent": return `run ${a.event}${a.delayMs ? ` after ${a.delayMs} ms` : ""}`;
    case "setSurface": return `paint ${fmtPos(a.cell)} ${a.side} → ${a.material}`;
    case "custom": return `${doc.customTypes[a.custom]?.name ?? a.custom}(${fmtParams(a.params)})`;
  }
}

export function describeCondition(doc: MapDoc, c: Condition): string {
  switch (c.type) {
    case "state": return `${targetLabel(doc, c.target)} is ${c.equals}`;
    case "flag": return `${c.name} ${c.op} ${JSON.stringify(c.value)}`;
    case "playerAt": return `player at ${fmtPos(c.pos)}${c.facing ? ` facing ${c.facing}` : ""}`;
    case "playerFacing": return `player facing ${c.facing}`;
    case "eventFired": return `${c.event} has fired`;
    case "not": return `none of (${c.conditions.map((s) => describeCondition(doc, s)).join(", ")})`;
    case "any": return `any of (${c.conditions.map((s) => describeCondition(doc, s)).join(", ")})`;
    case "custom": return `${doc.customTypes[c.custom]?.name ?? c.custom}(${fmtParams(c.params)})`;
  }
}

function fmtParams(p: Record<string, ParamValue> | undefined): string {
  if (!p) return "";
  return Object.entries(p)
    .map(([k, v]) => `${k}: ${v && typeof v === "object" ? fmtPos(v) : JSON.stringify(v)}`)
    .join(", ");
}

/** Every link from every trigger in the map. */
export function collectLinks(doc: MapDoc): Link[] {
  const out: Link[] = [];

  const walk = (source: LogicRef, trigger: Trigger, ref: EventRef, via: string[]) => {
    let ev: MapEvent | undefined;
    let chain = via;
    if (typeof ref === "string") {
      if (via.includes(ref)) return; // cycle
      ev = doc.events[ref];
      chain = [...via, ref];
    } else ev = ref;
    if (!ev) return;
    const push = (effect: Link["effect"], target: LogicRef | null, text: string) => {
      if (target) out.push({ source, trigger, via: chain, effect, target, text });
    };
    const customRefs = (custom: string, params: Record<string, ParamValue> | undefined, effect: Link["effect"], text: string) => {
      for (const d of doc.customTypes[custom]?.params ?? []) {
        const v = params?.[d.name];
        if (v === undefined || v === null) continue;
        if (d.type === "ref:edge" && typeof v === "string") push(effect, targetRef(doc, { kind: "edge", id: v }), text);
        if (d.type === "ref:prop" && typeof v === "string") push(effect, targetRef(doc, { kind: "prop", id: v }), text);
        if (d.type === "ref:flag" && typeof v === "string") push(effect, { kind: "flag", name: v }, text);
        if (d.type === "gridPos" && typeof v === "object") push(effect, { kind: "cell", pos: v }, text);
      }
    };
    const cond = (c: Condition) => {
      const text = `if ${describeCondition(doc, c)}`;
      switch (c.type) {
        case "state": push("read", targetRef(doc, c.target), text); break;
        case "flag": push("read", { kind: "flag", name: c.name }, text); break;
        case "playerAt": push("read", { kind: "cell", pos: c.pos }, text); break;
        case "not": case "any": c.conditions.forEach(cond); break;
        case "custom": customRefs(c.custom, c.params, "read", text); break;
      }
    };
    const act = (a: Action, branch: "" | "else: ") => {
      const text = branch + describeAction(doc, a);
      switch (a.type) {
        case "setConnectionState": case "toggleConnectionState": case "setPropState":
          push("write", targetRef(doc, a.target), text); break;
        case "setFlag": case "addFlag": push("write", { kind: "flag", name: a.name }, text); break;
        case "teleport": push("write", { kind: "cell", pos: a.to }, text); break;
        case "setSurface": push("write", { kind: "cell", pos: a.cell }, text); break;
        case "runEvent": walk(source, trigger, a.event, chain); break;
        case "custom": customRefs(a.custom, a.params, "write", text); break;
      }
    };
    ev.conditions?.forEach(cond);
    ev.actions.forEach((a) => act(a, ""));
    ev.else?.forEach((a) => act(a, "else: "));
  };

  if (doc.onLoad !== undefined) walk({ kind: "map" }, "onLoad", doc.onLoad, []);
  for (const c of Object.values(doc.cells)) {
    const src: LogicRef = { kind: "cell", pos: c.pos };
    if (c.onEnter !== undefined) walk(src, "onEnter", c.onEnter, []);
    if (c.onExit !== undefined) walk(src, "onExit", c.onExit, []);
  }
  for (const [k, e] of Object.entries(doc.edges)) {
    const src: LogicRef = { kind: "edge", key: k };
    if (e.onUse !== undefined) walk(src, "onUse", e.onUse, []);
    if (e.onBump !== undefined) walk(src, "onBump", e.onBump, []);
  }
  for (const p of Object.values(doc.props)) {
    if (p.onUse !== undefined) walk({ kind: "prop", id: p.id }, "onUse", p.onUse, []);
  }
  return out;
}

export const linksFrom = (links: Link[], r: LogicRef) => links.filter((l) => sameRef(l.source, r));
export const linksTo = (links: Link[], r: LogicRef) => links.filter((l) => sameRef(l.target, r));

/** Where an event id is used as a trigger or via runEvent / eventFired, for the Events panel. */
export function eventUsages(doc: MapDoc, id: string): string[] {
  const out: string[] = [];
  const mention = (ref: EventRef | undefined, where: string) => { if (ref === id) out.push(where); };
  mention(doc.onLoad, "map on load");
  for (const c of Object.values(doc.cells)) {
    mention(c.onEnter, `cell ${fmtPos(c.pos)} on enter`);
    mention(c.onExit, `cell ${fmtPos(c.pos)} on exit`);
  }
  for (const e of Object.values(doc.edges)) {
    const name = e.id ?? `${fmtPos(e.from)} ${e.dir}`;
    mention(e.onUse, `${name} on use`);
    mention(e.onBump, `${name} on bump`);
  }
  for (const p of Object.values(doc.props)) mention(p.onUse, `${p.id} on use`);
  const inEvent = (ev: MapEvent, name: string) => {
    const conds = (cs: Condition[] | undefined) => cs?.forEach((c) => {
      if (c.type === "eventFired" && c.event === id) out.push(`event ${name} (condition)`);
      if (c.type === "not" || c.type === "any") conds(c.conditions);
    });
    conds(ev.conditions);
    [...ev.actions, ...(ev.else ?? [])].forEach((a) => { if (a.type === "runEvent" && a.event === id) out.push(`event ${name} (runs it)`); });
  };
  for (const [eid, ev] of Object.entries(doc.events)) if (eid !== id) inEvent(ev, eid);
  return out;
}
