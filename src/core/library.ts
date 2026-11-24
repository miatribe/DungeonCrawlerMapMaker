/**
 * Type libraries (`.dcmm-types.json`, SPEC §5.7): share an engine's connection, prop and
 * custom types across maps.
 */
import { z } from "zod";
import type { Command } from "./history";
import type { MapDoc } from "./model";
import { ConnectionTypeSchema, CustomTypeSchema, PropTypeSchema } from "./schema";
import { APP_NAME, APP_VERSION } from "./version";

export const TypeLibrarySchema = z.object({
  format: z.literal("dcmm-types"),
  formatVersion: z.literal(1),
  generator: z.string().optional(),
  name: z.string().optional(),
  connectionTypes: z.record(ConnectionTypeSchema).default({}),
  propTypes: z.record(PropTypeSchema).default({}),
  customTypes: z.record(CustomTypeSchema).default({}),
});
export type TypeLibrary = z.infer<typeof TypeLibrarySchema>;

export function exportTypeLibrary(doc: MapDoc, only?: { connectionTypes?: string[]; propTypes?: string[]; customTypes?: string[] }): TypeLibrary {
  const pick = <T>(rec: Record<string, T>, ids?: string[]) =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => !ids || ids.includes(k)).sort(([a], [b]) => a.localeCompare(b)));
  return {
    format: "dcmm-types",
    formatVersion: 1,
    generator: `${APP_NAME} ${APP_VERSION}`,
    name: doc.name,
    connectionTypes: pick(doc.connectionTypes, only?.connectionTypes),
    propTypes: pick(doc.propTypes, only?.propTypes),
    customTypes: pick(doc.customTypes, only?.customTypes),
  };
}

export type ParsedLibrary = { ok: true; library: TypeLibrary } | { ok: false; message: string };

export function parseTypeLibrary(text: string): ParsedLibrary {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, message: `Not valid JSON: ${(e as Error).message}` }; }
  const r = TypeLibrarySchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0]!;
    return { ok: false, message: `${i.path.join(".") || "(root)"}: ${i.message}` };
  }
  return { ok: true, library: r.data };
}

/** Which ids an import would add and which it would overwrite. */
export function libraryDiff(doc: MapDoc, lib: TypeLibrary) {
  const split = (mine: Record<string, unknown>, theirs: Record<string, unknown>) => ({
    added: Object.keys(theirs).filter((k) => !(k in mine)),
    replaced: Object.keys(theirs).filter((k) => k in mine && JSON.stringify(mine[k]) !== JSON.stringify(theirs[k])),
  });
  return {
    connectionTypes: split(doc.connectionTypes, lib.connectionTypes),
    propTypes: split(doc.propTypes, lib.propTypes),
    customTypes: split(doc.customTypes, lib.customTypes),
  };
}

/** Merge a library into the map; types with the same id are replaced. */
export function importTypeLibrary(lib: TypeLibrary): Command {
  return {
    label: "Import type library",
    recipe: (d) => {
      Object.assign(d.connectionTypes, structuredClone(lib.connectionTypes));
      Object.assign(d.propTypes, structuredClone(lib.propTypes));
      Object.assign(d.customTypes, structuredClone(lib.customTypes));
    },
  };
}
