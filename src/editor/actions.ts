/** File-level actions shared by the menu bar and keyboard shortcuts. */
import { runExport } from "../exporters";
import { download, listRecent, loadRecent, openFile, saveFile } from "./persistence";
import { EXAMPLES, useEditor } from "./store";

const S = () => useEditor.getState();

const confirmDiscard = () =>
  !S().dirty || S().fileName === null || window.confirm("You have unsaved changes to this file. They're kept in browser autosave, but continue?");

export async function openProject(): Promise<void> {
  try {
    const f = await openFile();
    if (!f) return;
    S().loadText(f.text, { fileName: f.name, ...(f.handle && { handle: f.handle }) });
  } catch (e) {
    S().notify(`Couldn't open file: ${(e as Error).message}`, "error");
  }
}

export async function saveProject(saveAs = false): Promise<void> {
  const s = S();
  const name = s.fileName ?? `${s.doc.id || "map"}.dcmm`;
  try {
    const handle = await saveFile(name, s.projectText(), saveAs ? undefined : s.fileHandle);
    if (handle === null) return; // cancelled
    S().markSaved(handle?.name ?? name, handle ?? undefined);
    S().notify(handle ? `Saved ${handle.name}` : `Downloaded ${name}`);
  } catch (e) {
    S().notify(`Couldn't save: ${(e as Error).message}`, "error");
  }
}

export function newProject(): void {
  if (confirmDiscard()) S().newMap();
}

export function openExample(id: string): void {
  const ex = EXAMPLES[id];
  if (ex && confirmDiscard()) S().loadText(ex.text);
}

export async function openRecent(uid: string): Promise<void> {
  const r = await loadRecent(uid);
  if (r) S().loadText(r.text, { uid: r.uid });
}

export { listRecent };

export function exportNow(exporterId: string, options: Record<string, unknown>): boolean {
  const s = S();
  const r = runExport(exporterId, s.doc, options, s.assets);
  if (!r.ok) {
    s.notify(`Export blocked by ${r.problems.filter((p) => p.severity === "error").length} error(s). See Problems.`, "error");
    return false;
  }
  for (const f of r.result.files) download(f.name, f.data, f.mime);
  s.notify(`Exported ${r.result.files.map((f) => f.name).join(", ")}${r.result.warnings?.length ? ` with ${r.result.warnings.length} warning(s)` : ""}`);
  return true;
}
