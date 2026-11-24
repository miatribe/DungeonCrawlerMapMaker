/** Hit-testing for the 2D view: is the cursor on a cell, or near one of its edges? */
import type { Facing, GridPos } from "../../core/geometry";

export type Hit =
  | { kind: "cell"; pos: GridPos }
  | { kind: "edge"; cell: GridPos; dir: Facing };

/** Fraction of a cell, measured from a boundary, that counts as "on the edge". */
export const EDGE_BAND = 0.22;

export type HitMode = "cell" | "edge" | "auto";

/**
 * - `cell`: always the cell under the cursor.
 * - `edge`: always the nearest edge of the cell under the cursor.
 * - `auto`: the nearest edge when within EDGE_BAND of it, otherwise the cell.
 */
export function hitTest(wx: number, wy: number, z: number, mode: HitMode = "auto"): Hit {
  const cx = Math.floor(wx);
  const cy = Math.floor(wy);
  const fx = wx - cx;
  const fy = wy - cy;
  const pos = { x: cx, y: cy, z };
  if (mode === "cell") return { kind: "cell", pos };
  const d: [Facing, number][] = [
    ["west", fx],
    ["east", 1 - fx],
    ["north", fy],
    ["south", 1 - fy],
  ];
  d.sort((a, b) => a[1] - b[1]);
  const [dir, dist] = d[0]!;
  if (mode === "edge" || dist < EDGE_BAND) return { kind: "edge", cell: pos, dir };
  return { kind: "cell", pos };
}

/** Where a prop is drawn: the cell center, pushed toward the wall it's mounted on. */
export function propPoint(p: { cell: GridPos; side?: string | undefined }): { x: number; y: number } {
  let x = p.cell.x + 0.5, y = p.cell.y + 0.5;
  if (p.side === "north") y -= 0.32;
  if (p.side === "south") y += 0.32;
  if (p.side === "west") x -= 0.32;
  if (p.side === "east") x += 0.32;
  return { x, y };
}

export const PROP_RADIUS = 0.16;

/** The prop under the cursor on level z, if any (nearest wins). */
export function propAt<P extends { id: string; cell: GridPos; side?: string | undefined }>(props: P[], wx: number, wy: number, z: number): P | undefined {
  let best: P | undefined;
  let bestD = PROP_RADIUS + 0.06;
  for (const p of props) {
    if (p.cell.z !== z) continue;
    const pt = propPoint(p);
    const d = Math.hypot(pt.x - wx, pt.y - wy);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** The face of a cell nearest the cursor, or "down" when in the middle of the cell. */
export function hitFace(wx: number, wy: number, z: number): { pos: GridPos; side: Facing | "down" } {
  const h = hitTest(wx, wy, z, "auto");
  return h.kind === "edge" ? { pos: h.cell, side: h.dir } : { pos: h.pos, side: "down" };
}
