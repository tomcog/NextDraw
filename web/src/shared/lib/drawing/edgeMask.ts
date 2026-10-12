// A random edge for an image, made rather than loaded: a grunge border, a torn edge, worked out from a
// preset and its numbers, and a seed. The drawing keeps just those, so the same edge comes back every time
// it is opened, and New edge is only a new seed. It is made at the shape of the part of the image that
// shows, so nothing is stretched, and only on the sides asked for.

export type EdgeStyle = "torn" | "brush" | "grunge" | "spray" | "thin" | "dry";

/** What makes an edge look the way it does, in the units the fields show. */
export interface EdgeLook {
  /** How far in the border reaches: a percentage of the shorter side of what shows. */
  depth: number;
  /** How far the border wanders in and out, as a percentage of its depth. */
  wander: number;
  /** How many slow waves it wanders in, along the shorter side. */
  waves: number;
  /** How ragged the line is close up: a percentage of the shorter side. */
  rough: number;
  /** How fine that raggedness is: bigger is finer. */
  grain: number;
  /** Specks of paper scattered inside the border, how far in they reach: a percentage. */
  specks: number;
  /** Streaks across the border, like a dry brush dragged off the edge: 0 none, 1 as long as it is deep. */
  streaks: number;
  /** Specks of image left inside the paper, how far out they reach: a percentage. */
  holes: number;
  /** A spray-paint fade, dots thinning out over this width: a percentage; 0 a clean line. */
  fade: number;
}

export interface EdgeGen extends EdgeLook {
  /** The preset it started from. Its numbers may since have been changed. */
  style: EdgeStyle;
  seed: number;
  /**
   * How much each layer's edge differs from the others, as a percentage: every number nudged up or
   * down by up to this much, differently for each layer, the edge itself the same - so the layers'
   * borders sit close together without lining up exactly, as hand-printed colours do. Absent, 0.
   */
  vary?: number;
}

/** The presets: each a look to start from, the same as the masks first made for the library. */
export const EDGE_STYLES: { key: EdgeStyle; label: string; look: EdgeLook }[] = [
  { key: "torn", label: "Torn paper", look: { depth: 5, wander: 90, waves: 6, rough: 1.2, grain: 40, specks: 0, streaks: 0, holes: 0, fade: 0 } },
  { key: "brush", label: "Rough brush", look: { depth: 6, wander: 60, waves: 10, rough: 2, grain: 25, specks: 3, streaks: 0.5, holes: 0, fade: 0 } },
  { key: "grunge", label: "Grunge", look: { depth: 7, wander: 70, waves: 5, rough: 5, grain: 8, specks: 6, streaks: 0, holes: 3, fade: 0 } },
  { key: "spray", label: "Spray", look: { depth: 5, wander: 40, waves: 4, rough: 1.5, grain: 12, specks: 0, streaks: 0, holes: 0, fade: 7 } },
  { key: "thin", label: "Thin rough", look: { depth: 2.5, wander: 80, waves: 14, rough: 0.8, grain: 50, specks: 1.5, streaks: 0, holes: 0, fade: 0 } },
  { key: "dry", label: "Dry brush", look: { depth: 6.5, wander: 50, waves: 7, rough: 1.2, grain: 30, specks: 0, streaks: 1.2, holes: 4, fade: 0 } },
];

/** Each number's field: its label, range and step, in the order the card shows them. */
export const EDGE_FIELDS: { key: keyof EdgeLook; label: string; unit?: string; min: number; max: number; step: number; about: string }[] = [
  { key: "depth", label: "Depth", unit: "%", min: 0.5, max: 30, step: 0.5, about: "How far in the border reaches, as a share of the shorter side" },
  { key: "wander", label: "Wander", unit: "%", min: 0, max: 100, step: 5, about: "How far the border wanders in and out, as a share of its depth" },
  { key: "waves", label: "Waves", min: 1, max: 40, step: 1, about: "How many slow waves the border wanders in along the shorter side" },
  { key: "rough", label: "Roughness", unit: "%", min: 0, max: 10, step: 0.1, about: "How ragged the line is close up" },
  { key: "grain", label: "Grain", min: 2, max: 100, step: 1, about: "How fine the raggedness is: higher is finer" },
  { key: "specks", label: "Specks", unit: "%", min: 0, max: 15, step: 0.5, about: "Specks of paper scattered inside the border, and how far in they reach" },
  { key: "holes", label: "Holes", unit: "%", min: 0, max: 15, step: 0.5, about: "Specks of image left in the border, and how far out they reach" },
  { key: "streaks", label: "Streaks", min: 0, max: 3, step: 0.1, about: "Streaks across the border, like a dry brush dragged off the edge" },
  { key: "fade", label: "Fade", unit: "%", min: 0, max: 20, step: 0.5, about: "A spray-paint fade: dots thinning out over this width. 0 is a clean line" },
];

const lookOf = (style: EdgeStyle) => (EDGE_STYLES.find((s) => s.key === style) ?? EDGE_STYLES[0]).look;

export const newSeed = () => Math.floor(Math.random() * 1e9);

/** A preset's edge, with a seed of its own. */
export const newEdge = (style: EdgeStyle): EdgeGen => ({ style, seed: newSeed(), ...lookOf(style) });

/** Read back from a drawing, or undefined for anything that isn't one. Missing numbers are the preset's. */
export function edgeGenFromData(raw: unknown): EdgeGen | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const style = EDGE_STYLES.find((s) => s.key === r.style)?.key;
  if (!style) return undefined;
  const look = { ...lookOf(style) };
  for (const f of EDGE_FIELDS) {
    const v = Number(r[f.key]);
    if (r[f.key] !== undefined && Number.isFinite(v)) look[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  const seed = Number(r.seed);
  const vary = Number(r.vary);
  return {
    style, seed: Number.isFinite(seed) ? Math.floor(Math.abs(seed)) % 1e9 : 1, ...look,
    ...(vary > 0 ? { vary: Math.min(MOST_VARY, vary) } : {}),
  };
}

export const edgeGenKey = (g: EdgeGen) => [g.seed, ...EDGE_FIELDS.map((f) => g[f.key]), g.vary ?? 0].join("|");

/** The most a layer's edge may vary from the others, as a percentage. */
export const MOST_VARY = 50;

/**
 * One layer's own version of a varied edge: each number moved up or down by up to `vary` percent, by
 * an amount worked out from the layer and the number, so a layer comes out the same every time and no
 * two layers alike. A number at nothing stays at nothing - a style without specks gets none.
 */
export function edgeForLayer(gen: EdgeGen, layer: string): EdgeGen {
  const vary = (gen.vary ?? 0) / 100;
  if (!(vary > 0)) return gen;
  const out = { ...gen };
  for (const f of EDGE_FIELDS) {
    const r = textHash(`${gen.seed}|${layer}|${f.key}`) * 2 - 1;
    out[f.key] = Math.min(f.max, Math.max(f.min, gen[f.key] * (1 + vary * r)));
  }
  return out;
}

/** A string as a number from 0 to 1, the same every time (FNV-1a). */
function textHash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Smooth noise from a table of random values, a different table for each seed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function noise2(seed: number) {
  const r = rng(seed);
  const G = 256;
  const g = new Float32Array(G * G);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const at = (i: number, j: number) => g[(j & 255) * G + (i & 255)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = ease(x - i);
    const fy = ease(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}
function fbm(seed: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, k) => noise2(seed + k * 97));
  return (x: number, y: number) => {
    let v = 0;
    let a = 1;
    let f = 1;
    let total = 0;
    for (const n of layers) {
      v += a * n(x * f, y * f);
      total += a;
      a *= 0.5;
      f *= 2;
    }
    return v / total;
  };
}
/** A random number for a pixel, the same whichever order the pixels are worked out in. */
function hash(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type Side = "top" | "right" | "bottom" | "left";
const cache = new Map<string, Float32Array>();

/**
 * How much of each pixel the edge keeps, 0 (paper) to 1, over a grid `gw` by `gh` laid on the part of
 * the image that shows. Distances are measured in the shorter side, so a border is as deep on a long
 * side as on a short one. Only the pixels near a chosen side are worked out; the middle is kept whole.
 */
export function edgeKeep(gen: EdgeGen, sides: Side[], gw: number, gh: number): Float32Array {
  const key = `${edgeGenKey(gen)}|${sides.join(",")}|${gw}x${gh}`;
  const known = cache.get(key);
  if (known) return known;
  const base = gen.depth / 100;
  const wobble = gen.wander / 100;
  const rough = gen.rough / 100;
  const soft = 0.002;
  const speck = gen.specks / 100;
  const holes = gen.holes / 100;
  const spray = gen.fade / 100;
  const streak = gen.streaks;
  const seed = gen.seed;
  const edge = fbm(seed, 5);
  const grain = fbm(seed + 500, 6);
  const fine = noise2(seed + 900);

  const S = Math.min(gw, gh);
  const W = gw / S;
  const H = gh / S;
  const keep = new Float32Array(gw * gh).fill(1);
  if (!sides.length || S < 2) return keep;
  // Each side's depth along it, worked out once: one wandering line per side.
  const depthAlong = (n: number, side: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = base * (1 + wobble * edge(((i + 0.5) / S) * gen.waves, side * 31.7));
    return out;
  };
  const along: Record<Side, Float32Array> = {
    left: depthAlong(gh, 0), right: depthAlong(gh, 1), top: depthAlong(gw, 2), bottom: depthAlong(gw, 3),
  };
  const sideIndex: Record<Side, number> = { left: 0, right: 1, top: 2, bottom: 3 };
  // Nothing past this reaches far enough to touch a pixel.
  const reach = base * (1 + wobble) + streak * base + rough + speck + spray + soft + 0.01;

  for (let y = 0; y < gh; y++) {
    const Y = (y + 0.5) / S;
    for (let x = 0; x < gw; x++) {
      const X = (x + 0.5) / S;
      let inside = Infinity;
      for (const side of sides) {
        const d = side === "left" ? X : side === "right" ? W - X : side === "top" ? Y : H - Y;
        if (d > reach) continue;
        const t = side === "left" || side === "right" ? Y : X;
        const ti = side === "left" || side === "right" ? y : x;
        let depth = along[side][ti];
        if (streak) depth += streak * base * fine(t * 400, sideIndex[side] * 13 + d * 3);
        inside = Math.min(inside, d - depth);
      }
      if (inside === Infinity) continue; // far from every chosen side: kept whole
      const g = grain(X * gen.grain, Y * gen.grain);
      inside += rough * g;
      let v: number;
      if (spray) {
        // A falloff dithered into specks, like spray paint dying away.
        v = hash(x, y, seed) < smoothstep(-spray * 0.4, spray, inside) ? 1 : 0;
      } else v = smoothstep(-soft, soft, inside);
      if (speck && inside > 0 && inside < speck && hash(x, y, seed + 1) < 0.02 * (1 - inside / speck) && grain(X * 90, Y * 90) > 0.05) v = 0;
      if (holes && inside < 0 && inside > -holes && grain(X * 60 + 9, Y * 60) > 0.25) v = 1;
      keep[y * gw + x] = v;
    }
  }
  // A speck is a pixel; spread each a touch so it reads at plotting size.
  if (speck || spray) {
    const spread = keep.slice();
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        if (keep[y * gw + x] === 0) {
          spread[y * gw + x + 1] = 0;
          spread[(y + 1) * gw + x] = 0;
          spread[(y + 1) * gw + x + 1] = 0;
        }
      }
    }
    keep.set(spread);
  }
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  cache.set(key, keep);
  return keep;
}
