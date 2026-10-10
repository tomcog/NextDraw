import { setSeparationRunner, type SeparationRequest } from "./photo";

// Separations of more than four plates take a second or two, so the apps that draw photos have them
// solved in a worker rather than freezing the page. Importing this is what turns it on. One worker for
// the page, started when first asked; each request gets its own answer, matched by number.

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, { resolve: (maps: Float32Array[]) => void; reject: (err: Error) => void }>();

function theWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; maps?: Float32Array[]; error?: string }>) => {
    const asked = waiting.get(e.data.id);
    if (!asked) return;
    waiting.delete(e.data.id);
    if (e.data.maps) asked.resolve(e.data.maps);
    else asked.reject(new Error(e.data.error ?? "The separation stopped"));
  };
  worker.onerror = (e) => {
    // A worker that fails to start or throws answers nobody: tell everyone waiting, and start afresh next time.
    for (const asked of waiting.values()) asked.reject(new Error(e.message || "The separation stopped"));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

setSeparationRunner((ask: SeparationRequest) => {
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    theWorker().postMessage({ id, ...ask }, [ask.rgb.buffer]);
  });
});
