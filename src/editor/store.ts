/** Editor state (Zustand). The map itself lives in `doc`; every change goes through `exec`. */
import { create } from "zustand";
import {
  apply, cellKey, collectLinks, createHistory, type Link, createMap, loadProject, redo as redoH, resolve, saveProject, stringifyProject,
  undo as undoH, validate, type Command, type EditorState, type History, type MapDoc, type Problem,
  type ProjectFile, type ResolvedMap,
} from "../core";
import type { View } from "../render/canvas2d/view";
import type { Hit } from "../render/canvas2d/hit";
import type { GridPos } from "../core/geometry";
import { autosave, type FileHandle } from "./persistence";
import threeRoomsText from "../../examples/three-rooms.dcmm?raw";
import towerText from "../../examples/tower.dcmm?raw";

export type ToolId = "select" | "paint" | "room" | "erase" | "edge" | "material" | "height" | "ramp" | "vertical" | "prop" | "start";
export type DockTab = "levels" | "events" | "flags" | "types" | "problems";

/** "Pick on map" mode: the next click answers a form field instead of using the tool. */
export type PickKind = "cell" | "edge" | "prop";
export interface PickRequest {
  kinds: PickKind[];
  prompt: string;
  /** Which form control asked, so only that button shows as active. */
  owner?: string;
  resolve: (r: { kind: "cell"; pos: GridPos } | { kind: "edge"; key: string } | { kind: "prop"; id: string }) => void;
}
export type MaterialTarget = "auto" | "floor" | "ceiling" | "walls" | "all";
export type HeightTarget = "floor" | "ceiling" | "both";
export type RampKind = "ramp" | "stairs" | "levelStairs";

export interface Selection {
  cells: string[];
  edges: string[];
  props: string[];
}

const EMPTY_SEL: Selection = { cells: [], edges: [], props: [] };

export const EXAMPLES: Record<string, { name: string; text: string }> = {
  "three-rooms": { name: "Three Rooms", text: threeRoomsText },
  tower: { name: "Tower (multi-level)", text: towerText },
};

interface Derived {
  resolved: ResolvedMap;
  problems: Problem[];
  problemCells: Set<string>;
  links: Link[];
}

function derive(doc: MapDoc): Derived {
  const resolved = resolve(doc);
  const problems = validate(doc, resolved);
  const problemCells = new Set(problems.filter((p) => p.severity === "error" && p.cell).map((p) => cellKey(p.cell!)));
  return { resolved, problems, problemCells, links: collectLinks(doc) };
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export interface EditorStore extends Derived {
  doc: MapDoc;
  history: History;
  assets: NonNullable<ProjectFile["assets"]>;
  notes: NonNullable<EditorState["notes"]>;
  docUid: string;
  fileName: string | null;
  fileHandle: FileHandle | undefined;
  dirty: boolean;

  tool: ToolId;
  activeConnection: string;
  activeVertical: string;
  activeMaterial: string;
  materialTarget: MaterialTarget;
  heightTarget: HeightTarget;
  heightMode: "step" | "set";
  heightValue: number;
  rampKind: RampKind;
  rampRise: number;
  verticalDir: "down" | "up";
  createMissing: boolean;
  activeProp: string;
  dockTab: DockTab;
  dockHeight: number;
  showAllLinks: boolean;
  editingEvent: string | null;
  pick: PickRequest | null;
  level: number;
  view: View;
  ghostAbove: boolean;
  ghostBelow: boolean;
  showHeights: boolean;
  selection: Selection;
  hover: Hit | null;
  hoverProp: string | null;
  preview: { cells?: GridPos[]; mode: "add" | "remove" | "select" } | null;
  cursor: { x: number; y: number } | null;
  toast: { text: string; kind: "info" | "error"; at: number } | null;
  exportOpen: boolean;
  recentOpen: boolean;
  /** Bumped when something outside wants the viewport to re-center. */
  focusRequest: { x: number; y: number; at: number } | null;
  /** The viewport should fit the map once it knows its size (file had no saved view). */
  pendingFit: boolean;

  exec(cmd: Command): void;
  undo(): void;
  redo(): void;
  setTool(t: ToolId): void;
  setLevel(z: number): void;
  setView(v: View): void;
  select(sel: Partial<Selection>, additive?: boolean): void;
  clearSelection(): void;
  set(p: Partial<EditorStore>): void;
  notify(text: string, kind?: "info" | "error"): void;
  newMap(): void;
  loadText(text: string, opts?: { fileName?: string | null; handle?: FileHandle; uid?: string; silent?: boolean }): boolean;
  projectText(): string;
  markSaved(fileName: string | null, handle: FileHandle | undefined): void;
  focusCell(x: number, y: number, z: number): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useEditor = create<EditorStore>((set, get) => {
  const initial = createMap();

  const scheduleAutosave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const s = get();
      void autosave({ uid: s.docUid, name: s.doc.name, savedAt: Date.now(), text: s.projectText() });
    }, 1000);
  };

  const commit = (doc: MapDoc, history: History) => {
    set({ doc, history, dirty: true, ...derive(doc) });
    // drop selected things that no longer exist
    const s = get();
    const sel = s.selection;
    const cells = sel.cells.filter((k) => doc.cells[k]);
    const edges = sel.edges.filter((k) => doc.edges[k]);
    const props = sel.props.filter((k) => doc.props[k]);
    if (cells.length !== sel.cells.length || edges.length !== sel.edges.length || props.length !== sel.props.length)
      set({ selection: { cells, edges, props } });
    scheduleAutosave();
  };

  return {
    doc: initial,
    history: createHistory(),
    ...derive(initial),
    assets: {},
    notes: [],
    docUid: uid(),
    fileName: null,
    fileHandle: undefined,
    dirty: false,

    tool: "paint",
    activeConnection: "door",
    activeVertical: "hatch",
    activeMaterial: "stone",
    materialTarget: "auto",
    heightTarget: "floor",
    heightMode: "step",
    heightValue: 0,
    rampKind: "stairs",
    rampRise: 1,
    verticalDir: "down",
    createMissing: true,
    activeProp: "lever",
    dockTab: "levels",
    dockHeight: 210,
    showAllLinks: false,
    editingEvent: null,
    pick: null,
    level: 0,
    view: { panX: 80, panY: 80, zoom: 36 },
    ghostAbove: false,
    ghostBelow: true,
    showHeights: true,
    selection: EMPTY_SEL,
    hover: null,
    hoverProp: null,
    preview: null,
    cursor: null,
    toast: null,
    exportOpen: false,
    recentOpen: false,
    focusRequest: null,
    pendingFit: false,

    exec(cmd) {
      const s = get();
      try {
        const r = apply(s.doc, s.history, cmd);
        if (r.changed) commit(r.doc, r.history);
      } catch (e) {
        get().notify((e as Error).message, "error");
      }
    },
    undo() {
      const s = get();
      const r = undoH(s.doc, s.history);
      if (r.changed) commit(r.doc, r.history);
    },
    redo() {
      const s = get();
      const r = redoH(s.doc, s.history);
      if (r.changed) commit(r.doc, r.history);
    },
    setTool: (tool) => set({ tool }),
    setLevel: (level) => set({ level }),
    setView: (view) => set({ view }),
    select(sel, additive = false) {
      const cur = get().selection;
      if (!additive) {
        set({ selection: { cells: sel.cells ?? [], edges: sel.edges ?? [], props: sel.props ?? [] } });
        return;
      }
      const toggle = (a: string[], b: string[] = []) => {
        const s = new Set(a);
        for (const x of b) s.has(x) ? s.delete(x) : s.add(x);
        return [...s];
      };
      set({ selection: { cells: toggle(cur.cells, sel.cells), edges: toggle(cur.edges, sel.edges), props: toggle(cur.props, sel.props) } });
    },
    clearSelection: () => set({ selection: EMPTY_SEL }),
    set: (p) => set(p),
    notify: (text, kind = "info") => set({ toast: { text, kind, at: Date.now() } }),

    newMap() {
      const doc = createMap();
      set({
        doc, history: createHistory(), ...derive(doc), assets: {}, notes: [], docUid: uid(),
        fileName: null, fileHandle: undefined, dirty: false, selection: EMPTY_SEL, level: 0,
        view: { panX: 80, panY: 80, zoom: 36 }, tool: "room",
      });
      get().notify("New map. Drag with the Room tool to start.");
    },

    loadText(text, opts = {}) {
      const r = loadProject(text);
      if (!r.ok) {
        get().notify(`Couldn't open: ${r.problems[0]?.message ?? "unknown error"}`, "error");
        return false;
      }
      const v = r.editor.view ?? {};
      set({
        doc: r.doc,
        history: createHistory(),
        ...derive(r.doc),
        assets: r.assets,
        notes: r.editor.notes ?? [],
        docUid: opts.uid ?? uid(),
        fileName: opts.fileName ?? null,
        fileHandle: opts.handle,
        dirty: false,
        selection: EMPTY_SEL,
        level: v.level ?? r.doc.start?.cell.z ?? 0,
        view: {
          panX: v.pan?.[0] ?? 80,
          panY: v.pan?.[1] ?? 80,
          zoom: v.zoom ?? 36,
        },
        ghostAbove: v.showLevelsAbove ?? false,
        ghostBelow: v.showLevelsBelow ?? true,
        pendingFit: !v.pan || v.zoom === undefined,
      });
      if (!opts.silent) {
        const extra = r.problems.length ? ` (${r.problems.length} load warning${r.problems.length > 1 ? "s" : ""})` : "";
        get().notify(`Opened ${r.doc.name}${r.migratedFrom ? ` (upgraded from format ${r.migratedFrom})` : ""}${extra}`);
      }
      return true;
    },

    projectText() {
      const s = get();
      const editor: EditorState = {
        view: {
          level: s.level,
          pan: [Math.round(s.view.panX), Math.round(s.view.panY)],
          zoom: s.view.zoom,
          showLevelsAbove: s.ghostAbove,
          showLevelsBelow: s.ghostBelow,
        },
      };
      if (s.notes.length) editor.notes = s.notes;
      return stringifyProject(saveProject(s.doc, { editor, assets: s.assets }));
    },

    markSaved: (fileName, fileHandle) => set({ fileName, fileHandle, dirty: false }),

    focusCell(x, y, z) {
      set({ level: z, focusRequest: { x, y, at: Date.now() } });
    },
  };
});

export const selectionSets = (s: Selection) => ({
  cells: new Set(s.cells),
  edges: new Set(s.edges),
  props: new Set(s.props),
});
