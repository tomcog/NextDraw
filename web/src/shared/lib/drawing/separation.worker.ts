import { solveSeparation, type SeparationRequest } from "./photo";

// Separating a photo into many plates, off the page: asked with the photo at its separating size and
// how to separate it, it answers with each plate's map. See separationWorker.ts.

self.onmessage = (e: MessageEvent<SeparationRequest & { id: number }>) => {
  const { id, ...ask } = e.data;
  try {
    const maps = solveSeparation(ask);
    (self as unknown as Worker).postMessage({ id, maps }, maps.map((m) => m.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
