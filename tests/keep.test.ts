import { describe, expect, it } from "vitest";
import { collectLinks, resolve, Runtime, validate } from "../src/core";
import { runExport } from "../src/exporters";
import { buildMesh } from "../src/render/mesh/buildMesh";
import { keep } from "./fixtures/maps";

const P = (x: number, y: number, z = 0) => ({ x, y, z });

describe("Keep of Echoes example", () => {
  it("validates with no problems at all", () => {
    expect(validate(keep())).toEqual([]);
  });

  it("matches its golden export", async () => {
    const r = runExport("json", keep());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    await expect(r.result.files[0]!.data).toMatchFileSnapshot("./golden/keep-of-echoes.json");
  });

  it("really does use everything", () => {
    const doc = keep();
    const r = resolve(doc);
    const kinds = (k: string) => r.edges.filter((e) => doc.connectionTypes[e.type]?.kind === k).length;
    for (const k of ["opening", "door", "gate", "wall", "hatch", "ladder", "pit", "grate"]) expect(kinds(k), k).toBeGreaterThan(0);
    expect(r.edges.some((e) => e.type === "open")).toBe(true);
    expect(r.edges.some((e) => !e.vertical && e.from.z !== e.to.z)).toBe(true); // full-level stairs
    expect(new Set(r.cells.map((c) => c.shape.kind))).toEqual(new Set(["flat", "ramp", "stairs"]));
    expect(r.levels.map((l) => l.z)).toEqual([-1, 0, 1]);
    expect(r.cells.some((c) => c.ceiling > doc.stepsPerLevel)).toBe(true);
    expect(r.cells.some((c) => c.floor < 0)).toBe(true);
    expect(r.risers.length).toBeGreaterThan(0);
    const actionTypes = new Set<string>(), condTypes = new Set<string>();
    const walkC = (cs: any[]) => cs.forEach((c) => { condTypes.add(c.type); if (c.conditions) walkC(c.conditions); });
    for (const ev of Object.values(doc.events)) {
      [...ev.actions, ...(ev.else ?? [])].forEach((a) => actionTypes.add(a.type));
      walkC(ev.conditions ?? []);
    }
    expect([...actionTypes].sort()).toEqual(["addFlag", "custom", "runEvent", "setConnectionState", "setFlag", "setPropState", "setSurface", "showMessage", "teleport", "toggleConnectionState"]);
    expect([...condTypes].sort()).toEqual(["any", "custom", "eventFired", "flag", "not", "playerFacing", "state"]);
    expect(new Set(Object.values(doc.flags).map((f) => f.type))).toEqual(new Set(["bool", "int", "string"]));
    expect(collectLinks(doc).length).toBeGreaterThan(30);
    expect(buildMesh(r).edges.find((e) => e.kind === "vedge" && e.ctKind === "ladder")).toBeDefined();
  });

  it("can be played from start to finish", () => {
    const customs: string[] = [];
    const rt = new Runtime(resolve(keep()), { schedule: (f) => f(), onCustomAction: (id) => customs.push(id) });
    rt.begin();
    const at = () => rt.state.player.pos;
    const last = () => rt.state.log.filter((l) => l.kind === "message").at(-1)!.text;
    expect(last()).toMatch(/Wind howls/);
    expect(rt.state.flags.visits).toBe(1);

    // open the hall door and step in
    rt.move("forward"); rt.use();
    expect(rt.state.edges["2,1,0:east"]).toBe("open");
    rt.move("forward");
    expect(last()).toMatch(/colder/);

    // the lever raises the portcullis
    rt.move("forward"); rt.move("left"); rt.turn("left"); rt.use();
    expect(rt.state.edges["5,4,0:south"]).toBe("open");
    expect(rt.state.props.hall_lever).toBe("on");

    // across the ramp and down the stairs into the armory
    rt.turn("right"); rt.move("forward"); rt.turn("right");
    for (let i = 0; i < 7; i++) expect(rt.move("forward"), `step ${i}`).toEqual({ ok: true });
    expect(at()).toEqual(P(5, 7));
    expect(rt.cell()!.abs.floor).toBe(-2);

    // the key, the mural, the dart plate and the spike pit
    rt.turn("left"); rt.use();
    expect(rt.state.flags.item).toBe("key");
    expect(rt.surface(P(6, 7), "east")).toBe("mural");
    rt.move("back");
    expect(last()).toMatch(/dart whistles/);
    rt.move("forward"); rt.move("right");
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(5, 2));
    expect(rt.state.player.facing).toBe("north");
    expect(rt.state.flags.falls).toBe(1);

    // unlock and open the vault door, climb to the tower
    rt.turn("right"); rt.move("forward"); rt.move("forward");
    expect(at()).toEqual(P(7, 2));
    expect(rt.move("forward")).toEqual({ ok: false, reason: "closed" });
    expect(last()).toMatch(/vault door is locked/);
    rt.use();
    expect(rt.state.edges["7,2,0:east"]).toBe("closed");
    rt.use();
    expect(rt.state.edges["7,2,0:east"]).toBe("open");
    rt.move("forward"); rt.move("forward"); rt.move("forward");
    expect(at()).toEqual(P(10, 2, 1));

    // the button reveals the library; the window only speaks when you face it
    rt.move("forward"); rt.move("forward"); rt.use();
    expect(rt.state.edges["11,3,1:south"]).toBe("open");
    rt.turn("left"); rt.move("forward"); rt.move("left");
    expect(last()).toMatch(/narrow window/);

    // take the tome, then drop down the shaft and get blown back to the entrance
    rt.move("back"); rt.move("back"); rt.move("back"); rt.move("back");
    expect(at()).toEqual(P(11, 5, 1));
    rt.turn("left"); rt.use();
    expect(rt.state.flags.tome).toBe(true);
    rt.turn("right"); rt.turn("right");
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(1, 1));

    // wake the altar: the trapdoor opens and the torch goes out
    for (let i = 0; i < 5; i++) rt.move("forward");
    expect(at()).toEqual(P(6, 1));
    rt.use();
    expect(rt.state.props.altar).toBe("awake");
    expect(rt.state.edges["4,3,-1:up"]).toBe("open");
    expect(rt.state.props.hall_torch).toBe("out");
    expect(customs).toContain("spawnMonster");

    // the grate holds, the trapdoor drops you into the cellar
    rt.turn("right"); rt.move("forward"); rt.move("forward"); rt.turn("right");
    expect(rt.move("forward")).toEqual({ ok: true });
    expect(at()).toEqual(P(5, 3));
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(at()).toEqual(P(4, 3, -1));

    // the crown, a dip in the pool, and out by the ladder
    rt.move("left"); rt.use();
    expect(rt.state.flags.crown).toBe(true);
    rt.turn("right"); rt.turn("right");
    expect(rt.move("forward")).toEqual({ ok: true });
    expect(rt.cell()!.abs.floor).toBe(-5);
    rt.move("back");
    rt.turn("right"); rt.turn("right"); rt.move("forward"); rt.move("right");
    expect(at()).toEqual(P(3, 3, -1));
    rt.use();
    expect(at()).toEqual(P(3, 3));
    expect(last()).toMatch(/You win/);
  });
});
