/**
 * Zod schemas for the authoring model as stored in a `.dcmm` project file (SPEC §4–§6.1).
 * The TS types are inferred from these. The recursive Condition type is declared by hand.
 */
import { z } from "zod";
import type { GridPos } from "./geometry";

export const FORMAT_VERSION = 1;

// ---------- primitives ----------

export const Id = z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_.\-]*$/, "ids start with a letter or _ and use letters, digits, _ . -");
export const GridPosSchema = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
export const FacingSchema = z.enum(["north", "east", "south", "west"]);
export const DirectionSchema = z.enum(["north", "east", "south", "west", "up", "down"]);
export const SideSchema = DirectionSchema;
export const CanonicalDirSchema = z.enum(["east", "south", "up"]);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb");
export const DataSchema = z.record(z.unknown());
export const TagsSchema = z.array(z.string());

export const ParamValueSchema = z.union([z.string(), z.number(), z.boolean(), GridPosSchema, z.null()]);
export const ParamsSchema = z.record(ParamValueSchema);

export const PARAM_TYPES = [
  "string", "int", "float", "bool", "enum", "gridPos", "direction", "color",
  "ref:edge", "ref:prop", "ref:event", "ref:flag", "ref:material",
] as const;
export const ParamTypeSchema = z.enum(PARAM_TYPES);

export const ParamDefSchema = z.object({
  name: Id,
  type: ParamTypeSchema,
  options: z.array(z.string()).optional(),
  default: ParamValueSchema.optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

// ---------- targets ----------

export const TargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edge"), id: Id }),
  z.object({ kind: z.literal("edgeAt"), cell: GridPosSchema, dir: DirectionSchema, toZ: z.number().int().optional() }),
  z.object({ kind: z.literal("prop"), id: Id }),
  z.object({ kind: z.literal("cell"), pos: GridPosSchema }),
  z.object({ kind: z.literal("player") }),
]);

// ---------- conditions (recursive) ----------

export type Target = z.infer<typeof TargetSchema>;
export type ParamValue = z.infer<typeof ParamValueSchema>;
export type FlagOp = "==" | "!=" | ">" | "<" | ">=" | "<=";

export type Condition =
  | { type: "state"; target: Target; equals: string }
  | { type: "flag"; name: string; op: FlagOp; value: boolean | number | string }
  | { type: "playerAt"; pos: GridPos; facing?: "north" | "east" | "south" | "west" }
  | { type: "playerFacing"; facing: "north" | "east" | "south" | "west" }
  | { type: "eventFired"; event: string }
  | { type: "not"; conditions: Condition[] }
  | { type: "any"; conditions: Condition[] }
  | { type: "custom"; custom: string; params?: Record<string, ParamValue> };

const FlagValue = z.union([z.boolean(), z.number(), z.string()]);

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("state"), target: TargetSchema, equals: z.string() }),
    z.object({ type: z.literal("flag"), name: Id, op: z.enum(["==", "!=", ">", "<", ">=", "<="]), value: FlagValue }),
    z.object({ type: z.literal("playerAt"), pos: GridPosSchema, facing: FacingSchema.optional() }),
    z.object({ type: z.literal("playerFacing"), facing: FacingSchema }),
    z.object({ type: z.literal("eventFired"), event: Id }),
    z.object({ type: z.literal("not"), conditions: z.array(ConditionSchema) }),
    z.object({ type: z.literal("any"), conditions: z.array(ConditionSchema) }),
    z.object({ type: z.literal("custom"), custom: Id, params: ParamsSchema.optional() }),
  ]),
);

// ---------- actions ----------

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setConnectionState"), target: TargetSchema, state: z.string() }),
  z.object({ type: z.literal("toggleConnectionState"), target: TargetSchema, states: z.tuple([z.string(), z.string()]) }),
  z.object({ type: z.literal("setPropState"), target: TargetSchema, state: z.string() }),
  z.object({ type: z.literal("setFlag"), name: Id, value: FlagValue }),
  z.object({ type: z.literal("addFlag"), name: Id, amount: z.number().int() }),
  z.object({ type: z.literal("teleport"), to: GridPosSchema, facing: FacingSchema.optional() }),
  z.object({ type: z.literal("showMessage"), text: z.string() }),
  z.object({ type: z.literal("runEvent"), event: Id, delayMs: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("setSurface"), cell: GridPosSchema, side: SideSchema, material: Id }),
  z.object({ type: z.literal("custom"), custom: Id, params: ParamsSchema.optional() }),
]);
export type Action = z.infer<typeof ActionSchema>;

// ---------- events ----------

export const MapEventSchema = z.object({
  once: z.boolean().optional(),
  conditions: z.array(ConditionSchema).optional(),
  actions: z.array(ActionSchema),
  else: z.array(ActionSchema).optional(),
  notes: z.string().optional(),
});
export type MapEvent = z.infer<typeof MapEventSchema>;

/** A named event id, or an inline event. */
export const EventRefSchema = z.union([Id, MapEventSchema]);
export type EventRef = z.infer<typeof EventRefSchema>;

// ---------- definitions ----------

export const MaterialSchema = z.object({
  name: z.string(),
  color: ColorSchema,
  texture: z.string().optional(), // asset id (project) — preview only
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});
export type Material = z.infer<typeof MaterialSchema>;

export const ConnectionStateSchema = z.object({
  passable: z.boolean(),
  blocksSight: z.boolean(),
  transitions: z.array(z.string()).optional(),
});

export const CONNECTION_KINDS = ["opening", "door", "gate", "hatch", "pit", "ladder", "grate", "wall", "custom"] as const;

export const ConnectionTypeSchema = z.object({
  name: z.string(),
  kind: z.enum(CONNECTION_KINDS),
  axis: z.enum(["horizontal", "vertical", "both"]),
  material: Id.optional(),
  initialState: z.string(),
  states: z.record(ConnectionStateSchema),
  params: z.array(ParamDefSchema).optional(),
});
export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;

export const BUILTIN_ICONS = ["lever", "button", "chest", "sign", "plate", "generic"] as const;

export const PropTypeSchema = z.object({
  name: z.string(),
  states: z.array(z.string()).min(1),
  initialState: z.string(),
  params: z.array(ParamDefSchema).optional(),
  preview: z.object({ color: ColorSchema, icon: z.enum(BUILTIN_ICONS).optional() }).optional(),
});
export type PropType = z.infer<typeof PropTypeSchema>;

export const CustomTypeSchema = z.object({
  category: z.enum(["action", "condition"]),
  name: z.string(),
  description: z.string().optional(),
  params: z.array(ParamDefSchema),
});
export type CustomType = z.infer<typeof CustomTypeSchema>;

export const FlagDefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bool"), initial: z.boolean() }),
  z.object({ type: z.literal("int"), initial: z.number().int() }),
  z.object({ type: z.literal("string"), initial: z.string() }),
]);
export type FlagDef = z.infer<typeof FlagDefSchema>;

// ---------- geometry ----------

export const CellShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flat") }),
  z.object({ kind: z.literal("ramp"), rise: z.number().int().positive(), toward: FacingSchema }),
  z.object({ kind: z.literal("stairs"), rise: z.number().int().positive(), toward: FacingSchema, treads: z.number().int().positive() }),
]);
export type CellShape = z.infer<typeof CellShapeSchema>;

export const SurfacesSchema = z
  .object({
    north: Id, east: Id, south: Id, west: Id, up: Id, down: Id,
  })
  .partial();
export type Surfaces = z.infer<typeof SurfacesSchema>;

export const CellSchema = z.object({
  pos: GridPosSchema,
  /** Steps above the level base. Default 0. */
  floor: z.number().int().optional(),
  /** Steps above the level base. Default map.stepsPerLevel. */
  ceiling: z.number().int().optional(),
  shape: CellShapeSchema.optional(),
  /** Missing sides use map.defaults. */
  surfaces: SurfacesSchema.optional(),
  onEnter: EventRefSchema.optional(),
  onExit: EventRefSchema.optional(),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});
export type Cell = z.infer<typeof CellSchema>;

export const EdgeSchema = z.object({
  /** Optional; needed only when something targets the edge by id. */
  id: Id.optional(),
  from: GridPosSchema,
  dir: CanonicalDirSchema,
  /** Far cell z, when it isn't the default (from.z for horizontal, from.z+1 for up). */
  toZ: z.number().int().optional(),
  type: Id,
  state: z.string(),
  onUse: EventRefSchema.optional(),
  onBump: EventRefSchema.optional(),
  params: ParamsSchema.optional(),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const PropSchema = z.object({
  id: Id,
  type: Id,
  cell: GridPosSchema,
  side: SideSchema.optional(),
  facing: FacingSchema.optional(),
  state: z.string(),
  onUse: EventRefSchema.optional(),
  params: ParamsSchema.optional(),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});
export type Prop = z.infer<typeof PropSchema>;

export const LevelSchema = z.object({ z: z.number().int(), name: z.string() });
export type Level = z.infer<typeof LevelSchema>;

export const StartSchema = z.object({ cell: GridPosSchema, facing: FacingSchema });
export type Start = z.infer<typeof StartSchema>;

// ---------- map (serialized form) ----------

export const MapDataSchema = z.object({
  id: Id,
  name: z.string(),
  cellSize: z.number().positive(),
  stepsPerLevel: z.number().int().min(1).max(64),
  stepHeight: z.number().positive(),
  start: StartSchema.nullable(),
  rules: z.object({ maxStep: z.number().int().nonnegative() }),
  defaults: z.object({ wall: Id, floor: Id, ceiling: Id }),
  onLoad: EventRefSchema.optional(),
  levels: z.array(LevelSchema),
  cells: z.array(CellSchema),
  edges: z.array(EdgeSchema),
  props: z.array(PropSchema),
  materials: z.record(MaterialSchema),
  connectionTypes: z.record(ConnectionTypeSchema),
  propTypes: z.record(PropTypeSchema),
  customTypes: z.record(CustomTypeSchema),
  events: z.record(MapEventSchema),
  flags: z.record(FlagDefSchema),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});
export type MapData = z.infer<typeof MapDataSchema>;

// ---------- project file ----------

export const AssetSchema = z.object({ mime: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string() });

export const NoteSchema = z.object({ id: z.string(), pos: GridPosSchema, text: z.string() });

export const EditorStateSchema = z.object({
  view: z
    .object({
      level: z.number().int(),
      pan: z.tuple([z.number(), z.number()]),
      zoom: z.number().positive(),
      showLevelsAbove: z.boolean(),
      showLevelsBelow: z.boolean(),
    })
    .partial()
    .optional(),
  notes: z.array(NoteSchema).optional(),
  playtestStart: StartSchema.nullable().optional(),
});
export type EditorState = z.infer<typeof EditorStateSchema>;

export const ProjectFileSchema = z.object({
  format: z.literal("dcmm-project"),
  formatVersion: z.literal(FORMAT_VERSION),
  app: z.object({ name: z.string(), version: z.string() }),
  map: MapDataSchema,
  assets: z.record(AssetSchema).optional(),
  editor: EditorStateSchema.optional(),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
