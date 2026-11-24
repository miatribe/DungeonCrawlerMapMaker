import { describe, expect, it } from "vitest";
import { resolve } from "../src/core";
import { threeRooms, tower } from "./fixtures/maps";

describe("resolve", () => {
  it("fills defaults and absolute heights", () => {
    const r = resolve(tower());
    const upper = r.cellAt({ x: 4, y: 1, z: 1 })!;
    expect(upper.abs).toEqual({ floor: 4, ceiling: 8 });
    expect(upper.surfaces).toEqual({ north: "stone", east: "stone", south: "stone", west: "stone", up: "ceiling", down: "wood" });
    expect(r.cellAt({ x: 0, y: 1, z: 0 })!.abs.floor).toBe(-1);
  });

  it("looks edges up from either side", () => {
    const r = resolve(threeRooms());
    expect(r.edgeAt({ x: 4, y: 2, z: 0 }, "west")?.id).toBe("gate");
    expect(r.edgeById("door")?.to).toEqual({ x: 6, y: 4, z: 0 });
    const t = resolve(tower());
    expect(t.edgeAt({ x: 4, y: 1, z: 1 }, "west", 0)?.from).toEqual({ x: 3, y: 1, z: 0 });
    expect(t.edgeAt({ x: 4, y: 2, z: 0 }, "up")?.type).toBe("pit");
    expect(t.edgesOf({ x: 3, y: 1, z: 0 }).map((e) => e.dir).sort()).toEqual(["east", "west"]);
  });

  it("derives risers at floor height changes only", () => {
    const r = resolve(tower());
    expect(r.risers).toEqual([
      {
        between: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], kind: "floor",
        from: -1, to: 0, material: "stone", facing: "south",
      },
      {
        between: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], kind: "floor",
        from: -1, to: 0, material: "stone", facing: "west",
      },
      {
        between: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }], kind: "floor",
        from: -1, to: 0, material: "stone", facing: "north",
      },
      // stairs (ceiling 8) next to the ground room (ceiling 4)
      {
        between: [{ x: 2, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }], kind: "ceiling",
        from: 4, to: 8, material: "stone", facing: "east",
      },
    ]);
  });

  it("is deterministic regardless of insertion order", () => {
    const a = threeRooms();
    const b = { ...a, cells: Object.fromEntries(Object.entries(a.cells).reverse()) };
    const strip = (r: ReturnType<typeof resolve>) => JSON.stringify({ c: r.cells, e: r.edges });
    expect(strip(resolve(b))).toBe(strip(resolve(a)));
  });
});
