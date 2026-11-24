/**
 * ResolvedMap: a normalized, read-only view of a MapDoc for exporters, renderers and the
 * playtest (SPEC §7). Defaults are filled in, arrays are sorted deterministically, absolute
 * heights and risers are derived, and lookup indexes are attached.
 */
import {
  canonicalEdge, cellKey, comparePos, edgeKey, edgeTo, OPPOSITE, SIDES,
  type CanonicalDir, type CellKey, type Direction, type EdgeKey, type Facing, type GridPos, type Side,
} from "./geometry";
import type { MapDoc } from "./model";
import type {
  CellShape, ConnectionType, CustomType, EventRef, FlagDef, Level, MapEvent, Material, ParamValue, Prop, PropType, Start,
} from "./schema";

export interface ResolvedCell {
  key: CellKey;
  pos: GridPos;
  floor: number;
  ceiling: number;
  /** Absolute heights in steps: z * stepsPerLevel + floor/ceiling. */
  abs: { floor: number; ceiling: number };
  shape: CellShape;
  surfaces: Record<Side, string>;
  onEnter?: EventRef;
  onExit?: EventRef;
  tags?: string[];
  data?: Record<string, unknown>;
}

export interface ResolvedEdge {
  key: EdgeKey;
  id?: string;
  from: GridPos;
  to: GridPos;
  dir: CanonicalDir;
  vertical: boolean;
  type: string;
  state: string;
  onUse?: EventRef;
  onBump?: EventRef;
  params?: Record<string, ParamValue>;
  tags?: string[];
  data?: Record<string, unknown>;
}

/**
 * A vertical strip between two horizontally connected cells whose floors (or ceilings)
 * meet at different heights. `facing` is the direction the visible face points.
 */
export interface Riser {
  between: [GridPos, GridPos];
  kind: "floor" | "ceiling";
  from: number;
  to: number;
  material: string;
  facing: Facing;
}

export interface ResolvedMap {
  id: string;
  name: string;
  cellSize: number;
  stepsPerLevel: number;
  stepHeight: number;
  start: Start | null;
  rules: { maxStep: number };
  defaults: { wall: string; floor: string; ceiling: string };
  onLoad?: EventRef;
  bounds: { min: GridPos; max: GridPos } | null;
  levels: Level[];
  cells: ResolvedCell[];
  edges: ResolvedEdge[];
  risers: Riser[];
  props: Prop[];
  materials: Record<string, Material>;
  connectionTypes: Record<string, ConnectionType>;
  propTypes: Record<string, PropType>;
  customTypes: Record<string, CustomType>;
  events: Record<string, MapEvent>;
  flags: Record<string, FlagDef>;
  tags?: string[];
  data?: Record<string, unknown>;

  cellAt(pos: GridPos): ResolvedCell | undefined;
  edgeAt(cell: GridPos, dir: Direction, toZ?: number): ResolvedEdge | undefined;
  edgeById(id: string): ResolvedEdge | undefined;
  propById(id: string): Prop | undefined;
  /** Every edge touching a cell, with the direction it leaves that cell. */
  edgesOf(pos: GridPos): { edge: ResolvedEdge; dir: Direction }[];
}

/** Absolute floor height where a cell meets the boundary on `side`, or null along a ramp's slope. */
export function floorAtSide(c: Pick<ResolvedCell, "abs" | "shape">, side: Facing): number | null {
  if (c.shape.kind === "flat") return c.abs.floor;
  if (side === c.shape.toward) return c.abs.floor + c.shape.rise;
  if (side === OPPOSITE[c.shape.toward]) return c.abs.floor;
  return null;
}

const sortKeys = <T>(r: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]!]));

export function resolve(doc: MapDoc): ResolvedMap {
  const spl = doc.stepsPerLevel;

  const cells: ResolvedCell[] = Object.values(doc.cells)
    .map((c) => {
      const floor = c.floor ?? 0;
      const ceiling = c.ceiling ?? spl;
      const surfaces = {} as Record<Side, string>;
      for (const s of SIDES) {
        surfaces[s] = c.surfaces?.[s] ?? (s === "up" ? doc.defaults.ceiling : s === "down" ? doc.defaults.floor : doc.defaults.wall);
      }
      const rc: ResolvedCell = {
        key: cellKey(c.pos),
        pos: { ...c.pos },
        floor,
        ceiling,
        abs: { floor: c.pos.z * spl + floor, ceiling: c.pos.z * spl + ceiling },
        shape: c.shape ?? { kind: "flat" },
        surfaces,
      };
      if (c.onEnter !== undefined) rc.onEnter = c.onEnter;
      if (c.onExit !== undefined) rc.onExit = c.onExit;
      if (c.tags) rc.tags = c.tags;
      if (c.data) rc.data = c.data;
      return rc;
    })
    .sort((a, b) => comparePos(a.pos, b.pos));

  const edges: ResolvedEdge[] = Object.values(doc.edges)
    .map((e) => {
      const re: ResolvedEdge = {
        key: edgeKey(e),
        from: { ...e.from },
        to: edgeTo(e),
        dir: e.dir,
        vertical: e.dir === "up",
        type: e.type,
        state: e.state,
      };
      if (e.id) re.id = e.id;
      if (e.onUse !== undefined) re.onUse = e.onUse;
      if (e.onBump !== undefined) re.onBump = e.onBump;
      if (e.params) re.params = e.params;
      if (e.tags) re.tags = e.tags;
      if (e.data) re.data = e.data;
      return re;
    })
    .sort((a, b) => comparePos(a.from, b.from) || a.dir.localeCompare(b.dir) || a.to.z - b.to.z);

  const cellIdx = new Map(cells.map((c) => [c.key, c]));
  const edgeIdx = new Map(edges.map((e) => [e.key, e]));
  const edgeIdIdx = new Map(edges.flatMap((e) => (e.id ? [[e.id, e] as const] : [])));
  const props = Object.values(doc.props).sort((a, b) => a.id.localeCompare(b.id));
  const propIdx = new Map(props.map((p) => [p.id, p]));
  const byCell = new Map<CellKey, { edge: ResolvedEdge; dir: Direction }[]>();
  for (const e of edges) {
    const push = (p: GridPos, dir: Direction) => {
      const k = cellKey(p);
      (byCell.get(k) ?? byCell.set(k, []).get(k)!).push({ edge: e, dir });
    };
    push(e.from, e.dir);
    push(e.to, OPPOSITE[e.dir]);
  }

  const risers: Riser[] = [];
  for (const e of edges) {
    if (e.vertical) continue;
    const a = cellIdx.get(cellKey(e.from));
    const b = cellIdx.get(cellKey(e.to));
    if (!a || !b) continue;
    const sa = e.dir as Facing;
    const sb = OPPOSITE[sa] as Facing;
    const fa = floorAtSide(a, sa);
    const fb = floorAtSide(b, sb);
    if (fa !== null && fb !== null && fa !== fb) {
      const [hi, side] = fa > fb ? [a, sa] : [b, sb];
      risers.push({
        between: [a.pos, b.pos], kind: "floor",
        from: Math.min(fa, fb), to: Math.max(fa, fb),
        material: hi.surfaces[side], facing: side,
      });
    }
    const ca = a.abs.ceiling;
    const cb = b.abs.ceiling;
    if (ca !== cb) {
      const [low, side] = ca < cb ? [a, sa] : [b, sb];
      risers.push({
        between: [a.pos, b.pos], kind: "ceiling",
        from: Math.min(ca, cb), to: Math.max(ca, cb),
        material: low.surfaces[side], facing: side,
      });
    }
  }

  let bounds: ResolvedMap["bounds"] = null;
  if (cells.length) {
    const xs = cells.map((c) => c.pos.x), ys = cells.map((c) => c.pos.y), zs = cells.map((c) => c.pos.z);
    bounds = {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    };
  }

  const r: ResolvedMap = {
    id: doc.id,
    name: doc.name,
    cellSize: doc.cellSize,
    stepsPerLevel: spl,
    stepHeight: doc.stepHeight,
    start: doc.start,
    rules: doc.rules,
    defaults: doc.defaults,
    bounds,
    levels: [...doc.levels].sort((a, b) => a.z - b.z),
    cells,
    edges,
    risers,
    props,
    materials: sortKeys(doc.materials),
    connectionTypes: sortKeys(doc.connectionTypes),
    propTypes: sortKeys(doc.propTypes),
    customTypes: sortKeys(doc.customTypes),
    events: sortKeys(doc.events),
    flags: sortKeys(doc.flags),
    cellAt: (p) => cellIdx.get(cellKey(p)),
    edgeAt: (c, d, toZ) => edgeIdx.get(edgeKey(canonicalEdge(c, d, toZ))),
    edgeById: (id) => edgeIdIdx.get(id),
    propById: (id) => propIdx.get(id),
    edgesOf: (p) => byCell.get(cellKey(p)) ?? [],
  };
  if (doc.onLoad !== undefined) r.onLoad = doc.onLoad;
  if (doc.tags) r.tags = doc.tags;
  if (doc.data) r.data = doc.data;
  return r;
}
