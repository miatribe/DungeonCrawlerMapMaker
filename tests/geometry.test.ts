import { describe, expect, it } from "vitest";
import { canonicalEdge, edgeKey, edgeKeyOf, edgeTo, rectPositions } from "../src/core";

describe("canonical edges", () => {
  const p = { x: 3, y: 2, z: 0 };

  it("keeps east/south/up as-is and drops default toZ", () => {
    expect(canonicalEdge(p, "east")).toEqual({ from: p, dir: "east" });
    expect(canonicalEdge(p, "south", 0)).toEqual({ from: p, dir: "south" });
    expect(canonicalEdge(p, "up")).toEqual({ from: p, dir: "up" });
  });

  it("flips west/north/down onto the neighbor", () => {
    expect(canonicalEdge(p, "west")).toEqual({ from: { x: 2, y: 2, z: 0 }, dir: "east" });
    expect(canonicalEdge(p, "north")).toEqual({ from: { x: 3, y: 1, z: 0 }, dir: "south" });
    expect(canonicalEdge(p, "down")).toEqual({ from: { x: 3, y: 2, z: -1 }, dir: "up" });
  });

  it("gives both sides of a boundary the same key", () => {
    expect(edgeKeyOf(p, "east")).toBe(edgeKeyOf({ x: 4, y: 2, z: 0 }, "west"));
    expect(edgeKeyOf(p, "south")).toBe(edgeKeyOf({ x: 3, y: 3, z: 0 }, "north"));
    expect(edgeKeyOf(p, "up")).toBe(edgeKeyOf({ x: 3, y: 2, z: 1 }, "down"));
  });

  it("handles cross-level horizontal edges", () => {
    const a = canonicalEdge(p, "east", 1);
    expect(a).toEqual({ from: p, dir: "east", toZ: 1 });
    expect(edgeKey(a)).toBe("3,2,0:east>1");
    expect(edgeTo(a)).toEqual({ x: 4, y: 2, z: 1 });
    // same boundary seen from the upper cell
    expect(canonicalEdge({ x: 4, y: 2, z: 1 }, "west", 0)).toEqual(a);
  });

  it("supports tall vertical spans and rejects bad ones", () => {
    expect(edgeTo(canonicalEdge(p, "up", 2))).toEqual({ x: 3, y: 2, z: 2 });
    expect(() => canonicalEdge(p, "up", 0)).toThrow();
    expect(() => canonicalEdge(p, "down", 1)).toThrow();
  });

  it("enumerates rectangles", () => {
    expect(rectPositions({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })).toHaveLength(4);
  });
});
