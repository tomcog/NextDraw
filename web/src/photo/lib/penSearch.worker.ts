import { searchPens, type Candidate, type FitOptions } from "./choosePens";

// The pen search, off the page: asked with a photo's sampled pixels and the pens to choose from, it
// answers with the best set and how near each count of pens comes. See penSearch.ts.

export interface SearchRequest {
  id: number;
  pixels: Float32Array;
  candidates: Candidate[];
  paper: string;
  most: number;
  opts: FitOptions;
}

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  const { id, pixels, candidates, paper, most, opts } = e.data;
  try {
    self.postMessage({ id, choice: searchPens(pixels, candidates, paper, most, opts) });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
