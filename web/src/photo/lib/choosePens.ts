import { fitMenu, hexLinear, labOfLinear, saturatedOf } from "../../shared/lib/drawing/photo";

// Choosing a tool's pens for a photo by how they really come out on paper. The photo is sampled here,
// on the page; the search itself runs in a worker (penSearch.worker.ts), so the page doesn't stop
// while a few hundred million colour comparisons are made.
// With a set of pens, every
// colour they can make is known: bare paper, each pen at each number of passes, and - with pairs -
// each two hatched across each other (fitMenu, which the drawing itself is made from). The best set
// of N is the one whose colours, each point of the photo taking the nearest, come nearest on average.

/** A pen to choose from: its name, and its colour on the paper being printed on, solid. */
export interface Candidate {
  name: string;
  onPaper: string;
}

export interface FitOptions {
  /** How much paper 0, 1, 2… passes of hatching cover. */
  steps: number[];
  /** Whether two pens may be hatched across each other. */
  pairs: boolean;
  /** Whether the ink covers what's under it. */
  opaque: boolean;
}

export interface PenChoice {
  /** The pens chosen, as indices into the candidates. */
  pens: number[];
  /** The average ΔE with the best 1, 2, … pens. The last is after swapping, the rest as they were added. */
  errors: number[];
}

/** Pixels the choice is made on: plenty to stand for a photo, few enough to try every pen against. */
const SAMPLES = 2000;

/** Brightness and contrast, as the photo's own settings apply them, to a channel value 0 to 255. */
const adjuster = (brightness: number, contrast: number) => {
  const lift = brightness / 200;
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  return (v: number) => Math.min(255, Math.max(0, ((v / 255 - 0.5) * gain + 0.5 + lift) * 255));
};
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * The photo `src`, sampled, in CIELAB - three numbers to a pixel - as its brightness and contrast
 * make it, or null while it hasn't been read.
 */
export function samplePhoto(src: string, brightness: number, contrast: number, saturation = 0): Float32Array | null {
  const tones = saturatedOf(src, saturation);
  if (!tones) return null;
  const adjust = adjuster(brightness, contrast);
  const total = tones.w * tones.h;
  const n = Math.min(SAMPLES, total);
  const pixels = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    pixels.set(labOfLinear([toLinear(adjust(tones.rgba[p])), toLinear(adjust(tones.rgba[p + 1])), toLinear(adjust(tones.rgba[p + 2]))]), i * 3);
  }
  return pixels;
}

/**
 * The best `most` pens of `candidates` for a photo's sampled `pixels` on `paper`. Pens are added one
 * at a time, each the one that helps most; then, for the full set, any pen is swapped for another
 * while that brings the photo nearer.
 */
export function searchPens(pixels: Float32Array, candidates: Candidate[], paper: string, most: number, opts: FitOptions): PenChoice | null {
  if (!candidates.length || !pixels.length) return null;
  const n = pixels.length / 3;

  // What a pen alone, and two together, can make - only the colours with that pen (or both) in them.
  const alone = new Map<number, number[][]>();
  const together = new Map<string, number[][]>();
  const aloneOf = (k: number) => {
    let labs = alone.get(k);
    if (!labs) {
      labs = fitMenu(paper, [candidates[k].onPaper], opts.steps, false, opts.opaque).slice(1).map((m) => m.lab);
      alone.set(k, labs);
    }
    return labs;
  };
  const togetherOf = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let labs = together.get(key);
    if (!labs) {
      labs = fitMenu(paper, [candidates[a].onPaper, candidates[b].onPaper], opts.steps, true, opts.opaque)
        .filter((m) => m.passes[0] > 0 && m.passes[1] > 0)
        .map((m) => m.lab);
      together.set(key, labs);
    }
    return labs;
  };
  /** Each pixel's squared distance to the nearest of these colours, or to what it had already. */
  const nearer = (have: Float32Array, labs: number[][]) => {
    const out = new Float32Array(have);
    for (let i = 0; i < n; i++) {
      const L = pixels[i * 3];
      const A = pixels[i * 3 + 1];
      const B = pixels[i * 3 + 2];
      let best = out[i];
      for (const c of labs) {
        const d = (L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2;
        if (d < best) best = d;
      }
      out[i] = best;
    }
    return out;
  };
  const mean = (d2: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.sqrt(d2[i]);
    return sum / n;
  };
  // Bare paper, before any pen.
  const bare = nearer(new Float32Array(n).fill(Infinity), [labOfLinear(hexLinear(paper))]);
  /** The colours a pen adds to a set: its own, and with pairs, each with every pen already in it. */
  const added = (k: number, set: number[]) => [...aloneOf(k), ...(opts.pairs ? set.flatMap((s) => togetherOf(k, s)) : [])];
  const withSet = (set: number[]) => set.reduce<{ d: Float32Array; so: number[] }>((acc, k) => ({ d: nearer(acc.d, added(k, acc.so)), so: [...acc.so, k] }), { d: bare, so: [] }).d;

  const chosen: number[] = [];
  const errors: number[] = [];
  let have: Float32Array = bare;
  const limit = Math.min(most, candidates.length);
  while (chosen.length < limit) {
    let bestPen = -1;
    let bestD: Float32Array | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < candidates.length; k++) {
      if (chosen.includes(k)) continue;
      const d = nearer(have, added(k, chosen));
      const score = mean(d);
      if (score < bestScore) { bestScore = score; bestPen = k; bestD = d; }
    }
    chosen.push(bestPen);
    errors.push(bestScore);
    have = bestD!;
  }

  // Adding one at a time can settle on a set no better than a swap away: one round of every swap.
  let current = errors[errors.length - 1] ?? mean(bare);
  for (let slot = 0; slot < chosen.length; slot++) {
    const others = chosen.filter((_, i) => i !== slot);
    const base = withSet(others);
    for (let k = 0; k < candidates.length; k++) {
      if (chosen.includes(k)) continue;
      const score = mean(nearer(base, added(k, others)));
      if (score < current - 1e-6) {
        chosen[slot] = k;
        current = score;
      }
    }
  }
  if (errors.length) errors[errors.length - 1] = current;
  return { pens: chosen, errors };
}
