import { describe, expect, it } from "vitest";
import { createMap, resolve, run } from "../src/core";
import * as ops from "../src/core/ops";
import { buildMesh, triangleCount, type Buffers } from "../src/render/mesh/buildMesh";
import { crypt, threeRooms, tower } from "./fixtures/maps";

const P = (x: number, y: number, z = 0) => ({ x, y, z });

/** Triangles of a buffer as [normal, centroid] pairs, for checking orientation. */
function tris(b: Buffers) {
  const out: { n: number[]; c: number[] }[] = [];
  for (let i = 0; i < b.positions.length; i += 9) {
    const p = b.positions.slice(i, i + 9);
    out.push({ n: b.normals.slice(i, i + 3), c: [(p[0]! + p[3]! + p[6]!) / 3, (p[1]! + p[4]! + p[7]!) / 3, (p[2]! + p[5]! + p[8]!) / 3] });
  }
  return out;
}

describe("buildMesh", () => {
  it("a lone cell is a closed box facing inward", () => {
    const doc = run(createMap(), ops.paintCells([P(2, 3)]));
    const m = buildMesh(resolve(doc));
    expect(triangleCount(m)).toBe(12);
    const floor = tris(m.groups.get("flagstone")!);
    expect(floor.every((t) => t.n[1] === 1 && t.c[1] === 0)).toBe(true);
    const ceil = tris(m.groups.get("ceiling")!);
    expect(ceil.every((t) => t.n[1] === -1 && t.c[1] === 1)).toBe(true);
    // every wall faces the cell center (2.5, *, 3.5)
    for (const t of tris(m.groups.get("stone")!)) {
      const toCenter = [2.5 - t.c[0]!, 0, 3.5 - t.c[2]!];
      expect(t.n[0]! * toCenter[0]! + t.n[2]! * toCenter[2]!).toBeGreaterThan(0);
    }
  });

  it("openings remove walls between cells; doors become dynamic parts", () => {
    const m = buildMesh(resolve(threeRooms()));
    const kinds = m.edges.map((e) => `${e.kind}:${e.ctKind}`).sort();
    expect(kinds).toEqual(["hedge:door", "hedge:gate"]);
    const gate = m.edges.find((e) => e.key === "3,2,0:east")!;
    expect(gate).toMatchObject({ kind: "hedge", a: [4, 2], b: [4, 3], y0: 0, y1: 1, plane: "x", material: "iron" });
    expect(m.props.map((p) => p.id)).toEqual(["chest", "lever1", "lever2"]);
  });

  it("builds stairs, cross-level landings, pits and risers for the tower", () => {
    const m = buildMesh(resolve(tower()));
    const pit = m.edges.find((e) => e.kind === "vedge");
    expect(pit).toMatchObject({ ctKind: "pit", x: 4, z: 2, y: 1 });
    // pit: no ceiling over the cellar and no floor in the upper cell above it
    const floors = tris(m.groups.get("wood")!).filter((t) => t.n[1] === 1);
    expect(floors.some((t) => t.c[0]! > 4 && t.c[0]! < 5 && t.c[2]! > 2 && t.c[2]! < 3)).toBe(false);
    // the sunken nook makes three risers of stone facing out of it, between y -0.25 and 0
    const stone = tris(m.groups.get("stone")!).filter((t) => t.c[1]! > -0.25 && t.c[1]! < 0 && t.n[1] === 0);
    expect(stone.length).toBeGreaterThanOrEqual(6);
    // stairs reach the upper floor height (4 steps = 1 unit)
    const treads = tris(m.groups.get("flagstone")!).filter((t) => t.c[0]! > 3 && t.c[0]! < 4 && t.n[1] === 1);
    expect(Math.max(...treads.map((t) => t.c[1]!))).toBeCloseTo(1);
  });

  it("cutaway skips cells and applies surface overrides", () => {
    const r = resolve(tower());
    const all = buildMesh(r);
    const low = buildMesh(r, { includeCell: (c) => c.pos.z <= 0 });
    expect(triangleCount(low)).toBeLessThan(triangleCount(all));
    expect(low.groups.get("wood")).toBeUndefined();
    const over = buildMesh(resolve(threeRooms()), { surface: (p, s) => (p.x === 1 && p.y === 1 && s === "north" ? "water" : undefined) });
    expect(triangleCount({ ...over, groups: new Map([["water", over.groups.get("water")!]]) })).toBe(2);
  });

  it("leans ladders on a real wall of their lower cell", () => {
    const m = buildMesh(resolve(crypt()));
    const ladder = m.edges.find((e) => e.kind === "vedge" && e.ctKind === "ladder");
    // the Crypt's ladder cell (3,8,-1) is open to the north and west; east is solid
    expect(ladder).toMatchObject({ x: 3, z: 8, side: "east" });
  });

  it("puts wall-mounted props against their wall", () => {
    let doc = threeRooms();
    doc = run(doc, ops.updateProp("lever1", { side: "east" }));
    const lever = buildMesh(resolve(doc)).props.find((p) => p.id === "lever1")!;
    expect(lever.mount).toBe("east");
    expect(lever.pos[0]).toBeCloseTo(3.96);
    expect(lever.pos[1]).toBeGreaterThan(0.3);
  });
});
