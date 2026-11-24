/** Built-in materials and types that every new map starts with (SPEC §4.4, §5.1). */
import type { MapDoc } from "./model";
import type { ConnectionType, Material, PropType } from "./schema";

export const BUILTIN_MATERIALS: Record<string, Material> = {
  stone: { name: "Grey stone", color: "#7b8190" },
  brick: { name: "Red brick", color: "#a5503a" },
  moss: { name: "Mossy stone", color: "#5b8a58" },
  wood: { name: "Oak planks", color: "#8a5a2b" },
  iron: { name: "Iron", color: "#9aa0a8" },
  dirt: { name: "Dirt", color: "#5a4632" },
  water: { name: "Water", color: "#2f5f8a" },
  flagstone: { name: "Flagstone", color: "#4a4440" },
  ceiling: { name: "Ceiling", color: "#2a2630" },
};

const open = { passable: true, blocksSight: false };

export const BUILTIN_CONNECTION_TYPES: Record<string, ConnectionType> = {
  opening: { name: "Opening", kind: "opening", axis: "horizontal", initialState: "open", states: { open } },
  door: {
    name: "Wooden door", kind: "door", axis: "horizontal", material: "wood", initialState: "closed",
    states: {
      closed: { passable: false, blocksSight: true, transitions: ["open"] },
      open: { passable: true, blocksSight: false, transitions: ["closed"] },
      locked: { passable: false, blocksSight: true, transitions: [] },
    },
  },
  gate: {
    name: "Iron gate", kind: "gate", axis: "horizontal", material: "iron", initialState: "closed",
    states: {
      closed: { passable: false, blocksSight: false, transitions: [] },
      open: { passable: true, blocksSight: false, transitions: [] },
    },
  },
  secretWall: {
    name: "Secret wall", kind: "wall", axis: "horizontal", initialState: "closed",
    states: {
      closed: { passable: false, blocksSight: true, transitions: [] },
      open: { passable: true, blocksSight: false, transitions: [] },
    },
  },
  open: { name: "Open", kind: "opening", axis: "vertical", initialState: "open", states: { open } },
  hatch: {
    name: "Trapdoor", kind: "hatch", axis: "vertical", material: "wood", initialState: "closed",
    states: {
      closed: { passable: false, blocksSight: true, transitions: ["open"] },
      open: { passable: true, blocksSight: false, transitions: ["closed"] },
    },
  },
  pit: { name: "Pit", kind: "pit", axis: "vertical", initialState: "open", states: { open } },
  ladder: { name: "Ladder", kind: "ladder", axis: "vertical", material: "wood", initialState: "open", states: { open } },
  grate: {
    name: "Grate", kind: "grate", axis: "vertical", material: "iron", initialState: "closed",
    states: { closed: { passable: false, blocksSight: false, transitions: [] } },
  },
};

export const BUILTIN_PROP_TYPES: Record<string, PropType> = {
  lever: { name: "Lever", states: ["off", "on"], initialState: "off", preview: { color: "#c9ccd1", icon: "lever" } },
  button: { name: "Button", states: ["up", "down"], initialState: "up", preview: { color: "#c9ccd1", icon: "button" } },
  chest: { name: "Chest", states: ["closed", "open"], initialState: "closed", preview: { color: "#f2c744", icon: "chest" } },
  sign: {
    name: "Sign", states: ["default"], initialState: "default",
    params: [{ name: "text", type: "string", default: "" }],
    preview: { color: "#c8a46e", icon: "sign" },
  },
  pressurePlate: { name: "Pressure plate", states: ["up", "down"], initialState: "up", preview: { color: "#8c8c8c", icon: "plate" } },
};

export interface NewMapOptions {
  id?: string;
  name?: string;
  stepsPerLevel?: number;
}

export function createMap(opts: NewMapOptions = {}): MapDoc {
  return {
    id: opts.id ?? "untitled",
    name: opts.name ?? "Untitled map",
    cellSize: 1,
    stepsPerLevel: opts.stepsPerLevel ?? 4,
    stepHeight: 1 / (opts.stepsPerLevel ?? 4),
    start: null,
    rules: { maxStep: 1 },
    defaults: { wall: "stone", floor: "flagstone", ceiling: "ceiling" },
    levels: [{ z: 0, name: "Ground" }],
    cells: {},
    edges: {},
    props: {},
    materials: structuredClone(BUILTIN_MATERIALS),
    connectionTypes: structuredClone(BUILTIN_CONNECTION_TYPES),
    propTypes: structuredClone(BUILTIN_PROP_TYPES),
    customTypes: {},
    events: {},
    flags: {},
  };
}
