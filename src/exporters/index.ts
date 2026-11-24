/** Exporter registry. Adding a format = adding one module and one line here. */
import type { MapDoc } from "../core/model";
import { resolve } from "../core/resolve";
import type { ProjectFile } from "../core/schema";
import { hasErrors, validate, type Problem } from "../core/validate";
import { jsonExporter } from "./json";
import type { Exporter, ExportResult } from "./types";

export type { Exporter, ExportResult, ExportContext, ExportFile } from "./types";

const registry = new Map<string, Exporter<any>>();

export function registerExporter(e: Exporter<any>): void {
  if (registry.has(e.id)) throw new Error(`exporter "${e.id}" is already registered`);
  registry.set(e.id, e);
}

export const getExporter = (id: string): Exporter<any> | undefined => registry.get(id);
export const listExporters = (): Exporter<any>[] => [...registry.values()];

registerExporter(jsonExporter);

export type RunExportResult =
  | { ok: true; result: ExportResult; problems: Problem[] }
  | { ok: false; problems: Problem[] };

/** Validate, resolve and export. Errors block the export; warnings are returned with the result. */
export function runExport(
  exporterId: string,
  doc: MapDoc,
  options: Record<string, unknown> = {},
  assets: NonNullable<ProjectFile["assets"]> = {},
): RunExportResult {
  const exporter = getExporter(exporterId);
  if (!exporter) throw new Error(`unknown exporter "${exporterId}"`);
  const resolved = resolve(doc);
  const problems = validate(doc, resolved);
  if (hasErrors(problems)) return { ok: false, problems };
  const result = exporter.export(resolved, { ...exporter.defaultOptions, ...options }, { doc, assets });
  return { ok: true, result, problems };
}
