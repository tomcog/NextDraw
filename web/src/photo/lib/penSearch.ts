import type { Candidate, FitOptions, PenChoice } from "./choosePens";
import type { SearchRequest } from "./penSearch.worker";

// Asking the pen-search worker. One worker for the page, started when first asked; each question gets
// its own answer, matched by number, so several can be in flight at once.

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, { resolve: (choice: PenChoice | null) => void; reject: (err: Error) => void }>();

function theWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./penSearch.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; choice?: PenChoice | null; error?: string }>) => {
    const asked = waiting.get(e.data.id);
    if (!asked) return;
    waiting.delete(e.data.id);
    if (e.data.error) asked.reject(new Error(e.data.error));
    else asked.resolve(e.data.choice ?? null);
  };
  worker.onerror = (e) => {
    // A worker that fails to start or throws answers nobody: tell everyone waiting, and start afresh next time.
    for (const asked of waiting.values()) asked.reject(new Error(e.message || "The pen search stopped"));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** The best `most` pens for a photo's sampled pixels, worked out in the worker. */
export function searchPensOffPage(pixels: Float32Array, candidates: Candidate[], paper: string, most: number, opts: FitOptions): Promise<PenChoice | null> {
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const request: SearchRequest = { id, pixels, candidates, paper, most, opts };
    theWorker().postMessage(request);
  });
}
