import { describe, expect, it } from "vitest";
import {
  collectLinks, eventUsages, exportTypeLibrary, importTypeLibrary, libraryDiff, linksFrom, linksTo, parseTypeLibrary,
  run, type LogicRef,
} from "../src/core";
import * as ops from "../src/core/ops";
import { threeRooms } from "./fixtures/maps";

const gate: LogicRef = { kind: "edge", key: "3,2,0:east" };
const lever1: LogicRef = { kind: "prop", id: "lever1" };

describe("trigger links", () => {
  it("follows a lever to the gate it toggles", () => {
    const links = collectLinks(threeRooms());
    const out = linksFrom(links, lever1);
    expect(out.map((l) => [l.effect, l.target, l.text])).toEqual([
      ["read", gate, "if gate is closed"],
      ["write", gate, "set gate → open"],
      ["write", lever1, "set lever1 → on"],
      ["write", gate, "else: set gate → closed"],
      ["write", lever1, "else: set lever1 → off"],
    ]);
    expect(out.every((l) => l.trigger === "onUse" && l.via[0] === "toggleGate")).toBe(true);
  });

  it("answers what affects a door", () => {
    const links = collectLinks(threeRooms());
    const into = linksTo(links, { kind: "edge", key: "6,3,0:south" }).filter((l) => l.effect === "write");
    expect(into.map((l) => [l.source, l.trigger])).toEqual([
      [{ kind: "cell", pos: { x: 6, y: 4, z: 0 } }, "onEnter"],
      [{ kind: "prop", id: "lever2" }, "onUse"],
    ]);
  });

  it("follows runEvent chains, edgeAt targets and flags without looping", () => {
    let doc = threeRooms();
    doc = run(
      doc,
      ops.define("event", "a", { actions: [{ type: "runEvent", event: "b" }] }),
      ops.define("event", "b", {
        actions: [
          { type: "setConnectionState", target: { kind: "edgeAt", cell: { x: 4, y: 2, z: 0 }, dir: "west" }, state: "open" },
          { type: "addFlag", name: "count", amount: 1 },
          { type: "runEvent", event: "a" },
        ],
      }),
      ops.updateCells([{ x: 2, y: 2, z: 0 }], { onEnter: "a" }),
    );
    const out = linksFrom(collectLinks(doc), { kind: "cell", pos: { x: 2, y: 2, z: 0 } });
    expect(out.map((l) => [l.target, l.via])).toEqual([
      [gate, ["a", "b"]],
      [{ kind: "flag", name: "count" }, ["a", "b"]],
    ]);
  });

  it("includes custom params that reference map things", () => {
    const doc = run(
      threeRooms(),
      ops.define("customType", "shake", { category: "action", name: "Shake", params: [{ name: "what", type: "ref:prop" }, { name: "at", type: "gridPos" }] }),
      ops.updateProp("chest", { onUse: { actions: [{ type: "custom", custom: "shake", params: { what: "lever1", at: { x: 1, y: 1, z: 0 } } }] } }),
    );
    const out = linksFrom(collectLinks(doc), { kind: "prop", id: "chest" });
    expect(out.map((l) => l.target)).toEqual([lever1, { kind: "cell", pos: { x: 1, y: 1, z: 0 } }]);
    expect(out[0]!.text).toBe('Shake(what: "lever1", at: (1, 1, 0))');
  });

  it("lists where an event is used", () => {
    expect(eventUsages(threeRooms(), "trap")).toEqual(["cell (6, 4, 0) on enter"]);
    expect(eventUsages(threeRooms(), "toggleGate")).toEqual(["lever1 on use"]);
  });
});

describe("renameState / typeUsage", () => {
  it("renames a connection state across the type and edges", () => {
    let doc = threeRooms();
    doc = run(doc, ops.renameState("connectionType", "door", "closed", "shut"));
    const t = doc.connectionTypes.door!;
    expect(Object.keys(t.states)).toEqual(["shut", "open", "locked"]);
    expect(t.initialState).toBe("shut");
    expect(t.states.open!.transitions).toEqual(["shut"]);
    expect(doc.edges["6,3,0:south"]!.state).toBe("shut");
  });

  it("renames a prop state and refuses clashes", () => {
    let doc = run(threeRooms(), ops.renameState("propType", "lever", "off", "up"));
    expect(doc.propTypes.lever).toMatchObject({ states: ["up", "on"], initialState: "up" });
    expect(doc.props.lever1!.state).toBe("up");
    const before = doc;
    doc = run(doc, ops.renameState("propType", "lever", "up", "on"));
    expect(doc).toBe(before);
  });

  it("counts usage", () => {
    const doc = threeRooms();
    expect(ops.typeUsage(doc, "propType", "lever")).toBe(2);
    expect(ops.typeUsage(doc, "connectionType", "gate")).toBe(1);
    expect(ops.typeUsage(doc, "customType", "nope")).toBe(0);
  });
});

describe("type libraries", () => {
  it("round-trips and merges", () => {
    const src = run(threeRooms(), ops.define("customType", "playSound", { category: "action", name: "Play sound", params: [{ name: "sound", type: "string" }] }));
    const text = JSON.stringify(exportTypeLibrary(src, { customTypes: ["playSound"], propTypes: [], connectionTypes: ["door"] }));
    const parsed = parseTypeLibrary(text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(Object.keys(parsed.library.customTypes)).toEqual(["playSound"]);

    let dst = run(threeRooms(), ops.define("connectionType", "door", { ...threeRooms().connectionTypes.door!, name: "Old door" }));
    expect(libraryDiff(dst, parsed.library)).toEqual({
      connectionTypes: { added: [], replaced: ["door"] },
      propTypes: { added: [], replaced: [] },
      customTypes: { added: ["playSound"], replaced: [] },
    });
    dst = run(dst, importTypeLibrary(parsed.library));
    expect(dst.customTypes.playSound?.name).toBe("Play sound");
    expect(dst.connectionTypes.door?.name).toBe("Wooden door");
  });

  it("rejects bad files", () => {
    expect(parseTypeLibrary("nope").ok).toBe(false);
    expect(parseTypeLibrary(JSON.stringify({ format: "dcmm-types", formatVersion: 1, propTypes: { x: { name: "x", states: [] } } }))).toMatchObject({ ok: false });
  });
});
