// A vignette: the picture darkened toward its edges - or lightened, faded toward the paper - before
// any effect reads it, so every layer and every style sees it, as it sees brightness and contrast. It
// lies over the part of the picture that shows, inside the crop, so it frames what's drawn.

/** A vignette's numbers, in the units the card's fields show. */
export interface Vignette {
  /** -100 to 100: how much darker the edges get; below 0, how far they fade toward the paper instead. */
  amount: number;
  /** 0 to 100: how far in it reaches - 0 the corners alone, 100 nearly to the middle. */
  size: number;
  /** 0 to 100: how gently it fades in - 0 a hard line, 100 the softest. */
  softness: number;
  /** -100 to 100: its shape - 0 an oval fitting the picture, 100 a circle, -100 nearly the picture's rectangle. */
  roundness: number;
  /** Turned off, its numbers kept for turning it on again. */
  off?: boolean;
}

export const VIGNETTE_DEFAULTS: Vignette = { amount: 50, size: 50, softness: 50, roundness: 0 };

/** Each number's field: its label, range and step, in the order the card shows them. */
export const VIGNETTE_FIELDS: { key: Exclude<keyof Vignette, "off">; label: string; unit?: string; min: number; max: number; step: number; about: string }[] = [
  { key: "amount", label: "Darkness", unit: "%", min: -100, max: 100, step: 5, about: "How much darker the edges get. Below 0 they fade toward the paper instead" },
  { key: "size", label: "Size", unit: "%", min: 0, max: 100, step: 5, about: "How far in it reaches: 0 the corners alone, 100 nearly to the middle" },
  { key: "softness", label: "Softness", unit: "%", min: 0, max: 100, step: 5, about: "How gently it fades in: 0 a hard line, 100 the softest" },
  { key: "roundness", label: "Roundness", min: -100, max: 100, step: 5, about: "Its shape: 0 an oval fitting the picture, 100 a circle, -100 nearly a rectangle" },
];

/** Whether a vignette changes anything. */
export const vignetteOn = (v: Vignette | undefined): v is Vignette => Boolean(v && !v.off && v.amount !== 0);

/** The same numbers, the same vignette: for keys. */
export const vignetteKey = (v: Vignette | undefined) => (vignetteOn(v) ? `${v.amount},${v.size},${v.softness},${v.roundness}` : "");

/** Read back from a drawing, or undefined for anything that isn't one. Missing numbers are the defaults. */
export function vignetteFromData(raw: unknown): Vignette | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Vignette = { ...VIGNETTE_DEFAULTS };
  for (const f of VIGNETTE_FIELDS) {
    const v = Number(r[f.key]);
    if (r[f.key] !== undefined && Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  if (r.off === true) out.off = true;
  return out;
}

const smoothstep = (a: number, b: number, x: number) => {
  if (b <= a) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How strongly the vignette works at each point of a picture `w` by `h` pixels, row by row: 0 not at
 * all, up to the amount's share, 0 to 1, at the corners. Its sign is the amount's: darker or lighter.
 */
export function vignetteStrength(v: Vignette, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  if (!vignetteOn(v)) return out;
  const amount = Math.min(1, Math.abs(v.amount) / 100);
  const round = Math.max(-1, Math.min(1, v.roundness / 100));
  // Toward a circle, the axes scaled to the longer side; toward a rectangle, a squarer superellipse.
  const long = Math.max(w, h);
  const sx = round > 0 ? 1 + ((w / long) - 1) * round : 1;
  const sy = round > 0 ? 1 + ((h / long) - 1) * round : 1;
  const p = round < 0 ? 2 + -round * 8 : 2;
  // Where the fade is halfway: the oval through the middle of each side is 1, the corners about 1.4.
  const mid = 1.45 - (Math.min(100, Math.max(0, v.size)) / 100) * 1.2;
  const half = Math.max(0.01, (Math.min(100, Math.max(0, v.softness)) / 100) * 0.9);
  for (let y = 0; y < h; y++) {
    const ey = Math.abs((((y + 0.5) / h) * 2 - 1) * sy);
    for (let x = 0; x < w; x++) {
      const ex = Math.abs((((x + 0.5) / w) * 2 - 1) * sx);
      const d = p === 2 ? Math.hypot(ex, ey) : Math.pow(ex ** p + ey ** p, 1 / p);
      out[y * w + x] = smoothstep(mid - half, mid + half, d) * amount;
    }
  }
  return out;
}

/** A pixel's value, 0 to 1 or 0 to 255 by `top`, with the vignette's strength `k` there laid over it. */
export const vignetted = (value: number, k: number, darker: boolean, top = 1) => (darker ? value * (1 - k) : top - (top - value) * (1 - k));
