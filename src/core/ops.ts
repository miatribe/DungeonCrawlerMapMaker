/**
 * Editing operations. Each returns a Command for history.apply(); none of them validate
 * deeply. Validation (validate.ts) reports problems instead, so a map can be broken
 * mid-edit without the editor refusing work.
 */
import type { Draft } from "immer";
import type { Command } from "./history";
import {
  canonicalEdge, cellKey, DELTA, edgeKey, edgeEnds, FACINGS, parseCellKey, samePos,
  type Direction, type EdgeKey, type Facing, type GridPos, type Side,
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

// ---------- heights, ramps, stairs, vertical links (SPEC §4.1, §4.3) ----------

/** Normalize a cell's heights so defaults aren't stored. */
function tidyHeights(c: Draft<Cell>, spl: number) {
  if (c.floor === 0) delete c.floor;
  if (c.ceiling === spl) delete c.ceiling;
}

/**
 * Set floor and/or ceiling (steps above the level base) on each cell. With `keepHeight`,
 * setting the floor moves the ceiling by the same amount, so the room keeps its height.
 */
export function setHeights(positions: GridPos[], h: { floor?: number; ceiling?: number; keepHeight?: boolean }): Command {
  return cmd("Set height", (d) => {
    for (const p of positions) {
      const c = d.cells[cellKey(p)];
      if (!c) continue;
      const oldFloor = c.floor ?? 0;
      if (h.floor !== undefined) c.floor = h.floor;
      if (h.ceiling !== undefined) c.ceiling = h.ceiling;
      else if (h.keepHeight && h.floor !== undefined) c.ceiling = (c.ceiling ?? d.stepsPerLevel) + (h.floor - oldFloor);
      tidyHeights(c, d.stepsPerLevel);
    }
  });
}

/** Headroom (steps) left above the top of a ramp when its ceiling has to be raised. */
export const headroom = (stepsPerLevel: number) => Math.max(1, Math.ceil(stepsPerLevel / 2));

export interface RampOptions {
  kind: "ramp" | "stairs";
  /** Steps each cell rises. */
  rise: number;
  toward: Facing;
  /** Stair treads per cell (stairs only; default 4). */
  treads?: number;
}

/**
 * Turn a straight run of cells into a continuous ramp or staircase. Each cell starts where
 * the previous one ended, beginning at the first cell's current floor. Missing cells are
 * created, consecutive cells are opened to each other, and ceilings are raised where a
 * cell's top would hit it.
 */
export function buildRamp(path: GridPos[], o: RampOptions): Command {
  return cmd(o.kind === "ramp" ? "Build ramp" : "Build stairs", (d) => {
    const spl = d.stepsPerLevel;
    const first = path[0] && d.cells[cellKey(path[0])];
    const base = first?.floor ?? 0;
    path.forEach((p, i) => {
      const k = cellKey(p);
      d.cells[k] ??= { pos: { ...p } };
      ensureLevel(d, p.z);
      const c = d.cells[k]!;
      c.floor = base + i * o.rise;
      c.shape = o.kind === "ramp"
        ? { kind: "ramp", rise: o.rise, toward: o.toward }
        : { kind: "stairs", rise: o.rise, toward: o.toward, treads: o.treads ?? 4 };
      if ((c.ceiling ?? spl) <= c.floor + o.rise) c.ceiling = c.floor + o.rise + headroom(spl);
      tidyHeights(c, spl);
      if (i > 0) {
        const e = canonicalEdge(path[i - 1]!, o.toward);
        const ek = edgeKey(e);
        if (!d.edges[ek]) d.edges[ek] = { ...e, type: "opening", state: d.connectionTypes.opening?.initialState ?? "open" };
      }
    });
  });
}

/** Make a cell flat again (keeps its floor height). */
export function flattenCells(positions: GridPos[]): Command {
  return cmd("Flatten", (d) => {
    for (const p of positions) {
      const c = d.cells[cellKey(p)];
      if (c) delete c.shape;
    }
  });
}

/**
 * A staircase (or ramp) in one cell that climbs to the level above (SPEC §4.3): the cell
 * becomes tall enough to stand at the top, and its high end joins the cell one step
 * `toward` on level z+1 with a cross-level opening. That upper cell is created if needed.
 */
export function buildLevelStairs(doc: MapDoc, pos: GridPos, toward: Facing, kind: "ramp" | "stairs" = "stairs", treads = 4): Command {
  const spl = doc.stepsPerLevel;
  const here = doc.cells[cellKey(pos)];
  const floor = here?.floor ?? 0;
  const d0 = DELTA[toward];
  const topPos = { x: pos.x + d0.x, y: pos.y + d0.y, z: pos.z + 1 };
  const top = doc.cells[cellKey(topPos)];
  const rise = spl + (top?.floor ?? 0) - floor;
  if (rise <= 0) throw new Error("The cell above is not higher than this one");
  const ceiling = Math.max(here?.ceiling ?? spl, spl + (top?.ceiling ?? spl));
  return cmd(kind === "ramp" ? "Build ramp to level above" : "Build stairs to level above", (d) => {
    const k = cellKey(pos);
    d.cells[k] ??= { pos: { ...pos } };
    const c = d.cells[k]!;
    c.shape = kind === "ramp" ? { kind: "ramp", rise, toward } : { kind: "stairs", rise, toward, treads };
    c.ceiling = ceiling;
    tidyHeights(c, spl);
    ensureLevel(d, pos.z);
    const tk = cellKey(topPos);
    d.cells[tk] ??= { pos: { ...topPos } };
    ensureLevel(d, topPos.z);
    // The high end now leads up a level, so drop any same-level connection on that side.
    delete d.edges[edgeKey(canonicalEdge(pos, toward))];
    const e = canonicalEdge(pos, toward, topPos.z);
    d.edges[edgeKey(e)] = { ...e, type: "opening", state: d.connectionTypes.opening?.initialState ?? "open" };
  });
}

/** Absolute floor/ceiling of a stored cell, in steps. */
function absHeights(doc: MapDoc, c: Cell) {
  const base = c.pos.z * doc.stepsPerLevel;
  return { floor: base + (c.floor ?? 0), ceiling: base + (c.ceiling ?? doc.stepsPerLevel) };
}

/** The vertical edges (by key) leaving a cell through its ceiling or floor. */
export function verticalEdgesOf(doc: MapDoc, pos: GridPos, dir: "up" | "down"): EdgeKey[] {
  return Object.entries(doc.edges)
    .filter(([, e]) => e.dir === "up" && (dir === "up" ? samePos(e.from, pos) : samePos(edgeEnds(e)[1], pos)))
    .map(([k]) => k);
}

export interface VerticalTarget {
  /** z of the cell on the far side. */
  z: number;
  /** True when a cell there already meets this one exactly. */
  exists: boolean;
  /** For a cell that has to be created: its floor/ceiling relative to its own level. */
  create?: Omit<Cell, "pos">;
}

/**
 * Where a connection through a cell's ceiling (up) or floor (down) should lead: the cell in
 * the same column whose floor meets this ceiling (or whose ceiling meets this floor), or a
 * new one positioned to meet it, which also handles tall and sunken cells.
 */
export function verticalTarget(doc: MapDoc, pos: GridPos, dir: "up" | "down"): VerticalTarget {
  const spl = doc.stepsPerLevel;
  const c = doc.cells[cellKey(pos)];
  if (!c) throw new Error(`no cell at ${cellKey(pos)}`);
  const h = absHeights(doc, c);
  const column = Object.values(doc.cells).filter((o) => o.pos.x === pos.x && o.pos.y === pos.y && o.pos.z !== pos.z);
  if (dir === "up") {
    const hit = column.find((o) => absHeights(doc, o).floor === h.ceiling);
    if (hit) return { z: hit.pos.z, exists: true };
    const z = Math.max(pos.z + 1, Math.floor(h.ceiling / spl));
    const floor = h.ceiling - z * spl;
    return { z, exists: false, create: floor === 0 ? {} : { floor } };
  }
  const hit = column.find((o) => absHeights(doc, o).ceiling === h.floor);
  if (hit) return { z: hit.pos.z, exists: true };
  const z = Math.min(pos.z - 1, Math.ceil(h.floor / spl) - 1);
  const ceiling = h.floor - z * spl;
  return { z, exists: false, create: ceiling === spl ? {} : { ceiling } };
}

/**
 * Connect a cell up through its ceiling or down through its floor with a vertical
 * connection type (`null` removes it). Replaces any existing connection on that side.
 * With `createMissing`, the cell on the other side is created when there isn't one.
 */
export function connectVertical(
  doc: MapDoc,
  pos: GridPos,
  dir: "up" | "down",
  type: string | null,
  opts: { createMissing?: boolean; state?: string } = {},
): Command {
  const existing = verticalEdgesOf(doc, pos, dir);
  if (type === null) {
    return cmd("Remove vertical connection", (d) => { for (const k of existing) delete d.edges[k]; });
  }
  const t = verticalTarget(doc, pos, dir);
  return cmd("Set vertical connection", (d) => {
    const prev = existing.map((k) => d.edges[k]).find(Boolean);
    for (const k of existing) delete d.edges[k];
    if (!t.exists && opts.createMissing) {
      const p = { x: pos.x, y: pos.y, z: t.z };
      d.cells[cellKey(p)] ??= { ...structuredClone(t.create ?? {}), pos: p };
      ensureLevel(d, t.z);
    }
    const e = canonicalEdge(pos, dir, t.z);
    const ct = d.connectionTypes[type];
    const state = opts.state ?? (prev?.type === type ? prev.state : (ct?.initialState ?? "open"));
    const edge: Edge = { ...e, type, state };
    if (prev?.id) edge.id = prev.id;
    if (prev?.onUse !== undefined) edge.onUse = prev.onUse;
    if (prev?.onBump !== undefined) edge.onBump = prev.onBump;
    d.edges[edgeKey(e)] = edge;
  });
}

/**
 * Rename a state of a connection or prop type: updates the type (states, initial state,
 * transitions) and every edge/prop of that type currently in that state. Event actions
 * and conditions that name the state are left for validation to report.
 */
export function renameState(kind: "connectionType" | "propType", typeId: string, from: string, to: string): Command {
  return cmd("Rename state", (d) => {
    if (from === to) return;
    if (kind === "connectionType") {
      const t = d.connectionTypes[typeId];
      if (!t || !(from in t.states) || to in t.states) return;
      const states: typeof t.states = {};
      for (const [k, v] of Object.entries(t.states)) states[k === from ? to : k] = v;
      for (const s of Object.values(states)) if (s.transitions) s.transitions = s.transitions.map((x) => (x === from ? to : x));
      t.states = states;
      if (t.initialState === from) t.initialState = to;
      for (const e of Object.values(d.edges)) if (e.type === typeId && e.state === from) e.state = to;
    } else {
      const t = d.propTypes[typeId];
      if (!t || !t.states.includes(from) || t.states.includes(to)) return;
      t.states = t.states.map((s) => (s === from ? to : s));
      if (t.initialState === from) t.initialState = to;
      for (const p of Object.values(d.props)) if (p.type === typeId && p.state === from) p.state = to;
    }
  });
}

/** How many edges/props use a type, for delete warnings. */
export function typeUsage(doc: MapDoc, kind: "connectionType" | "propType" | "customType", id: string): number {
  if (kind === "connectionType") return Object.values(doc.edges).filter((e) => e.type === id).length;
  if (kind === "propType") return Object.values(doc.props).filter((p) => p.type === id).length;
  let n = 0;
  walkRefs(doc, (r) => { if (r.kind === "customType" && "id" in r && r.id === id) n++; });
  return n;
}

// ---------- helpers ----------

/** Positions of all cells on one level. */
export function cellsOnLevel(doc: MapDoc, z: number): GridPos[] {
  return Object.keys(doc.cells).map(parseCellKey).filter((p) => p.z === z);
}

export function propsAt(doc: MapDoc, pos: GridPos): Prop[] {
  return Object.values(doc.props).filter((p) => samePos(p.cell, pos));
}
