/** Zod schema for the runtime JSON export (`dcmm-map`, SPEC §6.2). Engines can validate against the generated JSON Schema. */
import { z } from "zod";
import {
  CanonicalDirSchema, CellShapeSchema, ConnectionTypeSchema, CustomTypeSchema, DataSchema, EventRefSchema, FacingSchema,
  FlagDefSchema, GridPosSchema, Id, LevelSchema, MapEventSchema, MaterialSchema, ParamsSchema, PropSchema, PropTypeSchema,
  StartSchema, TagsSchema,
} from "../../core/schema";

export const RUNTIME_SCHEMA_VERSION = 1;

const Surfaces = z.object({ north: Id, east: Id, south: Id, west: Id, up: Id, down: Id });

export const RuntimeCellSchema = z.object({
  pos: GridPosSchema,
  floor: z.number().int(),
  ceiling: z.number().int(),
  abs: z.object({ floor: z.number().int(), ceiling: z.number().int() }),
  shape: CellShapeSchema,
  surfaces: Surfaces,
  onEnter: EventRefSchema.optional(),
  onExit: EventRefSchema.optional(),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});

export const RuntimeEdgeSchema = z.object({
  id: Id.optional(),
  from: GridPosSchema,
  to: GridPosSchema,
  dir: CanonicalDirSchema,
  type: Id,
  state: z.string(),
  onUse: EventRefSchema.optional(),
  onBump: EventRefSchema.optional(),
  params: ParamsSchema.optional(),
  tags: TagsSchema.optional(),
  data: DataSchema.optional(),
});

export const RiserSchema = z.object({
  between: z.tuple([GridPosSchema, GridPosSchema]),
  kind: z.enum(["floor", "ceiling"]),
  from: z.number().int(),
  to: z.number().int(),
  material: Id,
  facing: FacingSchema,
});

export const RuntimeMaterialSchema = MaterialSchema.extend({
  /** Only with the includePreviewTextures option: an uploaded image as a data URI, or "builtin:<pattern>". */
  texture: z.string().optional(),
});

export const RuntimeMapSchema = z.object({
  format: z.literal("dcmm-map"),
  schemaVersion: z.literal(RUNTIME_SCHEMA_VERSION),
  generator: z.string(),
  map: z.object({
    id: Id,
    name: z.string(),
    cellSize: z.number().positive(),
    stepsPerLevel: z.number().int().positive(),
    stepHeight: z.number().positive(),
    bounds: z.object({ min: GridPosSchema, max: GridPosSchema }).nullable(),
    start: StartSchema.nullable(),
    rules: z.object({ maxStep: z.number().int().nonnegative() }),
    defaults: z.object({ wall: Id, floor: Id, ceiling: Id }),
    onLoad: EventRefSchema.optional(),
    tags: TagsSchema.optional(),
    data: DataSchema.optional(),
  }),
  levels: z.array(LevelSchema),
  cells: z.array(RuntimeCellSchema),
  edges: z.array(RuntimeEdgeSchema),
  risers: z.array(RiserSchema),
  props: z.array(PropSchema),
  materials: z.record(RuntimeMaterialSchema),
  connectionTypes: z.record(ConnectionTypeSchema),
  propTypes: z.record(PropTypeSchema),
  customTypes: z.record(CustomTypeSchema),
  events: z.record(MapEventSchema),
  flags: z.record(FlagDefSchema),
});
export type RuntimeMap = z.infer<typeof RuntimeMapSchema>;
