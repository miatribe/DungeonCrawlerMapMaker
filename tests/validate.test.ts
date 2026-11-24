import { describe, expect, it } from "vitest";
import { createMap, run, validate, type MapDoc, type ProblemCode } from "../src/core";
import * as ops from "../src/core/ops";
import { threeRooms, tower } from "./fixtures/maps";

const codes = (doc: MapDoc, severity?: string) =>
  validate(doc).filter((p) => !severity || p.severity === severity).map((p) => p.code);

const expectCode = (doc: MapDoc, code: ProblemCode) => expect(codes(doc)).toContain(code);

describe("validate", () => {
  it("fixtures are clean", () => {
    expect(validate(threeRooms()).filter((p) => p.severity !== "info")).toEqual([]);
    expect(validate(tower()).filter((p) => p.severity !== "info")).toEqual([]);
  });

  it("reports custom materials only when unused", () => {
    const doc = run(threeRooms(), ops.define("material", "unusedMat", { name: "x", color: "#000000" }));
    expect(validate(doc).filter((p) => p.code === "V-UNUSED").map((p) => p.message)).toEqual(['material "unusedMat" is never used']);
  });

  it("requires a start on a cell", () => {
    expectCode(createMap(), "V-START");
    expectCode(run(threeRooms(), ops.setStart({ cell: { x: 0, y: 0, z: 0 }, facing: "east" })), "V-START");
  });

  it("finds missing references", () => {
    let doc = threeRooms();
    doc = run(doc, ops.undefine("event", "trap"), ops.updateCells([{ x: 1, y: 1, z: 0 }], { surfaces: { north: "nope" } }));
    const refs = validate(doc).filter((p) => p.code === "V-REF").map((p) => p.message);
    expect(refs).toContain('cells[6,4,0].onEnter: unknown event "trap"');
    expect(refs).toContain('cells[1,1,0].surfaces.north: unknown material "nope"');
  });

  it("checks states of edges, props and action targets", () => {
    let doc = threeRooms();
    doc = run(doc, ops.define("event", "bad", { actions: [{ type: "setConnectionState", target: { kind: "edge", id: "gate" }, state: "locked" }] }));
    doc = run(doc, ops.updateProp("chest", { state: "smashed" }));
    const msgs = validate(doc).filter((p) => p.code === "V-STATE").map((p) => p.where);
    expect(msgs).toContain("events.bad.actions[0]");
    expect(msgs).toContain("props.chest");
  });

  it("checks flag types", () => {
    const doc = run(threeRooms(), ops.define("event", "bad", { actions: [{ type: "setFlag", name: "treasure", value: 3 }, { type: "addFlag", name: "treasure", amount: 1 }] }));
    expect(codes(doc).filter((c) => c === "V-TYPE")).toHaveLength(2);
  });

  it("detects overlapping cells across levels", () => {
    let doc = run(createMap(), ops.paintCells([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]));
    expect(codes(doc)).not.toContain("V-OVERLAP");
    doc = run(doc, ops.adjustHeights([{ x: 0, y: 0, z: 0 }], { ceiling: 1 }));
    expectCode(doc, "V-OVERLAP");
  });

  it("checks ceilings and ramp tops", () => {
    let doc = run(createMap(), ops.paintCells([{ x: 0, y: 0, z: 0 }]));
    expectCode(run(doc, ops.adjustHeights([{ x: 0, y: 0, z: 0 }], { floor: 4 })), "V-CEIL");
    doc = run(doc, ops.updateCells([{ x: 0, y: 0, z: 0 }], { shape: { kind: "ramp", rise: 4, toward: "east" } }));
    expectCode(doc, "V-CEIL");
  });

  it("checks axis, void edges, gaps and steps", () => {
    let doc = run(createMap(), ops.paintCells([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]));
    doc = run(doc, ops.setEdge({ cell: { x: 0, y: 0, z: 0 }, dir: "east" }, "hatch"));
    expectCode(doc, "V-AXIS");
    doc = run(doc, ops.setEdge({ cell: { x: 0, y: 0, z: 0 }, dir: "east" }, "opening"), ops.adjustHeights([{ x: 1, y: 0, z: 0 }], { floor: 2 }));
    expectCode(doc, "V-STEP");
    doc = run(doc, ops.setEdge({ cell: { x: 0, y: 0, z: 0 }, dir: "west" }, "door"));
    expectCode(doc, "V-EDGE-VOID");
    doc = run(doc, ops.paintCells([{ x: 0, y: 0, z: 1 }], { autoOpen: false }), ops.adjustHeights([{ x: 0, y: 0, z: 0 }], { ceiling: -1 }));
    doc = run(doc, ops.setEdge({ cell: { x: 0, y: 0, z: 0 }, dir: "up" }, "open"));
    expectCode(doc, "V-GAP");
  });

  it("warns about unreachable cells but counts teleport targets", () => {
    let doc = run(threeRooms(), ops.paintCells([{ x: 10, y: 10, z: 0 }]));
    expectCode(doc, "V-UNREACH");
    doc = run(doc, ops.define("event", "warp", { actions: [{ type: "teleport", to: { x: 10, y: 10, z: 0 } }] }));
    expect(codes(doc)).not.toContain("V-UNREACH");
  });

  it("validates custom action params", () => {
    let doc = run(
      threeRooms(),
      ops.define("customType", "playSound", {
        category: "action", name: "Play sound",
        params: [
          { name: "sound", type: "string", required: true },
          { name: "volume", type: "float", default: 1 },
          { name: "bus", type: "enum", options: ["sfx", "music"] },
          { name: "near", type: "ref:prop" },
        ],
      }),
      ops.define("event", "noise", { actions: [{ type: "custom", custom: "playSound", params: { volume: "loud", bus: "voice", near: "ghost", extra: 1 } }] }),
    );
    const p = validate(doc);
    const msgs = p.filter((x) => x.code === "V-PARAM").map((x) => x.message);
    expect(msgs).toEqual(expect.arrayContaining([
      '"playSound": required parameter "sound" is missing',
      '"playSound": parameter "volume" should be a number',
      '"playSound": parameter "bus" should be one of sfx, music',
      '"playSound": unknown parameter "extra"',
    ]));
    expect(p.some((x) => x.code === "V-REF" && x.message.includes('unknown prop "ghost"'))).toBe(true);
    doc = run(doc, ops.define("event", "noise", { conditions: [{ type: "custom", custom: "playSound" }], actions: [] }));
    expectCode(doc, "V-TYPE");
  });
});
