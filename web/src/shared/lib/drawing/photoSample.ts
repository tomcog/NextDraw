// Reading a picture: the tones under a point, the colour under it, the separations behind that, and
// the small geometry every effect shares - joining runs, pruning, thinning, travelling. The engine,
// in other words, with the effects that drive it in files of their own (Tom, 2026-11-24).
//
// It knows nothing of photo.ts, which is what lets each effect import from here without the two
// importing each other in a circle.

import { edgeGenKey } from "./edgeMask";
import type { Point } from "./parametric";
import { fitNodes } from "./path";
import type { Node } from "./path";
import { BLACK_CHROMA, BLACK_LIGHTEST, BLACK_SHARE, BLEED_LAB, CENTER_DEFAULTS, CENTER_EDGE, COVER_EDGE, EDGE_DE, EDGE_DEFAULTS, FLOW_EDGE, INK_COST, KEY_FROM, MAX_DENSITY, MOST_PASSES, PAINT_DEFAULTS, PAINT_FLAT_DEFAULTS, PLATE_OFF, RING, SILHOUETTE_DEFAULTS, SKETCH_LINES, SKETCH_RANGES, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, SQUIGGLE_INKSCAPE_RANGES, SQUIGGLE_RANGES, STREAM_DEFAULTS } from "./photoDefaults";
import type { SketchLines, SketchNumber, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";
import type { Areas, Fit, Mix, PaintRegions, Photo, Plate, PlateSet, Run, Separation, SeparationRequest, Tones } from "./photoTypes";
import { vignetteKey } from "./vignette";

export const PLATE_SETS: { key: PlateSet; label: string; about: string; plates: Plate[] }[] = [
  { key: "cmyk", label: "CMYK", about: "Print's four plates: cyan, magenta, yellow and black", plates: ["c", "m", "y", "k"] },
  { key: "cmykog", label: "CMYK + OG", about: "Six plates, as Hexachrome printing: CMYK with orange and green", plates: ["c", "m", "y", "k", "o", "g"] },
  { key: "cmykogv", label: "CMYK + OGV", about: "Seven plates, as today's extended-gamut printing: CMYK with orange, green and violet", plates: ["c", "m", "y", "k", "o", "g", "v"] },
  { key: "cmykogrv", label: "CMYK + OGRV", about: "Eight plates: CMYK with orange, green, red and violet", plates: ["c", "m", "y", "k", "o", "g", "r", "v"] },
];
/**
 * A set of inks said in a line: the built-in set's own name where they are one of them - CMYK,
 * CMYK + OGV - and how many there are where they aren't. For naming a color profile in the Inks
 * menu by what it separates into, in the words the menu already uses above it (Tom, 2026-11-23).
 */

/** Which plate set a photo's plates are, by how many there are. */
export const plateSetOf = (plates: unknown[] | undefined): PlateSet =>
  PLATE_SETS.find((s) => s.plates.length === (plates?.length ?? 4))?.key ?? "cmyk";

export const platesOf = (plates: unknown[] | undefined): Plate[] => PLATE_SETS.find((s) => s.key === plateSetOf(plates))!.plates;

/**
 * What each plate aims for - printing's own cyan, magenta, yellow and black, to find the nearest pen
 * to - and the angle it's hatched at: print's screen angles, apart enough that the four don't make
 * moiré patterns where they cross.
 */

/** Where this layer's ink sits in its set: its own place, or its plate's place in the built-in set. */
export const inkAtOf = (p: Pick<Photo, "inkAt" | "plate" | "plates">): number =>
  p.inkAt ?? (p.plate ? platesOf(p.plates).indexOf(p.plate) : -1);

/**
 * Whether a photo's pens are still the ones its ink set chose. False once any has been changed by
 * hand in the Layers card: the menu then names a set these are no longer the inks of, which is worse
 * than saying nothing - it was what made "Save ink set" look as though it would save CMYK + OGV.
 *
 * Judged against what the set would choose for THIS photo's hatching, not the hatching as it stands:
 * a pen is picked partly by how it covers at a spacing, so comparing against the current spacing
 * would call a set modified merely because the spacing had been turned.
 *
 * A plate turned off is not a change of ink - the set is still the set, with one of it silenced.
 */

/**
 * Whether this layer is one ink of a separated set - a plate of CMYK, or of a set of your own. Asked
 * wherever `photo.plate` used to be asked as a yes or no, since a set of your own has no plate letter.
 */
export const onePlate = (p: Pick<Photo, "plate" | "inkAt">): boolean => Boolean(p.plate) || p.inkAt !== undefined;

/** A colour's hue round the colour wheel (0-360), saturation and value (0-1). */

/** The picture's tones a photo split around the paper leaves bare, as darkness from and to: unless set, the middle third. */
export const paperToneOf = (photo: Pick<Photo, "paperTone">): [number, number] => {
  const [a, b] = photo.paperTone ?? [1 / 3, 2 / 3];
  return [Math.min(1, Math.max(0, Math.min(a, b))), Math.min(1, Math.max(0, Math.max(a, b)))];
};

export const squiggleInkscapeOf = (photo: Pick<Photo, "squiggleInkscape">): SquiggleInkscape => {
  const out = { ...SQUIGGLE_INKSCAPE, ...(photo.squiggleInkscape ?? {}) };
  for (const [key, r] of Object.entries(SQUIGGLE_INKSCAPE_RANGES) as ["rows" | "cols" | "freq" | "amp", { min: number; max: number }][]) {
    out[key] = Math.min(r.max, Math.max(r.min, Math.round(Number.isFinite(out[key]) ? out[key] : SQUIGGLE_INKSCAPE[key])));
  }
  out.invert = out.invert === true;
  if (out.path !== "bidi" && out.path !== "join") out.path = "uni";
  return out;
};

export const sketchLinesOf = (photo: Pick<Photo, "sketchLines">): SketchLines => {
  const out = { ...SKETCH_LINES, ...(photo.sketchLines ?? {}) };
  for (const [key, r] of Object.entries(SKETCH_RANGES) as [SketchNumber, { min: number; max: number }][]) {
    out[key] = Math.min(r.max, Math.max(r.min, Number.isFinite(out[key]) ? out[key] : SKETCH_LINES[key]));
  }
  for (const key of ["unlimitedTests", "liftPen", "shading"] as const) out[key] = typeof out[key] === "boolean" ? out[key] : SKETCH_LINES[key];
  return out;
};

/** A photo's SquiggleDraw settings: its own over the sketch's defaults, each kept in its range. */

/** A photo's SquiggleDraw settings: its own over the sketch's defaults, each kept in its range. */
export const squiggleDrawOf = (photo: Pick<Photo, "squiggleDraw">): SquiggleDraw => {
  const out = { ...SQUIGGLE_DRAW, ...(photo.squiggleDraw ?? {}) };
  for (const [key, r] of Object.entries(SQUIGGLE_RANGES) as [Exclude<keyof SquiggleDraw, "invert">, { min: number; max: number }][]) {
    out[key] = Math.min(r.max, Math.max(r.min, Number.isFinite(out[key]) ? out[key] : SQUIGGLE_DRAW[key]));
  }
  out.invert = out.invert === true;
  return out;
};

export const centerModeOf = (p: Pick<Photo, "centerMode" | "centerStraightMm">) => p.centerMode ?? (p.centerStraightMm ? "straight" : "curves");

/**
 * The photo faded to paper under its edge mask. The mask is stretched over the part of the picture
 * that shows - inside the crop - so its border frames what's drawn, whatever the crop; how much of
 * each pixel is kept is the mask's lightness there (its darkness, inverted), and the pixel is taken
 * that far back toward white. Worked out once for each photo, mask and crop.
 */
/**
 * Which layer of a photo this is, as text: what tells its layers apart - the band, the plate, the
 * colour group, the separation, the key. The same for a layer every time, so its varied edge is too.
 */
export const layerOf = (p: Partial<Photo>) =>
  // Not the ink set or the place in it: this seeds the varied edge and the random sketch of a layer
  // (see sketchLines and streamlines), so anything added here redraws every drawing ever made. The
  // inks of a set are told apart by `ink`, their own colour, which is here already.
  JSON.stringify([p.band, p.side, p.plate, p.ink, p.region, p.key ? 1 : 0, p.separation ? `${p.separation.length}|${p.separation.slice(-24)}` : ""]);

const smoothCache = new Map<string, Tones>();

/**
 * The photo smoothed by `r` pixels - its lightness and its colours alike, so every way of splitting it
 * sees the same smoothing. Worked out once for each photo and amount.
 */

/**
 * The photo smoothed by `r` pixels - its lightness and its colours alike, so every way of splitting it
 * sees the same smoothing. Worked out once for each photo and amount.
 */
export function smoothedTones(src: string, tones: Tones, r: number): Tones {
  const k = Math.round(r * 2) / 2;
  if (k < 0.5) return tones;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${tones.flat ?? 0}|${k}`;
  const known = smoothCache.get(key);
  if (known) return known;
  const n = tones.w * tones.h;
  const light = Float32Array.from(tones.light);
  blurGrid(light, tones.w, tones.h, k);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const channel = new Float32Array(n);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) channel[i] = tones.rgba[i * 4 + c];
    if (c < 3) blurGrid(channel, tones.w, tones.h, k);
    for (let i = 0; i < n; i++) rgba[i * 4 + c] = channel[i];
  }
  const made = { w: tones.w, h: tones.h, light, rgba, blur: k, sat: tones.sat, mask: tones.mask, flat: tones.flat };
  if (smoothCache.size > 4) smoothCache.delete(smoothCache.keys().next().value!);
  smoothCache.set(key, made);
  return made;
}

/** Everything a photo's lines depend on, as one string: the same key, the same lines. */
export function marksKey(photo: Photo, w: number, h: number) {
  return [photo.src.length, photo.src.slice(-32), w.toFixed(4), h.toFixed(4), photo.brightness, photo.contrast, photo.saturation ?? 0, photo.flatten ?? 0, photo.angle, photo.spacingMm, photo.levels, photo.hatchSmoothMm ?? "", photo.hatchShortestMm ?? "", photo.band?.join(",") ?? "", photo.side ?? "", photo.paperTone?.join(",") ?? "", photo.crop?.join(",") ?? "", photo.bleed ?? 0, photo.style ?? "hatch", photo.rowMm ?? "", photo.waveMm ?? "", photo.squiggleAmpMm ?? "", photo.squiggleHeight ?? "", photo.squiggleJoin ? "join" : "", photo.squiggleLift ? "lift" : "", photo.squiggleSmooth ?? "", JSON.stringify(photo.squiggleDraw ?? {}), photo.squiggleVersion ?? "", JSON.stringify(photo.squiggleInkscape ?? {}), photo.squiggleAngle ?? "", photo.ink ?? "", photo.regions?.join(",") ?? "", photo.region ?? "", photo.contours ?? "", photo.smoothMm ?? "", photo.key ? "key" : "", photo.keyInk ?? "", photo.regionInks?.join(",") ?? "", photo.keyStrength ?? "", photo.keyFrom ?? "", photo.plate ?? "", photo.plates?.join(",") ?? "", photo.blackShare ?? "", photo.centerFrom ?? "", photo.centerSmoothMm ?? "", photo.centerShortestMm ?? "", photo.centerMode ?? "", photo.centerStraightMm ?? "", photo.centerLongMm ?? "", photo.centerCornerDeg ?? "", photo.edgeFrom ?? "", photo.edgeSmoothMm ?? "", photo.edgeShortestMm ?? "", photo.silhouetteFrom ?? "", photo.silhouetteSmoothMm ?? "", photo.silhouetteSmallestMm ?? "", photo.fitPaper ?? "", photo.penMm ?? "", photo.fitPairs ? "pairs" : "", photo.fitOpaque ? "opaque" : "", photo.streamWidestMm ?? "", photo.streamPasses ?? "", photo.streamFlowMm ?? "", photo.scribbleLengthMm ?? "", photo.scribbleMinMm ?? "", photo.scribbleWiggle ?? "", photo.scribbleSegmentMm ?? "", photo.scribbleSeed ?? "", JSON.stringify(photo.sketchLines ?? {}), photo.paintSmoothMm ?? "", photo.paintSmallestMm ?? "", photo.paintOutline ?? "", photo.profileInk ?? "", photo.lineDots ?? "", photo.lineLiftMm ?? "", photo.lineCurve ?? "", photo.lineAngle ?? "", photo.lineBias ?? "", photo.lineGrain ?? "", photo.lineContrast ?? "", photo.hilbertCoarsestMm ?? "", photo.hilbertLift ? "hlift" : "", photo.hilbertCurve ?? "", photo.hilbertRound ?? "", photo.hilbertBlend ?? "", photo.hilbertAngle ?? "", photo.edgeMask ? `${photo.edgeMask.length}|${photo.edgeMask.slice(-32)}` : "", photo.edgeMaskInvert ? "inv" : "", photo.edgeMaskSides?.join(",") ?? "", photo.edgeGen ? edgeGenKey(photo.edgeGen) : "", vignetteKey(photo.vignette)].join("|");
}

/** How dark the photo is at a point of its box (0 to 1 across and down), after brightness and contrast. */
export function darknessAt(tones: Tones, u: number, v: number, lift: number, gain: number): number {
  const x = Math.min(tones.w - 1, Math.max(0, u * (tones.w - 1)));
  const y = Math.min(tones.h - 1, Math.max(0, v * (tones.h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(tones.w - 1, x0 + 1);
  const y1 = Math.min(tones.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const L = tones.light;
  const top = L[y0 * tones.w + x0] * (1 - fx) + L[y0 * tones.w + x1] * fx;
  const bottom = L[y1 * tones.w + x0] * (1 - fx) + L[y1 * tones.w + x1] * fx;
  const light = (top * (1 - fy) + bottom * fy - 0.5) * gain + 0.5 + lift;
  return 1 - Math.min(1, Math.max(0, light));
}

// ---------- Splitting by colour ----------

/** Light let through by an sRGB channel value, 0 to 255: what multiplies when inks are layered. */

/** Light let through by an sRGB channel value, 0 to 255: what multiplies when inks are layered. */
export const linear = (v: number) => {
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const density = (v: number) => Math.min(MAX_DENSITY, -Math.log(Math.max(1e-3, linear(v))));

/** An ink's density in each channel. */

/** An ink's density in each channel. */
const densityOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(density) as [number, number, number];
};

export function lab(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export const hexLab = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return lab((n >> 16) & 255, (n >> 8) & 255, n & 255);
};

export const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Brightness and contrast, applied to a channel value 0 to 255. */
export const adjuster = (brightness: number, contrast: number) => {
  const lift = brightness / 200;
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  return (v: number) => Math.min(255, Math.max(0, ((v / 255 - 0.5) * gain + 0.5 + lift) * 255));
};

/**
 * Whether a photo is in colour to speak of: enough of it far enough from grey. A black and white
 * photo - or a colour one that's nearly so - is split by value; one in colour, by its colours.
 */

const fitOf = (photo: Photo): Fit | undefined =>
  photo.fitPaper
    ? { paper: photo.fitPaper, steps: coverSteps(photo.penMm ?? 0.5, photo.spacingMm, photo.levels), pairs: Boolean(photo.fitPairs), opaque: Boolean(photo.fitOpaque) }
    : undefined;

function inArea(areas: Areas, at: number, group: number, bleed: number) {
  return areas.dist[at * areas.groups + group] <= areas.nearest[at] + bleed * BLEED_LAB;
}

const areasCache = new Map<string, Areas>();

// ---------- Best fit: pens as they come out on paper ----------

/** A colour's light, per channel, 0 to 1: what mixes when a pen's lines and the paper between them blur together. */

/** A colour's light, per channel, 0 to 1: what mixes when a pen's lines and the paper between them blur together. */
export const hexLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [linear((n >> 16) & 255), linear((n >> 8) & 255), linear(n & 255)];
};

/** CIELAB from light per channel. */
/** Light per channel from CIELAB: labOfLinear the other way. */
function linearOfLab([L, a, b]: number[]): [number, number, number] {
  const fy = (L + 16) / 116;
  const g = (t: number) => (t > 0.206893 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = g(fy + a / 500) * 0.9505;
  const y = g(fy);
  const z = g(fy - b / 200) * 1.089;
  return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
}

export function labOfLinear([R, G, B]: number[]): [number, number, number] {
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Light per channel from CIELAB: labOfLinear the other way. */

/**
 * Pens laid over the paper, each covering its share of it, bottom first: the colour that comes out,
 * as light per channel. Hatching seen from a little way off is the paper and the pen's colour mixed
 * by how much of the paper the lines cover, in linear light - which predicts a calibration sheet's
 * measured patches to within about 2 ΔE. A pen's lines over another's pass their share of the light
 * through, as a filter does; an opaque ink's cover what's under them instead. `pens` are each pen's
 * colour on this paper, solid, as light.
 */
export function mixOf(paper: number[], pens: number[][], covers: number[], opaque: boolean): [number, number, number] {
  const out: [number, number, number] = [paper[0], paper[1], paper[2]];
  pens.forEach((pen, k) => {
    const c = covers[k];
    if (!c) return;
    for (let i = 0; i < 3; i++) {
      out[i] = opaque ? out[i] * (1 - c) + pen[i] * c : out[i] * (1 - c + (c * pen[i]) / Math.max(1e-4, paper[i]));
    }
  });
  return out;
}

export function fitMenu(paper: string, pens: string[], steps: number[], pairs: boolean, opaque: boolean): Mix[] {
  const paperLight = hexLinear(paper);
  const light = pens.map(hexLinear);
  // Lightest first, the order the layers go down in.
  const order = light.map((_, k) => k).sort((a, b) => labOfLinear(light[b])[0] - labOfLinear(light[a])[0]);
  const make = (passes: number[]): Mix => {
    const covers = order.map((k) => steps[passes[k]] ?? 0);
    return { passes, lab: labOfLinear(mixOf(paperLight, order.map((k) => light[k]), covers, opaque)) };
  };
  const none = pens.map(() => 0);
  const menu = [make(none)];
  for (let a = 0; a < pens.length; a++) {
    for (let i = 1; i < steps.length; i++) menu.push(make(none.map((_, k) => (k === a ? i : 0))));
    if (!pairs) continue;
    for (let b = a + 1; b < pens.length; b++) {
      for (let i = 1; i < steps.length; i++) {
        for (let j = 1; j < steps.length; j++) menu.push(make(none.map((_, k) => (k === a ? i : k === b ? j : 0))));
      }
    }
  }
  return menu;
}

/**
 * How much of the paper hatching covers with 0, 1, 2… passes, for a line `penMm` wide, `spacingMm`
 * apart and up to `levels` passes. Each pass draws lines two spacings apart: the second crosses the
 * first, the third falls between the first's lines and the fourth between the second's; the fifth and
 * sixth run on the diagonals, each laying its share over what's left.
 */

/**
 * How much of the paper hatching covers with 0, 1, 2… passes, for a line `penMm` wide, `spacingMm`
 * apart and up to `levels` passes. Each pass draws lines two spacings apart: the second crosses the
 * first, the third falls between the first's lines and the fourth between the second's; the fifth and
 * sixth run on the diagonals, each laying its share over what's left.
 */
export function coverSteps(penMm: number, spacingMm: number, levels: number): number[] {
  const one = Math.min(1, penMm / (2 * Math.max(0.05, spacingMm)));
  const both = Math.min(1, 2 * one);
  const four = 1 - (1 - both) ** 2;
  const steps = [0, one, 1 - (1 - one) ** 2, 1 - (1 - both) * (1 - one), four, 1 - (1 - four) * (1 - one), 1 - (1 - four) * (1 - one) ** 2];
  return steps.slice(0, Math.min(MOST_PASSES, Math.max(1, Math.round(levels))) + 1);
}

/**
 * Which colour group each point of the photo belongs to - the nearest - and the density of its
 * colour, worked out small and read at its nearest pixel. What each layer draws is its group's area.
 * Split by best fit, the groups are pens, and each point takes whichever colour the pens can make -
 * bare paper, one pen at some number of passes, or two hatched across each other - comes nearest the
 * photo there: a pen's area is wherever that colour uses it, and `menu` says how many passes.
 */

/**
 * Which colour group each point of the photo belongs to - the nearest - and the density of its
 * colour, worked out small and read at its nearest pixel. What each layer draws is its group's area.
 * Split by best fit, the groups are pens, and each point takes whichever colour the pens can make -
 * bare paper, one pen at some number of passes, or two hatched across each other - comes nearest the
 * photo there: a pen's area is wherever that colour uses it, and `menu` says how many passes.
 */
function areasOf(tones: Tones, groups: string[], brightness: number, contrast: number, fit?: Fit): Areas {
  const key = [tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.flat ?? 0, tones.light[0], tones.light[tones.light.length >> 1], groups.join(","), brightness, contrast, fit ? JSON.stringify(fit) : ""].join("|");
  const known = areasCache.get(key);
  if (known) return known;
  const adjust = adjuster(brightness, contrast);
  const scale = Math.min(1, COVER_EDGE / Math.max(tones.w, tones.h));
  const w = Math.max(1, Math.round(tones.w * scale));
  const h = Math.max(1, Math.round(tones.h * scale));
  const centres = groups.map(hexLab);
  // The paper is a group of its own here, so pale areas belong to it and no layer draws them.
  centres.push(lab(255, 255, 255));
  const count = centres.length;
  const dist = new Float32Array(w * h * count);
  const nearestAll = new Float32Array(w * h);
  const bestAll = new Uint8Array(w * h);
  const want = new Float32Array(w * h * 3);
  const menu = fit ? fitMenu(fit.paper, groups, fit.steps, fit.pairs, fit.opaque) : undefined;
  const choice = menu ? new Uint16Array(w * h) : undefined;
  // A photo repeats its colours: each one is looked up in the menu once.
  const chosen = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    const sy = Math.min(tones.h - 1, Math.round((y / Math.max(1, h - 1)) * (tones.h - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(tones.w - 1, Math.round((x / Math.max(1, w - 1)) * (tones.w - 1)));
      const i = (sy * tones.w + sx) * 4;
      const r = adjust(tones.rgba[i]);
      const g = adjust(tones.rgba[i + 1]);
      const b = adjust(tones.rgba[i + 2]);
      const here = lab(r, g, b);
      const at = y * w + x;
      let nearest = Infinity;
      if (menu && choice) {
        const colour = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
        let pick = chosen.get(colour);
        if (pick === undefined) {
          pick = 0;
          let closest = Infinity;
          menu.forEach((mix, m) => {
            const d = dist2(here, mix.lab);
            if (d < closest) { closest = d; pick = m; }
          });
          chosen.set(colour, pick);
        }
        choice[at] = pick;
        // A pen's area is wherever the colour chosen uses it; the paper's, where it uses none.
        const passes = menu[pick].passes;
        let any = false;
        for (let k = 0; k < count - 1; k++) {
          const used = passes[k] > 0;
          dist[at * count + k] = used ? 0 : 1e9;
          if (used && !any) { bestAll[at] = k; any = true; }
        }
        dist[at * count + count - 1] = any ? 1e9 : 0;
        if (!any) bestAll[at] = count - 1;
        nearest = 0;
      } else {
        centres.forEach((c, k) => {
          const d = Math.sqrt(dist2(here, c));
          dist[at * count + k] = d;
          if (d < nearest) { nearest = d; bestAll[at] = k; }
        });
      }
      nearestAll[at] = nearest;
      want[at * 3] = density(r);
      want[at * 3 + 1] = density(g);
      want[at * 3 + 2] = density(b);
    }
  }
  const made = { w, h, groups: count, dist, nearest: nearestAll, best: bestAll, want, menu, choice };
  if (areasCache.size > 8) areasCache.delete(areasCache.keys().next().value!);
  areasCache.set(key, made);
  return made;
}

/**
 * How much of an area's pen and of the key, 0 to 1 each, to put down at a point, the way a printer
 * takes the grey out of colour: the key takes the darkness every channel shares - as much of it as
 * it can without going darker than the photo in any channel, times `strength` - and the pen draws
 * what's left, which is the colour itself. Either ink can be missing.
 */
// ---------- CMYK ----------

const separationCache = new Map<string, Separation>();

/**
 * How much of each of the four plates' pens the photo needs at every point, 0 to 1, laid over each
 * other on white paper. The black takes `blackShare` of the grey the colours would otherwise share
 * - cyan, magenta and yellow's least, taken out of all three and drawn in black (chooseCovers) - and
 * the colours make up the rest between them: at each point the amounts whose densities, added up, come nearest the photo's own, none less
 * than nothing or more than solid. Worked out from the pens' own colours, not printing's, so the
 * blend is what these markers will actually make. Worked out small, and read at its nearest pixel.
 */

/**
 * How much of each of the four plates' pens the photo needs at every point, 0 to 1, laid over each
 * other on white paper. The black takes `blackShare` of the grey the colours would otherwise share
 * - cyan, magenta and yellow's least, taken out of all three and drawn in black (chooseCovers) - and
 * the colours make up the rest between them: at each point the amounts whose densities, added up, come nearest the photo's own, none less
 * than nothing or more than solid. Worked out from the pens' own colours, not printing's, so the
 * blend is what these markers will actually make. Worked out small, and read at its nearest pixel.
 */
export function separationOf(tones: Tones, photo: Photo): Separation | null {
  const plates = photo.plates!;
  const { brightness, contrast } = photo;
  const blackShare = Math.min(1, Math.max(0, photo.blackShare ?? BLACK_SHARE));
  // What the hatching can draw: how many passes, and how much paper each covers.
  const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
  const penMm = photo.penMm ?? 0.5;
  const spacingMm = photo.spacingMm;
  const key = [tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.flat ?? 0, tones.light[0], tones.light[tones.light.length >> 1], plates.join(","), brightness, contrast, blackShare, levels, penMm, spacingMm].join("|");
  const known = separationCache.get(key);
  if (known) return known;
  const keep = (made: Separation) => {
    if (separationCache.size > 6) separationCache.delete(separationCache.keys().next().value!);
    separationCache.set(key, made);
    return made;
  };
  // The photo at the size it's separated at, read at the nearest pixel: quick, so done here.
  const scale = Math.min(1, COVER_EDGE / Math.max(tones.w, tones.h));
  const w = Math.max(1, Math.round(tones.w * scale));
  const h = Math.max(1, Math.round(tones.h * scale));
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(tones.h - 1, Math.round((y / Math.max(1, h - 1)) * (tones.h - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(tones.w - 1, Math.round((x / Math.max(1, w - 1)) * (tones.w - 1)));
      const i = (sy * tones.w + sx) * 4;
      rgb.set([tones.rgba[i], tones.rgba[i + 1], tones.rgba[i + 2]], (y * w + x) * 3);
    }
  }
  // A separation takes a moment to solve, so it's done off the page when the app has said how, and
  // until then there's nothing to draw yet. With no worker, here and now.
  if (separationRunner && !separateNow) {
    if (!separating.has(key)) {
      separating.add(key);
      separationRunner({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm })
        .then((maps) => {
          keep({ w, h, maps });
          for (const heard of separationListeners) heard();
        })
        .catch(() => {})
        .finally(() => separating.delete(key));
    }
    return null;
  }
  return keep({ w, h, maps: solveSeparation({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm }) });
}

let separationRunner: ((ask: SeparationRequest) => Promise<Float32Array[]>) | null = null;
// Set while lines are wanted at once, whatever the wait: when a drawing is written to a file.

// Set while lines are wanted at once, whatever the wait: when a drawing is written to a file.
let separateNow = false;

/** Setters, because the two above are this module's own state and the page that drives them lives
 *  elsewhere: `let` can only be assigned where it is declared. */
export const setSeparateNow = (on: boolean) => { separateNow = on; };
export function setSeparationRunner(run: (ask: SeparationRequest) => Promise<Float32Array[]>) {
  separationRunner = run;
}

/** A photo's lines now, its separation worked out here if it isn't ready - for saving, which can't wait. */

export const separating = new Set<string>();

export const separationListeners = new Set<() => void>();

/** How the app solves separations off the page - a worker; without one they're solved where asked. */

/**
 * The slow half of a separation, as hatching draws it. A pen's ink is always full strength: what
 * changes is how much of the paper its lines cover, and the lines mostly lie beside each other, or
 * across where they cross. So for each point of the photo this works out how much paper each plate's
 * pen should cover - smoothly, from none to as much as its passes reach (coverSteps for this pen and
 * spacing) - so that, laid over white paper and each other (mixOf), they come nearest the photo's
 * colour in Lab, with a small cost on ink so none is spent where it doesn't help, black weighed
 * against the colours by `blackShare`. Then each amount becomes the tone its hatching draws the
 * nearest number of passes at.
 *
 * Several mixes of many pens can come about equally near a colour, and two nearly equal colours
 * solved on their own can land on quite different ones - hard-edged blotches across a face. So each
 * point starts from the mix of the point before it and only adjusts it, and neighbouring colours stay
 * on the same mix; where the colour jumps - an edge - it's solved afresh. Pure, so a worker can run it.
 */
export function solveSeparation({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm }: SeparationRequest): Float32Array[] {
  const adjust = adjuster(brightness, contrast);
  // A plate set to None is a pen of paper's colour that's never used: the rest come as near as they can
  // without it, and its map stays empty.
  const off = plates.map((p) => p === PLATE_OFF);
  const pens = plates.map((p) => (p === PLATE_OFF ? [1, 1, 1] : hexLinear(p)));
  const steps = coverSteps(penMm, spacingMm, levels);
  const ink = blackInk(pens, off);
  const reach = withinReach(pens, steps, blackShare, off, ink);
  const maps = plates.map(() => new Float32Array(w * h));
  // Each colour solved once - shades an eighth of a step apart in each channel share an answer - but
  // reached from wherever its first point was, so the answer it keeps is a neighbour's.
  const solved = new Map<number, Float32Array>();
  let before: { want: number[]; covers: number[] } | null = null;
  // Each row starts from the point above it, not from the far end of the row before.
  let rowStart: { want: number[]; covers: number[] } | null = null;
  const toTone = (cover: number) => coverTone(cover, steps);
  for (let y = 0; y < h; y++) {
    before = rowStart;
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      const i = at * 3;
      const key = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
      const want = reach(labOfLinear([linear(adjust(rgb[i])), linear(adjust(rgb[i + 1])), linear(adjust(rgb[i + 2]))]));
      let covers = solved.get(key);
      if (!covers) {
        const from: number[] | null = before && Math.hypot(want[0] - before.want[0], want[1] - before.want[1], want[2] - before.want[2]) < EDGE_DE ? before.covers : null;
        covers = Float32Array.from(chooseCovers(want, pens, steps, blackShare, from, off, ink));
        solved.set(key, covers);
      }
      before = { want, covers: [...covers] };
      if (x === 0) rowStart = before;
      for (let n = 0; n < plates.length; n++) maps[n][at] = toTone(covers[n]);
    }
  }
  return maps;
}

/**
 * The photo's colours brought within what these pens can draw - black-point compensation, as print's
 * colour management does it. Hatching covers only part of the paper, so the darkest it can draw is
 * often a mid grey; matched exactly, everything darker than that goes to full ink and the photo's
 * shadows, mid-tones and much of its light are drawn alike - flat. So the photo's black becomes the
 * pens' darkest, white stays the paper, and every tone and colour between is spread in proportion.
 * The darkest follows the black share: with none, every pen at its most laid over each other; with
 * all of it, the black pen at its most on its own - so a black that is all black ink is the photo's
 * black, rather than a target only the colours stacked under it can reach. Returns the mapping, Lab to Lab.
 */

/**
 * The photo's colours brought within what these pens can draw - black-point compensation, as print's
 * colour management does it. Hatching covers only part of the paper, so the darkest it can draw is
 * often a mid grey; matched exactly, everything darker than that goes to full ink and the photo's
 * shadows, mid-tones and much of its light are drawn alike - flat. So the photo's black becomes the
 * pens' darkest, white stays the paper, and every tone and colour between is spread in proportion.
 * The darkest follows the black share: with none, every pen at its most laid over each other; with
 * all of it, the black pen at its most on its own - so a black that is all black ink is the photo's
 * black, rather than a target only the colours stacked under it can reach. Returns the mapping, Lab to Lab.
 */
export function withinReach(pens: number[][], steps: number[], blackShare = BLACK_SHARE, off: boolean[] = [], ink = blackInk(pens, off)): (lab: number[]) => number[] {
  const most = steps[steps.length - 1];
  const all = labOfLinear(mixOf([1, 1, 1], pens, pens.map((_, n) => (off[n] ? 0 : most)), false))[0];
  const black = ink >= 0 ? labOfLinear(mixOf([1, 1, 1], pens, pens.map((_, n) => (n === ink ? most : 0)), false))[0] : all;
  const share = Math.min(1, Math.max(0, blackShare));
  const darkest = all + (black - all) * share;
  // Only the lightness follows it: colour is scaled as every pen together can draw it, so turning the
  // black up doesn't wash out an orange or a navy that has no black in it.
  const k = Math.max(0, Math.min(1, (100 - darkest) / 100));
  const colour = Math.max(0, Math.min(1, (100 - all) / 100));
  return ([L, a, b]) => [100 - (100 - L) * k, a * colour, b * colour];
}

export function coverTone(cover: number, steps: number[]): number {
  const most = steps.length - 1;
  let p = 0;
  while (p < most && steps[p + 1] <= cover) p++;
  const passes = Math.min(most, Math.round(p + (p < most ? (cover - steps[p]) / (steps[p + 1] - steps[p]) : 0)));
  return passes ? (passes + 0.5) / (most + 1) : 0;
}

function blackInk(pens: number[][], off: boolean[] = []): number {
  let found = -1;
  let darkest = Infinity;
  pens.forEach((pen, n) => {
    if (off[n]) return;
    const [L, a, b] = labOfLinear(pen);
    if (L > BLACK_LIGHTEST || Math.hypot(a, b) > BLACK_CHROMA || L >= darkest) return;
    darkest = L;
    found = n;
  });
  return found;
}

/**
 * How much paper each pen should cover (in plate order, black fourth) to come nearest a colour `want`
 * in Lab, with black generation as print does it (gray component replacement). The grey in a colour is
 * the darkness all three of its channels share - its lightest channel's - which any mix of the colours
 * spends ink laying down together. `blackShare` of that darkness is the black's to draw: the black
 * plate is never less than that, and the others make up only what's left, the colour the black can't
 * give. So at all of it a grey or a black is black ink alone; at none the black is used only where it
 * comes cheaper than the colours over each other, as before.
 */

/**
 * How much paper each pen should cover (in plate order, black fourth) to come nearest a colour `want`
 * in Lab, with black generation as print does it (gray component replacement). The grey in a colour is
 * the darkness all three of its channels share - its lightest channel's - which any mix of the colours
 * spends ink laying down together. `blackShare` of that darkness is the black's to draw: the black
 * plate is never less than that, and the others make up only what's left, the colour the black can't
 * give. So at all of it a grey or a black is black ink alone; at none the black is used only where it
 * comes cheaper than the colours over each other, as before.
 */
export function chooseCovers(want: number[], pens: number[][], steps: number[], blackShare: number, from: number[] | null, off: boolean[] = [], ink = blackInk(pens, off)): number[] {
  const share = Math.min(1, Math.max(0, blackShare));
  if (ink < 0 || share === 0) return fitCovers(want, pens, steps, share, from, off, undefined, ink);
  const floors = pens.map((_, n) => (n === ink ? blackFloor(want, pens[ink], steps, share) : 0));
  return fitCovers(want, pens, steps, share, from, off, floors, ink);
}

/**
 * The least black for `want`: `share` of its grey, as density - the darkness its lightest channel has -
 * drawn by the black pen, whose own lightest channel passes that much light at that cover.
 */

/**
 * The least black for `want`: `share` of its grey, as density - the darkness its lightest channel has -
 * drawn by the black pen, whose own lightest channel passes that much light at that cover.
 */
function blackFloor(want: number[], black: number[], steps: number[], share: number): number {
  const lightest = Math.min(1, Math.max(...linearOfLab(want)));
  if (lightest >= 1) return 0;
  const passed = Math.exp(share * Math.log(Math.max(1e-4, lightest)));
  // Black at cover c passes 1 - c (1 - its own lightest channel) of the light.
  const cover = (1 - passed) / Math.max(1e-4, 1 - Math.max(...black));
  return Math.min(steps[steps.length - 1], Math.max(0, cover));
}

/**
 * The amounts themselves: one pen at a time, its best amount found with the others held, until none
 * moves - each pen kept to at least its `floors` amount. Started from `from` - a neighbour's mix, or
 * the black generation's - or, with none, from the one pen that comes nearest on its own: from
 * nothing, the first pens tried (cyan, magenta, yellow) settle an orange as yellow over magenta and the
 * orange pen is never reached.
 */

/**
 * The amounts themselves: one pen at a time, its best amount found with the others held, until none
 * moves - each pen kept to at least its `floors` amount. Started from `from` - a neighbour's mix, or
 * the black generation's - or, with none, from the one pen that comes nearest on its own: from
 * nothing, the first pens tried (cyan, magenta, yellow) settle an orange as yellow over magenta and the
 * orange pen is never reached.
 */
function fitCovers(want: number[], pens: number[][], steps: number[], blackShare: number, from: number[] | null, off: boolean[] = [], floors: number[] = [], ink = blackInk(pens, off)): number[] {
  const most = steps[steps.length - 1];
  const low = (n: number) => floors[n] ?? 0;
  const covers = from ? from.map((c, n) => (off[n] ? 0 : Math.max(low(n), c))) : pens.map((_, n) => low(n));
  const weight = pens.map((_, n) => (n === ink ? 1 - blackShare : blackShare) * 2 * INK_COST);
  const score = () => {
    const got = labOfLinear(mixOf([1, 1, 1], pens, covers, false));
    let sum = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
    for (let n = 0; n < covers.length; n++) sum += covers[n] * weight[n];
    return sum;
  };
  if (!from) {
    let best = score();
    let start = -1;
    let amount = 0;
    for (let n = 0; n < pens.length; n++) {
      if (off[n]) continue;
      for (let k = 1; k <= 16; k++) {
        covers[n] = Math.max(low(n), (most * k) / 16);
        const e = score();
        if (e < best) { best = e; start = n; amount = covers[n]; }
      }
      covers[n] = low(n);
    }
    if (start >= 0) covers[start] = amount;
  }
  for (let round = 0; round < 30; round++) {
    let moved = 0;
    for (let n = 0; n < pens.length; n++) {
      if (off[n]) continue;
      const was = covers[n];
      // The best amount for this pen, the others held: a golden-section search, then its least if that's no worse.
      let a = low(n);
      let b = most;
      // Ten steps narrow it to under a hundredth of the range - finer than whole passes can show.
      for (let it = 0; it < 10; it++) {
        const x1 = b - 0.618 * (b - a);
        const x2 = a + 0.618 * (b - a);
        covers[n] = x1;
        const f1 = score();
        covers[n] = x2;
        const f2 = score();
        if (f1 < f2) b = x2;
        else a = x1;
      }
      const found = (a + b) / 2;
      covers[n] = found;
      const withIt = score();
      covers[n] = low(n);
      covers[n] = score() <= withIt ? low(n) : found;
      moved = Math.max(moved, Math.abs(covers[n] - was));
    }
    if (moved < 2e-3) break;
  }
  return covers;
}

/** How many passes of each plate's pen, in plate order, a colour is drawn with: one point of a separation, for checking it. */

/** A CMYK plate, read at a point of the photo (u and v, 0 to 1): -1 where it draws nothing, else how much. */
function plateSampler(tones: Tones, photo: Photo) {
  const sep = separationOf(tones, photo);
  // Still being separated off the page: nothing yet (photoMarks waits for it rather than keep this).
  if (!sep) return () => -1;
  const map = sep.maps[inkAtOf(photo)];
  // A plate the separation doesn't have - its list of plates out of step - draws nothing rather than
  // stopping the whole app: a drawing opened with its extra plates dropped did once.
  if (!map) return () => -1;
  return (u: number, v: number) => {
    const amount = map[Math.min(sep.h - 1, Math.round(v * (sep.h - 1))) * sep.w + Math.min(sep.w - 1, Math.round(u * (sep.w - 1)))];
    return amount > 0.02 ? amount : -1;
  };
}

function colourSampler(tones: Tones, photo: Photo) {
  const areas = areasOf(tones, photo.regions!, photo.brightness, photo.contrast, fitOf(photo));
  const bleed = Math.max(0, photo.bleed ?? 0);
  const own = densityOf(photo.ink!);
  const pointAt = (u: number, v: number) =>
    Math.min(areas.h - 1, Math.round(v * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)));
  if (photo.key) {
    // The key shades over the colours rather than taking their place: it follows how dark the photo
    // is, from `keyFrom` to black, and the colour layers under it draw as they would without it.
    // How dark, the way the eye sees it: a bright red is a mid-tone, not a shadow.
    const adjust = adjuster(photo.brightness, photo.contrast);
    const from = Math.min(0.95, Math.max(0, photo.keyFrom ?? KEY_FROM));
    const strength = Math.min(1, Math.max(0, photo.keyStrength ?? 1));
    return (u: number, v: number) => {
      const px = (Math.min(tones.h - 1, Math.round(v * (tones.h - 1))) * tones.w + Math.min(tones.w - 1, Math.round(u * (tones.w - 1)))) * 4;
      const dark = 1 - lab(adjust(tones.rgba[px]), adjust(tones.rgba[px + 1]), adjust(tones.rgba[px + 2]))[0] / 100;
      const amount = strength * ((dark - from) / (1 - from));
      return amount > 0.02 ? Math.min(1, amount) : -1;
    };
  }
  const mine = photo.region!;
  if (areas.menu && areas.choice) {
    // Best fit: as many passes of this pen as the colour chosen here takes, as a tone that just
    // clears that many of the hatching's thresholds.
    const { menu, choice } = areas;
    const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
    return (u: number, v: number) => {
      const passes = menu[choice[pointAt(u, v)]].passes[mine];
      return passes ? (passes + 0.5) / (levels + 1) : -1;
    };
  }
  const dd = own[0] * own[0] + own[1] * own[1] + own[2] * own[2];
  return (u: number, v: number) => {
    const at = pointAt(u, v);
    if (!inArea(areas, at, mine, bleed) || dd < 1e-9) return -1;
    const want = areas.want;
    return Math.min(1, Math.max(0, (want[at * 3] * own[0] + want[at * 3 + 1] * own[1] + want[at * 3 + 2] * own[2]) / dd));
  };
}

/**
 * How a photo's tone is read at a point of its box, in inches from its corner: -1 outside its band,
 * otherwise - with `whole` - the photo's own darkness there, 0 to 1, or without it how far through
 * the band it is, 0 to 1. Brightness, contrast and the crop are applied.
 * A band draws only where the photo's tone falls in it, and grades its lines across its own range;
 * `fromWhite` says whether it's the lightest, which leaves white as paper where the others draw
 * something everywhere in their band, so two bands meet without a gap. Widened by the bleed, into
 * the bands either side: graded across the wider range, what spills over starts sparse and builds,
 * like a haze rather than a second edge.
 */

/**
 * How a photo's tone is read at a point of its box, in inches from its corner: -1 outside its band,
 * otherwise - with `whole` - the photo's own darkness there, 0 to 1, or without it how far through
 * the band it is, 0 to 1. Brightness, contrast and the crop are applied.
 * A band draws only where the photo's tone falls in it, and grades its lines across its own range;
 * `fromWhite` says whether it's the lightest, which leaves white as paper where the others draw
 * something everywhere in their band, so two bands meet without a gap. Widened by the bleed, into
 * the bands either side: graded across the wider range, what spills over starts sparse and builds,
 * like a haze rather than a second edge.
 */
export function toneSampler(tones: Tones, photo: Photo, w: number, h: number, whole = false) {
  const lift = photo.brightness / 200;
  const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // Split by colour: this layer draws its colour group's area, as much of its pen's ink there as
  // comes nearest the photo's colour - so a pale part of its area gets few lines.
  if (photo.plate && (photo.plates?.length ?? 0) >= 4) {
    const sample = plateSampler(tones, photo);
    return {
      toneAt: (x: number, y: number) => {
        if (x < 0 || x > w || y < 0 || y > h) return -1;
        return sample(c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1));
      },
      fromWhite: true,
    };
  }
  if (photo.ink && photo.regions && (photo.region !== undefined || photo.key)) {
    const sample = colourSampler(tones, photo);
    return {
      toneAt: (x: number, y: number) => {
        if (x < 0 || x > w || y < 0 || y > h) return -1;
        return sample(c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1));
      },
      fromWhite: true,
    };
  }
  const bleed = photo.band ? Math.max(0, photo.bleed ?? 0) : 0;
  const lo = photo.band ? Math.max(0, photo.band[0] - (photo.band[0] > 0 ? bleed : 0)) : 0;
  const hi = photo.band ? Math.min(1, photo.band[1] + (photo.band[1] < 1 ? bleed : 0)) : 1;
  // Split around the paper: the tone is how far past the paper's tones this layer's side reaches -
  // 0 at the paper's edge, 1 at black for a dark pen, at white for a light one - and the band is a
  // share of that, from the paper outwards. Nothing on the paper's side of its edge.
  const [p0, p1] = photo.side ? paperToneOf(photo) : [0, 0];
  const sided = (d: number) =>
    photo.side === "light" ? (d < p0 ? (p0 - d) / p0 : -1) : photo.side === "dark" ? (d > p1 ? (p1 < 1 ? (d - p1) / (1 - p1) : 1) : -1) : d;
  const toneAt = (x: number, y: number) => {
    if (x < 0 || x > w || y < 0 || y > h) return -1;
    const d = sided(darknessAt(tones, c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1), lift, gain));
    if (d < 0) return -1;
    if (d < lo || d > hi || (d === hi && hi < 1)) return -1;
    // `whole`: where it's this band's, the photo's own darkness rather than how far through the band.
    if (whole) return d;
    return hi > lo ? (d - lo) / (hi - lo) : 1;
  };
  // Split around the paper, the paper's own tones are where nothing's drawn: every tone past them
  // gets at least one pass, so a band is filled right up to the paper's edge.
  return { toneAt, fromWhite: photo.side ? false : lo <= 0 };
}

/**
 * Tone as tone lines: one line along each row, waving across it - harder and tighter where the photo
 * is darker, flattening out as it lightens, and lifted off the paper where there's nothing to draw.
 * At black, neighbouring rows' waves just meet. Every other row runs back the way the last came, so
 * the pen goes on from where it stopped. One path, one stroke per run of line.
 */

const processingBlurCache = new Map<string, Tones>();
/**
 * The photo blurred as Processing's filter(BLUR, 2) blurs it, for squiggles: its kernel - 15 wide,
 * weighted (7 - distance) squared - across then down, the edges weighed by what's inside the picture.
 */

/**
 * The photo blurred as Processing's filter(BLUR, 2) blurs it, for squiggles: its kernel - 15 wide,
 * weighted (7 - distance) squared - across then down, the edges weighed by what's inside the picture.
 */
export function processingBlurred(src: string, tones: Tones): Tones {
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${tones.flat ?? 0}|${tones.w}x${tones.h}`;
  const known = processingBlurCache.get(key);
  if (known) return known;
  const radius = 7;
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => (radius - Math.abs(i - radius)) ** 2);
  kernel[radius] = radius * radius;
  const { w, h } = tones;
  const pass = (v: Float32Array, across: boolean) => {
    const out = new Float32Array(v.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let weight = 0;
        for (let i = 0; i < kernel.length; i++) {
          const xx = across ? x - radius + i : x;
          const yy = across ? y : y - radius + i;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          sum += v[yy * w + xx] * kernel[i];
          weight += kernel[i];
        }
        out[y * w + x] = sum / weight;
      }
    }
    return out;
  };
  const light = pass(pass(Float32Array.from(tones.light), true), false);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const channel = new Float32Array(w * h);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < w * h; i++) channel[i] = tones.rgba[i * 4 + c];
    const done = c < 3 ? pass(pass(channel, true), false) : channel;
    for (let i = 0; i < w * h; i++) rgba[i * 4 + c] = done[i];
  }
  const made = { w, h, light, rgba, blur: -2, sat: tones.sat, mask: tones.mask };
  if (processingBlurCache.size > 4) processingBlurCache.delete(processingBlurCache.keys().next().value!);
  processingBlurCache.set(key, made);
  return made;
}

/**
 * Tone as squiggles, the way Gregg Wygonik's SquiggleDraw for Inkscape (v1.0.1) draws them - see
 * SQUIGGLE_INKSCAPE. Unlike the Processing sketch, the waves keep their frequency: the photo is cut
 * into a grid of `rows` by `cols`, every cell of a row gets `freq` waves, and only their height
 * follows the darkness, read from the grid as the extension reads it (the grid scaled up to a
 * pixel a millimetre, Lanczos, and read at each cell's corner). Each wave is two rounded humps -
 * quadratic curves, written here as cubics - up to a quarter of (256 less the brightness) over
 * the amplitude's divisor, in mm, as Inkscape's own millimetre documents have it. Joined, each row
 * turns round into the next half a cell out past the edge.
 *
 * As the extension's, the waves of the top and bottom rows swing out past the photo's edge where
 * they're tall enough: nothing here stops them there (Plot's driver stops at the page edge).
 *
 * Over the extension: rows at `squiggleAngle`; and with `squiggleLift`, a layer of a photo lifts
 * off at the cells where it has nothing to draw - white, another band's tone, another pen's colour.
 * Without it, every layer's rows run edge to edge, flat there, as the extension's do.
 */

export function blurGrid(v: Float32Array, gw: number, gh: number, r: number) {
  if (r < 0.5) return;
  const k = Math.max(1, Math.round(r));
  const tmp = new Float32Array(v.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < gh; y++) {
      let sum = 0;
      for (let x = -k; x <= k; x++) sum += v[y * gw + Math.min(gw - 1, Math.max(0, x))];
      for (let x = 0; x < gw; x++) {
        tmp[y * gw + x] = sum / (2 * k + 1);
        sum += v[y * gw + Math.min(gw - 1, x + k + 1)] - v[y * gw + Math.max(0, x - k)];
      }
    }
    for (let x = 0; x < gw; x++) {
      let sum = 0;
      for (let y = -k; y <= k; y++) sum += tmp[Math.min(gh - 1, Math.max(0, y)) * gw + x];
      for (let y = 0; y < gh; y++) {
        v[y * gw + x] = sum / (2 * k + 1);
        sum += tmp[Math.min(gh - 1, y + k + 1) * gw + x] - tmp[Math.max(0, y - k) * gw + x];
      }
    }
  }
}

/**
 * The lines along which a grid crosses a level - marching squares - joined up into runs: each run a
 * list of grid points, closed where it comes back round to its start.
 */

/**
 * What a layer of the photo is traced from, on a grid `gw` by `gh` over its box: how dark the photo
 * is at each point - or, for a colour layer, 1 inside its colour's area and 0 outside; for a plate or
 * the key, how much of its pen is wanted there. With the levels a contour is traced at, `count` of
 * them spread across it (a colour layer has just the one, half-way).
 */
export function fieldOf(tones: Tones, photo: Photo, gw: number, gh: number, count: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const field = new Float32Array(gw * gh);
  const levels: number[] = [];
  if (photo.plate && (photo.plates?.length ?? 0) >= 4) {
    // A plate: how much of its pen the photo needs, traced at levels spread across it like tone.
    const sample = plateSampler(tones, photo);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = Math.max(0, sample(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1)));
      }
    }
    for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
  } else if (photo.ink && photo.regions && photo.key) {
    // The key: how much of it the photo needs, traced at levels spread across it like tone.
    const sample = colourSampler(tones, photo);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = Math.max(0, sample(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1)));
      }
    }
    for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
  } else if (photo.ink && photo.regions && photo.region !== undefined) {
    // A colour layer: 1 inside its colour's area, 0 outside, traced at the half-way line.
    const areas = areasOf(tones, photo.regions, photo.brightness, photo.contrast, fitOf(photo));
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const u = c0 + (gx / (gw - 1)) * (c2 - c0);
        const vv = c1 + (gy / (gh - 1)) * (c3 - c1);
        const at = Math.min(areas.h - 1, Math.round(vv * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)));
        field[gy * gw + gx] = inArea(areas, at, photo.region, Math.max(0, photo.bleed ?? 0)) ? 1 : 0;
      }
    }
    levels.push(0.5);
  } else {
    const lift = photo.brightness / 200;
    const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
    const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = darknessAt(tones, c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1), lift, gain);
      }
    }
    if (photo.band) {
      const [lo, hi] = photo.band;
      for (let k = 0; k < count; k++) {
        const t = lo + ((hi - lo) * k) / count;
        if (t > 0) levels.push(t); // the lightest band's lower edge is white: nothing to trace
      }
    } else {
      for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
    }
  }
  return { field, levels };
}

/**
 * Tone as outlines: the photo traced as contour lines, like a map's - along the places its tone
 * crosses a level, so they follow its edges and its shapes. Smoothed first, so a speck of noise is
 * not a contour. A whole photo is traced at levels spread from white to black; a tone band at its own
 * lower edge and levels inside it, so an edge two bands share is drawn once; a colour layer around
 * its colour's area.
 */

export function thin(on: Uint8Array, gw: number, gh: number) {
  // Only points still on are looked at, and the list shrinks as they come off.
  let live: number[] = [];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) if (on[y * gw + x]) live.push(y * gw + x);
  const gone: number[] = [];
  const p = new Uint8Array(8);
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      gone.length = 0;
      for (const i of live) {
        if (!on[i]) continue;
        p[0] = on[i - gw]; p[1] = on[i - gw + 1]; p[2] = on[i + 1]; p[3] = on[i + gw + 1];
        p[4] = on[i + gw]; p[5] = on[i + gw - 1]; p[6] = on[i - 1]; p[7] = on[i - gw - 1];
        let count = 0;
        let turns = 0;
        for (let k = 0; k < 8; k++) {
          count += p[k];
          if (!p[k] && p[(k + 1) & 7]) turns++;
        }
        if (count < 2 || count > 6 || turns !== 1) continue;
        // p[0] above, p[2] right, p[4] below, p[6] left.
        if (step === 0 ? (p[0] && p[2] && p[4]) || (p[2] && p[4] && p[6]) : (p[0] && p[2] && p[6]) || (p[0] && p[4] && p[6])) continue;
        gone.push(i);
      }
      for (const i of gone) on[i] = 0;
      if (gone.length) {
        changed = true;
        live = live.filter((i) => on[i]);
      }
    }
  }
  // Thinning leaves a point at the inside of each step of a staircase, which reads as a junction.
  // Take out any point whose neighbours are joined to each other without it.
  for (const i of live) if (on[i] && neighbours(on, i, gw).length >= 2 && joinedWithout(on, i, gw)) on[i] = 0;
}

export const neighbours = (on: Uint8Array, i: number, gw: number) => {
  const out: number[] = [];
  for (const [dx, dy] of RING) if (on[i + dy * gw + dx]) out.push(i + dy * gw + dx);
  return out;
};

/** Whether a point's neighbours touch one another in a single chain, so taking it out breaks nothing. */

/** Whether a point's neighbours touch one another in a single chain, so taking it out breaks nothing. */
function joinedWithout(on: Uint8Array, i: number, gw: number) {
  const near = neighbours(on, i, gw);
  const seen = new Set([near[0]]);
  const todo = [near[0]];
  while (todo.length) {
    const a = todo.pop()!;
    for (const b of near) {
      if (seen.has(b)) continue;
      if (Math.abs((a % gw) - (b % gw)) <= 1 && Math.abs(Math.floor(a / gw) - Math.floor(b / gw)) <= 1) {
        seen.add(b);
        todo.push(b);
      }
    }
  }
  return seen.size === near.length;
}

/** How far each dark point is from the nearest light one, in grid steps: a 3-4 chamfer, so half a stroke's width on its middle line. */

/** How far each dark point is from the nearest light one, in grid steps: a 3-4 chamfer, so half a stroke's width on its middle line. */
export function distances(on: Uint8Array, gw: number, gh: number): Float32Array {
  const d = new Float32Array(gw * gh);
  const far = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = on[i] ? far : 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - gw] + 3);
        if (x > 0) v = Math.min(v, d[i - gw - 1] + 4);
        if (x < gw - 1) v = Math.min(v, d[i - gw + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < gw - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < gh - 1) {
        v = Math.min(v, d[i + gw] + 3);
        if (x < gw - 1) v = Math.min(v, d[i + gw + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + gw - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * Whiskers taken off: thinning grows a short branch toward every bump in a stroke's edge. A branch
 * from a free end to a junction that is shorter than the stroke is wide there, or than `shortest`,
 * is one of those rather than a line of the picture.
 */

/**
 * Whiskers taken off: thinning grows a short branch toward every bump in a stroke's edge. A branch
 * from a free end to a junction that is shorter than the stroke is wide there, or than `shortest`,
 * is one of those rather than a line of the picture.
 */
export function prune(on: Uint8Array, gw: number, gh: number, dist: Float32Array, shortest: number) {
  for (let round = 0; round < 3; round++) {
    let cut = false;
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const start = y * gw + x;
        if (!on[start] || neighbours(on, start, gw).length !== 1) continue;
        const branch = [start];
        let prev = -1;
        let at = start;
        let junction = -1;
        for (;;) {
          const next = neighbours(on, at, gw).filter((k) => k !== prev && !branch.includes(k));
          if (next.length !== 1) break;
          if (neighbours(on, next[0], gw).length > 2) {
            junction = next[0];
            break;
          }
          prev = at;
          at = next[0];
          branch.push(at);
          if (branch.length > shortest + 40) break;
        }
        if (junction < 0) continue;
        if (branch.length < Math.max(shortest, dist[junction] * 1.5)) {
          for (const k of branch) on[k] = 0;
          cut = true;
        }
      }
    }
    if (!cut) break;
    thin(on, gw, gh);
  }
}

export function traceRuns(on: Uint8Array, gw: number, gh: number): Run[] {
  const degree = new Uint8Array(gw * gh);
  for (let i = 0; i < on.length; i++) if (on[i]) degree[i] = neighbours(on, i, gw).length;
  // Neighbouring junction points are one junction.
  const junction = new Int32Array(gw * gh).fill(-1);
  let junctions = 0;
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || degree[i] < 3 || junction[i] >= 0) continue;
    const todo = [i];
    junction[i] = junctions;
    while (todo.length) {
      const a = todo.pop()!;
      for (const b of neighbours(on, a, gw)) {
        if (degree[b] >= 3 && junction[b] < 0) {
          junction[b] = junctions;
          todo.push(b);
        }
      }
    }
    junctions++;
  }
  const isNode = (i: number) => degree[i] !== 2;
  const endOf = (i: number) => (degree[i] >= 3 ? junction[i] : -1);
  const walked = new Uint8Array(gw * gh);
  const runs: Run[] = [];
  const pairs = new Set<string>();
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || !isNode(i)) continue;
    for (const m of neighbours(on, i, gw)) {
      if (isNode(m)) {
        // Two ends side by side, or a step inside one junction: only a line if they're different things.
        const key = i < m ? `${i},${m}` : `${m},${i}`;
        if (pairs.has(key) || (degree[i] >= 3 && degree[m] >= 3 && junction[i] === junction[m])) continue;
        pairs.add(key);
        runs.push({ pts: [i, m], ends: [endOf(i), endOf(m)], closed: false });
        continue;
      }
      if (walked[m]) continue;
      const pts = [i];
      let prev = i;
      let at = m;
      for (;;) {
        pts.push(at);
        if (isNode(at)) break;
        walked[at] = 1;
        const next = neighbours(on, at, gw).find((k) => k !== prev && (isNode(k) || !walked[k]));
        if (next === undefined) break;
        prev = at;
        at = next;
      }
      runs.push({ pts, ends: [endOf(i), isNode(pts[pts.length - 1]) ? endOf(pts[pts.length - 1]) : -1], closed: false });
    }
  }
  // What's left are loops with no junction on them: a ring, an O.
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || walked[i] || isNode(i)) continue;
    const pts = [i];
    walked[i] = 1;
    let prev = i;
    let at = neighbours(on, i, gw)[0];
    while (at !== undefined && !walked[at]) {
      walked[at] = 1;
      pts.push(at);
      const next = neighbours(on, at, gw).find((k) => k !== prev && !walked[k]);
      prev = at;
      at = next ?? -1;
      if (at < 0) break;
    }
    if (pts.length > 2) runs.push({ pts, ends: [-1, -1], closed: true });
  }
  return runs;
}

/** Which way a run leaves its end: toward a point `steps` in, so a pixel's jag doesn't decide it. */

/** Which way a run leaves its end: toward a point `steps` in, so a pixel's jag doesn't decide it. */
function leavingDir(r: Run, end: 0 | 1, gw: number, steps = 6): [number, number] {
  const n = r.pts.length;
  const a = r.pts[end ? n - 1 : 0];
  const b = r.pts[end ? Math.max(0, n - 1 - steps) : Math.min(n - 1, steps)];
  const dx = (b % gw) - (a % gw);
  const dy = Math.floor(b / gw) - Math.floor(a / gw);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/**
 * Sharp tips made whole. Where two lines of a drawing meet in a point - a leaf's tip, a V - the ink
 * runs together into a wedge, and thinning makes that a Y: the two lines meeting a short tail that
 * runs on out to the point. A junction of just three, where two lines arrive from much the same
 * side and the third is a free end pointing away between them, is one of those: the tail is taken
 * off and the two lines joined as one, running into the point and back out, with the point kept
 * sharp. The points that are tips are added to `tips`.
 */

/**
 * Sharp tips made whole. Where two lines of a drawing meet in a point - a leaf's tip, a V - the ink
 * runs together into a wedge, and thinning makes that a Y: the two lines meeting a short tail that
 * runs on out to the point. A junction of just three, where two lines arrive from much the same
 * side and the third is a free end pointing away between them, is one of those: the tail is taken
 * off and the two lines joined as one, running into the point and back out, with the point kept
 * sharp. The points that are tips are added to `tips`.
 */
export function joinTips(runs: Run[], gw: number, dist: Float32Array, tips: Set<number>): Run[] {
  const at = new Map<number, Set<Run>>();
  const add = (r: Run) => {
    for (const e of r.ends) if (e >= 0) (at.get(e) ?? at.set(e, new Set()).get(e)!).add(r);
  };
  const drop = (r: Run) => {
    for (const e of r.ends) if (e >= 0) at.get(e)?.delete(r);
  };
  runs.forEach(add);
  const reach = 10;
  for (const [j, set] of at) {
    const ends: [Run, 0 | 1][] = [];
    for (const r of set) for (const e of [0, 1] as const) if (!r.closed && r.ends[e] === j) ends.push([r, e]);
    if (ends.length !== 3) continue;
    for (let s = 0; s < 3; s++) {
      const [tail, te] = ends[s];
      if (tail.ends[1 - te] !== -1) continue;
      const [[ra, ea], [rb, eb]] = ends.filter((_, k) => k !== s);
      // The tail is no longer than the wedge is likely to be: a few times the ink's width there.
      const where = tail.pts[te ? tail.pts.length - 1 : 0];
      if (tail.pts.length > Math.max(8, dist[where] * 8)) continue;
      const u = leavingDir(ra, ea, gw, reach);
      const v = leavingDir(rb, eb, gw, reach);
      // The two lines leave together, less than about 75 degrees apart...
      if (u[0] * v[0] + u[1] * v[1] < 0.25) continue;
      const mx = u[0] + v[0];
      const my = u[1] + v[1];
      const ml = Math.hypot(mx, my) || 1;
      const t = leavingDir(tail, te, gw);
      // ...and the tail points away from them both, out of the V.
      if ((t[0] * mx + t[1] * my) / ml > -0.7) continue;
      const apex = tail.pts[te ? 0 : tail.pts.length - 1];
      // Each line is cut back from the junction by the length of the bend it makes into the tail, and
      // runs from there straight into the point.
      const cut = Math.max(1, Math.round(dist[where] * 3));
      const trim = (r: Run, e: 0 | 1) => {
        const pts = e === 1 ? r.pts : [...r.pts].reverse(); // toward the junction
        return pts.slice(0, Math.max(2, pts.length - cut));
      };
      drop(ra);
      drop(rb);
      drop(tail);
      tail.pts = [];
      tips.add(apex);
      if (ra === rb) {
        // One run leaves the junction and comes back to it: a loop with a point, like a teardrop.
        const loop = ra.pts.length > cut * 2 + 2 ? ra.pts.slice(cut, ra.pts.length - cut) : ra.pts;
        ra.pts = [apex, ...loop, apex];
        ra.ends = [-1, -1];
      } else {
        const inward = trim(ra, ea);
        const outward = trim(rb, eb).reverse();
        const joined: Run = { pts: [...inward, apex, ...outward], ends: [ra.ends[1 - ea], rb.ends[1 - eb]], closed: false };
        ra.pts = [];
        rb.pts = [];
        runs.push(joined);
        add(joined);
      }
      break;
    }
  }
  return runs.filter((r) => r.pts.length > 1);
}

/**
 * Runs that meet at a junction joined where one carries straight on into another, so a line that
 * another crosses or branches off is still drawn as one stroke. The straightest pair at a junction
 * goes first; a run that comes back round to its own junction closes into a loop.
 */

/**
 * Runs that meet at a junction joined where one carries straight on into another, so a line that
 * another crosses or branches off is still drawn as one stroke. The straightest pair at a junction
 * goes first; a run that comes back round to its own junction closes into a loop.
 */
export function joinRuns(runs: Run[], gw: number): Run[] {
  const at = new Map<number, Set<Run>>();
  const add = (r: Run) => {
    for (const e of r.ends) if (e >= 0) (at.get(e) ?? at.set(e, new Set()).get(e)!).add(r);
  };
  const drop = (r: Run) => {
    for (const e of r.ends) if (e >= 0) at.get(e)?.delete(r);
  };
  runs.forEach(add);
  const leaving = (r: Run, end: 0 | 1) => leavingDir(r, end, gw);
  for (const [j, set] of at) {
    for (;;) {
      const ends: [Run, 0 | 1][] = [];
      for (const r of set) for (const e of [0, 1] as const) if (!r.closed && r.ends[e] === j) ends.push([r, e]);
      let best: [number, number] | null = null;
      let bestCos = -0.4; // straighter than this or not at all: a sharp corner is two strokes
      for (let a = 0; a < ends.length; a++) {
        for (let b = a + 1; b < ends.length; b++) {
          const u = leaving(...ends[a]);
          const v = leaving(...ends[b]);
          const cos = u[0] * v[0] + u[1] * v[1];
          if (cos < bestCos) {
            bestCos = cos;
            best = [a, b];
          }
        }
      }
      if (!best) break;
      const [ra, ea] = ends[best[0]];
      const [rb, eb] = ends[best[1]];
      if (ra === rb) {
        // Both ends of one run: it goes round and comes back, so it's a loop.
        drop(ra);
        ra.closed = true;
        ra.ends = [-1, -1];
        continue;
      }
      drop(ra);
      drop(rb);
      const first = ea === 1 ? ra.pts : [...ra.pts].reverse();
      const second = eb === 0 ? rb.pts : [...rb.pts].reverse();
      const joined: Run = { pts: [...first, ...second], ends: [ra.ends[1 - ea], rb.ends[1 - eb]], closed: false };
      runs.push(joined);
      ra.pts = [];
      rb.pts = [];
      add(joined);
    }
  }
  return runs.filter((r) => r.pts.length > 1);
}

/** A loop that is a circle, near enough, as its centre and radius; null if it isn't one. */

/** A loop that is a circle, near enough, as its centre and radius; null if it isn't one. */
export function circleOf(pts: Point[], tolerance: number): { cx: number; cy: number; r: number } | null {
  if (pts.length < 12) return null;
  // Kasa's fit: the circle that best explains every point, by least squares, in one solve.
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / pts.length;
  const my = sy / pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  const cx = mx + uc;
  const cy = my + vc;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  return worst <= Math.max(tolerance, r * 0.04) ? { cx, cy, r } : null;
}

/** A circle as four cubic curves, starting at `from` radians and going the way the loop went. */

/** A circle as four cubic curves, starting at `from` radians and going the way the loop went. */
export function circleNodes(c: { cx: number; cy: number; r: number }, from: number, clockwise: boolean): Node[] {
  const k = 0.5523 * c.r; // how long a quarter circle's handles are
  const s = clockwise ? 1 : -1;
  const nodes: Node[] = [];
  for (let q = 0; q <= 4; q++) {
    const a = from + (s * q * Math.PI) / 2;
    const x = c.cx + c.r * Math.cos(a);
    const y = c.cy + c.r * Math.sin(a);
    const tx = -Math.sin(a) * s;
    const ty = Math.cos(a) * s;
    nodes.push({ x, y, in: { x: x - tx * k, y: y - ty * k }, out: { x: x + tx * k, y: y + ty * k } });
  }
  delete nodes[0].in;
  delete nodes[4].out;
  return nodes;
}

/** The grid a line is traced on over a box `w` by `h`: CENTER_EDGE on its longer side, and no finer than the picture itself, which has nothing more to say. */

/** The grid a line is traced on over a box `w` by `h`: CENTER_EDGE on its longer side, and no finer than the picture itself, which has nothing more to say. */
function pictureGrid(tones: Tones, photo: Photo, w: number, h: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const edge = Math.min(CENTER_EDGE, Math.max(tones.w * (c2 - c0), tones.h * (c3 - c1)));
  const gw = Math.max(3, Math.round((edge * w) / Math.max(w, h)));
  const gh = Math.max(3, Math.round((edge * h) / Math.max(w, h)));
  return { gw, gh, cell: w / (gw - 1), cellY: h / (gh - 1) };
}

/**
 * What centerlines are traced from: the picture as black and white on a grid over its box - 1 where
 * it is a line, past `centerFrom` after smoothing; a colour layer's own area; a band's own tones.
 */

/**
 * What centerlines are traced from: the picture as black and white on a grid over its box - 1 where
 * it is a line, past `centerFrom` after smoothing; a colour layer's own area; a band's own tones.
 */
export function centerOn(tones: Tones, photo: Photo, w: number, h: number) {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const { field } = fieldOf(tones, photo, gw, gh, 1);
  blurGrid(field, gw, gh, Math.max(0, photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm) / 25.4 / cell);
  // Which points are line: past `centerFrom`; a colour layer's own area; a band's own tones.
  const from = Math.min(0.99, Math.max(0.01, photo.centerFrom ?? CENTER_DEFAULTS.from));
  const colourArea = photo.ink && photo.regions && photo.region !== undefined && !photo.key;
  const toneBand = !onePlate(photo) && !photo.ink && photo.band;
  const lo = colourArea ? 0.5 : toneBand ? Math.max(from, photo.band![0]) : from;
  const hi = toneBand && photo.band![1] < 1 ? photo.band![1] : Infinity;
  const on = new Uint8Array(gw * gh);
  // The grid's own edge stays light, so a line that runs off the picture ends at its edge.
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const v = field[y * gw + x];
    if (v > lo && v <= hi) on[y * gw + x] = 1;
  }
  return { gw, gh, cell, cellY, on };
}

/**
 * Where a picture's tone changes sharply, on a grid over its box: the Canny way - smoothed, the change
 * measured across each point (Sobel), kept only at its ridge across the edge so an edge is one point
 * wide, and kept where it's at least `edgeFrom` of the picture's sharpest changes or carries on from
 * one that is. What Edges traces, as Centerlines traces a drawing's strokes.
 */

/**
 * Where a picture's tone changes sharply, on a grid over its box: the Canny way - smoothed, the change
 * measured across each point (Sobel), kept only at its ridge across the edge so an edge is one point
 * wide, and kept where it's at least `edgeFrom` of the picture's sharpest changes or carries on from
 * one that is. What Edges traces, as Centerlines traces a drawing's strokes.
 */
export function edgesOn(tones: Tones, photo: Photo, w: number, h: number) {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const { field } = fieldOf(tones, { ...photo, band: undefined, ink: undefined, regions: undefined, region: undefined, key: undefined, plate: undefined, plates: undefined }, gw, gh, 1);
  blurGrid(field, gw, gh, Math.max(0, photo.edgeSmoothMm ?? EDGE_DEFAULTS.smoothMm) / 25.4 / cell);
  const mag = new Float32Array(gw * gh);
  const dir = new Uint8Array(gw * gh); // 0 across, 1 one diagonal, 2 down, 3 the other diagonal
  const at = (x: number, y: number) => field[y * gw + x];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    mag[y * gw + x] = Math.hypot(gx, gy);
    const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
    dir[y * gw + x] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
  }
  // Against the picture's sharpest changes - nearly the sharpest, so one freak point doesn't set the scale.
  const sorted = Array.from(mag).filter((v) => v > 1e-6).sort((a, b) => a - b);
  const top = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 1;
  const strong = Math.max(0.01, Math.min(1, photo.edgeFrom ?? EDGE_DEFAULTS.from)) * top;
  const weak = strong / 2;
  // Only the ridge of each edge: a point at least as strong as its neighbours across it.
  const ridge = new Uint8Array(gw * gh);
  const across: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const i = y * gw + x;
    const m = mag[i];
    if (m < weak) continue;
    const [ox, oy] = across[dir[i]];
    if (m >= mag[(y + oy) * gw + x + ox] && m >= mag[(y - oy) * gw + x - ox]) ridge[i] = m >= strong ? 2 : 1;
  }
  // A weak point is an edge only where it carries on from a strong one.
  const on = new Uint8Array(gw * gh);
  const stack: number[] = [];
  for (let i = 0; i < ridge.length; i++) if (ridge[i] === 2) { on[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % gw, y = (i - x) / gw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= gw - 1 || ny >= gh - 1) continue;
      const j = ny * gw + nx;
      if (ridge[j] && !on[j]) { on[j] = 1; stack.push(j); }
    }
  }
  return { gw, gh, cell, cellY, on };
}

/**
 * Edges: the lines where the picture's tone changes sharply - a wall against a ceiling, round a window
 * - traced and drawn as Centerlines draws a drawing's strokes, curved, straight or mixed. A pass to lay
 * over shading: hatching for the tones, edges to define them.
 */

/**
 * Where a traced line turns more than `degrees`: each point's turn read `reach` points either way,
 * and only the sharpest point of each bend kept, so a corner is one point, not a cluster of them.
 */
export function turnsOver(pts: Point[], closed: boolean, reach: number, degrees: number): number[] {
  const n = pts.length;
  const limit = (degrees * Math.PI) / 180;
  const turn: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - reach + n) % n] : pts[i - reach];
    const b = closed ? pts[(i + reach) % n] : pts[i + reach];
    if (!a || !b) continue;
    const ax = pts[i].x - a.x, ay = pts[i].y - a.y, bx = b.x - pts[i].x, by = b.y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) continue;
    turn[i] = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] <= limit) continue;
    let peak = true;
    for (let d = 1; d <= reach && peak; d++) {
      for (const j of [i - d, i + d]) {
        const k = closed ? (j + n) % n : j;
        if (k >= 0 && k < n && (turn[k] > turn[i] || (turn[k] === turn[i] && k < i))) peak = false;
      }
    }
    if (peak) out.push(i);
  }
  return out;
}

/**
 * A traced line as straight segments that stay within `tolerance` of it (Douglas-Peucker): the
 * fewest points that keep its shape, each joined to the next by a straight line, so its corners
 * are sharp. Its ends and `keep` - the tips and corners - are always among them.
 */

/**
 * A traced line as straight segments that stay within `tolerance` of it (Douglas-Peucker): the
 * fewest points that keep its shape, each joined to the next by a straight line, so its corners
 * are sharp. Its ends and `keep` - the tips and corners - are always among them.
 */
export function straightened(pts: Point[], tolerance: number, keep: number[]): Node[] {
  return straightPoints(pts, tolerance, keep).map((i) => ({ x: pts[i].x, y: pts[i].y }));
}

/** Which of a traced line's points the straight segments of `straightened` run between, in order. */

/** Which of a traced line's points the straight segments of `straightened` run between, in order. */
function straightPoints(pts: Point[], tolerance: number, keep: number[]): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const fixed = [...new Set([0, ...keep.filter((i) => i > 0 && i < n - 1), n - 1])].sort((a, b) => a - b);
  const chosen = new Uint8Array(n);
  for (const i of fixed) chosen[i] = 1;
  const off = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-12 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  };
  const stack: [number, number][] = [];
  for (let k = 0; k + 1 < fixed.length; k++) stack.push([fixed[k], fixed[k + 1]]);
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = off(pts[k], pts[i], pts[j]);
      if (d > worst) { worst = d; at = k; }
    }
    if (at >= 0 && worst > tolerance) {
      chosen[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (chosen[i]) out.push(i);
  return out;
}

/**
 * A traced line drawn straight where it runs straight and curved where it bends. Simplified to straight
 * segments within `tolerance` first: a segment `long` or longer is a stretch that really is straight,
 * and stays a straight line; runs of shorter ones are where the line bends, and are fitted with
 * curves as the curves mode fits them. Where the two meet, the line keeps the point between them.
 */

/**
 * A traced line drawn straight where it runs straight and curved where it bends. Simplified to straight
 * segments within `tolerance` first: a segment `long` or longer is a stretch that really is straight,
 * and stays a straight line; runs of shorter ones are where the line bends, and are fitted with
 * curves as the curves mode fits them. Where the two meet, the line keeps the point between them.
 */
export function mixedLine(pts: Point[], tolerance: number, long: number, keep: number[], fitTol: number): Node[] {
  const idx = straightPoints(pts, tolerance, keep);
  const parts: Node[][] = [];
  let bendFrom: number | null = null;
  const bend = (to: number) => {
    if (bendFrom === null) return;
    if (to > bendFrom) {
      const sub = pts.slice(bendFrom, to + 1);
      parts.push(fitNodes(sub, fitTol, keep.filter((i) => i > bendFrom! && i < to).map((i) => i - bendFrom!)));
    }
    bendFrom = null;
  };
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = idx[k], b = idx[k + 1];
    if (Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) >= long) {
      bend(a);
      parts.push([{ x: pts[a].x, y: pts[a].y }, { x: pts[b].x, y: pts[b].y }]);
    } else if (bendFrom === null) bendFrom = a;
  }
  bend(idx[idx.length - 1]);
  // One line: each part starts where the last ended, so their shared point is one node - keeping the
  // handle into it from the part before and the handle out of it into the part after.
  const out: Node[] = [];
  for (const part of parts) {
    if (!out.length) { out.push(...part); continue; }
    const last = out[out.length - 1];
    const first = part[0];
    out[out.length - 1] = { x: last.x, y: last.y, ...(last.in ? { in: last.in } : {}), ...(first.out ? { out: first.out } : {}) };
    out.push(...part.slice(1));
  }
  return out;
}

/**
 * Strokes drawn in an order that keeps the pen's travel short: each next the nearest to where the
 * last ended, turned round if its far end is nearer.
 */

/**
 * Strokes drawn in an order that keeps the pen's travel short: each next the nearest to where the
 * last ended, turned round if its far end is nearer.
 */
export function shortTravel(strokes: Node[][]): Node[][] {
  const ordered: Node[][] = [];
  const left = new Set(strokes.keys());
  let x = 0, y = 0;
  while (left.size) {
    let best = -1;
    let flip = false;
    let bestD = Infinity;
    for (const i of left) {
      const s = strokes[i];
      const a = s[0];
      const b = s[s.length - 1];
      const da = (a.x - x) ** 2 + (a.y - y) ** 2;
      const db = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (da < bestD) { bestD = da; best = i; flip = false; }
      if (db < bestD) { bestD = db; best = i; flip = true; }
    }
    left.delete(best);
    const s = flip ? reverseNodes(strokes[best]) : strokes[best];
    ordered.push(s);
    x = s[s.length - 1].x;
    y = s[s.length - 1].y;
  }
  return ordered;
}

// ---------- Silhouette ----------

/**
 * A painted or photographed thing on white paper as the line round its shape: traced where paint
 * meets paper, so it's the outline and, as loops of their own, the holes in it - whatever the paint
 * does inside. Paper is what is light in every colour, so a pale yellow-green highlight is still
 * paint. The edge of the picture counts as paper, so a shape cut off by it is closed along it.
 * Every layer of a split photo draws the same shape: it doesn't depend on tone or colour.
 */

/**
 * What a silhouette is traced from: how much paint there is at each point of a grid over the box -
 * 0 on white paper, 1 where the darkest colour is black - smoothed. The grid's own edge is paper.
 */
export function paintField(tones: Tones, photo: Photo, w: number, h: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  // How light each pixel is in its darkest colour, after brightness and contrast.
  const adjust = adjuster(photo.brightness, photo.contrast);
  const pale = new Float32Array(tones.w * tones.h);
  for (let p = 0, i = 0; p < pale.length; p++, i += 4) {
    pale[p] = Math.min(adjust(tones.rgba[i]), adjust(tones.rgba[i + 1]), adjust(tones.rgba[i + 2])) / 255;
  }
  const paleAt = (u: number, v: number) => {
    const x = Math.min(tones.w - 1, Math.max(0, u * (tones.w - 1)));
    const y = Math.min(tones.h - 1, Math.max(0, v * (tones.h - 1)));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(tones.w - 1, x0 + 1), y1 = Math.min(tones.h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const top = pale[y0 * tones.w + x0] * (1 - fx) + pale[y0 * tones.w + x1] * fx;
    const bottom = pale[y1 * tones.w + x0] * (1 - fx) + pale[y1 * tones.w + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  // How much paint: 0 on white paper, 1 where the darkest colour is black. The grid's own edge is paper.
  const field = new Float32Array(gw * gh);
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      field[gy * gw + gx] = 1 - paleAt(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1));
    }
  }
  blurGrid(field, gw, gh, Math.max(0, photo.silhouetteSmoothMm ?? SILHOUETTE_DEFAULTS.smoothMm) / 25.4 / cell);
  return { gw, gh, cell, cellY, field };
}

/** A run drawn the other way: the same curve, its handles swapped end for end. */

/** A run drawn the other way: the same curve, its handles swapped end for end. */
const reverseNodes = (run: Node[]): Node[] => [...run].reverse().map((p) => {
  const out: Node = { x: p.x, y: p.y };
  if (p.out) out.in = p.out;
  if (p.in) out.out = p.in;
  return out;
});

/**
 * Tone as hatching, the way an engraver builds it: a first set of lines where the photo is darker
 * than a fifth of the way to black, a second set across it past two fifths, and each set again
 * between its own lines past three and four fifths. So the darkest parts are crosshatched at the
 * spacing the tool fills solid at, and the lightest are left as paper. Five and six passes go on
 * with the diagonals, at 45° to the first two, for the deepest darks; the steps between the
 * passes close up to make room for them.
 */

export const paintDefaultsOf = (photo: Pick<Photo, "flat">) => (photo.flat ? PAINT_FLAT_DEFAULTS : PAINT_DEFAULTS);

const paintCache = new Map<string, Omit<PaintRegions, "mine">>();

/**
 * The picture as a painting by numbers would have it: on a grid over the box, which color each point
 * is painted - flat, one color to a region. A color layer's points are the nearest of the split's
 * colors, or the paper; any other layer's are its own pen or not, where it would draw darker than
 * half-way. The borders are smoothed - each color's area blurred, and every point taking the color
 * strongest there - and then any region smaller than the smallest asked for takes the color of the
 * neighbor it shares most border with, until none is left. Worked out once for all of a split's
 * color layers, so they share every border: `mine` is the label this layer paints.
 */

/**
 * The picture as a painting by numbers would have it: on a grid over the box, which color each point
 * is painted - flat, one color to a region. A color layer's points are the nearest of the split's
 * colors, or the paper; any other layer's are its own pen or not, where it would draw darker than
 * half-way. The borders are smoothed - each color's area blurred, and every point taking the color
 * strongest there - and then any region smaller than the smallest asked for takes the color of the
 * neighbor it shares most border with, until none is left. Worked out once for all of a split's
 * color layers, so they share every border: `mine` is the label this layer paints.
 */
export function paintRegions(tones: Tones, photo: Photo, w: number, h: number): PaintRegions {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const paint = paintDefaultsOf(photo);
  const smooth = Math.max(0, photo.paintSmoothMm ?? paint.smoothMm) / 25.4 / cell;
  const smallest = Math.max(0, photo.paintSmallestMm ?? paint.smallestMm) / 25.4;
  const colour = Boolean(photo.ink && photo.regions && photo.region !== undefined && !photo.key);
  const key = colour
    ? ["colour", tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.flat ?? 0, tones.light[0], tones.light[tones.light.length >> 1], photo.crop?.join(",") ?? "", photo.regions!.join(","), photo.brightness, photo.contrast, gw, gh, smooth, smallest].join("|")
    : ["layer", marksKey(photo, w, h)].join("|");
  const mine = colour ? photo.region! : 1;
  const known = paintCache.get(key);
  if (known) return { ...known, mine };

  const labels = new Uint8Array(gw * gh);
  let count: number;
  if (colour) {
    // The nearest color of the split, or the paper (the last), at each point - not the mixes Best fit
    // hatches, since a painting is flat: one color to a region.
    const areas = areasOf(tones, photo.regions!, photo.brightness, photo.contrast);
    count = areas.groups;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const u = c0 + (gx / (gw - 1)) * (c2 - c0);
        const v = c1 + (gy / (gh - 1)) * (c3 - c1);
        labels[gy * gw + gx] = areas.best[Math.min(areas.h - 1, Math.round(v * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)))];
      }
    }
  } else {
    // This layer's pen or not: in its band - the lightest band, and a layer that isn't one, where it
    // is past half-way to its darkest - or where its plate wants more than half its ink.
    const { toneAt, fromWhite } = toneSampler(tones, photo, w, h);
    count = 2;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const t = toneAt(Math.min(w, gx * cell), Math.min(h, gy * cellY));
        labels[gy * gw + gx] = t >= 0 && (!fromWhite || t > 0.5) ? 1 : 0;
      }
    }
  }

  // Smoothed borders: each color's area blurred, every point taking whichever is strongest there.
  if (smooth >= 0.5 && count > 1) {
    const strongest = new Float32Array(gw * gh).fill(-1);
    const out = new Uint8Array(gw * gh);
    const area = new Float32Array(gw * gh);
    for (let k = 0; k < count; k++) {
      let any = false;
      for (let i = 0; i < area.length; i++) { area[i] = labels[i] === k ? 1 : 0; if (area[i]) any = true; }
      if (!any) continue;
      blurGrid(area, gw, gh, smooth);
      for (let i = 0; i < area.length; i++) if (area[i] > strongest[i]) { strongest[i] = area[i]; out[i] = k; }
    }
    labels.set(out);
  }

  // Regions too small to paint take their biggest neighbor's color, a few times over: a speck
  // merged into a sliver can leave the two still too small together.
  const fewest = (smallest / cell) * (smallest / cellY);
  if (fewest >= 2) {
    const region = new Int32Array(gw * gh);
    const queue = new Int32Array(gw * gh);
    for (let round = 0; round < 6; round++) {
      region.fill(-1);
      let merged = 0;
      let id = 0;
      for (let start = 0; start < labels.length; start++) {
        if (region[start] >= 0) continue;
        const k = labels[start];
        // The region: every point of this color joined to this one, side to side.
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        region[start] = id;
        const touching = new Map<number, number>();
        while (head < tail) {
          const at = queue[head++];
          const x = at % gw;
          const y = (at - x) / gw;
          for (const next of [x > 0 ? at - 1 : -1, x < gw - 1 ? at + 1 : -1, y > 0 ? at - gw : -1, y < gh - 1 ? at + gw : -1]) {
            if (next < 0) continue;
            if (labels[next] !== k) {
              touching.set(labels[next], (touching.get(labels[next]) ?? 0) + 1);
            } else if (region[next] < 0) {
              region[next] = id;
              queue[tail++] = next;
            }
          }
        }
        if (tail < fewest && touching.size) {
          let into = k;
          let most = 0;
          for (const [other, n] of touching) if (n > most) { most = n; into = other; }
          for (let i = 0; i < tail; i++) labels[queue[i]] = into;
          merged++;
        }
        id++;
      }
      if (!merged) break;
    }
  }

  const made = { gw, gh, cell, cellY, labels };
  if (paintCache.size > 8) paintCache.delete(paintCache.keys().next().value!);
  paintCache.set(key, made);
  return { ...made, mine };
}

/**
 * Tone as a painting: the picture as flat regions of color, each filled solid in its pen - one set of
 * lines at the spacing the pen fills solid at, at the layer's angle - with, unless asked not to, a
 * line round each region, like the printed lines a painting by numbers is painted up to. Every
 * color layer paints its own regions and outlines them in its own pen; the paper's are left bare.
 */

/**
 * A short route through every point, back to the start: the points in a Hilbert curve's order, then
 * straightened - wherever two of its legs cross or could be swapped for two shorter
 * ones, the stretch between is turned round (2-opt), looking only at each point's nearest few so a
 * big picture is still quick.
 */
export function tour(px: Float64Array, py: Float64Array): Int32Array {
  const count = px.length;
  const order = new Int32Array(count);
  if (count < 4) return order.map((_, i) => i);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < count; k++) {
    x0 = Math.min(x0, px[k]); x1 = Math.max(x1, px[k]);
    y0 = Math.min(y0, py[k]); y1 = Math.max(y1, py[k]);
  }
  const cell = Math.max(1e-6, Math.sqrt(((x1 - x0) * (y1 - y0) || 1) / count) * 2);
  const bw = Math.floor((x1 - x0) / cell) + 1;
  const bh = Math.floor((y1 - y0) / cell) + 1;
  const bucketOf = (k: number) => Math.floor((py[k] - y0) / cell) * bw + Math.floor((px[k] - x0) / cell);
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  for (let k = 0; k < count; k++) buckets[bucketOf(k)].push(k);
  const d = (a: number, b: number) => Math.hypot(px[a] - px[b], py[a] - py[b]);

  // Each point's nearest few.
  const NEAR = 8;
  const near: Int32Array[] = [];
  for (let k = 0; k < count; k++) {
    const bx = Math.floor((px[k] - x0) / cell);
    const by = Math.floor((py[k] - y0) / cell);
    const found: number[] = [];
    for (let ring = 1; found.length < NEAR + 1 && ring <= Math.max(bw, bh); ring++) {
      found.length = 0;
      for (let cy = Math.max(0, by - ring); cy <= Math.min(bh - 1, by + ring); cy++) {
        for (let cx = Math.max(0, bx - ring); cx <= Math.min(bw - 1, bx + ring); cx++) found.push(...buckets[cy * bw + cx]);
      }
    }
    near.push(Int32Array.from(found.filter((j) => j !== k).sort((a, b) => d(k, a) - d(k, b)).slice(0, NEAR)));
  }

  // A first route in the order a Hilbert curve visits them: never a long jump, since the curve keeps
  // near points near each other. Starting from nearest-unvisited instead strands a few dots that
  // have to be fetched across the page at the end - long jumps the straightening below can't
  // reach, looking only at each dot's nearest few.
  const ORDER = 1 << 16;
  const keyOf = (k: number) => {
    let x = Math.min(ORDER - 1, Math.floor(((px[k] - x0) / (x1 - x0 || 1)) * (ORDER - 1)));
    let y = Math.min(ORDER - 1, Math.floor(((py[k] - y0) / (y1 - y0 || 1)) * (ORDER - 1)));
    let key = 0;
    for (let s = ORDER >> 1; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0;
      const ry = (y & s) > 0 ? 1 : 0;
      key += s * s * ((3 * rx) ^ ry);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        [x, y] = [y, x];
      }
    }
    return key;
  };
  const keys = Float64Array.from({ length: count }, (_, k) => keyOf(k));
  Array.from({ length: count }, (_, k) => k).sort((a, b) => keys[a] - keys[b]).forEach((k, i) => (order[i] = k));

  // 2-opt, with a queue of points whose legs may still improve.
  const pos = new Int32Array(count);
  for (let i = 0; i < count; i++) pos[order[i]] = i;
  const succ = (k: number) => order[(pos[k] + 1) % count];
  const pred = (k: number) => order[(pos[k] - 1 + count) % count];
  // Turn round the stretch from position i to j, going forward and wrapping; whichever way round is shorter.
  const reverse = (i: number, j: number) => {
    let len = ((j - i + count) % count) + 1;
    if (len * 2 > count) {
      const ni = (j + 1) % count;
      j = (i - 1 + count) % count;
      i = ni;
      len = count - len;
    }
    for (let s = 0; s < len >> 1; s++) {
      const a = (i + s) % count;
      const b = (j - s + count) % count;
      const t = order[a];
      order[a] = order[b];
      order[b] = t;
      pos[order[a]] = a;
      pos[order[b]] = b;
    }
  };
  const queued = new Uint8Array(count).fill(1);
  const queue: number[] = Array.from(order);
  let moves = 0;
  for (let q = 0; q < queue.length && moves < count * 50; q++) {
    const a = queue[q];
    queued[a] = 0;
    let improved = false;
    for (const dir of [1, -1]) {
      const an = dir === 1 ? succ(a) : pred(a);
      const dA = d(a, an);
      for (const b of near[a]) {
        const gain = dA - d(a, b);
        if (gain <= 1e-12) break;
        const bn = dir === 1 ? succ(b) : pred(b);
        if (b === an || bn === a) continue;
        if (gain + d(b, bn) - d(an, bn) > 1e-12) {
          // Legs a-an and b-bn become a-b and an-bn.
          if (dir === 1) reverse(pos[an], pos[b]);
          else reverse(pos[b], pos[an]);
          for (const k of [a, an, b, bn]) if (!queued[k]) { queued[k] = 1; queue.push(k); }
          moves++;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return order;
}


// ---------- Scribble ----------

/**
 * Tone as scribbling: strokes that wander and curl at random, overlapping freely, laid down until each
 * part of the picture has about as much ink as it's dark. Ink is kept count of on a grid as it goes
 * down. Random lines a spacing apart on average cover only part of the paper - they overlap - so the
 * count aims at what random lines need for the darkness: -ln(1 - darkness) spacings' worth. A stroke
 * starts where ink is most wanted (picked at random, likelier the more is wanted), turns a little more
 * or less at every step, and leans toward whichever side still wants ink, so it keeps to the dark
 * parts and tangles there; it ends at its longest, at the box's edge, or once it has run a few
 * spacings through parts that have enough. A stroke shorter than the minimum is left out and its ink
 * taken back off the count, so others fill there instead. Strokes are tried until a long run of tries finds nothing
 * wanting. Random, but the same each time for the same layer and seed; each layer of a photo scribbles
 * its own way, so their lines don't fall together.
 */

export function flowField(tones: Tones, photo: Photo, w: number, h: number) {
  const gw = Math.max(3, Math.round((FLOW_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(3, Math.round((FLOW_EDGE * h) / Math.max(w, h)));
  const lift = photo.brightness / 200;
  const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const dark = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) dark[y * gw + x] = darknessAt(tones, c0 + (x / (gw - 1)) * (c2 - c0), c1 + (y / (gh - 1)) * (c3 - c1), lift, gain);
  }
  blurGrid(dark, gw, gh, 1);
  const jxx = new Float32Array(gw * gh);
  const jxy = new Float32Array(gw * gh);
  const jyy = new Float32Array(gw * gh);
  const at = (x: number, y: number) => dark[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * gw + x;
      jxx[i] = gx * gx;
      jxy[i] = gx * gy;
      jyy[i] = gy * gy;
    }
  }
  const cellMm = (w * 25.4) / (gw - 1);
  const r = Math.max(0, photo.streamFlowMm ?? STREAM_DEFAULTS.flowMm) / cellMm;
  blurGrid(jxx, gw, gh, r);
  blurGrid(jxy, gw, gh, r);
  blurGrid(jyy, gw, gh, r);
  // The gradient's direction, doubled: (Jxx - Jyy, 2Jxy), as long as the shape is clear. A little of
  // the layer's own angle is added everywhere, so where the picture is flat that's what wins.
  const ex = new Float32Array(gw * gh);
  const ey = new Float32Array(gw * gh);
  let total = 0;
  for (let i = 0; i < ex.length; i++) {
    ex[i] = jxx[i] - jyy[i];
    ey[i] = 2 * jxy[i];
    total += Math.hypot(ex[i], ey[i]);
  }
  const quiet = (0.15 * total) / ex.length + 1e-9;
  // The gradient runs across the lines, so the angle it settles to is the layer's turned a right angle.
  const across = ((photo.angle + 90) * Math.PI) / 180;
  const qx = quiet * Math.cos(2 * across);
  const qy = quiet * Math.sin(2 * across);
  for (let i = 0; i < ex.length; i++) {
    const a = ex[i] + qx;
    const b = ey[i] + qy;
    const len = Math.hypot(a, b) || 1;
    ex[i] = a / len;
    ey[i] = b / len;
  }
  return (x: number, y: number): [number, number] => {
    const gx = Math.min(gw - 1, Math.max(0, (x / w) * (gw - 1)));
    const gy = Math.min(gh - 1, Math.max(0, (y / h) * (gh - 1)));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const mix = (v: Float32Array) =>
      (v[y0 * gw + x0] * (1 - fx) + v[y0 * gw + x1] * fx) * (1 - fy) + (v[y1 * gw + x0] * (1 - fx) + v[y1 * gw + x1] * fx) * fy;
    // Halved back to a direction, and turned a right angle: along the shape, not across it.
    const theta = Math.atan2(mix(ey), mix(ex)) / 2 + Math.PI / 2;
    return [Math.cos(theta), Math.sin(theta)];
  };
}

/** A line with the points dropped that lie within `tolerance` of the straight line past them (Douglas-Peucker). */

/** A line with the points dropped that lie within `tolerance` of the straight line past them (Douglas-Peucker). */
export function simplified(pts: number[][], tolerance: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let far = -1;
    let most = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Every style but hatching, which is what no style means: one list for writing and reading, so
// none is written that isn't read back, or the other way round.

export function contour(v: Float32Array, gw: number, gh: number, level: number): number[][][] {
  // A point on the edge between two grid points, where the level falls between them. Keyed by the
  // edge, so the two cells that share an edge find the same point and the pieces join up.
  const points = new Map<number, number[]>();
  const pointOn = (x0: number, y0: number, x1: number, y1: number) => {
    const key = y1 > y0 ? ((y0 * gw + x0) * 2 + 1) : (y0 * gw + x0) * 2;
    let p = points.get(key);
    if (!p) {
      const a = v[y0 * gw + x0];
      const b = v[y1 * gw + x1];
      const t = b !== a ? (level - a) / (b - a) : 0.5;
      p = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, key];
      points.set(key, p);
    }
    return p;
  };
  const next = new Map<number, number[]>(); // edge key -> the edge keys it joins
  const link = (a: number[], b: number[]) => {
    (next.get(a[2]) ?? next.set(a[2], []).get(a[2])!).push(b[2]);
    (next.get(b[2]) ?? next.set(b[2], []).get(b[2])!).push(a[2]);
  };
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const tl = v[y * gw + x] > level ? 8 : 0;
      const tr = v[y * gw + x + 1] > level ? 4 : 0;
      const br = v[(y + 1) * gw + x + 1] > level ? 2 : 0;
      const bl = v[(y + 1) * gw + x] > level ? 1 : 0;
      const c = tl | tr | br | bl;
      if (c === 0 || c === 15) continue;
      const top = () => pointOn(x, y, x + 1, y);
      const bottom = () => pointOn(x, y + 1, x + 1, y + 1);
      const left = () => pointOn(x, y, x, y + 1);
      const right = () => pointOn(x + 1, y, x + 1, y + 1);
      switch (c) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: link(left(), top()); link(bottom(), right()); break;
        case 10: link(top(), right()); link(left(), bottom()); break;
      }
    }
  }
  // Walk each chain from an end (an edge joined once), then what's left are closed loops.
  const used = new Set<number>();
  const runs: number[][][] = [];
  const walk = (start: number) => {
    const run: number[][] = [];
    let at: number | undefined = start;
    let from = -1;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      const p = points.get(at)!;
      run.push([p[0], p[1]]);
      const onward: number | undefined = (next.get(at) ?? []).find((k) => k !== from && !used.has(k));
      from = at;
      at = onward;
    }
    // Back round to the start: close it.
    if (run.length > 2 && (next.get(from) ?? []).includes(start)) run.push(run[0]);
    if (run.length > 1) runs.push(run);
  };
  for (const [key, joins] of next) if (joins.length === 1 && !used.has(key)) walk(key);
  for (const key of next.keys()) if (!used.has(key)) walk(key);
  return runs;
}
