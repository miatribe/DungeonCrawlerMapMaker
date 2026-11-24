/**
 * Grid geometry: directions, keys and canonical edge form.
 *
 * Coordinates: x east, y south, z up (one level per z). North = -y.
 * Every edge is stored from its west / north / lower cell, using dir east | south | up.
 */

export type Facing = "north" | "east" | "south" | "west";
export type VerticalDir = "up" | "down";
export type Direction = Facing | VerticalDir;
export type Side = Direction; // a cell face
export type CanonicalDir = "east" | "south" | "up";

export interface GridPos {
  x: number;
  y: number;
  z: number;
}

export const FACINGS: readonly Facing[] = ["north", "east", "south", "west"];
export const SIDES: readonly Side[] = ["north", "east", "south", "west", "up", "down"];
export const CANONICAL_DIRS: readonly CanonicalDir[] = ["east", "south", "up"];

export const OPPOSITE: Record<Direction, Direction> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

export const DELTA: Record<Direction, GridPos> = {
  north: { x: 0, y: -1, z: 0 },
  south: { x: 0, y: 1, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  down: { x: 0, y: 0, z: -1 },
};

export const BOUNDS = { minXY: 0, maxXY: 255, minZ: -16, maxZ: 15 } as const;

export function isHorizontal(d: Direction): d is Facing {
  return d !== "up" && d !== "down";
}

export function inBounds(p: GridPos): boolean {
  return (
    Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z) &&
    p.x >= BOUNDS.minXY && p.x <= BOUNDS.maxXY &&
    p.y >= BOUNDS.minXY && p.y <= BOUNDS.maxXY &&
    p.z >= BOUNDS.minZ && p.z <= BOUNDS.maxZ
  );
}

export type CellKey = string;
export type EdgeKey = string;

export function cellKey(p: GridPos): CellKey {
  return `${p.x},${p.y},${p.z}`;
}

export function parseCellKey(k: CellKey): GridPos {
  const [x, y, z] = k.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function comparePos(a: GridPos, b: GridPos): number {
  return a.z - b.z || a.y - b.y || a.x - b.x;
}

export function add(p: GridPos, d: GridPos): GridPos {
  return { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
}

/** Default z of the cell on the far side of an edge leaving `from` in `dir`. */
export function defaultToZ(from: GridPos, dir: Direction): number {
  return from.z + DELTA[dir].z;
}

/**
 * An edge position in canonical form. `toZ` is the z of the far cell. It defaults to
 * `from.z` for horizontal edges and `from.z + 1` for `up`. A horizontal edge with a
 * different toZ joins cells on different levels (e.g. the top of a stair that rises a full
 * level). An `up` edge with toZ > z+1 spans a tall cell.
 */
export interface EdgePos {
  from: GridPos;
  dir: CanonicalDir;
  toZ?: number;
}

/**
 * Normalize any (cell, direction, far-z) triple to canonical form.
 * Throws for a vertical edge whose far cell isn't strictly above/below.
 */
export function canonicalEdge(from: GridPos, dir: Direction, toZ?: number): EdgePos {
  const farZ = toZ ?? defaultToZ(from, dir);
  let out: EdgePos;
  switch (dir) {
    case "east":
    case "south":
      out = { from: { ...from }, dir, toZ: farZ };
      break;
    case "west":
      out = { from: { x: from.x - 1, y: from.y, z: farZ }, dir: "east", toZ: from.z };
      break;
    case "north":
      out = { from: { x: from.x, y: from.y - 1, z: farZ }, dir: "south", toZ: from.z };
      break;
    case "up":
      if (farZ <= from.z) throw new Error(`up edge must go to a higher z (got ${from.z}→${farZ})`);
      out = { from: { ...from }, dir: "up", toZ: farZ };
      break;
    case "down":
      if (farZ >= from.z) throw new Error(`down edge must go to a lower z (got ${from.z}→${farZ})`);
      out = { from: { x: from.x, y: from.y, z: farZ }, dir: "up", toZ: from.z };
      break;
  }
  if (out.toZ === defaultToZ(out.from, out.dir)) delete out.toZ;
  return out;
}

export function edgeKey(e: EdgePos): EdgeKey {
  const base = `${e.from.x},${e.from.y},${e.from.z}:${e.dir}`;
  return e.toZ === undefined ? base : `${base}>${e.toZ}`;
}

export function edgeKeyOf(from: GridPos, dir: Direction, toZ?: number): EdgeKey {
  return edgeKey(canonicalEdge(from, dir, toZ));
}

/** The far cell position of a canonical edge. */
export function edgeTo(e: EdgePos): GridPos {
  const d = DELTA[e.dir];
  return { x: e.from.x + d.x, y: e.from.y + d.y, z: e.toZ ?? defaultToZ(e.from, e.dir) };
}

/** Both cell positions an edge joins: [canonical from, far]. */
export function edgeEnds(e: EdgePos): [GridPos, GridPos] {
  return [e.from, edgeTo(e)];
}

export function rectPositions(a: GridPos, b: GridPos): GridPos[] {
  const out: GridPos[] = [];
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) out.push({ x, y, z });
  return out;
}
