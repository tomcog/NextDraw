import { fitCover, hexLinear, labOfLinear, tonesOf } from "../../shared/lib/drawing/photo";

// Choosing a tool's pens for a photo by how they really come out on paper: each pen's colour on this
// paper, solid, and every share of paper between none and solid, mixed in linear light as hatching
// is seen from a little way off. The best set of N is the one that, with each pixel drawn in its
// best pen at its best share, comes nearest the photo on average.

/** A pen to choose from: its name, and its colour on the paper being printed on, solid. */
export interface Candidate {
  name: string;
  onPaper: string;
}

export interface PenChoice {
  /** The pens chosen, best first, as indices into the candidates. */
  pens: number[];
  /** The average ΔE with the best 1, 2, … pens, so what one more or one fewer buys can be seen. */
  errors: number[];
}

/** Pixels the choice is made on: plenty to stand for a photo, few enough to try every pen against. */
const SAMPLES = 3000;

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
 * The best `most` pens of `candidates` for the photo `src` on `paper`, or null while the photo
 * hasn't been read. Pens are added one at a time, each the one that helps most; then, for the full
 * set, any pen is swapped for another while that brings the photo nearer.
 */
export function choosePens(src: string, brightness: number, contrast: number, candidates: Candidate[], paper: string, most: number): PenChoice | null {
  const tones = tonesOf(src);
  if (!tones || !candidates.length) return null;
  const adjust = adjuster(brightness, contrast);
  const paperLight = hexLinear(paper);
  const paperLab = labOfLinear(paperLight);
  const pens = candidates.map((c) => hexLinear(c.onPaper));

  // How near each sampled pixel comes in each pen, and in bare paper.
  const total = tones.w * tones.h;
  const n = Math.min(SAMPLES, total);
  const err = new Float32Array(n * pens.length);
  const bare = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    const light = [toLinear(adjust(tones.rgba[p])), toLinear(adjust(tones.rgba[p + 1])), toLinear(adjust(tones.rgba[p + 2]))];
    const here = labOfLinear(light);
    bare[i] = Math.hypot(here[0] - paperLab[0], here[1] - paperLab[1], here[2] - paperLab[2]);
    pens.forEach((pen, k) => { err[i * pens.length + k] = fitCover(light, paperLight, pen, here).err; });
  }

  // The average ΔE with a set of pens: each pixel in whichever of them, or bare paper, comes nearest.
  const scoreOf = (set: number[]) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = bare[i];
      for (const k of set) best = Math.min(best, err[i * pens.length + k]);
      sum += best;
    }
    return sum / n;
  };

  const chosen: number[] = [];
  const errors: number[] = [];
  const limit = Math.min(most, pens.length);
  while (chosen.length < limit) {
    let bestPen = -1;
    let bestScore = Infinity;
    for (let k = 0; k < pens.length; k++) {
      if (chosen.includes(k)) continue;
      const score = scoreOf([...chosen, k]);
      if (score < bestScore) { bestScore = score; bestPen = k; }
    }
    chosen.push(bestPen);
    errors.push(bestScore);
  }

  // Adding one at a time can settle on a set no better than a swap away: try every swap until none helps.
  let current = errors[errors.length - 1] ?? scoreOf([]);
  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (let slot = 0; slot < chosen.length; slot++) {
      for (let k = 0; k < pens.length; k++) {
        if (chosen.includes(k)) continue;
        const trial = chosen.map((c, i) => (i === slot ? k : c));
        const score = scoreOf(trial);
        if (score < current - 1e-6) {
          chosen[slot] = k;
          current = score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  if (errors.length) errors[errors.length - 1] = current;
  return { pens: chosen, errors };
}
