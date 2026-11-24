/** Reading and writing `.dcmm` project files (SPEC §6.1). */
import { canonicalEdge, cellKey, edgeKey } from "./geometry";
import { migrate } from "./migrations";
import { fromDoc, toDoc, type MapDoc } from "./model";
import { FORMAT_VERSION, MapDataSchema, ProjectFileSchema, type EditorState, type ProjectFile } from "./schema";
import type { Problem } from "./validate";
import { APP_NAME, APP_VERSION } from "./version";

export interface LoadedProject {
  doc: MapDoc;
  editor: EditorState;
  assets: NonNullable<ProjectFile["assets"]>;
  migratedFrom?: number;
  /** Non-fatal load problems (duplicates dropped, etc). Run validate() for the rest. */
  problems: Problem[];
}

export type LoadResult = ({ ok: true } & LoadedProject) | { ok: false; problems: Problem[] };

const fail = (message: string, where?: string): LoadResult => ({
  ok: false,
  problems: [{ code: "V-SCHEMA", severity: "error", message, ...(where && { where }) }],
});

export function loadProject(input: string | unknown): LoadResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(input); } catch (e) { return fail(`Not valid JSON: ${(e as Error).message}`); }
  }
  if (!raw || typeof raw !== "object" || (raw as any).format !== "dcmm-project")
    return fail('Not a DCMM project file (missing "format": "dcmm-project")');

  const m = migrate(raw as Record<string, any>);
  if (!m.ok) return fail(m.message);

  const parsed = ProjectFileSchema.safeParse(m.raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 50).map((i) => ({
        code: "V-SCHEMA" as const,
        severity: "error" as const,
        message: `${i.path.join(".") || "(root)"}: ${i.message}`,
        where: i.path.join("."),
      })),
    };
  }
  const file = parsed.data;
  const problems: Problem[] = [];
  const map = file.map;

  // Drop duplicates (first one wins) and normalize toZ.
  const dedupe = <T>(items: T[], key: (t: T) => string, what: string): T[] => {
    const seen = new Set<string>();
    return items.filter((t) => {
      const k = key(t);
      if (seen.has(k)) {
        problems.push({ code: "V-DUPID", severity: "error", message: `Duplicate ${what} ${k} was dropped on load` });
        return false;
      }
      seen.add(k);
      return true;
    });
  };
  map.cells = dedupe(map.cells, (c) => cellKey(c.pos), "cell");
  map.edges = dedupe(
    map.edges.map((e) => {
      const c = canonicalEdge(e.from, e.dir, e.toZ);
      const { toZ: _drop, ...rest } = e;
      return c.toZ === undefined ? rest : { ...rest, toZ: c.toZ };
    }),
    (e) => edgeKey(e),
    "connection",
  );
  map.props = dedupe(map.props, (p) => p.id, "prop");

  const result: LoadResult = {
    ok: true,
    doc: toDoc(map),
    editor: file.editor ?? {},
    assets: file.assets ?? {},
    problems,
  };
  if (m.migratedFrom !== undefined) result.migratedFrom = m.migratedFrom;
  return result;
}

export function saveProject(doc: MapDoc, extra: { editor?: EditorState; assets?: ProjectFile["assets"] } = {}): ProjectFile {
  const raw = fromDoc(doc);
  // Parsing puts keys in schema order, so the saved text doesn't depend on edit history.
  const parsed = MapDataSchema.safeParse(raw);
  const file: ProjectFile = {
    format: "dcmm-project",
    formatVersion: FORMAT_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    map: parsed.success ? parsed.data : raw,
  };
  if (extra.assets && Object.keys(extra.assets).length) file.assets = extra.assets;
  if (extra.editor) file.editor = extra.editor;
  return file;
}

export function stringifyProject(file: ProjectFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}
