import { describe, expect, it } from "vitest";
import { apply, createHistory, createMap, edgeKeyOf, redo, rectPositions, run, undo, undoLabel } from "../src/core";
import * as ops from "../src/core/ops";
import { threeRooms } from "./fixtures/maps";

const room = rectPositions({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 });

describe("paint and erase", () => {
  it("opens edges only between cells of the same stroke", () => {
    let doc = run(createMap(), ops.paintCells(room));
    expect(Object.keys(doc.cells)).toHaveLength(4);
    expect(Object.values(doc.edges).map((e) => e.type)).toEqual(["opening", "opening", "opening", "opening"]);
    doc = run(doc, ops.paintCells([{ x: 2, y: 0, z: 0 }]));
    expect(doc.edges[edgeKeyOf({ x: 1, y: 0, z: 0 }, "east")]).toBeUndefined();
  });

  it("adds a level entry when painting a new z", () => {
    const doc = run(createMap(), ops.paintCells([{ x: 0, y: 0, z: -1 }]));
    expect(doc.levels.map((l) => l.z)).toEqual([-1, 0]);
  });

  it("erasing removes touching edges and props", () => {
    let doc = threeRooms();
    doc = run(doc, ops.removeCells([{ x: 3, y: 3, z: 0 }]));
    expect(doc.props.lever1).toBeUndefined();
    expect(Object.values(doc.edges).some((e) => e.from.x === 3 && e.from.y === 3)).toBe(false);
  });
});

describe("edges", () => {
  it("setEdge keeps id and resets state to the new type's initial state", () => {
    let doc = run(createMap(), ops.paintCells(room));
    const at = { cell: { x: 1, y: 0, z: 0 }, dir: "west" as const };
    doc = run(doc, ops.setEdge(at, "door", { id: "d1" }));
    const k = edgeKeyOf(at.cell, at.dir);
    expect(doc.edges[k]).toMatchObject({ id: "d1", type: "door", state: "closed" });
    doc = run(doc, ops.setEdge(at, "hatch"));
    expect(doc.edges[k]).toMatchObject({ id: "d1", type: "hatch", state: "closed" });
    doc = run(doc, ops.setEdge(at, "opening"));
    expect(doc.edges[k]!.state).toBe("open");
    doc = run(doc, ops.setEdge(at, null));
    expect(doc.edges[k]).toBeUndefined();
  });

  it("ensureEdgeId names an unnamed edge", () => {
    let doc = run(createMap(), ops.paintCells(room));
    const k = edgeKeyOf({ x: 0, y: 0, z: 0 }, "east");
    const { command, id } = ops.ensureEdgeId(doc, k);
    doc = run(doc, command);
    expect(id).toBe("opening_1");
    expect(doc.edges[k]!.id).toBe("opening_1");
  });
});

describe("heights", () => {
  it("drops values that return to default", () => {
    let doc = run(createMap(), ops.paintCells(room));
    const p = [{ x: 0, y: 0, z: 0 }];
    doc = run(doc, ops.adjustHeights(p, { floor: 1, ceiling: 2 }));
    expect(doc.cells["0,0,0"]).toMatchObject({ floor: 1, ceiling: 6 });
    doc = run(doc, ops.adjustHeights(p, { floor: -1, ceiling: -2 }));
    expect(doc.cells["0,0,0"]).toEqual({ pos: { x: 0, y: 0, z: 0 } });
  });
});

describe("undo / redo", () => {
  it("round-trips through history", () => {
    const base = createMap();
    let h = createHistory();
    let doc = base;
    ({ doc, history: h } = apply(doc, h, ops.paintCells(room)));
    ({ doc, history: h } = apply(doc, h, ops.setSurface(room, "down", "dirt")));
    expect(undoLabel(h)).toBe("Paint material");
    const painted = doc;
    ({ doc, history: h } = undo(doc, h));
    ({ doc, history: h } = undo(doc, h));
    expect(doc).toEqual(base);
    ({ doc, history: h } = redo(doc, h));
    ({ doc, history: h } = redo(doc, h));
    expect(doc).toEqual(painted);
  });

  it("ignores no-op commands and caps history", () => {
    let h = createHistory(3);
    let doc = createMap();
    const r = apply(doc, h, ops.updateCells([{ x: 9, y: 9, z: 0 }], { floor: 1 }));
    expect(r.changed).toBe(false);
    for (let i = 0; i < 5; i++) ({ doc, history: h } = apply(doc, h, ops.paintCells([{ x: i, y: 0, z: 0 }])));
    expect(h.past).toHaveLength(3);
  });

  it("a new edit clears the redo stack", () => {
    let h = createHistory();
    let doc = createMap();
    ({ doc, history: h } = apply(doc, h, ops.paintCells(room)));
    ({ doc, history: h } = undo(doc, h));
    ({ doc, history: h } = apply(doc, h, ops.paintCells([{ x: 5, y: 5, z: 0 }])));
    expect(h.future).toHaveLength(0);
  });
});

describe("renameId", () => {
  it("renames an event and rewrites triggers", () => {
    let doc = threeRooms();
    doc = run(doc, ops.renameId(doc, "event", "trap", "doorTrap"));
    expect(doc.events.trap).toBeUndefined();
    expect(doc.events.doorTrap).toBeDefined();
    expect(doc.cells["6,4,0"]!.onEnter).toBe("doorTrap");
  });

  it("renames a prop and rewrites action targets", () => {
    let doc = threeRooms();
    doc = run(doc, ops.renameId(doc, "prop", "lever1", "gateLever"));
    expect(doc.props.gateLever!.id).toBe("gateLever");
    expect(JSON.stringify(doc.events.toggleGate)).toContain('"gateLever"');
    expect(JSON.stringify(doc.events.toggleGate)).not.toContain('"lever1"');
  });

  it("renames an edge id and a material", () => {
    let doc = threeRooms();
    doc = run(doc, ops.renameId(doc, "edge", "gate", "ironGate"), ops.renameId(doc, "material", "brick", "redBrick"));
    expect(JSON.stringify(doc.events)).toContain('"ironGate"');
    expect(doc.cells["1,1,0"]!.surfaces!.north).toBe("redBrick");
  });

  it("refuses a taken id", () => {
    const doc = threeRooms();
    expect(() => ops.renameId(doc, "event", "trap", "welcome")).toThrow(/already exists/);
  });
});
