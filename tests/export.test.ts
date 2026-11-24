import { describe, expect, it } from "vitest";
import { createMap, run } from "../src/core";
import * as ops from "../src/core/ops";
import { getExporter, listExporters, registerExporter, runExport } from "../src/exporters";
import { RuntimeMapSchema } from "../src/exporters/json/schema";
import { threeRooms, tower } from "./fixtures/maps";

const exportJson = (doc = threeRooms(), options = {}, assets = {}) => {
  const r = runExport("json", doc, options, assets);
  if (!r.ok) throw new Error(JSON.stringify(r.problems, null, 2));
  return r;
};
const parse = (r: ReturnType<typeof exportJson>) => JSON.parse(r.result.files[0]!.data as string);

describe("JSON exporter", () => {
  it("is registered", () => {
    expect(listExporters().map((e) => e.id)).toContain("json");
    expect(() => registerExporter(getExporter("json")!)).toThrow();
  });

  it("matches the golden files", async () => {
    await expect(exportJson(threeRooms()).result.files[0]!.data).toMatchFileSnapshot("./golden/three-rooms.json");
    await expect(exportJson(tower()).result.files[0]!.data).toMatchFileSnapshot("./golden/tower.json");
  });

  it("output conforms to the runtime schema", () => {
    for (const doc of [threeRooms(), tower()]) {
      const parsed = RuntimeMapSchema.safeParse(parse(exportJson(doc)));
      expect(parsed.error?.issues ?? []).toEqual([]);
    }
  });

  it("resolves every surface and names the file after the map", () => {
    const r = exportJson();
    expect(r.result.files[0]!.name).toBe("three-rooms.json");
    const data = parse(r);
    for (const c of data.cells) expect(Object.keys(c.surfaces).sort()).toEqual(["down", "east", "north", "south", "up", "west"]);
    expect(data.edges.find((e: any) => e.id === "gate")).toMatchObject({ from: { x: 3, y: 2, z: 0 }, to: { x: 4, y: 2, z: 0 }, dir: "east" });
  });

  it("is byte-identical for the same map regardless of edit order", () => {
    const a = threeRooms();
    const b = { ...a, edges: Object.fromEntries(Object.entries(a.edges).reverse()), props: Object.fromEntries(Object.entries(a.props).reverse()) };
    expect(exportJson(b).result.files[0]!.data).toBe(exportJson(a).result.files[0]!.data);
  });

  it("pruneUnused drops unused definitions transitively", () => {
    let doc = run(
      threeRooms(),
      ops.define("material", "orphanMat", { name: "o", color: "#111111" }),
      ops.define("event", "orphanA", { actions: [{ type: "runEvent", event: "orphanB" }] }),
      ops.define("event", "orphanB", { actions: [{ type: "setSurface", cell: { x: 1, y: 1, z: 0 }, side: "north", material: "orphanMat" }] }),
    );
    const full = parse(exportJson(doc));
    expect(full.events.orphanA).toBeDefined();
    const pruned = parse(exportJson(doc, { pruneUnused: true }));
    expect(pruned.events.orphanA).toBeUndefined();
    expect(pruned.events.orphanB).toBeUndefined();
    expect(pruned.materials.orphanMat).toBeUndefined();
    expect(pruned.materials.iron).toBeDefined(); // gate's material
    expect(pruned.materials.water).toBeUndefined();
    expect(Object.keys(pruned.connectionTypes).sort()).toEqual(["door", "gate", "opening"]);
    expect(pruned.events.toggleGate).toBeDefined();
  });

  it("embeds preview textures only when asked", () => {
    const doc = run(threeRooms(), ops.define("material", "flagA", { name: "Flagstone A", color: "#4a3a38", texture: "tex1" }));
    const assets = { tex1: { mime: "image/png" as const, data: "data:image/png;base64,AAAA" } };
    expect(parse(exportJson(doc, {}, assets)).materials.flagA.texture).toBeUndefined();
    expect(parse(exportJson(doc, { includePreviewTextures: true }, assets)).materials.flagA.texture).toBe("data:image/png;base64,AAAA");
    expect(exportJson(doc, { includePreviewTextures: true }, {}).result.warnings).toEqual(['Material "flagA" references missing texture asset "tex1"']);
  });

  it("is blocked by validation errors", () => {
    const r = runExport("json", createMap());
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toContain("V-START");
  });
});
