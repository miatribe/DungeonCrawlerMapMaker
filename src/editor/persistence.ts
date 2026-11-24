/**
 * Local persistence: IndexedDB autosave + recent maps, and file open/save via the File
 * System Access API where available (download/upload fallback elsewhere).
 */

const DB = "dcmm";
const STORE = "projects";

interface Saved {
  uid: string;
  name: string;
  savedAt: number;
  text: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "uid" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const RECENT_LIMIT = 10;

export async function autosave(entry: Saved): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(entry));
    const all = await listRecent();
    for (const old of all.slice(RECENT_LIMIT)) await tx("readwrite", (s) => s.delete(old.uid));
    try { localStorage.setItem("dcmm:last", entry.uid); } catch { /* storage blocked */ }
  } catch (e) {
    console.warn("Autosave failed", e);
  }
}

export async function listRecent(): Promise<Saved[]> {
  try {
    const all = await tx<Saved[]>("readonly", (s) => s.getAll() as IDBRequest<Saved[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadRecent(uid: string): Promise<Saved | undefined> {
  try {
    return await tx<Saved | undefined>("readonly", (s) => s.get(uid) as IDBRequest<Saved | undefined>);
  } catch {
    return undefined;
  }
}

export async function loadLast(): Promise<Saved | undefined> {
  let uid: string | null = null;
  try { uid = localStorage.getItem("dcmm:last"); } catch { /* storage blocked */ }
  if (uid) {
    const s = await loadRecent(uid);
    if (s) return s;
  }
  return (await listRecent())[0];
}

export async function forgetRecent(uid: string): Promise<void> {
  try { await tx("readwrite", (s) => s.delete(uid)); } catch { /* ignore */ }
}

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

export type { FileHandle, Saved };
