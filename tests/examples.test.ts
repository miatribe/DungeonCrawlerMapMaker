import { describe, expect, it } from "vitest";
import { resolve, Runtime, validate, type MapDoc } from "../src/core";
import { doors, geometry, traps } from "./fixtures/examples";
import { keep } from "./fixtures/maps";
import { thinWalls } from "./thinWalls";

const P = (x: number, y: number, z = 0) => ({ x, y, z });

/** A runtime whose delayed events wait until `flush()`. */
function play(doc: MapDoc) {
  const queue: (() => void)[] = [];
  const rt = new Runtime(resolve(doc), { schedule: (f) => { queue.push(f); } });
  rt.begin();
  const flush = () => { while (queue.length) queue.shift()!(); };
  const last = () => rt.state.log.filter((l) => l.kind === "message").at(-1)?.text ?? "";
  const at = () => rt.state.player.pos;
  const walk = (n: number) => { for (let i = 0; i < n; i++) expect(rt.move("forward"), `step ${i + 1} from ${JSON.stringify(at())}`).toMatchObject({ ok: true }); };
  return { rt, flush, last, at, walk };
}

describe.each([["doors", doors], ["traps", traps], ["geometry", geometry]] as const)("%s example", (_, build) => {
  it("validates with no problems at all", () => {
    expect(validate(build())).toEqual([]);
  });
});

describe.each([["doors", doors], ["traps", traps], ["geometry", geometry], ["keep", keep]] as const)("%s example", (name, build) => {
  it("has no thin walls: rooms meet only through openings and doorways", () => {
    // the Keep's secret wall stands in a doorway, like a door
    expect(thinWalls(build(), ["opening", "door", "gate", ...(name === "keep" ? ["wall"] : [])])).toEqual([]);
  });
});

describe("Doors and Levers", () => {
  it("can be played from start to finish", () => {
    const { rt, last, at, walk } = play(doors());
    expect(last()).toMatch(/Four rooms/);

    // a plain door
    walk(1);
    expect(rt.move("forward")).toEqual({ ok: false, reason: "closed" });
    rt.use();
    expect(rt.state.edges["2,1,0:east"]).toBe("open");
    walk(2);
    expect(at()).toEqual(P(4, 1));

    // a locked door and its lever
    walk(2);
    expect(rt.move("forward")).toEqual({ ok: false, reason: "closed" });
    expect(last()).toMatch(/lever on the north wall/);
    rt.turn("left"); walk(1); rt.turn("left"); walk(1); rt.turn("right");
    expect(at()).toEqual(P(5, 0));
    rt.use();
    expect(rt.state.edges["6,1,0:east"]).toBe("open");
    rt.use();
    expect(rt.state.edges["6,1,0:east"]).toBe("locked");
    rt.use();
    expect(rt.state.props.lever).toBe("on");

    // three levers for the vault door
    rt.turn("right"); walk(1); rt.turn("right"); walk(1); rt.turn("left"); walk(2);
    expect(at()).toEqual(P(8, 1));
    expect(last()).toMatch(/three levers/);
    rt.turn("right"); walk(2); rt.turn("right"); rt.use();
    expect(rt.state.props.lever_a).toBe("on");
    expect(rt.state.edges["11,1,0:east"]).toBe("locked");
    rt.turn("left"); rt.turn("left"); walk(2); rt.turn("right"); rt.use();
    expect(rt.state.props.lever_c).toBe("on");
    expect(rt.state.edges["11,1,0:east"]).toBe("locked");
    rt.turn("right"); rt.turn("right"); walk(3);
    expect(at()).toEqual(P(10, 0));
    rt.use();
    expect(rt.state.edges["11,1,0:east"]).toBe("open");
    rt.use(); // one lever down locks it again
    expect(rt.state.edges["11,1,0:east"]).toBe("locked");
    expect(last()).toMatch(/slams shut/);
    rt.use();
    expect(rt.state.edges["11,1,0:east"]).toBe("open");

    // the treasure
    rt.turn("right"); walk(1); rt.turn("right"); walk(1); rt.turn("left"); walk(3);
    expect(at()).toEqual(P(14, 1));
    rt.use();
    expect(rt.state.flags.treasure).toBe(true);
    expect(last()).toMatch(/You win/);
  });
});

describe("Trap Gauntlet", () => {
  it("can be played from start to finish", () => {
    const { rt, flush, last, at, walk } = play(traps());
    const hits = () => rt.state.flags.hits;
    expect(last()).toMatch(/Five traps/);

    // dart plate: dodge it, then get hit
    walk(4);
    expect(rt.state.props.dart_plate).toBe("down");
    walk(1); flush();
    expect(last()).toMatch(/whistles/);
    expect(hits()).toBe(0);
    expect(rt.state.props.dart_plate).toBe("up");
    rt.move("back"); flush();
    expect(last()).toMatch(/hits you/);
    expect(hits()).toBe(1);

    // spike pit: fall in, climb out, go around
    walk(3);
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(hits()).toBe(2);
    flush();
    expect(at()).toEqual(P(7, 1));
    rt.turn("left"); walk(1); rt.turn("right"); walk(2); rt.turn("right"); walk(1); rt.turn("left");
    expect(at()).toEqual(P(9, 1));

    // hidden trapdoor, then the ladder out of the cellar
    walk(2);
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(12, 1, -1));
    expect(rt.state.edges["12,1,-1:up"]).toBe("closed");
    expect(hits()).toBe(3);
    walk(1);
    expect(rt.move("forward")).toEqual({ ok: true, climbed: "up" });
    expect(at()).toEqual(P(13, 1));

    // rune floor: one wrong step, then the safe path
    walk(2);
    expect(at()).toEqual(P(14, 1));
    expect(hits()).toBe(4);
    rt.turn("right"); walk(1); rt.turn("left"); walk(2); rt.turn("left"); walk(2); rt.turn("right"); walk(2); rt.turn("right"); walk(1); rt.turn("left");
    expect(at()).toEqual(P(18, 1));
    expect(hits()).toBe(4);

    // the flooding room
    walk(3);
    expect(rt.state.edges["19,1,0:east"]).toBe("locked");
    expect(rt.surface(P(20, 0), "down")).toBe("water");
    flush();
    expect(hits()).toBe(5);
    walk(1); rt.use();
    expect(rt.state.edges["19,1,0:east"]).toBe("open");
    expect(rt.surface(P(20, 0), "down")).toBe("flagstone");
    expect(last()).toMatch(/beat the gauntlet\. The hits/);
  });

  it("praises a clean run", () => {
    const { rt, flush, last } = play(traps());
    rt.state.player.pos = P(20, 1); rt.state.player.facing = "east";
    rt.move("forward"); rt.move("forward"); rt.use(); flush();
    expect(last()).toMatch(/without a scratch/);
  });
});

describe("Geometry Tour", () => {
  it("uses every kind of geometry", () => {
    const doc = geometry();
    const r = resolve(doc);
    const kinds = new Set(r.edges.map((e) => doc.connectionTypes[e.type]!.kind));
    for (const k of ["opening", "hatch", "ladder", "pit", "grate"]) expect(kinds.has(k as never), k).toBe(true);
    expect(r.edges.some((e) => e.type === "open")).toBe(true);
    expect(r.edges.filter((e) => !e.vertical && e.from.z !== e.to.z)).toHaveLength(2); // ramp and stairs up a level
    expect(new Set(r.cells.map((c) => c.shape.kind))).toEqual(new Set(["flat", "ramp", "stairs"]));
    expect(r.cells.some((c) => c.ceiling > doc.stepsPerLevel)).toBe(true);
    expect(r.cells.some((c) => c.ceiling < doc.stepsPerLevel)).toBe(true);
    expect(r.cells.some((c) => c.floor > 0)).toBe(true);
    expect(r.cells.some((c) => c.floor < 0)).toBe(true);
  });

  it("can be walked from start to finish", () => {
    const { rt, last, at, walk } = play(geometry());
    const floor = () => rt.cell()!.abs.floor;

    // heights room
    walk(2); rt.turn("left"); walk(1);
    expect(rt.cell()!.abs.ceiling).toBe(2);
    rt.move("back"); rt.turn("right"); walk(1); rt.turn("left"); walk(1);
    expect(floor()).toBe(1);
    rt.turn("right"); walk(1);
    expect(floor()).toBe(2);
    rt.turn("right"); walk(2); rt.turn("right"); walk(1);
    expect(floor()).toBe(-1);
    rt.turn("right"); walk(1); rt.turn("right"); walk(1);
    expect(at()).toEqual(P(5, 1));

    // tunnel, hall, ramp up to the balcony, pit down, back into the hall
    walk(5);
    expect(at()).toEqual(P(10, 1));
    expect(rt.cell()!.abs.ceiling).toBe(8);
    rt.turn("right"); walk(3);
    expect(at()).toEqual(P(10, 4, 1));
    rt.turn("right"); walk(1);
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(8, 4));
    rt.turn("right"); walk(2); rt.turn("right"); walk(1); rt.turn("left"); walk(1); rt.turn("right"); walk(1);
    expect(at()).toEqual(P(10, 1));

    // ramp, landing, stairs down, grotto, stairs up a level
    walk(2);
    expect(floor()).toBe(1);
    walk(3);
    expect(floor()).toBe(-1);
    walk(3);
    expect(at()).toEqual(P(18, 1));
    walk(1);
    expect(at()).toEqual(P(19, 1, 1));
    expect(floor()).toBe(4);

    // grate holds, trapdoor opens with the lever
    rt.turn("left"); walk(1);
    expect(last()).toMatch(/grate/);
    rt.turn("right"); walk(1); rt.turn("left"); rt.use();
    expect(rt.state.edges["21,0,0:up"]).toBe("open");
    rt.turn("right");
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(21, 0));

    // ladder up, open shaft down, ladder up, pit down
    rt.turn("right"); walk(2); rt.turn("right"); walk(2);
    rt.use();
    expect(at()).toEqual(P(19, 2, 1));
    rt.turn("left"); rt.turn("left");
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(20, 2));
    rt.turn("left"); rt.turn("left"); walk(1); rt.use();
    expect(at()).toEqual(P(19, 2, 1));
    rt.turn("right"); walk(1); rt.turn("right"); walk(1);
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(21, 1));
  });
});
