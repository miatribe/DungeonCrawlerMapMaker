/**
 * File open/save via the File System Access API where available (download/upload fallback
 * elsewhere). Maps live only in files: there is no browser autosave.
 */

// ---------- files ----------

type FileHandle = { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }> };
type FsWindow = Window & {
  showOpenFilePicker?: (o: object) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: object) => Promise<FileHandle>;
};
const w = () => window as FsWindow;

const PROJECT_TYPES = [{ description: "DCMM project", accept: { "application/json": [".dcmm"] } }];

export type OpenedFile = { name: string; text: string; handle?: FileHandle };

export async function openFile(): Promise<OpenedFile | null> {
  if (w().showOpenFilePicker) {
    try {
      const [handle] = await w().showOpenFilePicker!({ types: PROJECT_TYPES, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dcmm,.json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save text. Reuses `handle` when given; otherwise asks where (or downloads). Returns the handle used, if any. */
export async function saveFile(name: string, text: string, handle?: FileHandle, mime = "application/json"): Promise<FileHandle | undefined | null> {
  if (handle) {
    const ws = await handle.createWritable();
    await ws.write(text);
    await ws.close();
    return handle;
  }
  if (w().showSaveFilePicker) {
    try {
      const h = await w().showSaveFilePicker!({ suggestedName: name, types: PROJECT_TYPES });
      const ws = await h.createWritable();
      await ws.write(text);
      await ws.close();
      return h;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  download(name, text, mime);
  return undefined;
}

export function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type { FileHandle };
