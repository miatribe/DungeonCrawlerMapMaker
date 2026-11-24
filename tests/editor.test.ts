import { describe, expect, it } from "vitest";
import { apply, batch, createHistory, createMap, resolve, run, undo } from "../src/core";
import * as ops from "../src/core/ops";
import { EDGE_BAND, hitFace, hitTest } from "../src/render/canvas2d/hit";
import { MAX_ZOOM, toScreen, toWorld, zoomAt } from "../src/render/canvas2d/view";
import { edgeOnSide, floodRoom, rampPath } from "../src/editor/tools";
import { overlayLinks, refPoint, triggerCells } from "../src/editor/linkOverlay";
import { collectLinks } from "../src/core";
import { propAt, propPoint } from "../src/render/canvas2d/hit";
import { threeRooms, tower } from "./fixtures/maps";

describe("hit testing", () => {
  it("picks cells in the middle and edges near boundaries", () => {
    expect(hitTest(3.5, 2.5, 0)).toEqual({ kind: "cell", pos: { x: 3, y: 2, z: 0 } });
    expect(hitTest(3.05, 2.5, 0)).toEqual({ kind: "edge", cell: { x: 3, y: 2, z: 0 }, dir: "west" });
    expect(hitTest(3.5, 2.95, 1)).toEqual({ kind: "edge", cell: { x: 3, y: 2, z: 1 }, dir: "south" });
    expect(hitTest(3.5 , 2 + EDGE_BAND + 0.01, 0).kind).toBe("cell");
  });

  it("honors forced modes", () => {
    expect(hitTest(3.05, 2.5, 0, "cell").kind).toBe("cell");
    expect(hitTest(3.5, 2.4, 0, "edge")).toEqual({ kind: "edge", cell: { x: 3, y: 2, z: 0 }, dir: "north" });
  });

  it("handles negative coordinates", () => {
    expect(hitTest(-0.5, -0.5, 0)).toEqual({ kind: "cell", pos: { x: -1, y: -1, z: 0 } });
  });

  it("maps the middle of a cell to its floor", () => {
    expect(hitFace(1.5, 1.5, 0).side).toBe("down");
    expect(hitFace(1.95, 1.5, 0).side).toBe("east");
  });
});

describe("view transform", () => {
  it("round-trips and zooms around the cursor", () => {
    const v = { panX: 40, panY: -10, zoom: 32 };
    const w = toWorld(v, 200, 150);
    expect(toScreen(v, w.x, w.y)).toEqual({ x: 200, y: 150 });
    const z = zoomAt(v, 200, 150, 2);
    expect(z.zoom).toBe(64);
    const w2 = toWorld(z, 200, 150);
    expect(w2.x).toBeCloseTo(w.x);
    expect(w2.y).toBeCloseTo(w.y);
    expect(zoomAt(v, 0, 0, 1000).zoom).toBe(MAX_ZOOM);
  });
});

describe("editor helpers", () => {
  it("floodRoom stops at doors and gates", () => {
    const r = resolve(threeRooms());
    expect(floodRoom(r, { x: 1, y: 1, z: 0 })).toHaveLength(9); // brick room, gate on the east
    expect(floodRoom(r, { x: 5, y: 2, z: 0 })).toHaveLength(12); // stone room, door to the south
    expect(floodRoom(r, { x: 20, y: 20, z: 0 })).toEqual([{ x: 20, y: 20, z: 0 }]);
  });

  it("edgeOnSide finds cross-level connections from either level", () => {
    const r = resolve(tower());
    expect(edgeOnSide(r, { x: 3, y: 1, z: 0 }, "east")?.at).toEqual({ cell: { x: 3, y: 1, z: 0 }, dir: "east", toZ: 1 });
    const fromTop = edgeOnSide(r, { x: 4, y: 1, z: 1 }, "west")!;
    expect(fromTop.at).toEqual({ cell: { x: 4, y: 1, z: 1 }, dir: "west", toZ: 0 });
    // the address resolves back to the same stored edge
    expect(ops.edgeKeyAt(fromTop.at)).toBe(fromTop.key);
    expect(edgeOnSide(r, { x: 0, y: 0, z: 0 }, "north")).toBeNull();
  });

  it("rampPath follows the drag's dominant axis, or the nearest edge on a click", () => {
    expect(rampPath({ startX: 1.5, startY: 1.5 }, { wx: 4.2, wy: 2.1 }, 0, false)).toEqual({
      toward: "east", path: [{ x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
    });
    expect(rampPath({ startX: 1.5, startY: 3.5 }, { wx: 1.9, wy: 1.2 }, 2, false).toward).toBe("north");
    expect(rampPath({ startX: 1.5, startY: 1.9 }, { wx: 1.5, wy: 1.9 }, 0, false)).toEqual({ toward: "south", path: [{ x: 1, y: 1, z: 0 }] });
    // level stairs always use one cell
    expect(rampPath({ startX: 1.5, startY: 1.5 }, { wx: 5.5, wy: 1.5 }, 0, true).path).toHaveLength(1);
  });

  it("finds props by position, including wall-mounted ones", () => {
    const props = [
      { id: "a", cell: { x: 1, y: 1, z: 0 } },
      { id: "b", cell: { x: 1, y: 1, z: 0 }, side: "north" },
      { id: "c", cell: { x: 1, y: 1, z: 1 } },
    ];
    expect(propPoint(props[1]!)).toEqual({ x: 1.5, y: 1.18 });
    expect(propAt(props, 1.5, 1.5, 0)?.id).toBe("a");
    expect(propAt(props, 1.52, 1.2, 0)?.id).toBe("b");
    expect(propAt(props, 1.5, 1.5, 1)?.id).toBe("c");
    expect(propAt(props, 1.9, 1.9, 0)).toBeUndefined();
  });

  it("places link arrows for the selection, at edge midpoints and prop positions", () => {
    const doc = threeRooms();
    const resolved = resolve(doc);
    const base = { doc, resolved, links: collectLinks(doc), showAllLinks: false };
    expect(overlayLinks({ ...base, selection: { cells: [], edges: [], props: [] } })).toEqual([]);
    const arrows = overlayLinks({ ...base, selection: { cells: [], edges: [], props: ["lever1"] } });
    // lever1 -> gate (write), lever1 -> gate (read), lever1 -> itself
    expect(arrows.map((a) => [a.effect, a.b])).toEqual([
      ["read", { x: 4, y: 2.5, z: 0 }],
      ["write", { x: 4, y: 2.5, z: 0 }],
      ["write", { x: 3.5, y: 3.5, z: 0 }],
    ]);
    expect(refPoint(resolved, { kind: "edge", key: "6,3,0:south" })).toEqual({ x: 6.5, y: 4, z: 0 });
    const all = overlayLinks({ ...base, showAllLinks: true, selection: { cells: [], edges: [], props: [] } });
    expect(all.length).toBeGreaterThan(arrows.length);
    expect(all.every((a) => a.faint)).toBe(true);
    expect([...triggerCells(resolved)].sort()).toEqual(["1,2,0", "5,2,0", "6,4,0"]);
  });

  it("batch makes one undo step", () => {
    let doc = createMap();
    let h = createHistory();
    ({ doc, history: h } = apply(doc, h, batch("Two things", [ops.paintCells([{ x: 0, y: 0, z: 0 }]), ops.setStart({ cell: { x: 0, y: 0, z: 0 }, facing: "north" })])));
    expect(h.past).toHaveLength(1);
    ({ doc } = undo(doc, h));
    expect(doc).toEqual(run(createMap()));
  });
});
