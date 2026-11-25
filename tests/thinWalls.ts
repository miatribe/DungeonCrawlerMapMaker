/** Finds thin walls: two cells side by side (on any levels) whose spaces overlap, with no opening between them. */
import { resolve, type MapDoc } from "../src/core";

const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

export function thinWalls(doc: MapDoc, allow: string[] = ["opening", "door", "gate"]): string[] {
  const r = resolve(doc);
  const out = new Set<string>();
  for (const c of r.cells) {
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      for (const n of r.cells) {
        if (n.pos.x !== c.pos.x + dx || n.pos.y !== c.pos.y + dy) continue;
        if (Math.min(c.abs.ceiling, n.abs.ceiling) <= Math.max(c.abs.floor, n.abs.floor)) continue;
        const e = r.edgeAt(c.pos, dir as keyof typeof DIRS, n.pos.z);
        const kind = e && doc.connectionTypes[e.type]?.kind;
        if (kind && allow.includes(kind)) continue;
        const [a, b] = [c.key, n.key].sort();
        out.add(`${a} | ${b}${kind ? ` (${kind})` : ""}`);
      }
    }
  }
  return [...out].sort();
}
