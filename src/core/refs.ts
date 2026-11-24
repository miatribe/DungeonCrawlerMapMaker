/**
 * One walker over every reference in a map. Validation (missing refs), unused-definition
 * checks and renames all use it, so a new reference site only has to be added here.
 *
 * `set` mutates the containing object in place, so call it only on a draft/mutable doc.
 */
import type { MapDoc } from "./model";
import type { Action, Condition, EventRef, MapEvent, ParamValue, Target } from "./schema";
import type { Direction, GridPos } from "./geometry";
import type { ParamDefSchema } from "./schema";
import type { z } from "zod";

export type RefKind = "material" | "connectionType" | "propType" | "customType" | "event" | "flag" | "edge" | "prop";

export type RefSite =
  | { kind: RefKind; id: string; where: string; set: (id: string) => void }
  | { kind: "cellPos"; pos: GridPos; where: string; role?: "teleport" }
  | { kind: "edgeAt"; cell: GridPos; dir: Direction; toZ?: number; where: string };

type ParamDef = z.infer<typeof ParamDefSchema>;

const PARAM_REF: Partial<Record<ParamDef["type"], RefKind>> = {
  "ref:edge": "edge",
  "ref:prop": "prop",
  "ref:event": "event",
  "ref:flag": "flag",
  "ref:material": "material",
};

export function walkRefs(doc: MapDoc, visit: (r: RefSite) => void): void {
  const id = (kind: RefKind, obj: any, key: string | number, where: string) => {
    const v = obj[key];
    if (typeof v === "string") visit({ kind, id: v, where, set: (n) => (obj[key] = n) });
  };

  const params = (defs: ParamDef[] | undefined, values: Record<string, ParamValue> | undefined, where: string) => {
    if (!defs || !values) return;
    for (const d of defs) {
      const k = PARAM_REF[d.type];
      if (k) id(k, values, d.name, `${where}.params.${d.name}`);
    }
  };

  const target = (t: Target, where: string) => {
    if (t.kind === "edge") id("edge", t, "id", where);
    else if (t.kind === "prop") id("prop", t, "id", where);
    else if (t.kind === "cell") visit({ kind: "cellPos", pos: t.pos, where });
    else if (t.kind === "edgeAt") visit({ kind: "edgeAt", cell: t.cell, dir: t.dir, toZ: t.toZ, where });
  };

  const condition = (c: Condition, where: string) => {
    switch (c.type) {
      case "state": target(c.target, `${where}.target`); break;
      case "flag": id("flag", c, "name", where); break;
      case "playerAt": visit({ kind: "cellPos", pos: c.pos, where }); break;
      case "eventFired": id("event", c, "event", where); break;
      case "not": case "any": c.conditions.forEach((s, i) => condition(s, `${where}.conditions[${i}]`)); break;
      case "custom":
        id("customType", c, "custom", where);
        params(doc.customTypes[c.custom]?.params, c.params, where);
        break;
    }
  };

  const action = (a: Action, where: string) => {
    switch (a.type) {
      case "setConnectionState": case "toggleConnectionState": case "setPropState":
        target(a.target, `${where}.target`); break;
      case "setFlag": case "addFlag": id("flag", a, "name", where); break;
      case "teleport": visit({ kind: "cellPos", pos: a.to, where, role: "teleport" }); break;
      case "runEvent": id("event", a, "event", where); break;
      case "setSurface":
        visit({ kind: "cellPos", pos: a.cell, where });
        id("material", a, "material", where);
        break;
      case "custom":
        id("customType", a, "custom", where);
        params(doc.customTypes[a.custom]?.params, a.params, where);
        break;
    }
  };

  const event = (ev: MapEvent, where: string) => {
    ev.conditions?.forEach((c, i) => condition(c, `${where}.conditions[${i}]`));
    ev.actions.forEach((a, i) => action(a, `${where}.actions[${i}]`));
    ev.else?.forEach((a, i) => action(a, `${where}.else[${i}]`));
  };

  const eventRef = (obj: any, key: string, where: string) => {
    const v: EventRef | undefined = obj[key];
    if (v === undefined) return;
    if (typeof v === "string") id("event", obj, key, `${where}.${key}`);
    else event(v, `${where}.${key}`);
  };

  // map-level
  for (const k of ["wall", "floor", "ceiling"] as const) id("material", doc.defaults, k, `defaults.${k}`);
  eventRef(doc, "onLoad", "map");
  if (doc.start) visit({ kind: "cellPos", pos: doc.start.cell, where: "start" });

  for (const [tid, t] of Object.entries(doc.connectionTypes)) id("material", t, "material", `connectionTypes.${tid}`);

  for (const [k, c] of Object.entries(doc.cells)) {
    const w = `cells[${k}]`;
    if (c.surfaces) for (const side of Object.keys(c.surfaces)) id("material", c.surfaces, side, `${w}.surfaces.${side}`);
    eventRef(c, "onEnter", w);
    eventRef(c, "onExit", w);
  }

  for (const [k, e] of Object.entries(doc.edges)) {
    const w = `edges[${k}]`;
    id("connectionType", e, "type", `${w}.type`);
    eventRef(e, "onUse", w);
    eventRef(e, "onBump", w);
    params(doc.connectionTypes[e.type]?.params, e.params, w);
  }

  for (const [pid, p] of Object.entries(doc.props)) {
    const w = `props.${pid}`;
    id("propType", p, "type", `${w}.type`);
    visit({ kind: "cellPos", pos: p.cell, where: `${w}.cell` });
    eventRef(p, "onUse", w);
    params(doc.propTypes[p.type]?.params, p.params, w);
  }

  for (const [eid, ev] of Object.entries(doc.events)) event(ev, `events.${eid}`);
}

/** Ids that each definition table holds, by ref kind. */
export function definedIds(doc: MapDoc, kind: RefKind): Set<string> {
  switch (kind) {
    case "material": return new Set(Object.keys(doc.materials));
    case "connectionType": return new Set(Object.keys(doc.connectionTypes));
    case "propType": return new Set(Object.keys(doc.propTypes));
    case "customType": return new Set(Object.keys(doc.customTypes));
    case "event": return new Set(Object.keys(doc.events));
    case "flag": return new Set(Object.keys(doc.flags));
    case "prop": return new Set(Object.keys(doc.props));
    case "edge": return new Set(Object.values(doc.edges).flatMap((e) => (e.id ? [e.id] : [])));
  }
}
