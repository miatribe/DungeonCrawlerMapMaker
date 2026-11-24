import { describe, expect, it } from "vitest";
import { loadProject, migrate, saveProject, stringifyProject } from "../src/core";
import { threeRooms, tower } from "./fixtures/maps";

describe("project files", () => {
  it("round-trips through save and load", () => {
    for (const doc of [threeRooms(), tower()]) {
      const text = stringifyProject(saveProject(doc, { editor: { view: { level: 1 } } }));
      const loaded = loadProject(text);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
      expect(loaded.problems).toEqual([]);
      expect(loaded.doc).toEqual(doc);
      expect(loaded.editor.view?.level).toBe(1);
      // saving again is stable
      expect(stringifyProject(saveProject(loaded.doc, { editor: loaded.editor }))).toBe(text);
    }
  });

  it("rejects non-projects, bad JSON and newer formats", () => {
    expect(loadProject("{").ok).toBe(false);
    expect(loadProject({ format: "something" }).ok).toBe(false);
    const newer = { ...saveProject(threeRooms()), formatVersion: 99 };
    const r = loadProject(newer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.message).toMatch(/newer DCMM/);
  });

  it("reports schema errors with paths", () => {
    const file = structuredClone(saveProject(threeRooms())) as any;
    file.map.cells[0].floor = 1.5;
    const r = loadProject(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.message).toMatch(/^map\.cells\.0\.floor/);
  });

  it("drops duplicates and normalizes default toZ", () => {
    const file = structuredClone(saveProject(threeRooms())) as any;
    file.map.cells.push(structuredClone(file.map.cells[0]));
    file.map.edges[0].toZ = file.map.edges[0].from.z;
    const r = loadProject(file);
    if (!r.ok) throw new Error("load failed");
    expect(r.problems.map((p) => p.code)).toEqual(["V-DUPID"]);
    expect(Object.values(r.doc.edges).every((e) => !("toZ" in e))).toBe(true);
  });

  it("migrate applies steps in order", () => {
    const steps = { 1: (r: any) => ({ ...r, formatVersion: 2, a: 1 }), 2: (r: any) => ({ ...r, formatVersion: 3, b: r.a + 1 }) };
    expect(migrate({ formatVersion: 1 }, steps, 3)).toEqual({ ok: true, raw: { formatVersion: 3, a: 1, b: 2 }, migratedFrom: 1 });
    expect(migrate({ formatVersion: 1 }, {}, 2)).toMatchObject({ ok: false, reason: "invalid" });
  });
});
