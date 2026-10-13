import type { Fill } from "../../shared/lib/drawing/hatch";
import type { Layer, Page, Shape } from "../../shared/lib/drawing/shapes";
import type { FileState } from "../../shared/lib/drawing/useDrawingFile";

/**
 * Image's unsaved drawing as it used to be kept: in the browser, so a reload put it back. Since the
 * apps share one current drawing on the server, unsaved work lives there instead; what's left here is
 * reading back work kept before that, once, so it isn't lost in the change (see resumeKept in App.tsx).
 */
export interface Work {
  shapes: Shape[];
  fills: Fill[];
  layers: Layer[];
  page: Page;
  file: FileState;
  activeLayer: string;
  selected: string | null;
}

const DB = "nextdraw-photo";
const STORE = "work";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The work kept from last time, if there is any. */
export const loadWork = () => run<Work | undefined>("readonly", (s) => s.get(KEY));

/** Put back, and sent on: forget what was kept. */
export const dropWork = () => run<undefined>("readwrite", (s) => s.delete(KEY));
