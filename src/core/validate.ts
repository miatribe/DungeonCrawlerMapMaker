/**
 * Map validation (SPEC §8.8). Errors block export; warnings and info don't.
 */
import { BUILTIN_CONNECTION_TYPES, BUILTIN_MATERIALS, BUILTIN_PROP_TYPES } from "./defaults";
import { cellKey, inBounds, OPPOSITE, type Facing, type GridPos } from "./geometry";
import type { MapDoc } from "./model";
import { definedIds, walkRefs, type RefKind } from "./refs";
import { floorAtSide, resolve, type ResolvedMap } from "./resolve";
import type { Action, Condition, MapEvent, ParamDefSchema, ParamValue, Target } from "./schema";
import type { z } from "zod";

export type Severity = "error" | "warning" | "info";

export type ProblemCode =
  | "V-SCHEMA" | "V-BOUNDS" | "V-OVERLAP" | "V-CEIL" | "V-REF" | "V-STATE" | "V-START" | "V-DUPID"
  | "V-PARAM" | "V-AXIS" | "V-TYPE" | "V-EDGE-VOID" | "V-GAP" | "V-STEP" | "V-UNREACH" | "V-UNUSED";

export interface Problem {
  code: ProblemCode;
  severity: Severity;
  message: string;
  /** A path into the map, e.g. `events.trap.actions[0]`, for the Problems panel to focus. */
  where?: string;
  cell?: GridPos;
}

type ParamDef = z.infer<typeof ParamDefSchema>;

const fmt = (p: GridPos) => `(${p.x},${p.y},${p.z})`;

export function validate(doc: MapDoc, resolved: ResolvedMap = resolve(doc)): Problem[] {
  const out: Problem[] = [];
  const add = (code: ProblemCode, severity: Severity, message: string, where?: string, cell?: GridPos) =>
    out.push({ code, severity, message, ...(where !== undefined && { where }), ...(cell && { cell }) });
  const err = (code: ProblemCode, msg: string, where?: string, cell?: GridPos) => add(code, "error", msg, where, cell);
  const warn = (code: ProblemCode, msg: string, where?: string, cell?: GridPos) => add(code, "warning", msg, where, cell);

  // ---------- cells ----------
  for (const c of resolved.cells) {
    const w = `cells[${c.key}]`;
    if (!inBounds(c.pos)) err("V-BOUNDS", `Cell ${fmt(c.pos)} is outside the map bounds`, w, c.pos);
    if (c.ceiling <= c.floor) err("V-CEIL", `Cell ${fmt(c.pos)}: ceiling (${c.ceiling}) must be above floor (${c.floor})`, w, c.pos);
    if (c.shape.kind !== "flat" && c.floor + c.shape.rise >= c.ceiling)
      err("V-CEIL", `Cell ${fmt(c.pos)}: the top of the ${c.shape.kind} (${c.floor + c.shape.rise}) reaches the ceiling (${c.ceiling})`, w, c.pos);
  }

  // Vertical occupancy per column: no two cells may share space.
  const columns = new Map<string, typeof resolved.cells>();
  for (const c of resolved.cells) {
    const k = `${c.pos.x},${c.pos.y}`;
    (columns.get(k) ?? columns.set(k, []).get(k)!).push(c);
  }
  for (const col of columns.values()) {
    col.sort((a, b) => a.abs.floor - b.abs.floor);
    for (let i = 1; i < col.length; i++) {
      const lo = col[i - 1]!, hi = col[i]!;
      if (hi.abs.floor < lo.abs.ceiling)
        err("V-OVERLAP", `Cell ${fmt(lo.pos)} (height ${lo.abs.floor}–${lo.abs.ceiling}) overlaps cell ${fmt(hi.pos)} (from ${hi.abs.floor})`, `cells[${hi.key}]`, hi.pos);
    }
  }

  // ---------- edges ----------
  const seenEdgeIds = new Map<string, string>();
  for (const e of resolved.edges) {
    const w = `edges[${e.key}]`;
    const ct = doc.connectionTypes[e.type];
    if (!inBounds(e.from) || !inBounds(e.to)) err("V-BOUNDS", `Connection ${e.key} is outside the map bounds`, w, e.from);
    if (e.id) {
      const prev = seenEdgeIds.get(e.id);
      if (prev) err("V-DUPID", `Connection id "${e.id}" is used by ${prev} and ${e.key}`, w, e.from);
      else seenEdgeIds.set(e.id, e.key);
    }
    if (ct) {
      if (!(e.state in ct.states)) err("V-STATE", `Connection ${e.key}: "${e.type}" has no state "${e.state}"`, w, e.from);
      const axisOk = ct.axis === "both" || (ct.axis === "vertical") === e.vertical;
      if (!axisOk) err("V-AXIS", `Connection ${e.key}: "${e.type}" is a ${ct.axis} type but is used on a ${e.vertical ? "vertical" : "horizontal"} boundary`, w, e.from);
      checkParams(ct.params, e.params, `${w}.params`, `connection ${e.key}`, e.from);
    }
    const a = resolved.cellAt(e.from), b = resolved.cellAt(e.to);
    if (!a || !b) {
      warn("V-EDGE-VOID", `Connection ${e.key} has a cell on only ${a || b ? "one side" : "neither side"}`, w, a ? e.from : e.to);
      continue;
    }
    if (e.vertical) {
      if (a.abs.ceiling !== b.abs.floor)
        warn("V-GAP", `Vertical connection ${e.key}: ceiling of ${fmt(a.pos)} (${a.abs.ceiling}) doesn't meet floor of ${fmt(b.pos)} (${b.abs.floor})`, w, e.from);
    } else {
      if (a.abs.ceiling <= b.abs.floor || b.abs.ceiling <= a.abs.floor)
        warn("V-GAP", `Connection ${e.key} joins cells that don't overlap vertically`, w, e.from);
      const passable = ct && Object.values(ct.states).some((s) => s.passable);
      const fa = floorAtSide(a, e.dir as Facing), fb = floorAtSide(b, OPPOSITE[e.dir] as Facing);
      if (passable && fa !== null && fb !== null && Math.abs(fa - fb) > resolved.rules.maxStep)
        warn("V-STEP", `Connection ${e.key}: floor step of ${Math.abs(fa - fb)} exceeds maxStep (${resolved.rules.maxStep})`, w, e.from);
    }
  }

  // ---------- props ----------
  for (const [key, p] of Object.entries(doc.props)) {
    const w = `props.${key}`;
    if (key !== p.id) err("V-DUPID", `Prop stored as "${key}" has id "${p.id}"`, w, p.cell);
    const pt = doc.propTypes[p.type];
    if (pt) {
      if (!pt.states.includes(p.state)) err("V-STATE", `Prop "${p.id}": "${p.type}" has no state "${p.state}"`, w, p.cell);
      checkParams(pt.params, p.params, `${w}.params`, `prop "${p.id}"`, p.cell);
    }
  }

  // ---------- definitions ----------
  for (const [id, t] of Object.entries(doc.connectionTypes)) {
    const w = `connectionTypes.${id}`;
    if (!(t.initialState in t.states)) err("V-STATE", `Connection type "${id}": initial state "${t.initialState}" is not defined`, w);
    for (const [sid, s] of Object.entries(t.states))
      for (const tr of s.transitions ?? [])
        if (!(tr in t.states)) err("V-STATE", `Connection type "${id}": state "${sid}" transitions to unknown "${tr}"`, w);
  }
  for (const [id, t] of Object.entries(doc.propTypes)) {
    if (!t.states.includes(t.initialState)) err("V-STATE", `Prop type "${id}": initial state "${t.initialState}" is not defined`, `propTypes.${id}`);
  }

  // ---------- start ----------
  if (!doc.start) err("V-START", "The map has no start position");
  else if (!resolved.cellAt(doc.start.cell)) err("V-START", `The start ${fmt(doc.start.cell)} is not on a cell`, "start", doc.start.cell);

  // ---------- references ----------
  const ids = {} as Record<RefKind, Set<string>>;
  const idsOf = (k: RefKind) => (ids[k] ??= definedIds(doc, k));
  const used = new Map<RefKind, Set<string>>();
  walkRefs(doc, (r) => {
    if (r.kind === "cellPos") {
      if (!resolved.cellAt(r.pos)) err("V-REF", `${r.where}: there is no cell at ${fmt(r.pos)}`, r.where, r.pos);
    } else if (r.kind === "edgeAt") {
      let ok = false;
      try { ok = !!resolved.edgeAt(r.cell, r.dir, r.toZ); } catch { /* bad vertical toZ */ }
      if (!ok) err("V-REF", `${r.where}: there is no connection at ${fmt(r.cell)} ${r.dir}`, r.where, r.cell);
    } else {
      (used.get(r.kind) ?? used.set(r.kind, new Set()).get(r.kind)!).add(r.id);
      if (!idsOf(r.kind).has(r.id)) err("V-REF", `${r.where}: unknown ${r.kind} "${r.id}"`, r.where);
    }
  });

  // ---------- logic: states, flag types, custom params ----------
  const targetStates = (t: Target): string[] | undefined => {
    if (t.kind === "edge" || t.kind === "edgeAt") {
      let e;
      try { e = t.kind === "edge" ? resolved.edgeById(t.id) : resolved.edgeAt(t.cell, t.dir, t.toZ); } catch { return; }
      const ct = e && doc.connectionTypes[e.type];
      return ct && Object.keys(ct.states);
    }
    if (t.kind === "prop") {
      const p = resolved.propById(t.id);
      return p && doc.propTypes[p.type]?.states;
    }
  };
  const checkState = (t: Target, state: string, where: string) => {
    const states = targetStates(t);
    if (states && !states.includes(state)) err("V-STATE", `${where}: target has no state "${state}" (has ${states.join(", ")})`, where);
  };
  const checkFlag = (name: string, value: unknown, where: string, numeric = false) => {
    const f = doc.flags[name];
    if (!f) return; // reported as V-REF
    if (numeric && f.type !== "int") err("V-TYPE", `${where}: flag "${name}" is ${f.type}, not int`, where);
    const t = f.type === "int" ? "number" : f.type === "bool" ? "boolean" : "string";
    if (value !== undefined && typeof value !== t) err("V-TYPE", `${where}: flag "${name}" is ${f.type} but the value is ${typeof value}`, where);
  };
  const condition = (c: Condition, where: string) => {
    if (c.type === "state") checkState(c.target, c.equals, where);
    else if (c.type === "flag") checkFlag(c.name, c.value, where, [">", "<", ">=", "<="].includes(c.op));
    else if (c.type === "not" || c.type === "any") c.conditions.forEach((s, i) => condition(s, `${where}.conditions[${i}]`));
    else if (c.type === "custom") customCall("condition", c.custom, c.params, where);
  };
  const action = (a: Action, where: string) => {
    switch (a.type) {
      case "setConnectionState": case "setPropState": checkState(a.target, a.state, where); break;
      case "toggleConnectionState": a.states.forEach((s) => checkState(a.target, s, where)); break;
      case "setFlag": checkFlag(a.name, a.value, where); break;
      case "addFlag": checkFlag(a.name, undefined, where, true); break;
      case "custom": customCall("action", a.custom, a.params, where); break;
    }
  };
  const customCall = (category: "action" | "condition", id: string, params: Record<string, ParamValue> | undefined, where: string) => {
    const def = doc.customTypes[id];
    if (!def) return; // V-REF
    if (def.category !== category) err("V-TYPE", `${where}: custom type "${id}" is a ${def.category}, used as a ${category}`, where);
    checkParams(def.params, params, `${where}.params`, `"${id}"`);
  };
  const event = (ev: MapEvent, where: string) => {
    ev.conditions?.forEach((c, i) => condition(c, `${where}.conditions[${i}]`));
    ev.actions.forEach((a, i) => action(a, `${where}.actions[${i}]`));
    ev.else?.forEach((a, i) => action(a, `${where}.else[${i}]`));
  };
  for (const [id, ev] of Object.entries(doc.events)) event(ev, `events.${id}`);
  const inline = (ref: unknown, where: string) => { if (ref && typeof ref === "object") event(ref as MapEvent, where); };
  inline(doc.onLoad, "map.onLoad");
  for (const [k, c] of Object.entries(doc.cells)) { inline(c.onEnter, `cells[${k}].onEnter`); inline(c.onExit, `cells[${k}].onExit`); }
  for (const [k, e] of Object.entries(doc.edges)) { inline(e.onUse, `edges[${k}].onUse`); inline(e.onBump, `edges[${k}].onBump`); }
  for (const [k, p] of Object.entries(doc.props)) inline(p.onUse, `props.${k}.onUse`);

  function checkParams(defs: ParamDef[] | undefined, values: Record<string, ParamValue> | undefined, where: string, what: string, cell?: GridPos) {
    const vals = values ?? {};
    const known = new Set((defs ?? []).map((d) => d.name));
    for (const k of Object.keys(vals)) if (!known.has(k)) warn("V-PARAM", `${what}: unknown parameter "${k}"`, where, cell);
    for (const d of defs ?? []) {
      const v = vals[d.name];
      if (v === undefined || v === null) {
        if (d.required && d.default === undefined) err("V-PARAM", `${what}: required parameter "${d.name}" is missing`, where, cell);
        continue;
      }
      const bad = (expected: string) => err("V-PARAM", `${what}: parameter "${d.name}" should be ${expected}`, where, cell);
      switch (d.type) {
        case "int": if (!Number.isInteger(v)) bad("an integer"); break;
        case "float": if (typeof v !== "number") bad("a number"); break;
        case "bool": if (typeof v !== "boolean") bad("true or false"); break;
        case "enum": if (typeof v !== "string" || !(d.options ?? []).includes(v)) bad(`one of ${(d.options ?? []).join(", ")}`); break;
        case "gridPos": if (typeof v !== "object") bad("a grid position"); break;
        case "direction": if (typeof v !== "string" || !["north", "east", "south", "west", "up", "down"].includes(v)) bad("a direction"); break;
        case "color": if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) bad("a #rrggbb color"); break;
        default: if (typeof v !== "string") bad("a string"); // string + ref:* (refs checked by walkRefs)
      }
    }
  }

  // ---------- reachability ----------
  if (doc.start && resolved.cellAt(doc.start.cell)) {
    const seen = new Set<string>();
    const queue: GridPos[] = [doc.start.cell];
    walkRefs(doc, (r) => { if (r.kind === "cellPos" && r.role === "teleport") queue.push(r.pos); });
    const passable = (type: string) => Object.values(doc.connectionTypes[type]?.states ?? {}).some((s) => s.passable);
    while (queue.length) {
      const p = queue.pop()!;
      const k = cellKey(p);
      if (seen.has(k) || !resolved.cellAt(p)) continue;
      seen.add(k);
      for (const { edge } of resolved.edgesOf(p)) {
        if (!passable(edge.type)) continue;
        for (const q of [edge.from, edge.to]) if (!seen.has(cellKey(q))) queue.push(q);
      }
    }
    const unreachable = resolved.cells.filter((c) => !seen.has(c.key));
    if (unreachable.length)
      warn("V-UNREACH", `${unreachable.length} cell(s) can't be reached from the start, e.g. ${fmt(unreachable[0]!.pos)}`, `cells[${unreachable[0]!.key}]`, unreachable[0]!.pos);
  }

  // ---------- unused (user-defined only) ----------
  const builtin: Partial<Record<RefKind, Record<string, unknown>>> = {
    material: BUILTIN_MATERIALS, connectionType: BUILTIN_CONNECTION_TYPES, propType: BUILTIN_PROP_TYPES,
  };
  for (const kind of ["material", "connectionType", "propType", "customType", "event", "flag"] as const) {
    for (const id of idsOf(kind)) {
      if (builtin[kind]?.[id] || used.get(kind)?.has(id)) continue;
      add("V-UNUSED", "info", `${kind} "${id}" is never used`);
    }
  }

  return out;
}

export const hasErrors = (problems: Problem[]) => problems.some((p) => p.severity === "error");
