/** Starting, stopping and syncing the first-person playtest. */
import { batch, cellKey, parseCellKey, Runtime, type Command, type Start } from "../core";
import * as ops from "../core/ops";
import { useEditor } from "./store";

const S = () => useEditor.getState();

export function startPlaytest(from?: Start): void {
  const s = S();
  const start = from ?? s.doc.start ?? undefined;
  if (!start || !s.resolved.cellAt(start.cell)) {
    s.notify("Set a start position first (Start tool, T), or select a cell and press Shift+F5 to start there.", "error");
    return;
  }
  const runtime = new Runtime(s.resolved, {
    start,
    customCondition: (id) => S().customConds[id] ?? true,
  });
  runtime.subscribe(() => S().set({ playTick: S().playTick + 1 }));
  const returnTo = s.viewMode === "3d" ? "3d" : "2d";
  s.set({ playtest: { runtime, from: start, returnTo }, viewMode: "play", pick: null, preview: null });
  runtime.begin();
}

/** Start from the selected cell (or the hovered one in 2D), keeping the map's start facing. */
export function startPlaytestHere(): void {
  const s = S();
  const k = s.selection.cells[0] ?? (s.hover ? cellKey(s.hover.kind === "cell" ? s.hover.pos : s.hover.cell) : undefined);
  if (!k || !s.doc.cells[k]) { startPlaytest(); return; }
  startPlaytest({ cell: parseCellKey(k), facing: s.doc.start?.facing ?? "north" });
}

export function stopPlaytest(): void {
  const s = S();
  if (!s.playtest) return;
  const p = s.playtest.runtime.state.player;
  s.set({ viewMode: s.playtest.returnTo, playtest: null, level: p.pos.z });
}

export function restartPlaytest(): void {
  const p = S().playtest;
  if (p) startPlaytestFrom(p.from, p.returnTo);
}

function startPlaytestFrom(from: Start, returnTo: "2d" | "3d") {
  startPlaytest(from);
  const pt = S().playtest;
  if (pt) S().set({ playtest: { ...pt, returnTo } });
}

/** Copy the playtest's current states and flag values into the map as its starting values. */
export function copyStateToMap(): void {
  const s = S();
  const rt = s.playtest?.runtime;
  if (!rt) return;
  const cmds: Command[] = [];
  for (const [k, st] of Object.entries(rt.state.edges)) if (s.doc.edges[k] && s.doc.edges[k]!.state !== st) cmds.push(ops.updateEdge(k, { state: st }));
  for (const [id, st] of Object.entries(rt.state.props)) if (s.doc.props[id] && s.doc.props[id]!.state !== st) cmds.push(ops.updateProp(id, { state: st }));
  for (const [name, v] of Object.entries(rt.state.flags)) {
    const f = s.doc.flags[name];
    if (f && f.initial !== v) cmds.push(ops.define("flag", name, { ...f, initial: v } as typeof f));
  }
  if (!cmds.length) { s.notify("Nothing differs from the map's starting state."); return; }
  s.exec(batch("Copy playtest state", cmds));
  s.notify(`Copied ${cmds.length} value(s) into the map's starting state. Undo reverts it.`);
}
