/**
 * In-memory document model. Same content as MapData, but cells, edges and props are
 * keyed for O(1) lookup and stable undo patches.
 */
import { cellKey, comparePos, edgeKey, type CellKey, type EdgeKey } from "./geometry";
import type { Cell, Edge, MapData, Prop } from "./schema";

export interface MapDoc extends Omit<MapData, "cells" | "edges" | "props"> {
  cells: Record<CellKey, Cell>;
  edges: Record<EdgeKey, Edge>;
  props: Record<string, Prop>;
}

export function toDoc(data: MapData): MapDoc {
  const cells: Record<CellKey, Cell> = {};
  for (const c of data.cells) cells[cellKey(c.pos)] = c;
  const edges: Record<EdgeKey, Edge> = {};
  for (const e of data.edges) edges[edgeKey(e)] = e;
  const props: Record<string, Prop> = {};
  for (const p of data.props) props[p.id] = p;
  return { ...data, cells, edges, props };
}

export function fromDoc(doc: MapDoc): MapData {
  const cells = Object.values(doc.cells).sort((a, b) => comparePos(a.pos, b.pos));
  const edges = Object.values(doc.edges).sort(
    (a, b) => comparePos(a.from, b.from) || a.dir.localeCompare(b.dir) || (a.toZ ?? 0) - (b.toZ ?? 0),
  );
  const props = Object.values(doc.props).sort((a, b) => a.id.localeCompare(b.id));
  return { ...doc, cells, edges, props };
}

/** Find a free id like `door_3` among the existing ids. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let i = 1; ; i++) {
    const id = `${prefix}_${i}`;
    if (!set.has(id)) return id;
  }
}

export function edgeIds(doc: MapDoc): string[] {
  return Object.values(doc.edges).flatMap((e) => (e.id ? [e.id] : []));
}
