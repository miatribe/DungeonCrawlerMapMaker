/** The JSON exporter: writes the DCMM runtime format (`dcmm-map`, SPEC §6.2). */
import type { MapDoc } from "../../core/model";
import { walkRefs, type RefKind } from "../../core/refs";
import type { ResolvedMap } from "../../core/resolve";
import { APP_NAME, APP_VERSION } from "../../core/version";
import type { ExportContext, Exporter } from "../types";
import { RUNTIME_SCHEMA_VERSION, RuntimeMapSchema, type RuntimeMap } from "./schema";

export interface JsonExportOptions extends Record<string, unknown> {
  pretty: boolean;
  pruneUnused: boolean;
  includePreviewTextures: boolean;
}

type PrunableKind = Exclude<RefKind, "edge" | "prop">;

/**
 * Ids still referenced once unreferenced events are dropped. Repeats until stable, so an
 * event used only by an unused event goes too.
 */
export function usedIds(doc: MapDoc): Record<PrunableKind, Set<string>> {
  let liveEvents = new Set(Object.keys(doc.events));
  for (;;) {
    const used: Record<PrunableKind, Set<string>> = {
      material: new Set(), connectionType: new Set(), propType: new Set(), customType: new Set(), event: new Set(), flag: new Set(),
    };
    walkRefs(doc, (r) => {
      if (!("id" in r) || r.kind === "edge" || r.kind === "prop") return;
      const m = /^events\.([^.[]+)/.exec(r.where);
      if (m && !liveEvents.has(m[1]!)) return;
      if (r.where.startsWith("connectionTypes.")) return; // counted below, only for live types
      used[r.kind].add(r.id);
    });
    for (const t of used.connectionType) {
      const mat = doc.connectionTypes[t]?.material;
      if (mat) used.material.add(mat);
    }
    const next = new Set([...liveEvents].filter((e) => used.event.has(e)));
    if (next.size === liveEvents.size) return used;
    liveEvents = next;
  }
}

const pick = <T>(rec: Record<string, T>, keep?: Set<string>): Record<string, T> =>
  keep ? Object.fromEntries(Object.entries(rec).filter(([k]) => keep.has(k))) : rec;

export function buildRuntimeMap(map: ResolvedMap, options: JsonExportOptions, ctx: ExportContext): { data: RuntimeMap; warnings: string[] } {
  const warnings: string[] = [];
  const used = options.pruneUnused ? usedIds(ctx.doc) : undefined;

  const materials: RuntimeMap["materials"] = {};
  for (const [id, m] of Object.entries(pick(map.materials, used?.material))) {
    const { texture, ...rest } = m;
    const out: RuntimeMap["materials"][string] = { ...rest };
    if (options.includePreviewTextures && texture) {
      const asset = ctx.assets[texture];
      if (texture.startsWith("builtin:")) out.texture = texture; // procedural pattern name; see EXPORT_FORMAT.md
      else if (asset) out.texture = asset.data;
      else warnings.push(`Material "${id}" references missing texture asset "${texture}"`);
    }
    materials[id] = out;
  }

  const meta: RuntimeMap["map"] = {
    id: map.id,
    name: map.name,
    cellSize: map.cellSize,
    stepsPerLevel: map.stepsPerLevel,
    stepHeight: map.stepHeight,
    bounds: map.bounds,
    start: map.start,
    rules: map.rules,
    defaults: map.defaults,
  };
  if (map.onLoad !== undefined) meta.onLoad = map.onLoad;
  if (map.tags) meta.tags = map.tags;
  if (map.data) meta.data = map.data;

  const data: RuntimeMap = {
    format: "dcmm-map",
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    map: meta,
    levels: map.levels,
    cells: map.cells.map(({ key: _key, ...c }) => c),
    edges: map.edges.map(({ key: _key, vertical: _v, ...e }) => e),
    risers: map.risers,
    props: map.props,
    materials,
    connectionTypes: pick(map.connectionTypes, used?.connectionType),
    propTypes: pick(map.propTypes, used?.propType),
    customTypes: pick(map.customTypes, used?.customType),
    events: pick(map.events, used?.event),
    flags: pick(map.flags, used?.flag),
  };
  // Parsing puts every object's keys in schema order, so output never depends on edit history.
  const parsed = RuntimeMapSchema.safeParse(data);
  if (!parsed.success) {
    warnings.push(`Export does not match the runtime schema: ${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
    return { data, warnings };
  }
  return { data: parsed.data, warnings };
}

export const jsonExporter: Exporter<JsonExportOptions> = {
  id: "json",
  name: "JSON (DCMM runtime)",
  fileExtension: ".json",
  optionsSchema: [
    { name: "pretty", type: "bool", default: true, description: "Indent the output for readability" },
    { name: "pruneUnused", type: "bool", default: false, description: "Leave out materials, types, events and flags nothing uses" },
    { name: "includePreviewTextures", type: "bool", default: false, description: "Embed preview textures as data URIs" },
  ],
  defaultOptions: { pretty: true, pruneUnused: false, includePreviewTextures: false },
  export(map, options, ctx) {
    const { data, warnings } = buildRuntimeMap(map, options, ctx);
    const text = (options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + "\n";
    return {
      files: [{ name: `${map.id}.json`, mime: "application/json", data: text }],
      ...(warnings.length && { warnings }),
    };
  },
};
