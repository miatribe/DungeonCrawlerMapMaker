/**
 * Turns a ResolvedMap into renderer-independent geometry (SPEC §9.3): static faces grouped
 * by material, plus "dynamic" parts (doors, gates, hatches, props) whose look depends on
 * runtime state. World space: X = grid x (east), Z = grid y (south), Y = up. One cell is 1
 * unit; one step is `stepHeight / cellSize` units.
 */
import { DELTA, OPPOSITE, type Facing, type GridPos, type Side } from "../../core/geometry";
import { floorAtSide, type ResolvedCell, type ResolvedEdge, type ResolvedMap } from "../../core/resolve";
import { ladderSide } from "../../core/logic/runtime";

export type Vec3 = [number, number, number];

export interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
}

export interface HEdgePart {
  kind: "hedge";
  key: string;
  type: string;
  ctKind: string;
  material: string;
  /** Boundary segment endpoints in world X/Z. */
  a: [number, number];
  b: [number, number];
  /** Opening span in world Y. */
  y0: number;
  y1: number;
  /** "x" when the boundary is a line of constant X (east/west sides). */
  plane: "x" | "z";
}

export interface VEdgePart {
  kind: "vedge";
  key: string;
  type: string;
  ctKind: string;
  material: string;
  /** Cell's minimum corner in world X/Z. */
  x: number;
  z: number;
  /** Height of the floor/ceiling boundary. */
  y: number;
  /** Height of the lower cell's floor (for ladders). */
  yLow: number;
  /** Ladders: the lower cell's wall it leans on (null = free-standing in the middle). */
  side: Facing | null;
}

export interface PropPart {
  id: string;
  type: string;
  icon: string;
  color: string;
  /** World position of the prop's base. */
  pos: Vec3;
  /** Wall it hangs on (pointing from the cell center toward that wall), or floor/ceiling. */
  mount: Side | "floor";
}

export interface MeshData {
  /** Static faces by material id. */
  groups: Map<string, Buffers>;
  edges: (HEdgePart | VEdgePart)[];
  props: PropPart[];
  /** World units per step. */
  unitY: number;
}

export interface BuildOptions {
  /** Only cells for which this returns true are built (e.g. cutaway above a level). */
  includeCell?: (c: ResolvedCell) => boolean;
  /** Runtime material overrides (setSurface). */
  surface?: (pos: GridPos, side: Side) => string | undefined;
}

const NORMAL: Record<Side, Vec3> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): Vec3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** Append a polygon (triangle fan), wound so it faces `facing`. */
function poly(buf: Buffers, pts: Vec3[], uvs: [number, number][], facing: Vec3) {
  let n = norm(cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!)));
  let order = pts.map((_, i) => i);
  if (dot(n, facing) < 0) { order = order.reverse(); n = [-n[0], -n[1], -n[2]]; }
  for (let i = 1; i + 1 < order.length; i++) {
    for (const j of [order[0]!, order[i]!, order[i + 1]!]) {
      buf.positions.push(...pts[j]!);
      buf.normals.push(...n);
      buf.uvs.push(...uvs[j]!);
    }
  }
}

/** Fraction along a cell (0..1 at the corner) in the uphill direction of a ramp. */
function along(toward: Facing, cx: number, cz: number): number {
  switch (toward) {
    case "east": return cx;
    case "west": return 1 - cx;
    case "south": return cz;
    case "north": return 1 - cz;
  }
}

/** The two horizontal sides perpendicular to a direction. */
function lateral(toward: Facing): [Facing, Facing] {
  return toward === "east" || toward === "west" ? ["north", "south"] : ["west", "east"];
}

export function buildMesh(map: ResolvedMap, opts: BuildOptions = {}): MeshData {
  const unitY = map.stepHeight / map.cellSize;
  const groups = new Map<string, Buffers>();
  const buf = (mat: string) => groups.get(mat) ?? groups.set(mat, { positions: [], normals: [], uvs: [] }).get(mat)!;
  const include = opts.includeCell ?? (() => true);
  const mat = (c: ResolvedCell, side: Side) => opts.surface?.(c.pos, side) ?? c.surfaces[side];
  const Y = (steps: number) => steps * unitY;
  const cells = map.cells.filter(include);
  const included = new Set(cells.map((c) => c.key));

  const edgeOn = (c: ResolvedCell, d: Side) => map.edgesOf(c.pos).find((e) => e.dir === d)?.edge;

  for (const c of cells) {
    const x = c.pos.x, z = c.pos.y;
    const f = c.abs.floor, top = c.abs.ceiling;

    // ---- floor ----
    if (!edgeOn(c, "down")) {
      const b = buf(mat(c, "down"));
      if (c.shape.kind === "flat") {
        poly(b, [[x, Y(f), z], [x + 1, Y(f), z], [x + 1, Y(f), z + 1], [x, Y(f), z + 1]], [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], [0, 1, 0]);
      } else if (c.shape.kind === "ramp") {
        const { rise, toward } = c.shape;
        const h = (cx: number, cz: number) => Y(f + rise * along(toward, cx, cz));
        poly(b, [[x, h(0, 0), z], [x + 1, h(1, 0), z], [x + 1, h(1, 1), z + 1], [x, h(0, 1), z + 1]], [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], [0, 1, 0]);
      } else {
        // stairs: treads and risers along the uphill direction
        const { rise, toward, treads } = c.shape;
        const d = DELTA[toward];
        for (let i = 0; i < treads; i++) {
          const t0 = i / treads, t1 = (i + 1) / treads;
          const hT = Y(f + (rise * (i + 1)) / treads), hB = Y(f + (rise * i) / treads);
          // strip [t0,t1] along `toward`, full width across
          const pt = (t: number, s: number, y: number): Vec3 => {
            // t along toward from the low edge, s across (0..1)
            if (toward === "east") return [x + t, y, z + s];
            if (toward === "west") return [x + 1 - t, y, z + s];
            if (toward === "south") return [x + s, y, z + t];
            return [x + s, y, z + 1 - t];
          };
          poly(b, [pt(t0, 0, hT), pt(t1, 0, hT), pt(t1, 1, hT), pt(t0, 1, hT)], [[0, t0], [0, t1], [1, t1], [1, t0]], [0, 1, 0]);
          poly(b, [pt(t0, 0, hB), pt(t0, 1, hB), pt(t0, 1, hT), pt(t0, 0, hT)], [[0, hB], [1, hB], [1, hT], [0, hT]], [-d.x, 0, -d.y]);
        }
      }
      // side profiles of ramps/stairs, facing out through the lateral sides
      if (c.shape.kind !== "flat") {
        const { rise, toward } = c.shape;
        const n = c.shape.kind === "stairs" ? c.shape.treads : 0;
        for (const side of lateral(toward)) {
          const sb = buf(mat(c, side));
          const fixed = side === "north" ? z : side === "south" ? z + 1 : side === "west" ? x : x + 1;
          const at = (t: number, y: number): Vec3 => {
            const u = toward === "east" ? t : toward === "west" ? 1 - t : toward === "south" ? t : 1 - t;
            return side === "north" || side === "south" ? [x + u, y, fixed] : [fixed, y, z + u];
          };
          if (n === 0) poly(sb, [at(0, Y(f)), at(1, Y(f)), at(1, Y(f + rise))], [[0, 0], [1, 0], [1, Y(rise)]], NORMAL[side]);
          else for (let i = 0; i < n; i++) {
            const t0 = i / n, t1 = (i + 1) / n, h = Y(f + (rise * (i + 1)) / n);
            poly(sb, [at(t0, Y(f)), at(t1, Y(f)), at(t1, h), at(t0, h)], [[t0, Y(f)], [t1, Y(f)], [t1, h], [t0, h]], NORMAL[side]);
          }
        }
      }
    }

    // ---- ceiling ----
    if (!edgeOn(c, "up")) {
      poly(buf(mat(c, "up")), [[x, Y(top), z], [x + 1, Y(top), z], [x + 1, Y(top), z + 1], [x, Y(top), z + 1]], [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], [0, -1, 0]);
    }

    // ---- walls: sides with no connection, or whose far side has no cell ----
    for (const side of ["north", "east", "south", "west"] as Facing[]) {
      const e = edgeOn(c, side);
      if (e && map.cellAt(otherEnd(e, c.pos))) continue;
      const [a, b2] = segment(side, x, z);
      const inward = NORMAL[OPPOSITE[side]];
      poly(buf(mat(c, side)), [[a[0], Y(f), a[1]], [b2[0], Y(f), b2[1]], [b2[0], Y(top), b2[1]], [a[0], Y(top), a[1]]], [[0, Y(f)], [1, Y(f)], [1, Y(top)], [0, Y(top)]], inward);
    }
  }

  // ---- risers between connected cells at different heights ----
  for (const r of map.risers) {
    const [p, q] = r.between;
    if (!included.has(`${p.x},${p.y},${p.z}`) && !included.has(`${q.x},${q.y},${q.z}`)) continue;
    let a: [number, number], b2: [number, number];
    if (p.x !== q.x) { const bx = Math.max(p.x, q.x); a = [bx, p.y]; b2 = [bx, p.y + 1]; }
    else { const bz = Math.max(p.y, q.y); a = [p.x, bz]; b2 = [p.x + 1, bz]; }
    poly(buf(r.material), [[a[0], Y(r.from), a[1]], [b2[0], Y(r.from), b2[1]], [b2[0], Y(r.to), b2[1]], [a[0], Y(r.to), a[1]]], [[0, Y(r.from)], [1, Y(r.from)], [1, Y(r.to)], [0, Y(r.to)]], NORMAL[r.facing]);
  }

  // ---- connections that have a look of their own ----
  const edges: (HEdgePart | VEdgePart)[] = [];
  for (const e of map.edges) {
    const a = map.cellAt(e.from), b = map.cellAt(e.to);
    if (!(a && included.has(a.key)) && !(b && included.has(b.key))) continue;
    const ct = map.connectionTypes[e.type];
    const ctKind = ct?.kind ?? "custom";
    if (ctKind === "opening" && !e.vertical) continue;
    if (e.vertical) {
      if (!a && !b) continue;
      edges.push({
        kind: "vedge", key: e.key, type: e.type, ctKind,
        material: ct?.material ?? a?.surfaces.up ?? b!.surfaces.down,
        x: e.from.x, z: e.from.y,
        y: Y(a ? a.abs.ceiling : b!.abs.floor),
        yLow: Y(a ? a.abs.floor : b!.abs.floor - map.stepsPerLevel),
        side: ctKind === "ladder" && a ? ladderSide(map, a.pos) : null,
      });
      continue;
    }
    const side = e.dir as Facing;
    const here = a ?? b!;
    const hereSide = a ? side : (OPPOSITE[side] as Facing);
    const [s0, s1] = segment(hereSide, here.pos.x, here.pos.y);
    const floors = [a && heightAt(a, side), b && heightAt(b, OPPOSITE[side] as Facing)].filter((v): v is number => v !== undefined);
    const ceils = [a?.abs.ceiling, b?.abs.ceiling].filter((v): v is number => v !== undefined);
    edges.push({
      kind: "hedge", key: e.key, type: e.type, ctKind,
      material: ct?.material ?? here.surfaces[hereSide],
      a: s0, b: s1,
      y0: Y(Math.max(...floors)), y1: Y(Math.min(...ceils)),
      plane: side === "east" || side === "west" ? "x" : "z",
    });
  }

  // ---- props ----
  const props: PropPart[] = [];
  for (const p of map.props) {
    const c = map.cellAt(p.cell);
    if (!c || !included.has(c.key)) continue;
    const pt = map.propTypes[p.type];
    const mount: PropPart["mount"] = p.side && p.side !== "down" ? p.side : "floor";
    let px = p.cell.x + 0.5, pz = p.cell.y + 0.5;
    let py = Y(c.shape.kind === "flat" ? c.abs.floor : c.abs.floor + c.shape.rise / 2);
    if (mount !== "floor" && mount !== "up") {
      const d = DELTA[mount];
      px += d.x * 0.46; pz += d.y * 0.46;
      py = Y(c.abs.floor) + Math.min(0.45 * map.stepsPerLevel, (c.ceiling - c.floor) * 0.45) * unitY;
    }
    if (mount === "up") py = Y(c.abs.ceiling);
    props.push({ id: p.id, type: p.type, icon: pt?.preview?.icon ?? "generic", color: pt?.preview?.color ?? "#e0a050", pos: [px, py, pz], mount });
  }

  return { groups, edges, props, unitY };
}

function otherEnd(e: ResolvedEdge, pos: GridPos): GridPos {
  return e.from.x === pos.x && e.from.y === pos.y && e.from.z === pos.z ? e.to : e.from;
}

function heightAt(c: ResolvedCell, side: Facing): number {
  return floorAtSide(c, side) ?? c.abs.floor + (c.shape.kind === "flat" ? 0 : c.shape.rise / 2);
}

/** A cell side as a world X/Z segment. */
function segment(side: Facing, x: number, z: number): [[number, number], [number, number]] {
  switch (side) {
    case "north": return [[x, z], [x + 1, z]];
    case "south": return [[x + 1, z + 1], [x, z + 1]];
    case "west": return [[x, z + 1], [x, z]];
    case "east": return [[x + 1, z], [x + 1, z + 1]];
  }
}

export function triangleCount(m: MeshData): number {
  let n = 0;
  for (const b of m.groups.values()) n += b.positions.length / 9;
  return n;
}
