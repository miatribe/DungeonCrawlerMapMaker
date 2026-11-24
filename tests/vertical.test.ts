import { describe, expect, it } from "vitest";
import { createMap, edgeKeyOf, rectPositions, run, validate, type MapDoc } from "../src/core";
import * as ops from "../src/core/ops";
import { tower } from "./fixtures/maps";

const P = (x: number, y: number, z = 0) => ({ x, y, z });
const errors = (doc: MapDoc) => validate(doc).filter((p) => p.severity === "error" && p.code !== "V-START");

describe("setHeights", () => {
  it("sets floor/ceiling and drops defaults", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0)]));
    doc = run(doc, ops.setHeights([P(0, 0)], { floor: 2, ceiling: 6 }));
    expect(doc.cells["0,0,0"]).toMatchObject({ floor: 2, ceiling: 6 });
    doc = run(doc, ops.setHeights([P(0, 0)], { floor: 0, ceiling: 4 }));
    expect(doc.cells["0,0,0"]).toEqual({ pos: P(0, 0) });
  });

  it("keepHeight moves the ceiling with the floor", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0)]));
    doc = run(doc, ops.setHeights([P(0, 0)], { floor: -2, keepHeight: true }));
    expect(doc.cells["0,0,0"]).toMatchObject({ floor: -2, ceiling: 2 });
  });
});

describe("buildRamp", () => {
  it("chains cells upward, opens them and raises ceilings", () => {
    const path = [P(0, 0), P(1, 0), P(2, 0)];
    let doc = run(createMap(), ops.paintCells([P(0, 0)]));
    doc = run(doc, ops.buildRamp(path, { kind: "ramp", rise: 1, toward: "east" }));
    expect(path.map((p) => doc.cells[`${p.x},0,0`]!.floor ?? 0)).toEqual([0, 1, 2]);
    expect(doc.cells["2,0,0"]!.shape).toEqual({ kind: "ramp", rise: 1, toward: "east" });
    // top of the last cell is 3, below the default ceiling of 4: untouched
    expect(doc.cells["2,0,0"]!.ceiling).toBeUndefined();
    expect(doc.edges[edgeKeyOf(P(0, 0), "east")]?.type).toBe("opening");
    expect(doc.edges[edgeKeyOf(P(1, 0), "east")]?.type).toBe("opening");
    expect(errors(doc)).toEqual([]);
  });

  it("raises a ceiling the top would hit", () => {
    const doc = run(createMap(), ops.buildRamp([P(0, 0), P(1, 0)], { kind: "stairs", rise: 2, toward: "east", treads: 3 }));
    // second cell: floor 2, top 4 = default ceiling -> raised to 4 + headroom(4)=2 -> 6
    expect(doc.cells["1,0,0"]).toMatchObject({ floor: 2, ceiling: 6, shape: { kind: "stairs", rise: 2, toward: "east", treads: 3 } });
    expect(errors(doc)).toEqual([]);
  });

  it("flattenCells removes the shape but keeps the floor", () => {
    let doc = run(createMap(), ops.buildRamp([P(0, 0), P(1, 0)], { kind: "ramp", rise: 1, toward: "east" }));
    doc = run(doc, ops.flattenCells([P(1, 0)]));
    expect(doc.cells["1,0,0"]).toEqual({ pos: P(1, 0), floor: 1 });
  });
});

describe("buildLevelStairs", () => {
  it("reproduces the tower's staircase in one operation", () => {
    let doc = createMap({ id: "tower", name: "Tower" });
    doc = run(
      doc,
      ops.paintCells(rectPositions(P(0, 0), P(2, 2)).concat([P(3, 1)])),
      ops.adjustHeights([P(0, 1)], { floor: -1 }),
      ops.paintCells(rectPositions(P(4, 0, 1), P(5, 2, 1))),
    );
    doc = run(doc, ops.buildLevelStairs(doc, P(3, 1), "east"));
    const t = tower();
    expect(doc.cells["3,1,0"]).toEqual(t.cells["3,1,0"]);
    expect(doc.edges["3,1,0:east>1"]).toEqual(t.edges["3,1,0:east>1"]);
    expect(doc.edges[edgeKeyOf(P(3, 1), "east")]).toBeUndefined();
  });

  it("creates the upper cell when missing and matches a raised landing", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0)]));
    doc = run(doc, ops.buildLevelStairs(doc, P(0, 0), "south"));
    expect(doc.cells["0,1,1"]).toEqual({ pos: P(0, 1, 1) });
    expect(doc.cells["0,0,0"]!.shape).toMatchObject({ kind: "stairs", rise: 4, toward: "south" });
    expect(doc.cells["0,0,0"]!.ceiling).toBe(8);
    expect(errors(doc)).toEqual([]);

    let raised = run(createMap(), ops.paintCells([P(0, 0)]), ops.paintCells([P(1, 0, 1)]), ops.setHeights([P(1, 0, 1)], { floor: 1, ceiling: 5 }));
    raised = run(raised, ops.buildLevelStairs(raised, P(0, 0), "east"));
    expect(raised.cells["0,0,0"]).toMatchObject({ ceiling: 9, shape: { rise: 5 } });
  });

  it("refuses when the target isn't higher", () => {
    const doc = run(createMap(), ops.paintCells([P(0, 0), P(1, 0, 1)]), ops.setHeights([P(1, 0, 1)], { floor: -4, ceiling: 0 }));
    expect(() => ops.buildLevelStairs(doc, P(0, 0), "east")).toThrow(/not higher/);
  });
});

describe("vertical connections", () => {
  it("connects to the cell whose floor meets the ceiling", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(0, 0, 1)], { autoOpen: false }));
    expect(ops.verticalTarget(doc, P(0, 0), "up")).toEqual({ z: 1, exists: true });
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "up", "hatch"));
    expect(doc.edges["0,0,0:up"]).toMatchObject({ type: "hatch", state: "closed" });
    // same boundary from above
    expect(ops.verticalEdgesOf(doc, P(0, 0, 1), "down")).toEqual(["0,0,0:up"]);
    doc = run(doc, ops.connectVertical(doc, P(0, 0, 1), "down", null));
    expect(doc.edges["0,0,0:up"]).toBeUndefined();
  });

  it("creates a missing cell positioned to meet tall and sunken cells", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0)]), ops.setHeights([P(0, 0)], { floor: -1, ceiling: 7 }));
    // ceiling at 7 -> new cell on level 1 with floor 3
    expect(ops.verticalTarget(doc, P(0, 0), "up")).toEqual({ z: 1, exists: false, create: { floor: 3 } });
    // floor at -1 -> new cell on level -1 with ceiling 3
    expect(ops.verticalTarget(doc, P(0, 0), "down")).toEqual({ z: -1, exists: false, create: { ceiling: 3 } });
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "down", "pit", { createMissing: true }));
    expect(doc.cells["0,0,-1"]).toEqual({ pos: P(0, 0, -1), ceiling: 3 });
    expect(doc.edges["0,0,-1:up"]).toMatchObject({ type: "pit" });
    expect(doc.levels.map((l) => l.z)).toEqual([-1, 0]);
    expect(errors(doc)).toEqual([]);
  });

  it("skips over a tall cell's occupied level", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(0, 0, 2)], { autoOpen: false }), ops.setHeights([P(0, 0)], { ceiling: 8 }));
    expect(ops.verticalTarget(doc, P(0, 0), "up")).toEqual({ z: 2, exists: true });
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "up", "open"));
    expect(doc.edges["0,0,0:up>2"]).toBeDefined();
    expect(errors(doc)).toEqual([]);
  });

  it("keeps id and triggers when the type changes", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(0, 0, 1)], { autoOpen: false }));
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "up", "hatch"), ops.updateEdge("0,0,0:up", { id: "trap", onUse: "x" }));
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "up", "grate"));
    expect(doc.edges["0,0,0:up"]).toMatchObject({ id: "trap", onUse: "x", type: "grate", state: "closed" });
  });
});
