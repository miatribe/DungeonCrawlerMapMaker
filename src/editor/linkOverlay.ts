/** Turns logic links into arrows for the 2D view: for the selection, or all of them. */
import { cellKey, refKey, sameRef, type Link, type LogicRef, type ResolvedMap } from "../core";
import type { DrawLink } from "../render/canvas2d/draw";
import { propPoint } from "../render/canvas2d/hit";
import type { EditorStore } from "./store";

/** Where a logic ref sits on the map, if it has a place. */
export function refPoint(map: ResolvedMap, r: LogicRef): { x: number; y: number; z: number } | null {
  switch (r.kind) {
    case "cell": return { x: r.pos.x + 0.5, y: r.pos.y + 0.5, z: r.pos.z };
    case "prop": {
      const p = map.propById(r.id);
      return p ? { ...propPoint(p), z: p.cell.z } : null;
    }
    case "edge": {
      const e = map.edges.find((x) => x.key === r.key);
      if (!e) return null;
      if (e.vertical) return { x: e.from.x + 0.27, y: e.from.y + 0.27, z: e.to.z };
      return {
        x: e.from.x + (e.dir === "east" ? 1 : 0.5),
        y: e.from.y + (e.dir === "south" ? 1 : 0.5),
        z: e.from.z,
      };
    }
    default: return null;
  }
}

export function selectedRefs(s: Pick<EditorStore, "selection" | "doc">): LogicRef[] {
  return [
    ...s.selection.cells.flatMap((k): LogicRef[] => (s.doc.cells[k] ? [{ kind: "cell", pos: s.doc.cells[k]!.pos }] : [])),
    ...s.selection.edges.map((key): LogicRef => ({ kind: "edge", key })),
    ...s.selection.props.map((id): LogicRef => ({ kind: "prop", id })),
  ];
}

export function overlayLinks(s: Pick<EditorStore, "links" | "resolved" | "selection" | "doc" | "showAllLinks">): DrawLink[] {
  const chosen = new Map<string, { l: Link; faint: boolean }>();
  const add = (l: Link, faint: boolean) => {
    if (sameRef(l.source, l.target) && l.source.kind !== "prop") return;
    const k = `${refKey(l.source)}>${refKey(l.target)}>${l.effect}`;
    const prev = chosen.get(k);
    if (!prev || (prev.faint && !faint)) chosen.set(k, { l, faint });
  };
  if (s.showAllLinks) for (const l of s.links) add(l, true);
  const sel = selectedRefs(s);
  if (sel.length) {
    const keys = new Set(sel.map(refKey));
    for (const l of s.links) if (keys.has(refKey(l.source)) || keys.has(refKey(l.target))) add(l, false);
  }
  const out: DrawLink[] = [];
  for (const { l, faint } of chosen.values()) {
    const a = refPoint(s.resolved, l.source);
    const b = refPoint(s.resolved, l.target);
    if (a && b) out.push({ a, b, effect: l.effect, faint });
  }
  return out;
}

export function triggerCells(map: ResolvedMap): Set<string> {
  return new Set(map.cells.filter((c) => c.onEnter !== undefined || c.onExit !== undefined).map((c) => cellKey(c.pos)));
}
