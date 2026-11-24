/** Exporter plugin interface (SPEC §7). */
import type { MapDoc } from "../core/model";
import type { ResolvedMap } from "../core/resolve";
import type { ParamDefSchema, ProjectFile } from "../core/schema";
import type { z } from "zod";

export type ExportOptionDef = z.infer<typeof ParamDefSchema>;

export interface ExportContext {
  /** The authoring doc, for exporters that need reference walking (e.g. pruning). */
  doc: MapDoc;
  assets: NonNullable<ProjectFile["assets"]>;
}

export interface ExportFile {
  name: string;
  mime: string;
  data: string | Uint8Array;
}

export interface ExportResult {
  /** More than one file means the editor offers a zip download. */
  files: ExportFile[];
  warnings?: string[];
}

export interface Exporter<Options extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  fileExtension: string;
  /** Drives the export dialog form. */
  optionsSchema?: ExportOptionDef[];
  defaultOptions: Options;
  export(map: ResolvedMap, options: Options, ctx: ExportContext): ExportResult;
}
