import type { Fill } from "../../shared/lib/drawing/hatch";
import type { Layer, Page, Shape } from "../../shared/lib/drawing/shapes";
import type { FileState } from "../../shared/lib/drawing/useDrawingFile";

/**
 * Photo's drawing while it has changes not saved to a file: kept in the browser, so a reload - or a
 * new version of the app, which needs one - puts it back as it was rather than losing the photo.
 * Once the drawing is saved there's nothing to keep: the app reopens the file it was saved to.
 *
 * In IndexedDB rather than localStorage, which holds a few megabytes at most: a photo's working copy
 * alone can come near that, and a photo split by tone or colour carries it in each of its layers.
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

/** Keep the drawing as it is now, in place of whatever was kept before. */
export const keepWork = (work: Work) => run<IDBValidKey>("readwrite", (s) => s.put(work, KEY));

/** Nothing unsaved any more: forget what was kept. */
export const dropWork = () => run<undefined>("readwrite", (s) => s.delete(KEY));
