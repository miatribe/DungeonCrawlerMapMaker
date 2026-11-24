import { describe, expect, it } from "vitest";
import { createMap, resolve, run, Runtime, type MapDoc } from "../src/core";
import * as ops from "../src/core/ops";
import { threeRooms, tower } from "./fixtures/maps";

const P = (x: number, y: number, z = 0) => ({ x, y, z });
const start = (doc: MapDoc, opts = {}) => {
  const rt = new Runtime(resolve(doc), { schedule: (f) => f(), ...opts });
  rt.begin();
  return rt;
};
const at = (rt: Runtime) => rt.state.player.pos;
const messages = (rt: Runtime) => rt.state.log.filter((l) => l.kind === "message").map((l) => l.text);

describe("runtime: Three Rooms playthrough", () => {
  it("can be completed", () => {
    const rt = start(threeRooms());
    expect(messages(rt)[0]).toMatch(/You wake in a cold brick room/);

    // gate is closed
    rt.move("forward"); rt.move("forward");
    expect(at(rt)).toEqual(P(3, 2));
    expect(rt.move("forward")).toEqual({ ok: false, reason: "closed" });

    // pull lever1 (floor prop in 3,3)
    expect(rt.move("right")).toEqual({ ok: true });
    rt.use();
    expect(rt.state.edges["3,2,0:east"]).toBe("open");
    expect(rt.state.props.lever1).toBe("on");

    // through the gate; the draft message fires once
    rt.move("left"); rt.move("forward"); rt.move("forward");
    expect(at(rt)).toEqual(P(5, 2));
    rt.move("back"); rt.move("forward");
    expect(messages(rt).filter((m) => m.includes("draft"))).toHaveLength(1);

    // open the door south of (6,3) and step through: the trap locks it
    rt.move("forward"); rt.move("right");
    expect(at(rt)).toEqual(P(6, 3));
    rt.turn("right"); // facing south
    rt.use();
    expect(rt.state.edges["6,3,0:south"]).toBe("open");
    rt.move("forward");
    expect(at(rt)).toEqual(P(6, 4));
    expect(rt.state.edges["6,3,0:south"]).toBe("locked");
    expect(rt.move("back")).toEqual({ ok: false, reason: "closed" });

    // lever2 unlocks it
    rt.move("forward"); rt.turn("right"); rt.move("forward");
    expect(at(rt)).toEqual(P(5, 5));
    rt.use();
    expect(rt.state.edges["6,3,0:south"]).toBe("closed");

    // the chest wins
    rt.turn("right"); rt.turn("right"); rt.move("forward"); rt.move("forward");
    expect(at(rt)).toEqual(P(7, 5));
    rt.use();
    expect(rt.state.flags.treasure).toBe(true);
    expect(messages(rt).at(-1)).toMatch(/You win/);
  });

  it("never touches the authored map", () => {
    const doc = threeRooms();
    const r = resolve(doc);
    const rt = new Runtime(r);
    rt.begin();
    rt.run("toggleGate");
    expect(r.edgeById("gate")!.state).toBe("closed");
    expect(rt.state.edges["3,2,0:east"]).toBe("open");
  });

  it("doors without events toggle through their transitions", () => {
    const doc = run(createMap(), ops.paintCells([P(0, 0), P(1, 0)]), ops.setEdge({ cell: P(0, 0), dir: "east" }, "door"), ops.setStart({ cell: P(0, 0), facing: "east" }));
    const rt = start(doc);
    expect(rt.move("forward").ok).toBe(false);
    rt.use();
    expect(rt.move("forward")).toEqual({ ok: true });
  });
});

describe("runtime: vertical movement", () => {
  it("climbs the tower's stairs to the next level and falls down the pit", () => {
    const rt = start(tower());
    rt.move("forward"); rt.move("forward");
    expect(at(rt)).toEqual(P(3, 1));
    rt.move("forward");
    expect(at(rt)).toEqual(P(4, 1, 1));
    expect(rt.move("right")).toEqual({ ok: true, fell: 1 });
    expect(at(rt)).toEqual(P(4, 2, 0));
    expect(rt.state.log.at(-1)!.text).toMatch(/fall/);
  });

  it("enforces maxStep but allows the one-step sunken nook", () => {
    const rt = start(tower());
    rt.move("back");
    expect(at(rt)).toEqual(P(0, 1)); // floor -1, one step down
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(1, 0)]), ops.setHeights([P(1, 0)], { floor: 2, ceiling: 6 }), ops.setStart({ cell: P(0, 0), facing: "east" }));
    const rt2 = start(doc);
    expect(rt2.move("forward")).toEqual({ ok: false, reason: "step" });
    doc = run(doc, ops.setMapMeta({ rules: { maxStep: 2 } }));
    expect(start(doc).move("forward")).toEqual({ ok: true });
  });

  it("climbs ladders by walking into a wall", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(0, 0, 1)], { autoOpen: false }), ops.setStart({ cell: P(0, 0), facing: "north" }));
    doc = run(doc, ops.connectVertical(doc, P(0, 0), "up", "ladder"));
    const rt = start(doc);
    expect(rt.move("forward")).toEqual({ ok: true, climbed: "up" });
    expect(at(rt)).toEqual(P(0, 0, 1));
    // a ladder doesn't drop you back down
    expect(rt.move("back")).toEqual({ ok: true, climbed: "down" });
    expect(at(rt)).toEqual(P(0, 0, 0));
  });

  it("a closed hatch holds you; an opened one drops you", () => {
    let doc = run(createMap(), ops.paintCells([P(0, 0), P(1, 0)]), ops.setStart({ cell: P(0, 0), facing: "east" }));
    doc = run(doc, ops.connectVertical(doc, P(1, 0), "down", "hatch", { createMissing: true }), ops.updateEdge("1,0,-1:up", { id: "trap" }));
    const rt = start(doc);
    rt.move("forward");
    expect(at(rt)).toEqual(P(1, 0));
    rt.move("back");
    rt.run({ actions: [{ type: "setConnectionState", target: { kind: "edge", id: "trap" }, state: "open" }] });
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at(rt)).toEqual(P(1, 0, -1));
  });
});

describe("runtime: events", () => {
  it("handles flags, any/none, delays, custom hooks and bump events", () => {
    const customs: string[] = [];
    let doc = run(
      createMap(),
      ops.paintCells([P(0, 0), P(1, 0)]),
      ops.setEdge({ cell: P(0, 0), dir: "east" }, "gate", { id: "g" }),
      ops.setStart({ cell: P(0, 0), facing: "east" }),
      ops.define("flag", "n", { type: "int", initial: 0 }),
      ops.define("customType", "isNight", { category: "condition", name: "Is night", params: [] }),
      ops.define("customType", "sfx", { category: "action", name: "Sound", params: [{ name: "id", type: "string" }] }),
      ops.define("event", "later", { actions: [{ type: "showMessage", text: "later!" }] }),
      ops.define("event", "bump", {
        conditions: [
          { type: "any", conditions: [{ type: "flag", name: "n", op: ">=", value: 2 }, { type: "custom", custom: "isNight" }] },
          { type: "not", conditions: [{ type: "eventFired", event: "later" }] },
        ],
        actions: [{ type: "addFlag", name: "n", amount: 1 }, { type: "custom", custom: "sfx", params: { id: "thud" } }, { type: "runEvent", event: "later", delayMs: 500 }],
        else: [{ type: "showMessage", text: "else branch" }],
      }),
    );
    doc = run(doc, ops.updateEdge("0,0,0:east", { onBump: "bump" }));
    let night = false;
    const rt = start(doc, { customCondition: () => night, onCustomAction: (id: string) => customs.push(id) });
    rt.move("forward");
    expect(messages(rt)).toEqual(["else branch"]);
    night = true;
    rt.move("forward");
    expect(rt.state.flags.n).toBe(1);
    expect(customs).toEqual(["sfx"]);
    expect(rt.state.log.some((l) => l.kind === "custom" && l.text === '[Sound] id="thud"')).toBe(true);
    expect(messages(rt)).toEqual(["else branch", "later!"]);
    // "later" has fired now, so the none-of condition fails
    rt.move("forward");
    expect(rt.state.flags.n).toBe(1);
  });

  it("stops runaway runEvent loops", () => {
    const doc = run(threeRooms(), ops.define("event", "loop", { actions: [{ type: "runEvent", event: "loop" }] }));
    const rt = start(doc);
    rt.run("loop");
    expect(rt.state.log.at(-1)!.text).toMatch(/too deep/);
  });

  it("setSurface overrides a material at runtime only", () => {
    const rt = start(threeRooms());
    rt.run({ actions: [{ type: "setSurface", cell: P(1, 1), side: "north", material: "moss" }] });
    expect(rt.surface(P(1, 1), "north")).toBe("moss");
    expect(rt.map.cellAt(P(1, 1))!.surfaces.north).toBe("brick");
  });
});
