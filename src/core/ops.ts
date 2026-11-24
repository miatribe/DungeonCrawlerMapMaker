/**
 * Editing operations. Each returns a Command for history.apply(); none of them validate
 * deeply. Validation (validate.ts) reports problems instead, so a map can be broken
 * mid-edit without the editor refusing work.
 */
import type { Draft } from "immer";
import type { Command } from "./history";
import {
  canonicalEdge, cellKey, DELTA, edgeKey, edgeEnds, FACINGS, parseCellKey, samePos,
  type Direction, type EdgeKey, type GridPos, type Side,
} from "./geometry";
import { nextId, type MapDoc } from "./model";
import { definedIds, walkRefs, type RefKind } from "./refs";
import type {
  Cell, ConnectionType, CustomType, Edge, FlagDef, MapEvent, Material, Prop, PropType, Start,
} from "./schema";

type D = Draft<MapDoc>;
const cmd = (label: string, recipe: (d: D) => void): Command => ({ label, recipe });

/** Shallow-merge `patch` into `obj`; keys whose value is `undefined` are deleted. */
function merge<T extends object>(obj: T, patch: Partial<T>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (obj as any)[k];
    else (obj as any)[k] = v;
  }
}

function ensureLevel(d: D, z: number) {
  if (!d.levels.some((l) => l.z === z)) {
    d.levels.push({ z, name: z === 0 ? "Ground" : z > 0 ? `Level ${z}` : `Basement ${-z}` });
    d.levels.sort((a, b) => a.z - b.z);
  }
}

// ---------- cells ----------

export interface PaintOptions {
  /** Create `opening` edges between the painted cells (default true). */
  autoOpen?: boolean;
  /** Connection type used for auto openings (default "opening"). */
  openingType?: string;
  template?: Omit<Cell, "pos">;
}

/** Add cells (existing ones are kept). Neighbors within the same stroke are opened to each other. */
export function paintCells(positions: GridPos[], opts: PaintOptions = {}): Command {
  return cmd(positions.length === 1 ? "Paint cell" : `Paint ${positions.length} cells`, (d) => {
    const set = new Set(positions.map(cellKey));
    for (const p of positions) {
      const k = cellKey(p);
      if (!d.cells[k]) d.cells[k] = { ...structuredClone(opts.template ?? {}), pos: { ...p } };
      ensureLevel(d, p.z);
    }
    if (opts.autoOpen === false) return;
    const type = opts.openingType ?? "opening";
    const state = d.connectionTypes[type]?.initialState ?? "open";
    for (const p of positions) {
      for (const dir of ["east", "south"] as const) {
        const n = { x: p.x + DELTA[dir].x, y: p.y + DELTA[dir].y, z: p.z };
        if (!set.has(cellKey(n))) continue;
        const e = canonicalEdge(p, dir);
        const k = edgeKey(e);
        if (!d.edges[k]) d.edges[k] = { ...e, type, state };
      }
    }
  });
}

/** Remove cells along with every edge that touches them and every prop inside them. */
export function removeCells(positions: GridPos[]): Command {
  return cmd(positions.length === 1 ? "Erase cell" : `Erase ${positions.length} cells`, (d) => {
    const gone = new Set(positions.map(cellKey));
    for (const k of gone) delete d.cells[k];
    for (const [k, e] of Object.entries(d.edges)) {
      if (edgeEnds(e).some((p) => gone.has(cellKey(p)))) delete d.edges[k];
    }
    for (const [id, p] of Object.entries(d.props)) if (gone.has(cellKey(p.cell))) delete d.props[id];
  });
}

/** Merge fields into existing cells. Pass `undefined` to reset a field to its default. */
export function updateCells(positions: GridPos[], patch: Partial<Omit<Cell, "pos">>): Command {
  return cmd("Edit cell", (d) => {
    for (const p of positions) {
      const c = d.cells[cellKey(p)];
      if (c) merge(c, structuredClone(patch) as Partial<Draft<Cell>>);
    }
  });
}

export type SurfaceTarget = Side | "walls" | "all";
const WALL_SIDES: Side[] = [...FACINGS];

/** Paint a material onto one face, the four walls, or all six faces of each cell. `null` resets to the map default. */
export function setSurface(positions: GridPos[], target: SurfaceTarget, material: string | null): Command {
  const sides: Side[] = target === "walls" ? WALL_SIDES : target === "all" ? [...WALL_SIDES, "up", "down"] : [target];
  return cmd("Paint material", (d) => {
    for (const p of positions) {
      const c = d.cells[cellKey(p)];
      if (!c) continue;
      c.surfaces ??= {};
      for (const s of sides) {
        if (material === null) delete c.surfaces[s];
        else c.surfaces[s] = material;
      }
      if (Object.keys(c.surfaces).length === 0) delete c.surfaces;
    }
  });
}

/** Move floor and/or ceiling by a number of steps. Values that end at the default are removed. */
export function adjustHeights(positions: GridPos[], delta: { floor?: number; ceiling?: number }): Command {
  return cmd("Change height", (d) => {
    for (const p of positions) {
      const c = d.cells[cellKey(p)];
      if (!c) continue;
      if (delta.floor) c.floor = (c.floor ?? 0) + delta.floor;
      if (delta.ceiling) c.ceiling = (c.ceiling ?? d.stepsPerLevel) + delta.ceiling;
      if (c.floor === 0) delete c.floor;
      if (c.ceiling === d.stepsPerLevel) delete c.ceiling;
    }
  });
}

// ---------- edges ----------

export interface EdgeAt {
  cell: GridPos;
  dir: Direction;
  toZ?: number;
}

export function edgeKeyAt(at: EdgeAt): EdgeKey {
  return edgeKey(canonicalEdge(at.cell, at.dir, at.toZ));
}

/**
 * Set the connection type at a boundary. `null` turns it back into a wall/solid slab.
 * Changing type keeps the id and triggers and resets the state to the new type's initial
 * state (so a door placed on an opening starts closed).
 */
export function setEdge(at: EdgeAt, type: string | null, opts: { id?: string; state?: string } = {}): Command {
  return cmd(type === null ? "Remove connection" : "Set connection", (d) => {
    const pos = canonicalEdge(at.cell, at.dir, at.toZ);
    const k = edgeKey(pos);
    if (type === null) {
      delete d.edges[k];
      return;
    }
    const ct = d.connectionTypes[type];
    const existing = d.edges[k];
    const state =
      opts.state ??
      (existing && existing.type === type ? existing.state : (ct?.initialState ?? "open"));
    if (existing) {
      existing.type = type;
      existing.state = state;
      if (opts.id !== undefined) existing.id = opts.id;
    } else {
      const e: Edge = { ...pos, type, state };
      if (opts.id !== undefined) e.id = opts.id;
      d.edges[k] = e;
    }
  });
}

export function updateEdge(key: EdgeKey, patch: Partial<Omit<Edge, "from" | "dir" | "toZ">>): Command {
  return cmd("Edit connection", (d) => {
    const e = d.edges[key];
    if (e) merge(e, structuredClone(patch) as Partial<Draft<Edge>>);
  });
}

/** Give an edge an id if it has none, e.g. before it is targeted by an event. Returns the command and the id. */
export function ensureEdgeId(doc: MapDoc, key: EdgeKey, prefix?: string): { command: Command; id: string } {
  const e = doc.edges[key];
  if (!e) throw new Error(`no edge at ${key}`);
  if (e.id) return { command: cmd("Name connection", () => {}), id: e.id };
  const id = nextId(prefix ?? e.type, definedIds(doc, "edge"));
  return { command: updateEdge(key, { id }), id };
}

// ---------- props ----------

export function addProp(doc: MapDoc, prop: Omit<Prop, "id" | "state"> & { id?: string; state?: string }): { command: Command; id: string } {
  const id = prop.id ?? nextId(prop.type, Object.keys(doc.props));
  const state = prop.state ?? doc.propTypes[prop.type]?.initialState ?? "default";
  return {
    id,
    command: cmd("Place prop", (d) => {
      d.props[id] = structuredClone({ ...prop, id, state });
    }),
  };
}

export function updateProp(id: string, patch: Partial<Omit<Prop, "id">>): Command {
  return cmd("Edit prop", (d) => {
    const p = d.props[id];
    if (p) merge(p, structuredClone(patch) as Partial<Draft<Prop>>);
  });
}

export function removeProp(id: string): Command {
  return cmd("Delete prop", (d) => {
    delete d.props[id];
  });
}

// ---------- map ----------

export function setStart(start: Start | null): Command {
  return cmd("Set start", (d) => {
    d.start = start && structuredClone(start);
  });
}

export type MapMeta = Pick<MapDoc, "id" | "name" | "cellSize" | "stepsPerLevel" | "stepHeight" | "rules" | "defaults" | "onLoad" | "tags" | "data">;

export function setMapMeta(patch: Partial<MapMeta>): Command {
  return cmd("Edit map settings", (d) => merge(d, structuredClone(patch) as Partial<D>));
}

export function setLevelName(z: number, name: string): Command {
  return cmd("Rename level", (d) => {
    ensureLevel(d, z);
    d.levels.find((l) => l.z === z)!.name = name;
  });
}

// ---------- definitions ----------

export interface DefTables {
  material: Material;
  connectionType: ConnectionType;
  propType: PropType;
  customType: CustomType;
  event: MapEvent;
  flag: FlagDef;
}
export type DefKind = keyof DefTables;

const TABLE: Record<DefKind, keyof MapDoc> = {
  material: "materials",
  connectionType: "connectionTypes",
  propType: "propTypes",
  customType: "customTypes",
  event: "events",
  flag: "flags",
};

/** Create or replace a definition. */
export function define<K extends DefKind>(kind: K, id: string, value: DefTables[K]): Command {
  return cmd(`Save ${kind}`, (d) => {
    (d[TABLE[kind]] as Record<string, unknown>)[id] = structuredClone(value);
  });
}

/** Delete a definition. References to it are left for validation to report. */
export function undefine(kind: DefKind, id: string): Command {
  return cmd(`Delete ${kind}`, (d) => {
    delete (d[TABLE[kind]] as Record<string, unknown>)[id];
  });
}

/** Rename an id and rewrite every reference to it. Throws if the new id is taken. */
export function renameId(doc: MapDoc, kind: RefKind, oldId: string, newId: string): Command {
  if (oldId === newId) return cmd("Rename", () => {});
  if (definedIds(doc, kind).has(newId)) throw new Error(`${kind} "${newId}" already exists`);
  if (!definedIds(doc, kind).has(oldId)) throw new Error(`${kind} "${oldId}" does not exist`);
  return cmd(`Rename ${kind}`, (d) => {
    if (kind === "edge") {
      const e = Object.values(d.edges).find((e) => e.id === oldId)!;
      e.id = newId;
    } else if (kind === "prop") {
      const p = d.props[oldId]!;
      delete d.props[oldId];
      p.id = newId;
      d.props[newId] = p;
    } else {
      const table = d[TABLE[kind]] as Record<string, unknown>;
      table[newId] = table[oldId];
      delete table[oldId];
    }
    walkRefs(d as MapDoc, (r) => {
      if (r.kind === kind && "set" in r && r.id === oldId) r.set(newId);
    });
  });
}

// ---------- helpers ----------

/** Positions of all cells on one level. */
export function cellsOnLevel(doc: MapDoc, z: number): GridPos[] {
  return Object.keys(doc.cells).map(parseCellKey).filter((p) => p.z === z);
}

export function propsAt(doc: MapDoc, pos: GridPos): Prop[] {
  return Object.values(doc.props).filter((p) => samePos(p.cell, pos));
}
