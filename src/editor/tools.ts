/**
 * Pointer behavior for each tool. The viewport converts events to world coordinates and
 * calls down/move/up; tools turn gestures into commands. A drag commits one command, so
 * one stroke = one undo step.
 */
import {
  batch, canonicalEdge, cellKey, edgeKey, FACINGS, rectPositions, type Command, type Facing, type GridPos,
  type ResolvedMap, type Side,
} from "../core";
import * as ops from "../core/ops";
import { hitFace, hitTest, type Hit, type HitMode } from "../render/canvas2d/hit";
import { useEditor, type MaterialTarget, type ToolId } from "./store";

export interface PointerInfo {
  wx: number;
  wy: number;
  button: number; // 0 left, 2 right
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export const TOOLS: { id: ToolId; name: string; key: string; hint: string }[] = [
  { id: "select", name: "Select", key: "V", hint: "Click a cell or connection to inspect it. Drag a box to select cells. Shift adds. Delete erases." },
  { id: "room", name: "Room", key: "R", hint: "Drag a rectangle to add a room. Right-drag removes cells." },
  { id: "paint", name: "Paint cells", key: "B", hint: "Drag to paint cells; cells in one stroke open into each other. Right-drag erases." },
  { id: "erase", name: "Erase", key: "E", hint: "Drag over cells to erase them. Click a connection to turn it back into a wall." },
  { id: "edge", name: "Connections", key: "D", hint: "Click a cell edge to place the active connection; click again to cycle its state. Right-click makes a wall. Drag along edges to place many." },
  { id: "material", name: "Material", key: "M", hint: "Click a floor or wall face to paint it. Shift paints the whole room, Alt picks a material, right-click resets." },
  { id: "height", name: "Height", key: "H", hint: "Click or drag over cells to raise them; right-click lowers. In Set mode it paints an exact height instead. Alt picks up a cell's height. = and - nudge the selected or hovered cell from any tool." },
  { id: "ramp", name: "Ramp / Stairs", key: "S", hint: "Drag in the uphill direction to build a ramp or staircase; each cell rises from where the last one ended. Click near a cell edge for a one-cell ramp toward it. Right-click flattens." },
  { id: "vertical", name: "Vertical connections", key: "U", hint: "Click a cell to connect it down through its floor (or up through its ceiling) with the active type; click again to cycle its state. Shift uses the other direction. Right-click removes." },
  { id: "start", name: "Start", key: "T", hint: "Click a cell to put the start there; click it again to turn." },
];

export function hitModeFor(tool: ToolId, target: MaterialTarget): HitMode {
  switch (tool) {
    case "paint": case "room": case "start": case "height": case "ramp": case "vertical": return "cell";
    case "edge": return "edge";
    case "material": return target === "auto" ? "auto" : "cell";
    default: return "auto";
  }
}

const S = () => useEditor.getState();

interface Drag {
  tool: ToolId;
  button: number;
  shift: boolean;
  startX: number;
  startY: number;
  moved: boolean;
  cells: Map<string, GridPos>;
  edges: Map<string, { cell: GridPos; dir: Facing }>;
  faces: Map<string, { pos: GridPos; side: Side }>;
}

let drag: Drag | null = null;

const hit = (p: PointerInfo, mode: HitMode): Hit => hitTest(p.wx, p.wy, S().level, mode);

export function pointerHover(p: PointerInfo | null): void {
  const s = S();
  if (!p) {
    s.set({ hover: null, cursor: null });
    return;
  }
  s.set({
    hover: hit(p, hitModeFor(s.tool, s.materialTarget)),
    cursor: { x: Math.floor(p.wx), y: Math.floor(p.wy) },
  });
}

export function pointerDown(p: PointerInfo): void {
  const s = S();
  drag = {
    tool: s.tool, button: p.button, shift: p.shift, startX: p.wx, startY: p.wy, moved: false,
    cells: new Map(), edges: new Map(), faces: new Map(),
  };
  if (s.tool === "height" && p.alt && p.button === 0) {
    const c = s.resolved.cellAt({ x: Math.floor(p.wx), y: Math.floor(p.wy), z: s.level });
    if (c) {
      const v = s.heightTarget === "ceiling" ? c.ceiling : c.floor;
      s.set({ heightValue: v, heightMode: "set" });
      s.notify(`Picked ${s.heightTarget === "ceiling" ? "ceiling" : "floor"} height ${v}`);
    }
    drag = null;
    return;
  }
  if (s.tool === "material" && p.alt && p.button === 0) {
    pickMaterial(p);
    drag = null;
    return;
  }
  extend(p);
}

export function pointerMove(p: PointerInfo): void {
  pointerHover(p);
  if (!drag) return;
  if (Math.hypot(p.wx - drag.startX, p.wy - drag.startY) > 0.3) drag.moved = true;
  extend(p);
}

export function pointerUp(p: PointerInfo): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  S().set({ preview: null });
  finish(d, p);
}

export function cancelDrag(): void {
  drag = null;
  S().set({ preview: null });
}

/** Accumulate the gesture and update the preview. */
function extend(p: PointerInfo) {
  const d = drag!;
  const s = S();
  const z = s.level;
  switch (d.tool) {
    case "height": {
      const h = hit(p, "cell");
      if (h.kind === "cell" && s.doc.cells[cellKey(h.pos)]) d.cells.set(cellKey(h.pos), h.pos);
      s.set({ preview: { cells: [...d.cells.values()], mode: d.button === 2 ? "remove" : "add" } });
      break;
    }
    case "ramp": {
      const { path } = rampPath(d, p);
      d.cells = new Map(path.map((c) => [cellKey(c), c]));
      s.set({ preview: { cells: path, mode: d.button === 2 ? "remove" : "add" } });
      break;
    }
    case "paint":
    case "erase": {
      const h = hit(p, d.tool === "erase" ? "auto" : "cell");
      if (d.tool === "erase" && !d.moved && h.kind === "edge") break; // maybe an edge click
      const pos = h.kind === "cell" ? h.pos : h.cell;
      d.cells.set(cellKey(pos), pos);
      const remove = d.tool === "erase" || d.button === 2;
      s.set({ preview: { cells: [...d.cells.values()], mode: remove ? "remove" : "add" } });
      break;
    }
    case "room":
    case "select": {
      if (d.tool === "select" && !d.moved) break;
      const a = { x: Math.floor(d.startX), y: Math.floor(d.startY), z };
      const b = { x: Math.floor(p.wx), y: Math.floor(p.wy), z };
      const cells = rectPositions(a, b);
      d.cells = new Map(cells.map((c) => [cellKey(c), c]));
      s.set({ preview: { cells, mode: d.tool === "select" ? "select" : d.button === 2 ? "remove" : "add" } });
      break;
    }
    case "edge": {
      const h = hit(p, "edge");
      if (h.kind !== "edge") break;
      const k = edgeKey(canonicalEdge(h.cell, h.dir));
      d.edges.set(k, { cell: h.cell, dir: h.dir });
      break;
    }
    case "material": {
      for (const f of materialFaces(p, d.shift)) d.faces.set(`${cellKey(f.pos)}:${f.side}`, f);
      s.set({ preview: { cells: [...new Map([...d.faces.values()].map((f) => [cellKey(f.pos), f.pos])).values()], mode: d.button === 2 ? "remove" : "add" } });
      break;
    }
  }
}

function finish(d: Drag, p: PointerInfo) {
  const s = S();
  const z = s.level;
  const exists = (pos: GridPos) => !!s.doc.cells[cellKey(pos)];
  switch (d.tool) {
    case "height": {
      const cells = [...d.cells.values()];
      if (!cells.length) return;
      const target = s.heightTarget;
      if (s.heightMode === "step") {
        const delta = d.button === 2 ? -1 : 1;
        s.exec(ops.adjustHeights(cells, {
          ...(target !== "ceiling" && { floor: delta }),
          ...(target !== "floor" && { ceiling: delta }),
        }));
      } else if (d.button === 2) {
        s.exec(ops.setHeights(cells, {
          ...(target !== "ceiling" && { floor: 0 }),
          ...(target !== "floor" && { ceiling: s.doc.stepsPerLevel }),
        }));
      } else {
        const v = s.heightValue;
        s.exec(ops.setHeights(cells, target === "ceiling" ? { ceiling: v } : target === "floor" ? { floor: v } : { floor: v, keepHeight: true }));
      }
      return;
    }
    case "ramp": {
      const { path, toward } = rampPath(d, p);
      if (d.button === 2) {
        const cells = path.filter(exists);
        if (cells.length) s.exec(ops.flattenCells(cells));
        return;
      }
      try {
        if (s.rampKind === "levelStairs") s.exec(ops.buildLevelStairs(s.doc, path[0]!, toward));
        else s.exec(ops.buildRamp(path, { kind: s.rampKind, rise: s.rampRise, toward }));
      } catch (e) {
        s.notify((e as Error).message, "error");
      }
      return;
    }
    case "vertical": {
      const h = hit(p, "cell");
      if (h.kind !== "cell") return;
      if (!exists(h.pos)) { s.notify("Click an existing cell to connect it up or down.", "error"); return; }
      const dir = d.shift ? (s.verticalDir === "up" ? "down" : "up") : s.verticalDir;
      if (d.button === 2) { s.exec(ops.connectVertical(s.doc, h.pos, dir, null)); return; }
      const type = s.activeVertical;
      const existing = ops.verticalEdgesOf(s.doc, h.pos, dir).map((k) => [k, s.doc.edges[k]!] as const)[0];
      if (existing && existing[1].type === type) {
        const states = Object.keys(s.doc.connectionTypes[type]?.states ?? {});
        if (states.length > 1) {
          const next = states[(states.indexOf(existing[1].state) + 1) % states.length]!;
          s.exec(ops.updateEdge(existing[0], { state: next }));
        }
        return;
      }
      try {
        s.exec(ops.connectVertical(s.doc, h.pos, dir, type, { createMissing: s.createMissing }));
      } catch (e) {
        s.notify((e as Error).message, "error");
      }
      return;
    }
    case "paint": {
      const cells = [...d.cells.values()];
      if (!cells.length) return;
      s.exec(d.button === 2 ? ops.removeCells(cells.filter(exists)) : ops.paintCells(cells));
      return;
    }
    case "room": {
      const cells = [...d.cells.values()];
      if (!cells.length) return;
      s.exec(d.button === 2 ? ops.removeCells(cells.filter(exists)) : ops.paintCells(cells));
      return;
    }
    case "erase": {
      if (!d.moved) {
        const h = hit(p, "auto");
        if (h.kind === "edge") {
          const e = edgeOnSide(s.resolved, h.cell, h.dir);
          if (e) { s.exec(ops.setEdge(e.at, null)); return; }
          d.cells.set(cellKey(h.cell), h.cell);
        }
      }
      const cells = [...d.cells.values()].filter(exists);
      if (cells.length) s.exec(ops.removeCells(cells));
      return;
    }
    case "edge": {
      // Address existing cross-level connections exactly; new ones are same-level.
      const list = [...d.edges.values()].map((e) => edgeOnSide(s.resolved, e.cell, e.dir)?.at ?? e);
      if (!list.length) return;
      if (d.button === 2) {
        s.exec(batch("Make walls", list.map((e) => ops.setEdge(e, null))));
        return;
      }
      const type = s.activeConnection;
      if (list.length === 1) {
        const e = list[0]!;
        const existing = s.doc.edges[ops.edgeKeyAt(e)];
        if (existing && existing.type === type) {
          const states = Object.keys(s.doc.connectionTypes[type]?.states ?? {});
          const next = states[(states.indexOf(existing.state) + 1) % states.length] ?? existing.state;
          s.exec(ops.setEdge(e, type, { state: next }));
          return;
        }
      }
      s.exec(batch(list.length > 1 ? `Place ${list.length} connections` : "Set connection", list.map((e) => ops.setEdge(e, type))));
      return;
    }
    case "material": {
      const faces = [...d.faces.values()].filter((f) => exists(f.pos));
      if (!faces.length) return;
      const mat = d.button === 2 ? null : s.activeMaterial;
      s.exec(batch(mat ? "Paint material" : "Reset material", faces.map((f) => ops.setSurface([f.pos], f.side, mat))));
      return;
    }
    case "start": {
      const h = hit(p, "cell");
      if (h.kind !== "cell" || !exists(h.pos)) return;
      const cur = s.doc.start;
      const same = cur && cur.cell.x === h.pos.x && cur.cell.y === h.pos.y && cur.cell.z === h.pos.z;
      const facing = same ? FACINGS[(FACINGS.indexOf(cur.facing) + 1) % 4]! : (cur?.facing ?? "east");
      s.exec(ops.setStart({ cell: h.pos, facing }));
      return;
    }
    case "select": {
      if (d.moved) {
        const cells = [...d.cells.values()].filter(exists).map(cellKey);
        s.select({ cells }, d.shift);
        return;
      }
      const h = hit(p, "auto");
      if (h.kind === "edge") {
        const e = edgeOnSide(s.resolved, h.cell, h.dir);
        if (e) { s.select({ edges: [e.key] }, d.shift); return; }
      }
      const pos = h.kind === "cell" ? h.pos : h.cell;
      if (!exists(pos)) { if (!d.shift) s.clearSelection(); return; }
      s.select({ cells: [cellKey(pos)] }, d.shift);
      return;
    }
  }
  void z;
}

/**
 * The straight run of cells for the ramp tool, and its uphill direction: along the drag's
 * dominant axis, or (for a click) toward the cell edge nearest the click point. Level stairs
 * use only the first cell.
 */
export function rampPath(d: { startX: number; startY: number }, p: { wx: number; wy: number }, z = S().level, single = S().rampKind === "levelStairs"): { path: GridPos[]; toward: Facing } {
  const sx = Math.floor(d.startX), sy = Math.floor(d.startY);
  const dx = Math.floor(p.wx) - sx, dy = Math.floor(p.wy) - sy;
  let toward: Facing;
  let n: number;
  if (dx === 0 && dy === 0) {
    const h = hitTest(d.startX, d.startY, z, "edge");
    toward = h.kind === "edge" ? h.dir : "east";
    n = 0;
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    toward = dx > 0 ? "east" : "west";
    n = Math.abs(dx);
  } else {
    toward = dy > 0 ? "south" : "north";
    n = Math.abs(dy);
  }
  if (single) n = 0;
  const step = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[toward];
  const path = Array.from({ length: n + 1 }, (_, i) => ({ x: sx + step[0]! * i, y: sy + step[1]! * i, z }));
  return { path, toward };
}

/**
 * The connection on one side of a cell, whatever level its far end is on, as an EdgeAt
 * that addresses it exactly (with toZ when it crosses levels).
 */
export function edgeOnSide(map: ResolvedMap, cell: GridPos, side: Facing): { key: string; at: { cell: GridPos; dir: Facing; toZ?: number } } | null {
  const found = map.edgesOf(cell).find((e) => e.dir === side);
  if (found) {
    const other = found.edge.from.x === cell.x && found.edge.from.y === cell.y && found.edge.from.z === cell.z ? found.edge.to : found.edge.from;
    return { key: found.edge.key, at: { cell, dir: side, ...(other.z !== cell.z && { toZ: other.z }) } };
  }
  return null;
}

/** Faces the material tool would paint at this pointer position. */
function materialFaces(p: PointerInfo, flood: boolean): { pos: GridPos; side: Side }[] {
  const s = S();
  const z = s.level;
  const target = s.materialTarget;
  let pos: GridPos;
  let sides: Side[];
  if (target === "auto") {
    const f = hitFace(p.wx, p.wy, z);
    pos = f.pos;
    sides = [f.side];
  } else {
    pos = { x: Math.floor(p.wx), y: Math.floor(p.wy), z };
    sides = target === "floor" ? ["down"] : target === "ceiling" ? ["up"] : target === "walls" ? [...FACINGS] : [...FACINGS, "up", "down"];
  }
  const cells = flood ? floodRoom(s.resolved, pos) : [pos];
  return cells.flatMap((c) => sides.map((side) => ({ pos: c, side })));
}

function pickMaterial(p: PointerInfo) {
  const s = S();
  const f = hitFace(p.wx, p.wy, s.level);
  const c = s.resolved.cellAt(f.pos);
  if (!c) return;
  const mat = c.surfaces[s.materialTarget === "ceiling" ? "up" : f.side];
  s.set({ activeMaterial: mat });
  s.notify(`Picked material "${mat}"`);
}

/** Cells reachable from `start` on its level through any connection (doors included): "the room". */
export function floodRoom(map: ResolvedMap, start: GridPos): GridPos[] {
  if (!map.cellAt(start)) return [start];
  const seen = new Map<string, GridPos>();
  const stack = [start];
  while (stack.length) {
    const p = stack.pop()!;
    const k = cellKey(p);
    if (seen.has(k)) continue;
    seen.set(k, p);
    for (const { edge } of map.edgesOf(p)) {
      if (edge.vertical || edge.from.z !== edge.to.z) continue;
      const kind = map.connectionTypes[edge.type]?.kind;
      if (kind !== "opening") continue; // doors and gates bound a room
      for (const q of [edge.from, edge.to]) if (map.cellAt(q) && !seen.has(cellKey(q))) stack.push(q);
    }
  }
  return [...seen.values()];
}

/** Delete whatever is selected. */
export function deleteSelection(): void {
  const s = S();
  const cmds: Command[] = [];
  for (const k of s.selection.edges) {
    const e = s.doc.edges[k];
    if (e) cmds.push(ops.setEdge({ cell: e.from, dir: e.dir, ...(e.toZ !== undefined && { toZ: e.toZ }) }, null));
  }
  for (const id of s.selection.props) cmds.push(ops.removeProp(id));
  const cells = s.selection.cells.map((k) => s.doc.cells[k]?.pos).filter((p): p is GridPos => !!p);
  if (cells.length) cmds.push(ops.removeCells(cells));
  if (cmds.length) {
    s.exec(batch("Delete selection", cmds));
    s.clearSelection();
  }
}
