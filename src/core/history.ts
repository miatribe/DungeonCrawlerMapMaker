/**
 * Undo/redo over immutable MapDocs using Immer patches (SPEC §8.7).
 * Every edit is a Command: a label plus a recipe that mutates a draft.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type { MapDoc } from "./model";

enablePatches();

export interface Command {
  label: string;
  recipe: (draft: Draft<MapDoc>) => void;
}

interface Entry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface History {
  past: Entry[];
  future: Entry[];
  limit: number;
}

export function createHistory(limit = 200): History {
  return { past: [], future: [], limit };
}

export interface EditResult {
  doc: MapDoc;
  history: History;
  changed: boolean;
}

export function apply(doc: MapDoc, history: History, cmd: Command): EditResult {
  const [next, patches, inverse] = produceWithPatches(doc, cmd.recipe);
  if (patches.length === 0) return { doc, history, changed: false };
  const past = [...history.past, { label: cmd.label, patches, inverse }];
  if (past.length > history.limit) past.splice(0, past.length - history.limit);
  return { doc: next, history: { ...history, past, future: [] }, changed: true };
}

export function undo(doc: MapDoc, history: History): EditResult {
  const entry = history.past.at(-1);
  if (!entry) return { doc, history, changed: false };
  return {
    doc: applyPatches(doc, entry.inverse),
    history: { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] },
    changed: true,
  };
}

export function redo(doc: MapDoc, history: History): EditResult {
  const [entry, ...rest] = history.future;
  if (!entry) return { doc, history, changed: false };
  return {
    doc: applyPatches(doc, entry.patches),
    history: { ...history, past: [...history.past, entry], future: rest },
    changed: true,
  };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
export const undoLabel = (h: History) => h.past.at(-1)?.label;
export const redoLabel = (h: History) => h.future[0]?.label;

/** Run a command once without history (handy for building fixtures and imports). */
export function run(doc: MapDoc, ...cmds: Command[]): MapDoc {
  let h = createHistory(1);
  for (const c of cmds) ({ doc, history: h } = apply(doc, h, c));
  return doc;
}
