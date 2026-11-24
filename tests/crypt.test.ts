import { describe, expect, it } from "vitest";
import { resolve, Runtime, validate } from "../src/core";
import { runExport } from "../src/exporters";
import { crypt } from "./fixtures/maps";

const P = (x: number, y: number, z = 0) => ({ x, y, z });

describe("Crypt example", () => {
  it("validates cleanly", () => {
    expect(validate(crypt()).filter((p) => p.severity !== "info")).toEqual([]);
  });

  it("matches its golden export", async () => {
    const r = runExport("json", crypt());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    await expect(r.result.files[0]!.data).toMatchFileSnapshot("./golden/crypt.json");
  });

  it("can be played from start to finish", () => {
    const custom: string[] = [];
    let light = true;
    const rt = new Runtime(resolve(crypt()), { schedule: (f) => f(), customCondition: () => light, onCustomAction: (id) => custom.push(id) });
    rt.begin();
    const msgs = () => rt.state.log.filter((l) => l.kind === "message").map((l) => l.text);
    expect(msgs()[0]).toMatch(/Three braziers/);

    // the secret wall holds until all three braziers burn
    rt.move("forward");           // (1,1)
    rt.move("left");              // (1,0)
    rt.turn("left"); rt.use();    // brazier 1 (north wall)
    rt.use();
    expect(msgs().at(-1)).toMatch(/already burning/);
    rt.turn("right"); rt.move("forward"); rt.move("forward"); // (3,0)
    rt.turn("left"); rt.use();    // brazier 2
    expect(rt.state.edges["2,2,0:south"]).toBe("closed");
    rt.turn("right"); rt.move("forward"); rt.move("right");    // (4,1) facing east
    rt.use();                     // brazier 3
    expect(rt.state.flags.flames).toBe(3);
    expect(rt.state.edges["2,2,0:south"]).toBe("open");
    expect(custom).toEqual(["playSound"]);

    // down the stairs into the vault
    rt.move("right"); rt.move("back"); rt.move("back");       // (2,2)
    rt.turn("right");             // south
    for (let i = 0; i < 4; i++) expect(rt.move("forward")).toEqual({ ok: true });
    expect(rt.state.player.pos).toEqual(P(2, 6));
    expect(rt.cell()!.abs.floor).toBe(-2);

    // the plate opens the trapdoor; stepping on it drops into the crypt
    expect(rt.state.edges["2,7,-1:up"]).toBe("closed");
    rt.move("right");             // (1,6): plate
    expect(rt.state.edges["2,7,-1:up"]).toBe("open");
    rt.move("left");
    light = false;
    expect(rt.move("forward")).toEqual({ ok: true, fell: 1 });
    expect(rt.state.player.pos).toEqual(P(2, 7, -1));
    expect(msgs().at(-1)).toMatch(/total darkness/);

    // the sarcophagus, used from the next cell
    rt.use();
    expect(rt.state.flags.relic).toBe(true);
    expect(custom).toEqual(["playSound", "playSound", "spawnMonster"]);
    expect(rt.state.log.some((l) => l.text === '[Spawn monster] monster="skeleton" at=(1,7,-1)')).toBe(true);

    // ladder back up
    rt.move("forward"); rt.move("left");                       // (3,8,-1)
    expect(rt.move("forward")).toEqual({ ok: true, climbed: "up" });
    expect(rt.state.player.pos).toEqual(P(3, 8, 0));
    expect(msgs().at(-1)).toMatch(/Well done/);
  });
});
