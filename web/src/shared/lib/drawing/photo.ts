// A photo on the page, drawn as hatching: lines whose spacing follows how dark the photo is there.
// The photo itself is kept - a working copy of it, small enough to travel inside the drawing - with a
// few numbers, and the lines are made from those every time. Nothing here is a shape to edit line by
// line: a photo is tens of thousands of strokes, and it is the photo and its numbers that are edited.

import { colorNamed } from "../colorNames";
import { FIT_CENTERED, type FitAlign, type Margins } from "../geometry";
import { edgeForLayer, edgeGenFromData, edgeGenKey, edgeKeep } from "./edgeMask";
import { vignetted, vignetteFromData, vignetteKey, vignetteOn, vignetteStrength } from "./vignette";
import { inksOf, parseProfile, usesBpc, type InkProfile } from "./icc";
import type { Point } from "./parametric";
import { fitNodes, pathData, type Node } from "./path";
import type { AnglePreset, Bucket, FlatColour, FlatColours, InkSet, MaskSide, Photo, PhotoMarks, PhotoMask, Plate, SetInk, Tones } from "./photoTypes";
import { BLACK_SHARE, CARDINAL, CENTER_DEFAULTS, CLASSIC, DEFAULT_DPI, EDGE_DEFAULTS, FINDABLE, FIT_CELLS, FLATTEN_LEAST, FLATTEN_LEAST_FLAT, FLATTEN_MOST, FLATTEN_SAMPLE, FLAT_LEAST, FLAT_LEAST_ASKED, FLAT_MERGE, FLAT_MOST_CANDIDATES, FLAT_NEAR, GOLDEN, HILBERT_DEFAULTS, HILBERT_EDGE, MASK_EDGE, MOST_BLACK_POINT, MOST_COLORS, MOST_PAINT_COLORS, MOST_PASSES, ONE_LINE_DEFAULTS, ONE_LINE_EDGE, ONE_LINE_MOST, ONE_LINE_SPREAD, OUTLINE_DEFAULTS, OUTLINE_EDGE, PAPER_CHROMA, PAPER_LIGHTNESS, PEN_TEST_COLOURS, PHOTO_DEFAULTS, PLATE_OFF, SCRIBBLE_DEFAULTS, SILHOUETTE_DEFAULTS, SKETCH_LINES, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, STREAM_DEFAULTS, WAVE_DEFAULTS, WORKING_EDGE } from "./photoDefaults";
import type { SketchLines, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";
import { PLATE_SETS, adjuster, blurGrid, centerModeOf, centerOn, chooseCovers, circleNodes, circleOf, coverSteps, coverTone, dist2, distances, edgesOn, fieldOf, flowField, hexLab, hexLinear, joinRuns, joinTips, lab, labOfLinear, layerOf, linear, marksKey, mixOf, mixedLine, onePlate, paintDefaultsOf, paintField, paintRegions, plateSetOf, processingBlurred, prune, separationListeners, separationOf, setSeparateNow, shortTravel, simplified, sketchLinesOf, smoothedTones, squiggleDrawOf, squiggleInkscapeOf, straightened, thin, toneSampler, tour, traceRuns, turnsOver, withinReach } from "./photoSample";
// The picture's own types live in photoTypes.ts; everything imports them from here as before.
export type { AnglePreset, Fit, InkSet, Photo, PhotoPart, Plate, PlateSet, Separation, SeparationRequest, SetInk, Tones } from "./photoTypes";

// The effects' numbers live in photoDefaults.ts; the cards import them from here as they always have.
export { BAND_NAMES, BLACK_SHARE, CENTER_DEFAULTS, EDGE_DEFAULTS, FLATTEN_DEFAULT, FLATTEN_MOST, FLAT_ENOUGH, HILBERT_DEFAULTS, KEY_FROM, MASK_EDGE_PX, MOST_BLACK_POINT, MOST_LAYERS, MOST_PASSES, MOST_SIDE_LAYERS, ONE_LINE_DEFAULTS, ONE_LINE_MOST, OUTLINE_DEFAULTS, PHOTO_DEFAULTS, PLATE_OFF, SCRIBBLE_DEFAULTS, SILHOUETTE_DEFAULTS, SKETCH_LINES, SKETCH_RANGES, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, SQUIGGLE_INKSCAPE_RANGES, SQUIGGLE_RANGES, STREAM_DEFAULTS, WAVE_DEFAULTS } from "./photoDefaults";
export type { SketchLines, SketchNumber, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";
// The engine lives in photoSample.ts; the cards import these from here as they always have.
export { PLATE_SETS, adjuster, centerModeOf, coverSteps, darknessAt, density, fitMenu, hexLinear, inkAtOf, lab, labOfLinear, layerOf, linear, neighbours, onePlate, paintDefaultsOf, paperToneOf, plateSetOf, platesOf, prune, separating, simplified, sketchLinesOf, solveSeparation, squiggleDrawOf, squiggleInkscapeOf, thin } from "./photoSample";

export const photoMode = (p: Photo) => (p.profile ? "profile" : p.separation ? "separations" : onePlate(p) ? "cmyk" : p.flat ? "flat" : p.ink ? "colour" : "value");

/**
 * Where a photo goes to fit or fill a page, inside a margin on each side (inches): its box, and the
 * part of it that shows. `aspect` is the picture's width over its height.
 */
export function placeOnPage(aspect: number, page: { w: number; h: number }, how: "fit" | "fill", margins: Margins, align: FitAlign = FIT_CENTERED) {
  // Each pair of sides leaves at least a sliver of page between them.
  const pair = (a: number, b: number, size: number) => {
    const x = Math.max(0, a), y = Math.max(0, b);
    const k = x + y > size - 0.2 ? (size - 0.2) / (x + y) : 1;
    return [x * k, y * k];
  };
  const [ml, mr] = pair(margins.left, margins.right, page.w);
  const [mt, mb] = pair(margins.top, margins.bottom, page.h);
  const aw = page.w - ml - mr;
  const ah = page.h - mt - mb;
  if (how === "fit") {
    const k = Math.min(aw / aspect, ah);
    const w = aspect * k;
    const h = k;
    // What it doesn't fill one way goes where the alignment says: before it, after it, or both halves.
    const x = ml + (aw - w) * align.x;
    const y = mt + (ah - h) * align.y;
    return { x, y, x2: x + w, y2: y + h, crop: undefined };
  }
  // Filling: the whole area inside the margin, with the picture cropped on the sides that don't fit -
  // evenly, keeping its middle, or keeping the edge the alignment names: Left keeps its left side.
  const area = aw / ah;
  const cut = aspect > area ? 1 - area / aspect : 1 - aspect / area;
  const crop: [number, number, number, number] = aspect > area
    ? [cut * align.x, 0, cut * align.x + (1 - cut), 1]
    : [0, cut * align.y, 1, cut * align.y + (1 - cut)];
  return { x: ml, y: mt, x2: page.w - mr, y2: page.h - mb, crop };
}

export const PLATES: Plate[] = ["c", "m", "y", "k"];

export function inksSaid(names: string[] | undefined, inks: number): string {
  const want = (names ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (want.length === inks) {
    const set = PLATE_SETS.find((s) => s.plates.length === inks && s.plates.every((pl) => want.includes(PLATE_AIMS[pl].name.toLowerCase())));
    if (set) return set.label;
  }
  return `${inks} inks`;
}

export const PLATE_AIMS: Record<Plate, { name: string; color: string; angle: number }> = {
  c: { name: "Cyan", color: "#00a3e0", angle: 15 },
  m: { name: "Magenta", color: "#d6007a", angle: 75 },
  y: { name: "Yellow", color: "#ffe500", angle: 0 },
  k: { name: "Black", color: "#1a1a1a", angle: 45 },
  // The extra plates, at angles between CMYK's - apart from them and from each other, hatching's own
  // right-angle cross counted.
  o: { name: "Orange", color: "#ff6a13", angle: 30 },
  g: { name: "Green", color: "#00a650", angle: 60 },
  r: { name: "Red", color: "#e4002b", angle: 7.5 },
  v: { name: "Violet", color: "#5b2c8f", angle: 52.5 },
};

export const BUILT_IN_INK_SETS: InkSet[] = PLATE_SETS.map((set) => ({
  key: set.key,
  label: set.label,
  about: set.about,
  inks: set.plates.map((p) => ({ ...PLATE_AIMS[p] })),
}));

/** The set a photo is separated into: its own, kept with the drawing, or the built-in one its plates are. */
export const inkSetOf = (p: Pick<Photo, "inkSet" | "plates">): InkSet =>
  p.inkSet ?? BUILT_IN_INK_SETS.find((s) => s.key === plateSetOf(p.plates)) ?? BUILT_IN_INK_SETS[0];

export function inksAreTheSet(photo: Pick<Photo, "inkSet" | "plates" | "plate" | "inkAt" | "penMm" | "spacingMm" | "levels">, palette: { color: string }[]): boolean {
  const have = photo.plates;
  if (!have?.length) return true;
  const set = inkSetOf(photo);
  const want = set.own
    ? set.inks.map((ink) => ink.color)
    : platePens(palette, PLATE_SETS.find((s) => s.key === set.key)?.plates ?? PLATES, {
      penMm: photo.penMm ?? 0.5, spacingMm: photo.spacingMm, levels: photo.levels,
    }).map((pen) => pen?.color ?? "");
  if (have.length !== want.length) return false;
  return have.every((colour, i) => colour === PLATE_OFF || (colour ?? "").toLowerCase() === (want[i] ?? "").toLowerCase());
}

function hsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/**
 * The pens a palette has for the four plates, each used once: black the darkest, and cyan, magenta
 * and yellow each the pen nearest printing's own round the colour wheel - by hue, as a painter would
 * match them, among pens with colour enough to count. Measured in a space where distance means
 * colour, a pale violet can come out nearer cyan than a real turquoise does; by hue, it doesn't.
 */
export function platePens<P extends { color: string }>(palette: P[], plates: Plate[] = PLATES, hatching = { penMm: 0.5, spacingMm: 1, levels: 4 }): (P | undefined)[] {
  const out: (P | undefined)[] = plates.map(() => undefined);
  const used = new Set<P>();
  const black = plates.indexOf("k");
  const darkest = [...palette].sort((a, b) => hsv(a.color)[2] - hsv(b.color)[2])[0];
  if (darkest && black >= 0) { out[black] = darkest; used.add(darkest); }
  const pairs: { plate: number; pen: P; score: number }[] = [];
  plates.forEach((plate, i) => {
    if (plate === "k") return;
    const [ah, as, av] = hsv(PLATE_AIMS[plate].color);
    for (const pen of palette) {
      const [h, sat, val] = hsv(pen.color);
      if (sat < 0.25) continue;
      const turn = Math.min(Math.abs(h - ah), 360 - Math.abs(h - ah));
      pairs.push({ plate: i, pen, score: turn + 40 * Math.abs(sat - as) + 30 * Math.abs(val - av) });
    }
  });
  pairs.sort((a, b) => a.score - b.score);
  for (const { plate, pen } of pairs) {
    if (out[plate] || used.has(pen)) continue;
    out[plate] = pen;
    used.add(pen);
  }
  // Then, plate by plate, whichever pen near its hue makes the hatching come nearest a range of photo
  // colours: matching by hue alone takes a dark pen near the hue (a brown for orange, a wine for
  // magenta) over a truer one a little further round, and the drawing comes out muddy.
  return refinePlatePens(palette, plates, out, hatching);
}

function plateSetError(pens: number[][], steps: number[], plates: Plate[]): number {
  const colours = [...PEN_TEST_COLOURS, ...plates.filter((p) => p !== "k").map((p) => {
    const n = parseInt(PLATE_AIMS[p].color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
  })];
  const reach = withinReach(pens, steps);
  let sum = 0;
  for (const rgb of colours) {
    const want = reach(labOfLinear(rgb.map(linear)));
    // As the hatching will draw them: each pen's amount rounded to its nearest number of passes.
    const covers = chooseCovers(want, pens, steps, BLACK_SHARE, null).map((c) => {
      const tone = coverTone(c, steps);
      return tone ? steps[Math.floor(tone * steps.length)] : 0;
    });
    const got = labOfLinear(mixOf([1, 1, 1], pens, covers, false));
    sum += Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
  }
  return sum / colours.length;
}

function refinePlatePens<P extends { color: string }>(palette: P[], plates: Plate[], picked: (P | undefined)[], hatching: { penMm: number; spacingMm: number; levels: number }): (P | undefined)[] {
  if (picked.some((p) => !p)) return picked;
  const out = [...picked];
  const steps = coverSteps(hatching.penMm, hatching.spacingMm, hatching.levels);
  const pensOf = (list: (P | undefined)[]) => list.map((p) => hexLinear(p!.color));
  let best = plateSetError(pensOf(out), steps, plates);
  for (let round = 0; round < 2; round++) {
    let better = false;
    plates.forEach((plate, i) => {
      if (plate === "k") return;
      const ah = hsv(PLATE_AIMS[plate].color)[0];
      for (const pen of palette) {
        if (out.includes(pen)) continue;
        const [h, sat] = hsv(pen.color);
        // Only pens that are this plate's colour still - within 20° of its hue - so an orange plate
        // stays orange, choosing among oranges: 30° and it drifts to whatever pen the test colours
        // happen to like (a second yellow as the orange plate); 15° missed EnerGel's Lime Green,
        // which draws green truer than its Green. And strong enough to be that colour, not a tint.
        const off = (hue: number) => Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
        if (sat < 0.45 || off(ah) > 20) continue;
        // And nearer this plate's hue than any other plate's in the set: a pink is magenta's, not
        // red's, and a golden yellow is yellow's, not orange's.
        if (plates.some((other) => other !== plate && other !== "k" && off(hsv(PLATE_AIMS[other].color)[0]) < off(ah))) continue;
        const trial = [...out];
        trial[i] = pen;
        const e = plateSetError(pensOf(trial), steps, plates);
        if (e < best - 1e-6) { best = e; out[i] = pen; better = true; }
      }
    });
    if (!better) break;
  }
  return out;
}

// The words a separation's file can name its plate by: CMYK and the extra inks.
const PLATE_WORDS: [string, Plate][] = [
  ["cyan", "c"], ["magenta", "m"], ["yellow", "y"], ["black", "k"], ["key", "k"],
  ["orange", "o"], ["green", "g"], ["red", "r"], ["violet", "v"], ["purple", "v"],
];
const nameWords = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Which ink a separation's file is for, from its name however it's written - "Portrait_Cyan.png",
 * "portrait-cyan-channel.tif", "PortraitMagenta.jpg", "img yellow 2.png", "portrait_K.png". In turn:
 * a plate's name as a word of its own (CMYK and the extra inks: orange, green, red, violet), the
 * last such word winning; a long plate name run into others ("portraitcyan"); one of the palette's
 * pens by its name ("Pink", "Light gray"), the longest name found; any other color by its name
 * (colorNames.ts: "peach", "cranberry", "federal blue"); or C, M, Y or K as a word of its own.
 * Undefined when the name says no ink.
 */
export function inkNamed<P extends { name: string }>(name: string, pens: P[] = []): { plate?: Plate; pen?: P; color?: { name: string; color: string } } | undefined {
  const words = nameWords(name);
  for (let i = words.length - 1; i >= 0; i--) {
    const plate = PLATE_WORDS.find(([w]) => w === words[i])?.[1];
    if (plate) return { plate };
  }
  const joined = words.join("");
  const found = PLATE_WORDS.filter(([w]) => FINDABLE.has(w) && joined.includes(w))
    .sort((a, b) => joined.lastIndexOf(b[0]) - joined.lastIndexOf(a[0]))[0];
  if (found) return { plate: found[1] };
  const spaced = ` ${words.join(" ")} `;
  const pen = pens.filter((p) => nameWords(p.name).length && spaced.includes(` ${nameWords(p.name).join(" ")} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  // Any other color by its name - "peach", "cranberry", "federal blue" - drawn in that color, whatever
  // pen there is: one can be chosen for it later. The longer name wins, so "fluorescent pink" isn't
  // taken for the pen called Pink.
  const color = colorNamed(words);
  if (pen && (!color || nameWords(pen.name).length >= color.name.split(" ").length)) return { pen };
  if (color) return { color };
  for (let i = words.length - 1; i >= 0; i--) {
    const plate = (["c", "m", "y", "k"] as Plate[]).find((p) => p === words[i]);
    if (plate) return { plate };
  }
  return undefined;
}

/** Which plate a separation's file is, from its name (see inkNamed). Undefined when it names none. */
const plateNamed = (name: string): Plate | undefined => inkNamed(name)?.plate;

/** The plate a layer is: a CMYK split's, or a separation's by its name ("Cyan"). For its angle. */
export const plateOfPhoto = (p: Pick<Photo, "plate" | "separation">): Plate | undefined =>
  p.plate ?? (p.separation ? plateNamed(p.separation) : undefined);

/**
 * A separation file's name without its ink, for naming the drawing they make together: "Portrait_Cyan"
 * and "portrait-cyan-channel" are both "Portrait". The ink's word goes, and the words that say a file
 * is a separation - channel, plate, separation, layer - with it. A name that is nothing but its ink
 * gives `fallback` - its folder's name - when there is one.
 */
export const stemWithoutPlate = (name: string, pens: { name: string }[] = [], fallback = "") => {
  const bare = name.replace(/\.[^.]+$/, "");
  const inks = [...PLATE_WORDS.map(([w]) => w), ...pens.map((p) => p.name.toLowerCase()), "c", "m", "y", "k", "channel", "plate", "separation", "sep", "layer"];
  const words = bare.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_\-.()]+/).filter(Boolean);
  const kept = words.filter((w) => !inks.includes(w.toLowerCase()));
  // A file named for its ink alone - "cyan.png" - leaves nothing: the folder it came from, if known.
  return kept.join(" ").trim() || fallback || bare;
};

export const LAYER_SETTINGS = [
  "style", "angle", "spacingMm", "levels", "hatchSmoothMm", "hatchShortestMm", "rowMm", "waveMm", "squiggleAmpMm", "squiggleHeight", "squiggleJoin", "squiggleLift", "squiggleSmooth", "squiggleDraw", "squiggleVersion", "squiggleInkscape", "squiggleAngle", "contours", "smoothMm", "centerFrom", "centerSmoothMm", "centerShortestMm", "centerMode", "centerStraightMm", "centerLongMm", "centerCornerDeg", "edgeFrom", "edgeSmoothMm", "edgeShortestMm", "silhouetteFrom", "silhouetteSmoothMm", "silhouetteSmallestMm", "streamWidestMm", "streamPasses", "streamFlowMm", "scribbleLengthMm", "scribbleMinMm", "scribbleWiggle", "scribbleSegmentMm", "scribbleSeed", "sketchLines", "paintSmoothMm", "paintSmallestMm", "paintOutline", "lineDots", "lineLiftMm", "lineCurve", "lineAngle", "lineBias", "lineGrain", "lineContrast", "hilbertCoarsestMm", "hilbertLift", "hilbertCurve", "hilbertRound", "hilbertBlend", "hilbertAngle", "offsetMm",
  "band", "side", "paperTone", "ink", "regions", "region", "flat", "flatCount", "flatOwn", "key", "regionInks", "keyInk", "plate", "plates", "inkSet", "inkAt", "fitPaper", "penMm", "fitPairs", "fitOpaque",
] as const;

export const mostColorsOf = (photo: Pick<Photo, "style">) => (photo.style === "paint" ? MOST_PAINT_COLORS : MOST_COLORS);

/** Hatching's shortest stroke unless set: one and a half line spacings, in mm. */
export const hatchShortestOf = (photo: Pick<Photo, "hatchShortestMm" | "spacingMm">) =>
  photo.hatchShortestMm ?? Math.round(Math.max(0.05, photo.spacingMm) * 1.5 * 100) / 100;

export const MASK_SIDES: MaskSide[] = ["top", "right", "bottom", "left"];

export const ANGLE_PRESETS: { key: AnglePreset; label: string; about: string }[] = [
  { key: "classic", label: "Classic", about: "Print's screen angles: cyan 15°, magenta 75°, yellow 0°, black 45°; layers by tone or color 45°, 15°, 75°, 0°, 30°, 60°" },
  { key: "complementary", label: "Complementary", about: "Print's way with extra inks: CMYK as Classic, orange on cyan's 15°, green on magenta's 75°, violet on yellow's 0°, red at 7.5°; layers by tone or color as Classic" },
  { key: "cardinal", label: "Cardinal", about: "Only horizontal, vertical and the diagonals: 0°, 90°, 45°, 135°, then round again for more layers" },
  { key: "golden", label: "Golden spread", about: "Each layer turned 137.5° - the golden angle - from the last: 0°, 137.5°, 95°, 52.5°, 10°, 147.5°" },
  { key: "uniform", label: "Uniform", about: "Every layer's lines at the same angle: the Angle setting, which then turns them all together" },
];
const COMPLEMENT: Partial<Record<Plate, Plate>> = { o: "c", g: "m", v: "y" };
export function presetAngle(preset: AnglePreset, index: number, plate?: Plate): number {
  if (preset === "classic") return plate ? PLATE_AIMS[plate].angle : CLASSIC[index % CLASSIC.length];
  // Red is cyan's opposite too, but orange has that angle and the two print side by side: its own.
  if (preset === "complementary") return plate ? PLATE_AIMS[COMPLEMENT[plate] ?? plate].angle : CLASSIC[index % CLASSIC.length];
  if (preset === "cardinal") return CARDINAL[index % CARDINAL.length];
  if (preset === "uniform") return 0; // all alike: the angle they share is the turn on top of it
  return Math.round(((index * GOLDEN) % 180) * 10) / 10;
}

const saturatedCache = new Map<string, Tones>();

/**
 * The photo with its colours made greyer or more vivid, `sat` -100 to 100: each pixel's colour pushed
 * toward or away from its own grey - the lightness the photo is read by - so a black and white reading
 * of it is the same, and only its colours change. Worked out once for each photo and amount.
 */
/** Pixels made greyer or more colourful about their own grey (see saturatedTones), into `out` - which
 *  may be `rgba` itself, for a whole photo too big to copy. */
export function saturate(rgba: Uint8ClampedArray, sat: number, out: Uint8ClampedArray = rgba): Uint8ClampedArray {
  const k = 1 + Math.max(-100, Math.min(100, sat)) / 100;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i] = grey + (r - grey) * k;
    out[i + 1] = grey + (g - grey) * k;
    out[i + 2] = grey + (b - grey) * k;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

function saturatedTones(src: string, tones: Tones, sat: number): Tones {
  if (!sat) return tones;
  const key = `${src.length}|${src.slice(-32)}|${sat}`;
  const known = saturatedCache.get(key);
  if (known) return known;
  const rgba = saturate(tones.rgba, sat, new Uint8ClampedArray(tones.rgba.length));
  const made = { ...tones, rgba, sat };
  if (saturatedCache.size > 4) saturatedCache.delete(saturatedCache.keys().next().value!);
  saturatedCache.set(key, made);
  return made;
}

/** A photo's pixels with a saturation applied, for reading its colours: undefined until it's been read. */
export const saturatedOf = (src: string, saturation: number) => photoTones({ src, saturation });

/** A photo as its layers read it: its pixels, with its saturation applied and its edge mask laid over. Undefined until both have been read. */
const photoTones = (photo: Pick<Photo, "src" | "saturation" | "flatten" | "vignette" | "edgeMask" | "edgeMaskInvert" | "edgeMaskSides" | "edgeGen" | "crop" | "band" | "side" | "plate" | "ink" | "region" | "key" | "separation">) => {
  const tones = tonesOf(photo.src);
  if (!tones) return undefined;
  // Flattened after the saturation and the vignette, which change what colours there are to find,
  // and before the edge mask, which fades a border to paper and isn't a colour of the picture.
  const coloured = vignettedTones(photo.src, saturatedTones(photo.src, tones, photo.saturation ?? 0), photo);
  const saturated = photo.flatten ? flattenedTones(photo.src, coloured, photo.flatten) : coloured;
  if (photo.edgeGen) return maskedTones(photo.src, saturated, null, photo);
  if (!photo.edgeMask) return saturated;
  const mask = tonesOf(photo.edgeMask);
  if (!mask) {
    // Read now, and whatever is drawing the photo told when it can be drawn masked. Until then nothing,
    // rather than lines drawn over the border that then vanish.
    if (!maskReading.has(photo.edgeMask)) {
      const src = photo.edgeMask;
      maskReading.add(src);
      readTones(src).then(() => separationListeners.forEach((heard) => heard())).catch(() => {}).finally(() => maskReading.delete(src));
    }
    return undefined;
  }
  return maskedTones(photo.src, saturated, mask, photo);
};

const vignetteCache = new Map<string, Tones>();

/**
 * The photo under its vignette, stretched over the part of the picture that shows - inside the crop -
 * so it frames what's drawn, whatever the crop. Each pixel is taken toward black, or toward white for
 * a lightening one, by the vignette's strength there. Worked out once for each photo, vignette and crop.
 */
function vignettedTones(src: string, tones: Tones, photo: Pick<Photo, "vignette" | "crop">): Tones {
  const v = photo.vignette;
  if (!vignetteOn(v)) return tones;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const id = `vig:${vignetteKey(v)}|${c0},${c1},${c2},${c3}`;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${id}`;
  const known = vignetteCache.get(key);
  if (known) return known;
  const { w, h } = tones;
  // Worked out over the pixels that show, at their own shape.
  const x0 = Math.round(c0 * w);
  const y0 = Math.round(c1 * h);
  const gw = Math.max(1, Math.round((c2 - c0) * w));
  const gh = Math.max(1, Math.round((c3 - c1) * h));
  const strength = vignetteStrength(v, gw, gh);
  const darker = v.amount > 0;
  const light = Float32Array.from(tones.light);
  const rgba = Uint8ClampedArray.from(tones.rgba);
  for (let gy = 0; gy < gh; gy++) {
    const y = y0 + gy;
    if (y < 0 || y >= h) continue;
    for (let gx = 0; gx < gw; gx++) {
      const x = x0 + gx;
      if (x < 0 || x >= w) continue;
      const k = strength[gy * gw + gx];
      if (!k) continue;
      const i = y * w + x;
      light[i] = vignetted(light[i], k, darker);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = vignetted(rgba[i * 4 + c], k, darker, 255);
    }
  }
  const out = { w, h, light, rgba, sat: tones.sat, mask: id };
  if (vignetteCache.size > 4) vignetteCache.delete(vignetteCache.keys().next().value!);
  vignetteCache.set(key, out);
  return out;
}

const maskedCache = new Map<string, Tones>();
const maskReading = new Set<string>();

function maskedTones(src: string, tones: Tones, mask: Tones | null, photo: Pick<Photo, "edgeMask" | "edgeMaskInvert" | "edgeMaskSides" | "edgeGen" | "crop" | "band" | "side" | "plate" | "ink" | "region" | "key" | "separation">): Tones {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const sides = photo.edgeMaskSides ?? MASK_SIDES;
  // A made edge varied by layer: this layer's own version of it.
  const gen = photo.edgeGen && edgeForLayer(photo.edgeGen, layerOf(photo));
  const what = gen ? `gen:${edgeGenKey(gen)}` : `${photo.edgeMask!.length}|${photo.edgeMask!.slice(-32)}|${photo.edgeMaskInvert ? "inv" : ""}`;
  const id = `${what}|${c0},${c1},${c2},${c3}|${sides.join(",")}`;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${id}`;
  const known = maskedCache.get(key);
  if (known) return known;
  const { w, h } = tones;
  const light = new Float32Array(w * h);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const cw = Math.max(1e-6, c2 - c0);
  const ch = Math.max(1e-6, c3 - c1);
  // A made edge: worked out over the pixels that show, on the sides chosen.
  const gw = Math.max(1, Math.round(w * cw));
  const gh = Math.max(1, Math.round(h * ch));
  const made = gen ? edgeKeep(gen, sides, gw, gh) : null;
  // A side left out of a loaded mask: its border there is cut off and the rest stretched to the edge.
  const depth = mask ? borderDepths(mask, photo.edgeMaskInvert) : null;
  const off = (side: MaskSide) => (!depth || sides.includes(side) ? 0 : depth[side]);
  const [u0, u1] = [off("left"), 1 - off("right")];
  const [v0, v1] = [off("top"), 1 - off("bottom")];
  for (let y = 0; y < h; y++) {
    const mv = ((y + 0.5) / h - c1) / ch;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mu = ((x + 0.5) / w - c0) / cw;
      // Outside the crop nothing is drawn anyway: left as it is.
      let keep = 1;
      if (mu >= 0 && mu <= 1 && mv >= 0 && mv <= 1) {
        if (made) {
          keep = made[Math.min(gh - 1, Math.floor(mv * gh)) * gw + Math.min(gw - 1, Math.floor(mu * gw))];
        } else {
          const m = lightAt(mask!, u0 + mu * (u1 - u0), v0 + mv * (v1 - v0));
          keep = photo.edgeMaskInvert ? 1 - m : m;
        }
      }
      light[i] = 1 - (1 - tones.light[i]) * keep;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = 255 - (255 - tones.rgba[i * 4 + c]) * keep;
      rgba[i * 4 + 3] = tones.rgba[i * 4 + 3];
    }
  }
  // Under a vignette as well: both kept in what's worked out from it.
  const out = { w, h, light, rgba, sat: tones.sat, flat: tones.flat, mask: tones.mask ? `${tones.mask}+${id}` : id };
  if (maskedCache.size > 8) maskedCache.delete(maskedCache.keys().next().value!);
  maskedCache.set(key, out);
  return out;
}

/**
 * How far in from each edge a mask's border reaches, 0 to 1 of the way across: the furthest any
 * paper reaches along the middle half of that side, so its corners - where the next border runs -
 * don't count. A little more, so a side cut away leaves no sliver of it behind.
 */
function borderDepths(mask: Tones, invert?: boolean): Record<MaskSide, number> {
  const { w, h } = mask;
  const paper = (x: number, y: number) => {
    const l = mask.light[y * w + x];
    return (invert ? l : 1 - l) > 0.15;
  };
  // From one edge inward: the last line, within the first half, with any paper on it.
  const reach = (lines: number, along: number, at: (line: number, k: number) => boolean) => {
    let last = -1;
    for (let line = 0; line < lines / 2; line++) {
      for (let k = Math.floor(along / 4); k < Math.ceil((along * 3) / 4); k++) {
        if (at(line, k)) { last = line; break; }
      }
    }
    return last < 0 ? 0 : Math.min(0.45, (last + 1) / lines + 0.01);
  };
  return {
    left: reach(w, h, (c, r) => paper(c, r)),
    right: reach(w, h, (c, r) => paper(w - 1 - c, r)),
    top: reach(h, w, (r, c) => paper(c, r)),
    bottom: reach(h, w, (r, c) => paper(c, h - 1 - r)),
  };
}

/** A picture's lightness at a point of it, 0 to 1 across and down, blended between its four nearest pixels. */
function lightAt(t: Tones, u: number, v: number): number {
  const x = Math.min(t.w - 1, Math.max(0, u * t.w - 0.5));
  const y = Math.min(t.h - 1, Math.max(0, v * t.h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(t.w - 1, x0 + 1);
  const y1 = Math.min(t.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = t.light[y0 * t.w + x0] * (1 - fx) + t.light[y0 * t.w + x1] * fx;
  const bottom = t.light[y1 * t.w + x0] * (1 - fx) + t.light[y1 * t.w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

const tonesCache = new Map<string, Tones>();
const reading = new Map<string, Promise<Tones>>();

/** The photo's lightness, once it has been read; undefined until then. */
export const tonesOf = (src: string) => tonesCache.get(src);

/** Read the photo's lightness, once per photo, however many things ask. */
export function readTones(src: string): Promise<Tones> {
  const known = tonesCache.get(src);
  if (known) return Promise.resolve(known);
  const pending = reading.get(src);
  if (pending) return pending;
  const job = (async () => {
    // Decoded as a bitmap, away from the page: quicker, and it doesn't wait on the tab being in view.
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const light = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, p = 0; p < light.length; i += 4, p++) {
      light[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    const tones = { w: canvas.width, h: canvas.height, light, rgba: data };
    tonesCache.set(src, tones);
    reading.delete(src);
    return tones;
  })();
  reading.set(src, job);
  return job;
}

// ---------- Splitting by a color profile ----------

const profiles = new Map<string, InkProfile>();
const profileLoading = new Map<string, Promise<InkProfile>>();

/**
 * A printer profile from the server's Color profiles folder, by its file name, read once however many
 * layers ask. (A drawing from before the folder has the profile's whole path: the server looks for
 * its file name.)
 */
export function loadProfile(path: string): Promise<InkProfile> {
  const known = profiles.get(path);
  if (known) return Promise.resolve(known);
  const pending = profileLoading.get(path);
  if (pending) return pending;
  const job = (async () => {
    const res = await fetch(`/api/color-profile?name=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "That profile couldn't be read");
    const made = parseProfile(await res.arrayBuffer());
    profiles.set(path, made);
    return made;
  })().finally(() => profileLoading.delete(path));
  profileLoading.set(path, job);
  return job;
}

/** A short, steady stand-in for a profile's path in the keys below. */
const pathHash = (path: string) => {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/**
 * What an ink's share of the photo is kept under, as though it were a picture of its own - so every
 * cache keyed by a photo's picture tells one ink from another. Ends with what tells them apart.
 */
const profileKey = (p: Pick<Photo, "src" | "profile" | "profileIntent" | "profileBpc" | "profileInk" | "saturation">) =>
  `${p.src}#icc|${pathHash(p.profile!)}|${p.profileIntent ?? 0}${bpcKey(p)}|${p.saturation ?? 0}|${p.profileInk ?? 0}`;
/** Black point compensation, in a key only where it changes anything: older keys stay as they were. */
const bpcKey = (p: Pick<Photo, "profileIntent" | "profileBpc">) => (p.profileBpc && usesBpc(p.profileIntent ?? 0) ? "b" : "");
const splitting = new Set<string>();

/**
 * The photo as a profile ink's layer draws it: its picture that ink's share, darker where more of it
 * goes, as a separation's is. Null while the profile or the photo is still being read - asked for now,
 * and whatever is drawing told when it's ready. Any other photo comes back as it is.
 */
function profiled(p: Photo): Photo | null {
  if (!p.profile) return p;
  const key = profileKey(p);
  if (tonesCache.has(key)) return { ...p, src: key };
  const whole = `${p.src}#icc|${pathHash(p.profile)}|${p.profileIntent ?? 0}${bpcKey(p)}|${p.saturation ?? 0}`;
  if (!splitting.has(whole)) {
    splitting.add(whole);
    Promise.all([loadProfile(p.profile), readTones(p.src)])
      .then(([profile, tones]) => {
        // Split from the colors as saturated: more vivid, more of the colored inks; greyer, more black.
        const inks = inksOf(profile, saturatedTones(p.src, tones, p.saturation ?? 0).rgba, { intent: p.profileIntent ?? 0, bpc: p.profileBpc });
        inks.forEach((ink, i) => {
          const light = new Float32Array(ink.length);
          const rgba = new Uint8ClampedArray(ink.length * 4);
          for (let k = 0; k < ink.length; k++) {
            light[k] = 1 - ink[k];
            const v = Math.round(light[k] * 255);
            rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = v;
            rgba[k * 4 + 3] = 255;
          }
          tonesCache.set(`${whole}|${i}`, { w: tones.w, h: tones.h, light, rgba });
        });
        separationListeners.forEach((heard) => heard());
      })
      .catch(() => {})
      .finally(() => splitting.delete(whole));
  }
  return null;
}

const flattenedImages = new Map<string, string>();

/**
 * The flattened picture as a picture, for the stage to show: what Flatten makes of the image, which
 * is what every effect and every ink set reads (Tom, 2026-11-23). Undefined until the image has been
 * read, and for an image that isn't flattened at all.
 *
 * Its saturation and its vignette are already in these pixels - flattening happens after both - so
 * whatever draws it must not apply them a second time. Its brightness and contrast are NOT: those
 * are applied to what comes out of the flattening, which is why moving them doesn't flatten it again.
 */
export function flattenedPicture(p: Pick<Photo, "src" | "saturation" | "vignette" | "crop" | "flatten">): string | undefined {
  if (!p.flatten) return undefined;
  const tones = tonesOf(p.src);
  if (!tones) return undefined;
  const vig = vignetteOn(p.vignette) ? vignetteKey(p.vignette!) : "";
  const key = `${p.src.length}|${p.src.slice(-32)}|${p.saturation ?? 0}|${vig}|${p.crop?.join(",") ?? ""}|${p.flatten}`;
  const known = flattenedImages.get(key);
  if (known) return known;
  const made = flattenedTones(p.src, vignettedTones(p.src, saturatedTones(p.src, tones, p.saturation ?? 0), p), p.flatten);
  const canvas = document.createElement("canvas");
  canvas.width = made.w;
  canvas.height = made.h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(made.rgba), made.w, made.h), 0, 0);
  const url = canvas.toDataURL("image/png");
  if (flattenedImages.size > 8) flattenedImages.delete(flattenedImages.keys().next().value!);
  flattenedImages.set(key, url);
  return url;
}

const plateImages = new Map<string, string>();

/**
 * A profile ink's share of the photo as a picture, for the stage to show - gray, darker where more of
 * it goes. Undefined until it's worked out (see profiled). Any other photo: its own picture.
 */
export function pictureOf(p: Photo): string | undefined {
  if (!p.profile) return p.src;
  const shown = profiled(p);
  if (!shown) return undefined;
  const known = plateImages.get(shown.src);
  if (known) return known;
  const tones = tonesCache.get(shown.src)!;
  const canvas = document.createElement("canvas");
  canvas.width = tones.w;
  canvas.height = tones.h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(tones.rgba), tones.w, tones.h), 0, 0);
  const url = canvas.toDataURL("image/png");
  if (plateImages.size > 24) plateImages.delete(plateImages.keys().next().value!);
  plateImages.set(shown.src, url);
  return url;
}

/**
 * A photo file made into a working copy: no longer than WORKING_EDGE on its longer side, as a JPEG,
 * so a drawing that carries it stays a size a browser opens without a pause. Rejects with a sentence
 * to show when the browser can't read the file - an iPhone's HEIC, in most of them.
 */
export async function workingCopy(file: File, edge = WORKING_EDGE): Promise<Pick<Photo, "src" | "width" | "height" | "ppi">> {
  const [img, dpi] = await Promise.all([readPicture(file), fileDpi(file).catch(() => null)]);
  try {
    const scale = Math.min(1, edge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const ppi = (dpi ?? DEFAULT_DPI) * (width / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // a transparent PNG is on white paper, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width, height, ppi };
  } finally {
    img.close();
  }
}

/**
 * Separation plates - greyscale, darker where more ink goes - as one colour picture: each plate's ink
 * laid over white in proportion to its darkness, as they'd print together. At the first plate's size,
 * the rest stretched to it, as the plates are drawn; a JPEG, as a working copy is.
 */
export async function joinedPicture(plates: { picture: Blob | string; ink: string }[]): Promise<Pick<Photo, "src" | "width" | "height">> {
  const bitmaps = await Promise.all(plates.map(async (p) => createImageBitmap(typeof p.picture === "string" ? await (await fetch(p.picture)).blob() : p.picture)));
  try {
    const width = bitmaps[0].width;
    const height = bitmaps[0].height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const out = new Float32Array(width * height * 3).fill(1);
    bitmaps.forEach((bitmap, i) => {
      const ink = /^#?([0-9a-f]{6})$/i.exec(plates[i].ink)?.[1] ?? "000000";
      const rgb = [0, 2, 4].map((at) => parseInt(ink.slice(at, at + 2), 16) / 255);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff"; // a transparent plate is no ink
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      for (let p = 0, d = 0; d < data.length; p += 3, d += 4) {
        const amount = 1 - (0.2126 * data[d] + 0.7152 * data[d + 1] + 0.0722 * data[d + 2]) / 255;
        for (let c = 0; c < 3; c++) out[p + c] *= 1 - amount * (1 - rgb[c]);
      }
    });
    const image = ctx.createImageData(width, height);
    for (let p = 0, d = 0; d < image.data.length; p += 3, d += 4) {
      image.data[d] = out[p] * 255;
      image.data[d + 1] = out[p + 1] * 255;
      image.data[d + 2] = out[p + 2] * 255;
      image.data[d + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width, height };
  } finally {
    bitmaps.forEach((b) => b.close());
  }
}

export async function fileDpi(file: File): Promise<number | null> {
  const v = new DataView(await file.arrayBuffer());
  const n = v.byteLength;
  const ascii = (at: number, len: number) => (at + len <= n ? String.fromCharCode(...new Uint8Array(v.buffer, at, len)) : "");
  const sane = (dpi: number) => (Number.isFinite(dpi) && dpi >= 1 && dpi <= 10000 ? dpi : null);
  // A TIFF header and its first directory, from `base`: Exif inside a JPEG, or the whole of a TIFF.
  const tiff = (base: number): number | null => {
    if (base + 8 > n) return null;
    const le = ascii(base, 2) === "II";
    if (!le && ascii(base, 2) !== "MM") return null;
    const u16 = (at: number) => v.getUint16(base + at, le);
    const u32 = (at: number) => v.getUint32(base + at, le);
    const ifd = u32(4);
    if (base + ifd + 2 > n) return null;
    let res: number | null = null;
    let unit = 2; // inches, when it doesn't say
    for (let i = 0, count = u16(ifd); i < count; i++) {
      const at = ifd + 2 + i * 12;
      if (base + at + 12 > n) break;
      const tag = u16(at);
      if (tag === 282) {
        const off = u32(at + 8);
        if (base + off + 8 <= n && u32(off + 4)) res = u32(off) / u32(off + 4);
      } else if (tag === 296) unit = u16(at + 8);
    }
    return res === null || unit === 1 ? null : sane(unit === 3 ? res * 2.54 : res);
  };
  if (n > 4 && v.getUint16(0) === 0xffd8) {
    let jfif: number | null = null, exif: number | null = null;
    for (let at = 2; at + 4 <= n && v.getUint8(at) === 0xff;) {
      const marker = v.getUint8(at + 1);
      if (marker === 0xda || marker === 0xd9) break; // the picture itself: no more headers
      const len = v.getUint16(at + 2);
      if (marker === 0xe0 && ascii(at + 4, 5) === "JFIF\0" && at + 16 <= n) {
        const units = v.getUint8(at + 11), x = v.getUint16(at + 12);
        if (units === 1 || units === 2) jfif = sane(units === 2 ? x * 2.54 : x);
      } else if (marker === 0xe1 && ascii(at + 4, 6) === "Exif\0\0") {
        exif = tiff(at + 10);
      }
      at += 2 + len;
    }
    return jfif ?? exif;
  }
  if (ascii(1, 3) === "PNG") {
    for (let at = 8; at + 8 <= n;) {
      const len = v.getUint32(at), type = ascii(at + 4, 4);
      if (type === "pHYs" && at + 17 <= n) // Kept per metre, which no round number of pixels to the inch is: 300 is 11811, which reads
      // back as 299.9994. Rounded to a hundredth, so 100% is the size the picture was saved at.
      return v.getUint8(at + 16) === 1 ? sane(Math.round(v.getUint32(at + 8) * 2.54) / 100) : null;
      if (type === "IDAT" || type === "IEND") break;
      at += 12 + len;
    }
    return null;
  }
  if (ascii(0, 2) === "II" || ascii(0, 2) === "MM") return tiff(0);
  if (ascii(0, 4) === "8BPS" && n > 30) {
    let at = 26 + 4 + v.getUint32(26); // past the colour mode data
    if (at + 4 > n) return null;
    const end = at + 4 + v.getUint32(at);
    for (at += 4; at + 12 <= end && at + 12 <= n && ascii(at, 4) === "8BIM";) {
      const id = v.getUint16(at + 4);
      const nameLen = v.getUint8(at + 6);
      const data = at + 6 + ((nameLen + 2) & ~1); // a Pascal name, padded to even
      if (data + 4 > n) break;
      const size = v.getUint32(data);
      if (id === 0x03ed && data + 10 <= n) {
        // Fixed 16.16 pixels to the unit, then the unit: 1 inches, 2 centimetres.
        const res = v.getUint32(data + 4) / 65536;
        return sane(v.getUint16(data + 8) === 2 ? res * 2.54 : res);
      }
      at = data + 4 + ((size + 1) & ~1);
    }
  }
  return null;
}

/**
 * How big a photo is drawn, as a percent of the size its file says it is: its box over the part of the
 * picture that shows, at the file's pixels to the inch. A photo from before that was kept has no such
 * size; it's taken as it is now, so 100% leaves it where it is.
 */
export function photoScale(sh: { x: number; x2: number; photo?: Photo }): number {
  const p = sh.photo;
  if (!p?.ppi) return 100;
  const [l, , r] = p.crop ?? [0, 0, 1, 1];
  const own = ((r - l) * p.width) / p.ppi;
  return own > 0 ? (Math.abs(sh.x2 - sh.x) / own) * 100 : 100;
}

/**
 * A picture file as pixels. A TIFF goes to the server, which flattens it on this Mac - a layered one
 * from Photoshop comes back as the picture Photoshop shows, adjustment layers applied - since Chrome
 * can't read TIFFs at all. Anything else the browser can't read (an iPhone's HEIC, in Chrome) gets
 * the same treatment before it's turned away.
 */
async function readPicture(file: File): Promise<ImageBitmap> {
  const tiff = /\.tiff?$/i.test(file.name) || file.type === "image/tiff";
  if (!tiff) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* the server may read it */
    }
  }
  let flat: Response;
  try {
    flat = await fetch(`/api/flat-image?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  } catch {
    throw new Error(`${file.name} needs the server to read it, and the server can't be reached.`);
  }
  if (flat.status === 413) throw new Error(`${file.name} is too big to send (50 MB at most). Save a smaller copy and add that.`);
  if (!flat.ok) {
    const said = await flat.json().catch(() => ({}));
    throw new Error(said.error ? `${file.name}: ${said.error}` : `${file.name} is a kind of picture this browser can’t read. Save it as a JPEG or PNG and add that.`);
  }
  return createImageBitmap(await flat.blob());
}

/**
 * The working copy turned a quarter, right (1) or left (-1): to stand a picture the way the paper
 * does. The pixels are turned, not the shape, so its lines are worked out square to the paper as
 * any photo's are. A JPEG at the working copy's quality, so the drawing that carries it stays its size.
 */
export async function turnedCopy(src: string, quarter: 1 | -1): Promise<Pick<Photo, "src" | "width" | "height">> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.height;
    canvas.height = img.width;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((quarter * Math.PI) / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
  } finally {
    img.close();
  }
}

/** Whether this is a part of a picture - left, top, right, bottom, as fractions, each in order. */
const isPart = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && n >= 0 && n <= 1) && v[0] < v[2] && v[1] < v[3];

/** A part of a part, as a part of the whole: `inner` in fractions of `outer`, made fractions of what `outer` is cut from. */
export function partOfPart(outer: [number, number, number, number] | undefined, inner: [number, number, number, number]): [number, number, number, number] {
  const [l, t, r, b] = outer ?? [0, 0, 1, 1];
  return [l + inner[0] * (r - l), t + inner[1] * (b - t), l + inner[2] * (r - l), t + inner[3] * (b - t)];
}

/** A copy of a picture cut to a part of it - left, top, right, bottom, as fractions. */
export async function croppedCopy(src: string, part: [number, number, number, number]): Promise<Pick<Photo, "src" | "width" | "height">> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const [l, t, r, b] = part;
    const x = Math.round(l * img.width), y = Math.round(t * img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(r * img.width) - x);
    canvas.height = Math.max(1, Math.round(b * img.height) - y);
    canvas.getContext("2d")!.drawImage(img, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
  } finally {
    img.close();
  }
}

/** A crop - left, top, right, bottom, as fractions - turned with its picture. */
export function turnedCrop(crop: Photo["crop"], quarter: 1 | -1): Photo["crop"] {
  if (!crop) return undefined;
  const [l, t, r, b] = crop;
  return quarter === 1 ? [1 - b, l, 1 - t, r] : [t, 1 - r, b, 1 - l];
}

/**
 * A photo's separation plates kept to come back to as Channels (`modes.separations`), cut or turned as
 * its picture just was, so they come back matching it: `picture` makes a plate's new picture, and
 * `own` its new cut and turns. `made` shares each new picture between the layers that keep the same
 * plates. The photo's modes as they now are; unchanged when it keeps no plates.
 */
export async function keptPlatesAlike(
  photo: Photo,
  picture: (src: string) => Promise<Pick<Photo, "src" | "width" | "height">>,
  own: (plate: Partial<Photo>) => Partial<Photo>,
  made: Map<string, Promise<Pick<Photo, "src" | "width" | "height">>>,
): Promise<Photo["modes"]> {
  const kept = photo.modes?.separations;
  if (!kept?.length) return photo.modes;
  const plates = await Promise.all(kept.map(async (part) => {
    const src = part.photo.src;
    if (!src) return part;
    if (!made.has(src)) made.set(src, picture(src));
    return { ...part, photo: { ...part.photo, ...await made.get(src)!, ...own(part.photo) } };
  }));
  return { ...photo.modes, separations: plates };
}

// ---------- Hatching ----------

const marksCache = new Map<string, PhotoMarks>();

/**
 * The lines for a photo in a box of this size, or null until the photo has been read. Worked out
 * in the photo's own corner, not the page's, so moving it about the page reuses them: only a new
 * size or new numbers draws them again.
 */
export function photoMarks(photo: Photo, w: number, h: number): PhotoMarks | null {
  // Baked, with no effect picked since: nothing to draw.
  if (photo.idle) return { passes: [], strokes: 0 };
  // A profile's ink: drawn from its own share of the photo, once the profile and the photo are read.
  const inked = profiled(photo);
  if (!inked) return null;
  photo = channelAdjusted(inked);
  const tones = photoTones(photo);
  if (!tones || w <= 0 || h <= 0) return null;
  const key = marksKey(photo, w, h);
  const known = marksCache.get(key);
  if (known) return known;
  // Hatching smoothed first, by as many of the photo's pixels as the millimetres asked for on the page.
  const [c0, , c2] = photo.crop ?? [0, 0, 1, 1];
  const hatchTones = !photo.style && photo.hatchSmoothMm
    ? smoothedTones(photo.src, tones, (photo.hatchSmoothMm * tones.w * (c2 - c0)) / (w * 25.4))
    : tones;
  // A plate whose separation - of the photo as this style reads it, smoothed or not - is still being
  // worked out off the page: not yet, and not kept. Asked of the unsmoothed photo, a smoothed plate
  // was drawn from a separation that wasn't there, came out empty, and stayed empty.
  const drawsFrom = photo.style === "squiggle" ? (photo.squiggleVersion === "inkscape" ? smoothedTones(photo.src, tones, 2) : processingBlurred(photo.src, tones)) : photo.style ? tones : hatchTones;
  if (photo.plate && (photo.plates?.length ?? 0) >= 4 && !separationOf(drawsFrom, photo)) return null;
  const made = photo.style === "waves" ? waves(tones, photo, w, h)
    : photo.style === "squiggle" ? (photo.squiggleVersion === "inkscape" ? squiggleInkscape(tones, photo, w, h) : squiggle(tones, photo, w, h))
    : photo.style === "streamlines" ? streamlines(tones, photo, w, h)
    : photo.style === "scribble" ? scribble(tones, photo, w, h)
    : photo.style === "sketch" ? sketchLines(tones, photo, w, h)
    : photo.style === "oneline" ? oneLine(tones, photo, w, h)
    : photo.style === "hilbert" ? hilbert(tones, photo, w, h)
    : photo.style === "outlines" ? outlines(tones, photo, w, h)
    : photo.style === "centerlines" ? centerlines(tones, photo, w, h)
    : photo.style === "silhouette" ? silhouette(tones, photo, w, h)
    : photo.style === "edges" ? edges(tones, photo, w, h)
    : photo.style === "paint" ? paint(tones, photo, w, h)
    : hatch(hatchTones, photo, w, h);
  if (marksCache.size > 24) marksCache.delete(marksCache.keys().next().value!);
  marksCache.set(key, made);
  return made;
}

const maskCache = new Map<string, PhotoMask>();

export function photoMask(photo: Photo, w: number, h: number): PhotoMask | null {
  const tones = photoTones(photo);
  if (!tones || w <= 0 || h <= 0) return null;
  // A plate whose separation is still being worked out off the page: not yet, and not kept.
  if (!separationReady(photo)) return null;
  const key = marksKey(photo, w, h);
  const known = maskCache.get(key);
  if (known) return known;
  let made: PhotoMask;
  if (photo.style === "centerlines") {
    const { gw, gh, on } = centerOn(tones, photo, w, h);
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(on, (v) => v * 255) };
  } else if (photo.style === "paint") {
    const { gw, gh, labels, mine } = paintRegions(tones, photo, w, h);
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(labels, (v) => (v === mine ? 255 : 0)) };
  } else if (photo.style === "silhouette") {
    const { gw, gh, field } = paintField(tones, photo, w, h);
    const level = 1 - Math.min(0.99, Math.max(0.01, photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from));
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(field, (v) => (v > level ? 255 : 0)) };
  } else {
    const gw = Math.max(2, Math.round((MASK_EDGE * w) / Math.max(w, h)));
    const gh = Math.max(2, Math.round((MASK_EDGE * h) / Math.max(w, h)));
    const { field } = fieldOf(tones, photo, gw, gh, 1);
    if (photo.style === "outlines") blurGrid(field, gw, gh, Math.max(0, photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm) / 25.4 / (w / (gw - 1)));
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(field, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) };
  }
  if (maskCache.size > 8) maskCache.delete(maskCache.keys().next().value!);
  maskCache.set(key, made);
  return made;
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** How much a contrast of -100 to 100 stretches the tones about middle grey. */
const contrastGain = (contrast: number) => {
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  return c >= 0 ? 1 / (1 - c) : 1 + c;
};

export function channelAdjusted(p: Photo): Photo {
  const own = { b: p.channelBrightness ?? 0, c: p.channelContrast ?? 0, k: p.channelBlackPoint ?? 0 };
  if (!own.b && !own.c && !own.k && !p.blackPoint) return p;
  // Lightness 0 to 1 as a * L + m, stage by stage.
  let a = 1;
  let m = 0;
  const then = (gain: number, offset: number) => {
    a *= gain;
    m = m * gain + offset;
  };
  const levels = (b: number, c: number) => {
    const gain = contrastGain(c);
    then(gain, 0.5 - 0.5 * gain + b / 200);
  };
  const black = (k: number) => {
    const point = Math.max(0, Math.min(MOST_BLACK_POINT, k)) / 100;
    if (point) then(1 / (1 - point), -point / (1 - point));
  };
  levels(own.b, own.c);
  black(own.k);
  levels(p.brightness, p.contrast);
  black(p.blackPoint ?? 0);
  const contrast = a >= 1 ? (1 - 1 / a) * 100 : (a - 1) * 100;
  return {
    ...p, brightness: (m - 0.5 + 0.5 * a) * 200, contrast: Math.max(-99, Math.min(99, contrast)),
    channelBrightness: undefined, channelContrast: undefined, channelBlackPoint: undefined, blackPoint: undefined,
  };
}

export function isColourful(src: string): boolean {
  const tones = tonesOf(src);
  if (!tones) return false;
  const total = tones.w * tones.h;
  let coloured = 0;
  const probes = 2000;
  for (let i = 0; i < probes; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    const [, a, b] = lab(tones.rgba[p], tones.rgba[p + 1], tones.rgba[p + 2]);
    if (Math.hypot(a, b) > 20) coloured++;
  }
  return coloured > probes * 0.1;
}

const isPaper = (c: number[]) => c[0] >= PAPER_LIGHTNESS && Math.hypot(c[1], c[2]) <= PAPER_CHROMA;

/**
 * The photo's colours gathered into this many groups of similar colours: each group's average
 * colour, lightest first, leaving out any group so light it's the paper. Gathered from a scattering
 * of the photo's pixels, the way a painter mixes a limited palette from a scene: start from colours
 * far apart, then settle each group on the average of what's nearest it, a few times over.
 */
export function colourGroups(src: string, count: number, brightness: number, contrast: number, saturation = 0): string[] {
  const tones = photoTones({ src, saturation });
  if (!tones) return [];
  const adjust = adjuster(brightness, contrast);
  const total = tones.w * tones.h;
  const pixels: { rgb: number[]; lab: [number, number, number] }[] = [];
  for (let i = 0; i < 4000; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    const rgb = [adjust(tones.rgba[p]), adjust(tones.rgba[p + 1]), adjust(tones.rgba[p + 2])];
    pixels.push({ rgb, lab: lab(rgb[0], rgb[1], rgb[2]) });
  }
  const k = Math.max(1, Math.min(count + 1, pixels.length)); // one more, in case one is the paper
  // Starting colours as far apart as the photo allows: each next one the pixel furthest from all so far.
  const centres: [number, number, number][] = [pixels[0].lab];
  while (centres.length < k) {
    let far = pixels[0];
    let farthest = -1;
    for (const px of pixels) {
      const d = Math.min(...centres.map((c) => dist2(px.lab, c)));
      if (d > farthest) { farthest = d; far = px; }
    }
    centres.push(far.lab);
  }
  const sums = centres.map(() => ({ lab: [0, 0, 0], rgb: [0, 0, 0], n: 0 }));
  for (let pass = 0; pass < 12; pass++) {
    sums.forEach((s) => { s.lab = [0, 0, 0]; s.rgb = [0, 0, 0]; s.n = 0; });
    for (const px of pixels) {
      let best = 0;
      let nearest = Infinity;
      centres.forEach((c, i) => { const d = dist2(px.lab, c); if (d < nearest) { nearest = d; best = i; } });
      const s = sums[best];
      for (let ch = 0; ch < 3; ch++) { s.lab[ch] += px.lab[ch]; s.rgb[ch] += px.rgb[ch]; }
      s.n++;
    }
    sums.forEach((s, i) => { if (s.n) centres[i] = [s.lab[0] / s.n, s.lab[1] / s.n, s.lab[2] / s.n]; });
  }
  const groups = sums
    .map((s, i) => ({ lab: centres[i], hex: s.n ? toHex(s.rgb.map((v) => v / s.n)) : "#ffffff", n: s.n }))
    .filter((g) => g.n > 0);
  // Drop the paper, then keep the biggest groups if there are still more than asked for.
  const inked = groups.filter((g) => !isPaper(g.lab)).sort((a, b) => b.n - a.n).slice(0, count);
  return inked.sort((a, b) => b.lab[0] - a.lab[0]).map((g) => g.hex);
}

const flattenCache = new Map<string, Tones>();

/**
 * The colours a picture would be flattened to, `count` of them, lightest first. Read from the flat
 * insides of the picture where it has them - which is what keeps a poster's five colours exactly -
 * and from all of it where it hasn't, so a photograph still has a palette to be cut down to.
 *
 * Nothing here is adjusted for brightness or contrast: flattening changes the picture, and the
 * picture's own brightness and contrast are applied to what comes out of it later. Flattening on the
 * adjusted colours would apply them twice, and would also re-flatten the picture every time a slider
 * moved.
 */
function flattenPalette(tones: Tones, count: number): string[] {
  const inside = flatBuckets(tones);
  const total = (tones.w - 2) * (tones.h - 2);
  let sums = inside.sums;
  if (inside.flat < total * FLATTEN_LEAST_FLAT) {
    // Grain, dithering or a photograph: too little of it lies inside a flat area to read, so every
    // pixel counts instead (every nth of them, where there are more than enough).
    sums = new Map();
    const step = Math.max(1, Math.ceil((tones.w * tones.h) / FLATTEN_SAMPLE));
    for (let i = 0; i < tones.w * tones.h; i += step) {
      const p = i * 4;
      intoBucket(sums, tones.rgba[p], tones.rgba[p + 1], tones.rgba[p + 2]);
    }
  }
  let held = 0;
  for (const b of sums.values()) held += b.n;
  if (!held) return [];
  // The paper is a colour here, unlike a split: a flattened picture is still a picture, and white
  // areas are white rather than missing.
  const candidates = gatheredColours(sums, (v) => v)
    .filter((k) => k.n >= held * FLATTEN_LEAST)
    .sort((a, z) => z.n - a.n)
    .slice(0, FLAT_MOST_CANDIDATES);
  return toCount(candidates, Math.max(1, count))
    .sort((a, z) => z.lab[0] - a.lab[0])
    .map((k) => toHex([k.r / k.n, k.g / k.n, k.b / k.n]));
}

/**
 * The colours a picture would be flattened to, lightest first: what Flatten makes of it, without
 * making it. The picture must have been read already (readTones).
 */
export function flattenedColours(src: string, count: number): string[] {
  const tones = tonesOf(src);
  return tones ? flattenPalette(tones, Math.max(2, Math.min(FLATTEN_MOST, Math.round(count)))) : [];
}

/**
 * The picture cut down to this many flat colours: every pixel taken to whichever of them it is
 * nearest, so what comes out has hard borders and no shading inside an area.
 *
 * An adjustment rather than a way of splitting: it changes the picture every effect and every ink
 * set then reads, so hatching a flattened photograph hatches flat areas, and a split of one finds
 * the colours it was flattened to. Worked out once for each picture and number.
 */
function flattenedTones(src: string, tones: Tones, count: number): Tones {
  const want = Math.max(2, Math.min(FLATTEN_MOST, Math.round(count)));
  const key = [src.length, src.slice(-32), tones.w, tones.h, tones.sat ?? 0, tones.mask ?? "", tones.light[0], tones.light[tones.light.length >> 1], want].join("|");
  const known = flattenCache.get(key);
  if (known) return known;
  const palette = flattenPalette(tones, want);
  if (palette.length < 2) return tones;
  // Which colour each eighth of each channel goes to, worked out once: then every pixel is a lookup
  // rather than a search through the palette in Lab, which on a big picture is millions of them.
  const labs = palette.map(hexLab);
  const rgbs = palette.map((hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  });
  const table = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const at = lab(r * 8 + 4, g * 8 + 4, b * 8 + 4);
        let best = 0;
        let nearest = Infinity;
        labs.forEach((c, i) => { const d = dist2(at, c); if (d < nearest) { nearest = d; best = i; } });
        table[(r << 10) | (g << 5) | b] = best;
      }
    }
  }
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const light = new Float32Array(tones.light.length);
  for (let p = 0, i = 0; p < light.length; p++, i += 4) {
    const [r, g, b] = rgbs[table[bucketAt(tones.rgba[i], tones.rgba[i + 1], tones.rgba[i + 2])]];
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = tones.rgba[i + 3];
    light[p] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  const made: Tones = { w: tones.w, h: tones.h, light, rgba, sat: tones.sat, mask: tones.mask, flat: want };
  if (flattenCache.size > 3) flattenCache.delete(flattenCache.keys().next().value!);
  flattenCache.set(key, made);
  return made;
}

const flatCache = new Map<string, FlatColours>();
const bucketAt = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

const intoBucket = (sums: Map<number, Bucket>, r: number, g: number, b: number) => {
  const at = bucketAt(r, g, b);
  const s = sums.get(at);
  if (s) { s.r += r; s.g += g; s.b += b; s.n++; }
  else sums.set(at, { r, g, b, n: 1 });
};

/**
 * Every pixel inside a flat area, gathered by its colour: a bucket for each eighth of each channel,
 * fine enough never to hold two colours the eye tells apart, coarse enough to hold a smear together.
 * A pixel whose four neighbours all match it is inside an area; one whose don't is on a border, and
 * a border is a blend of the two sides belonging to neither.
 */
function flatBuckets(tones: Tones): { sums: Map<number, Bucket>; flat: number } {
  const { w, h, rgba } = tones;
  const near = (p: number, q: number) => Math.abs(rgba[p] - rgba[q]) <= FLAT_NEAR
    && Math.abs(rgba[p + 1] - rgba[q + 1]) <= FLAT_NEAR && Math.abs(rgba[p + 2] - rgba[q + 2]) <= FLAT_NEAR;
  const sums = new Map<number, Bucket>();
  const row = w * 4;
  let flat = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (!near(p, p - 4) || !near(p, p + 4) || !near(p, p - row) || !near(p, p + row)) continue;
      intoBucket(sums, rgba[p], rgba[p + 1], rgba[p + 2]);
      flat++;
    }
  }
  return { sums, flat };
}

/**
 * The buckets gathered into colours: biggest first, so a colour's own bucket is there to take the
 * rest of its smear, and each bucket joins the colour it is near enough to be.
 */
function gatheredColours(sums: Map<number, Bucket>, adjust: (v: number) => number): FlatColour[] {
  const kept: FlatColour[] = [];
  for (const b of [...sums.values()].sort((a, z) => z.n - a.n)) {
    const rgb = [adjust(b.r / b.n), adjust(b.g / b.n), adjust(b.b / b.n)];
    const at = lab(rgb[0], rgb[1], rgb[2]);
    const same = kept.find((k) => dist2(at, k.lab) <= FLAT_MERGE * FLAT_MERGE);
    if (same) { same.r += rgb[0] * b.n; same.g += rgb[1] * b.n; same.b += rgb[2] * b.n; same.n += b.n; }
    else kept.push({ lab: at, r: rgb[0] * b.n, g: rgb[1] * b.n, b: rgb[2] * b.n, n: b.n });
  }
  return kept;
}

/** These colours joined, nearest pair first, until `want` are left - each joined into the one it is
 *  nearest, weighted by how much of the picture each holds. */
function toCount(colours: FlatColour[], want: number): FlatColour[] {
  const left = colours.slice();
  while (left.length > want) {
    let a = 0;
    let b = 1;
    let nearest = Infinity;
    for (let i = 0; i < left.length; i++) {
      for (let j = i + 1; j < left.length; j++) {
        const d = dist2(left[i].lab, left[j].lab);
        if (d < nearest) { nearest = d; a = i; b = j; }
      }
    }
    const [one, two] = [left[a], left[b]];
    const n = one.n + two.n;
    left[a] = {
      lab: [0, 1, 2].map((i) => (one.lab[i] * one.n + two.lab[i] * two.n) / n) as [number, number, number],
      r: one.r + two.r, g: one.g + two.g, b: one.b + two.b, n,
    };
    left.splice(b, 1);
  }
  return left;
}

/**
 * The colours a picture is already drawn in, read from it rather than gathered from it: for art made
 * of flat areas with hard borders - a poster, a print, a logo.
 *
 * Such a picture rarely still holds its colours exactly. Saved and resaved on its way here, each area
 * comes back smeared a level or two about its true colour, so counting colours finds tens of
 * thousands where the eye sees five. What it does still hold is the difference between an area and a
 * border: inside an area every neighbour matches, on a border none does. So keep only the pixels
 * inside an area - borders are a blend of the two sides and belong to neither - gather those into
 * their colours, and what stands with real area of its own is the picture's palette, counted by the
 * picture.
 *
 * This is what colourGroups can't do. Gathering a scattering of pixels into a fixed number of groups
 * spends groups on the borders' blends, and then makes two real colours share a group because a blend
 * has taken one: a poster's blue and navy come back as a single wrong blue, and a muddy colour that
 * is nowhere in the picture takes a pen. Here the borders are put aside before any colour is counted.
 *
 * `share` and `covered` are how well this reading suits the picture at all - how much of it lay in
 * flat areas, and how much of that the colours found account for. They describe the picture, so they
 * are the picture's own however many colours were asked for.
 *
 * `count` flattens it to that many colours instead of its own number of them: see toCount.
 */
export function flatColours(src: string, most: number, brightness: number, contrast: number, saturation = 0, count?: number): FlatColours {
  const none: FlatColours = { colours: [], share: 0, covered: 0 };
  const tones = photoTones({ src, saturation });
  if (!tones || tones.w < 3 || tones.h < 3) return none;
  const { w, h } = tones;
  const key = [w, h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.flat ?? 0, tones.light[0], tones.light[tones.light.length >> 1], most, count ?? 0, brightness, contrast].join("|");
  const known = flatCache.get(key);
  if (known) return known;
  const { sums, flat } = flatBuckets(tones);
  if (!flat) return none;
  const kept = gatheredColours(sums, adjuster(brightness, contrast));
  // What has area of its own is a colour of the picture; the paper is one of them, and gets no layer.
  const real = kept.filter((k) => k.n >= flat * FLAT_LEAST);
  const want = count ? Math.max(1, Math.min(most, Math.round(count))) : 0;
  // Asked for a number of colours rather than the picture's own: start from everything with any area
  // at all, and join the two nearest colours over and over until that many are left. Each one joined
  // takes the colour nearest it, so what goes is the distinction the eye would miss first - which is
  // what flattening to fewer colours means. Keeping the biggest and dropping the rest would instead
  // leave the dropped areas to no colour at all.
  const inked = (want
    ? toCount(kept.filter((k) => k.n >= flat * FLAT_LEAST_ASKED && !isPaper(k.lab)).sort((a, z) => z.n - a.n).slice(0, FLAT_MOST_CANDIDATES), want)
    : real.filter((k) => !isPaper(k.lab)).sort((a, z) => z.n - a.n).slice(0, Math.max(1, most)));
  const made: FlatColours = {
    colours: inked.slice().sort((a, z) => z.lab[0] - a.lab[0]).map((k) => toHex([k.r / k.n, k.g / k.n, k.b / k.n])),
    share: flat / ((w - 2) * (h - 2)),
    covered: real.reduce((sum, k) => sum + k.n, 0) / flat,
  };
  if (flatCache.size > 4) flatCache.delete(flatCache.keys().next().value!);
  flatCache.set(key, made);
  return made;
}

/**
 * The pen of a palette nearest each colour group, each pen used once: the closest pairs are matched
 * first, so a group only settles for a further pen when a nearer group has taken its own.
 */
export function matchPens<P extends { color: string }>(groups: string[], palette: P[]): (P | undefined)[] {
  const pairs: { g: number; p: number; d: number }[] = [];
  groups.forEach((hex, g) => palette.forEach((pen, p) => pairs.push({ g, p, d: dist2(hexLab(hex), hexLab(pen.color)) })));
  pairs.sort((a, b) => a.d - b.d);
  const out: (P | undefined)[] = groups.map(() => undefined);
  const used = new Set<number>();
  for (const { g, p } of pairs) {
    if (out[g] || used.has(p)) continue;
    out[g] = palette[p];
    used.add(p);
  }
  return out;
}

const unlinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
/** A colour as a hex, from its light per channel. */
export const linearHex = (rgb: number[]) => toHex(rgb.map((v) => unlinear(Math.min(1, Math.max(0, v)))));
export function photoMarksNow(photo: Photo, w: number, h: number): PhotoMarks | null {
  setSeparateNow(true);
  try {
    return photoMarks(photo, w, h);
  } finally {
    setSeparateNow(false);
  }
}
export { setSeparationRunner } from "./photoSample";

/** Be told when a separation solved off the page is ready, so its lines can be drawn. Returns the way to stop. */
export function onSeparation(heard: () => void): () => void {
  separationListeners.add(heard);
  return () => separationListeners.delete(heard);
}

/** Whether a photo layer can be drawn yet: false while its plates are still being separated off the page. */
function separationReady(photo: Photo): boolean {
  if (!photo.plate || (photo.plates?.length ?? 0) < 4) return true;
  const tones = photoTones(photo);
  return Boolean(tones && separationOf(tones, photo));
}

export function platePasses(rgb: [number, number, number], plates: string[], { levels = 6, penMm = 0.4, spacingMm = 1.2, blackShare = BLACK_SHARE } = {}): number[] {
  const steps = coverSteps(penMm, spacingMm, levels);
  const off = plates.map((p) => p === PLATE_OFF);
  const pens = plates.map((p) => (p === PLATE_OFF ? [1, 1, 1] : hexLinear(p)));
  const covers = chooseCovers(withinReach(pens, steps, blackShare, off)(labOfLinear(rgb.map(linear))), pens, steps, blackShare, null, off);
  return covers.map((c) => {
    const tone = coverTone(c, steps);
    return tone ? Math.floor(tone * steps.length) : 0;
  });
}

function waves(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const row = Math.max(0.2, photo.rowMm ?? WAVE_DEFAULTS.rowMm) / 25.4;
  const shortestWave = Math.max(0.2, photo.waveMm ?? WAVE_DEFAULTS.waveMm) / 25.4;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const rad = (photo.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  // Eight looks at the photo to the tightest wave: enough for the wave to read as a curve.
  const step = shortestWave / 8;
  const n = (v: number) => Number(v.toFixed(4));
  // How strongly the line waves: by the whole photo's darkness, in a band as in one layer, so bands
  // meet at the same strength and white is paper.
  const strength = (t: number) => t;
  const parts: string[] = [];
  let strokes = 0;
  let line = 0;
  for (let o = -reach + row / 2; o <= reach; o += row, line++) {
    const back = line % 2 === 1;
    let phase = 0;
    let run: string[] = [];
    const close = () => {
      if (run.length > 2) {
        parts.push(`M${run.join("L")}`);
        strokes++;
      }
      run = [];
    };
    for (let i = 0; i <= (reach * 2) / step; i++) {
      const t = back ? reach - i * step : -reach + i * step;
      const bx = cx - dy * o + dx * t;
      const by = cy + dx * o + dy * t;
      const tone = toneAt(bx, by);
      const s = tone < 0 ? 0 : strength(tone);
      if (s < 0.03) {
        close();
        continue;
      }
      // Darker waves are tighter: at black a wave is the shortest; toward white, four times as long.
      phase += (2 * Math.PI * step) / (shortestWave * (1 + 3 * (1 - s)));
      const swing = (row / 2) * s * Math.sin(phase);
      const x = bx - dy * swing;
      const y = by + dx * swing;
      if (x < 0 || x > w || y < 0 || y > h) {
        close();
        continue;
      }
      run.push(`${n(x)} ${n(y)}`);
    }
    close();
  }
  return { passes: [parts.join("")], strokes };
}

// ---------- Squiggle ----------

function squiggleInkscape(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sq = squiggleInkscapeOf(photo);
  const rows = Math.round(sq.rows);
  const cols = Math.round(sq.cols);
  const freq = Math.round(sq.freq);
  const divisor = [128, 64, 32, 16, 8, 4][Math.round(sq.amp) - 1];
  const sqMax = 256 / divisor;
  const MM = 1 / 25.4;
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(smoothedTones(photo.src, tones, 2), photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));

  // The grid in the rows' own frame: along them L, across them A - the box itself at no angle.
  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const A = Math.abs(w * dy) + Math.abs(h * dx);
  const cx = w / 2;
  const cy = h / 2;
  type P = { x: number; y: number };
  // A point by how far along (0 to L) and across (0 to A) the frame it is.
  const at = (t: number, o: number): P => ({ x: cx + (t - L / 2) * dx - (o - A / 2) * dy, y: cy + (t - L / 2) * dy + (o - A / 2) * dx });
  const inside = (p: P) => p.x >= -1e-9 && p.x <= w + 1e-9 && p.y >= -1e-9 && p.y <= h + 1e-9;
  const n = (v: number) => Number(v.toFixed(4));
  const brightness = (p: P) => {
    if (!inside(p)) return 255;
    const tone = toneAt(p.x, p.y);
    if (tone < 0) return 255;
    return 255 * (1 - (sq.invert ? 1 - tone : tone));
  };

  // The photo shrunk to the grid, each cell the average of its brightness, as whole numbers.
  const grid = new Float32Array(rows * cols);
  const SUB = 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) sum += brightness(at(((c + (j + 0.5) / SUB) * L) / cols, ((r + (i + 0.5) / SUB) * A) / rows));
    grid[r * cols + c] = Math.round(sum / (SUB * SUB));
  }
  // Then scaled up to a pixel a millimetre, plus one, by Lanczos, and read at a whole pixel.
  const Wpx = Math.round(L / MM) + 1;
  const Hpx = Math.round(A / MM) + 1;
  const lanczos = (x: number) => (x === 0 ? 1 : Math.abs(x) >= 3 ? 0 : (3 * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / 3)) / (Math.PI * Math.PI * x * x));
  const weights = (px: number, size: number, cells: number) => {
    const s = ((px + 0.5) * cells) / size - 0.5;
    const out: [number, number][] = [];
    let total = 0;
    for (let k = Math.floor(s) - 2; k <= Math.floor(s) + 3; k++) {
      if (k < 0 || k >= cells) continue;
      const wt = lanczos(s - k);
      out.push([k, wt]);
      total += wt;
    }
    return out.map(([k, wt]) => [k, wt / total] as [number, number]);
  };
  const read = (px: number, py: number) => {
    let v = 0;
    for (const [r, wr] of weights(py, Hpx, rows)) for (const [c, wc] of weights(px, Wpx, cols)) v += grid[r * cols + c] * wr * wc;
    return Math.min(255, Math.max(0, Math.round(v)));
  };

  // Whether this layer draws at a point along a row: its tone (and, lifting, not white). Asked of each
  // half-wave's middle, so a run stops at the half-wave where the tone does - asked of a whole cell,
  // a run reaching white ran on to the cell's end and spilled into it.
  const xinc = L / (cols - 1);
  const rowH = A / rows;
  const drawsAt = (t: number, oMid: number) => {
    const p = at(t, oMid);
    if (!inside(p)) return false;
    const tone = toneAt(p.x, p.y);
    return tone >= 0 && !(photo.squiggleLift && fromWhite && tone < 0.03);
  };

  // Each run: its cubics' points, from the row's middle at a cell's edge to another.
  type Run = { start: P; segs: [P, P, P][]; fromStart: boolean; toEnd: boolean; row: number };
  const lines: { start: P; segs: [P, P, P][] }[] = [];
  let open: Run | null = null;
  const quad = (p0: P, q: P, p1: P): [P, P, P] => [
    { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
    p1,
  ];
  const back = sq.path !== "uni";
  for (let r = 0; r < rows; r++) {
    const oMid = rowH * (r + 1) - rowH / 2;
    const reversed = back && r % 2 !== 0;
    const order = Array.from({ length: cols - 1 }, (_, i) => (reversed ? cols - 2 - i : i));
    const runs: Run[] = [];
    let run: Run | null = null;
    for (const [i, x] of order.entries()) {
      let amp = sqMax - read(Math.floor(x * (L / MM / cols)), Math.floor(r * (A / MM / rows))) / divisor;
      if (reversed) amp *= -1;
      const sign = reversed ? -1 : 1;
      const t0 = (reversed ? x + 1 : x) * xinc;
      // `freq` waves to the cell, each a hump out and its reflection back: a quadratic, then the
      // extension's smooth 't'. Each half drawn only where the tone is, so runs end with it.
      const half = (sign * xinc) / 2 / freq;
      for (let k = 0; k < 2 * freq; k++) {
        const s = t0 + half * k;
        if (!drawsAt(s + half / 2, oMid)) {
          if (run) runs.push(run);
          run = null;
          continue;
        }
        if (!run) run = { start: at(s, oMid), segs: [], fromStart: i === 0 && k === 0, toEnd: false, row: r };
        const swing = (k % 2 === 0 ? amp : -amp) / 2;
        run.segs.push(quad(at(s, oMid), at(s + half / 2, oMid + swing * MM), at(s + half, oMid)));
      }
      if (i === order.length - 1 && run) run.toEnd = true;
    }
    if (run) runs.push(run);
    for (const runNow of runs) {
      if (open && sq.path === "join" && runNow.fromStart && open.toEnd && open.row === r - 1) {
        // The turn, as the extension's: out half a cell past the edge the last row ended at, and round, down a row.
        const end = open.segs[open.segs.length - 1][2];
        const tOut = back && (r - 1) % 2 !== 0 ? -xinc / 2 : L + xinc / 2;
        const ctrl = at(tOut, oMid - rowH);
        const mid = at(tOut, oMid - rowH / 2);
        const ctrl2 = at(tOut, oMid);
        open.segs.push(quad(end, ctrl, mid), quad(mid, ctrl2, runNow.start), ...runNow.segs);
        open.toEnd = runNow.toEnd;
        open.row = r;
        continue;
      }
      if (open) lines.push(open);
      open = runNow;
    }
  }
  if (open) lines.push(open);

  const parts = lines
    .filter((l) => l.segs.length)
    .map((l) => `M${n(l.start.x)} ${n(l.start.y)}` + l.segs.map(([a, b, c]) => `C${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(c.x)} ${n(c.y)}`).join(""));
  return { passes: [parts.join("")], strokes: parts.length };
}

/**
 * Tone as squiggles: Gregg Wygonik's SquiggleDraw (public domain), its sums as the Processing sketch
 * has them, with its controls and their numbers - see SQUIGGLE_DRAW. It works on the photo as the
 * sketch sees it: grey, blurred by 2 pixels and scaled up by the resolution scale, its rows
 * `lines` to the photo's height. Along each row the phase moves on by the darkness over the
 * frequency at every `detail` step, so darker is tighter, and the swing is the darkness times the
 * strength over the lines. A point goes at each crest, trough and crossing of the middle, and the
 * points are joined as a Catmull-Rom curve - Processing's curveVertex - with a point a tenth of a
 * step past each end to aim the ends straight. Connect ends turns each row round into the next,
 * out past the edge by a third of a row, as the sketch does.
 *
 * Over the sketch: rows at `squiggleAngle`; with `squiggleLift`, a layer of a photo lifts off where
 * it has nothing to draw - white, another band's tone, another pen's colour (the sketch never lifts;
 * without it every layer's rows run edge to edge, flat there); and `squiggleSmooth` lengthens
 * or shortens the curve's handles, 1 being Processing's.
 */
function squiggle(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sd = squiggleDrawOf(photo);
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // The sketch's own picture: blurred as Processing's filter(BLUR, 2) does, then scaled up.
  const blurred = processingBlurred(photo.src, tones);
  const W2 = Math.max(1, Math.round(tones.w * (c2 - c0) * sd.scale));
  const H2 = Math.max(1, Math.round(tones.h * (c3 - c1) * sd.scale));
  const unit = h / H2; // inches to one of the sketch's pixels
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(blurred, photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));
  const ystep = Math.round(sd.lines);
  const ymult = sd.strength;
  const xstep = 31 - Math.round(sd.detail);
  const xsmooth = 257 - sd.frequency;
  const strokeWidth = Math.max(1, Math.round(sd.lineWidth));
  const minB = sd.black;
  const maxB = sd.white;
  // At least ten waves across the picture, and none tighter than the line is wide.
  const minPhaseIncr = (10 * 2 * Math.PI) / (W2 / xstep);
  const maxPhaseIncr = (2 * Math.PI * xstep) / strokeWidth;
  const HALF_PI = Math.PI / 2;
  const scaledYstep = Math.max(1, Math.floor(H2 / ystep));
  const row = scaledYstep * unit;

  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  type P = { x: number; y: number };
  const inBox = (p: P): P => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) });
  // Where a point of the box is read from: the sketch reads its scaled-up picture's pixel x at the
  // photo's x / scale, pixels counted from their corners - the reading here counts the last pixel as
  // the far edge, so the point is moved out to match. Off by a pixel in three hundred, the phase,
  // added up along a row, drifted.
  const [tw, th] = [tones.w, tones.h];
  const onPixels = (p: P): P => ({
    x: (((c0 + (p.x / w) * (c2 - c0)) * tw) / Math.max(1, tw - 1) - c0) * (w / (c2 - c0)),
    y: (((c1 + (p.y / h) * (c3 - c1)) * th) / Math.max(1, th - 1) - c1) * (h / (c3 - c1)),
  });

  // The stretch of a row inside the box, as distances along it from the middle; null if it misses.
  const span = (o: number): [number, number] | null => {
    let lo = -Infinity;
    let hi = Infinity;
    const clip = (start: number, along: number, max: number) => {
      if (Math.abs(along) < 1e-9) {
        if (start < 0 || start > max) lo = Infinity;
        return;
      }
      const a = (0 - start) / along;
      const b = (max - start) / along;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    };
    clip(cx - dy * o, dx, w);
    clip(cy + dx * o, dy, h);
    return hi - lo > unit * xstep ? [lo, hi] : null;
  };

  // Each run of line: its points, and whether it reaches its row's start and end.
  type Run = { points: P[]; fromStart: boolean; toEnd: boolean };
  const rows: Run[][] = [];
  // Rows from the top edge, a row apart, as the sketch's y = 0, scaledYstep… - turned, as far as they reach.
  const first = -Math.ceil((reach - h / 2) / row);
  for (let k = first; -h / 2 + k * row <= reach; k++) {
    const o = -h / 2 + k * row;
    if (k * scaledYstep >= H2 && Math.abs(dx) > 0.999) break; // the sketch's last row is above the bottom edge
    const s0 = span(o);
    if (!s0) continue;
    const [lo, hi] = s0;
    const length = (hi - lo) / unit; // the row, in the sketch's pixels
    const at = (x: number, swing: number): P => {
      const t = lo + x * unit;
      return { x: cx - dy * o + dx * t - dy * swing * unit, y: cy + dx * o + dy * t + dx * swing * unit };
    };
    // How dark the sketch finds a point: 0 to 255 trimmed to the black and white points; -1 where this layer draws nothing.
    const zAt = (x: number) => {
      const base = onPixels(at(x, 0));
      const tone = toneAt(Math.min(w, Math.max(0, base.x)), Math.min(h, Math.max(0, base.y)));
      if (tone < 0) return -1;
      if (photo.squiggleLift && fromWhite && tone < 0.03) return -1;
      const dark = sd.invert ? 1 - tone : tone;
      // Processing's whole-number blur and scale-up round down: its white reads 254, its 177 176.
      const b = Math.max(minB, Math.floor(255 * (1 - dark) - 0.5));
      return Math.max(maxB - b, 0);
    };

    // The sketch's vertices, each with whether this layer draws there.
    const verts: { x: number; y: number; on: boolean }[] = [];
    let phase = 0;
    let lastPhase = 0;
    let lastAmpl = 0;
    let lastX = 1;
    let x = 1;
    let finalStep = false;
    while (!finalStep) {
      x += xstep;
      finalStep = x + xstep >= length;
      const zRaw = zAt(x);
      const on = zRaw >= 0;
      const z = on ? zRaw : 0;
      const r = (z / ystep) * ymult;
      let df = z / xsmooth;
      if (df < minPhaseIncr) df = minPhaseIncr;
      if (df > maxPhaseIncr) df = maxPhaseIncr;
      phase += df;
      const deltaX = x - lastX;
      const deltaAmpl = r - lastAmpl;
      const deltaPhase = phase - lastPhase;
      if (!finalStep && deltaPhase > HALF_PI) {
        const vertexCount = Math.floor(deltaPhase / HALF_PI);
        const integerPart = (vertexCount * HALF_PI) / deltaPhase;
        const xPerVertex = (deltaX * integerPart) / vertexCount;
        const amplPerVertex = (integerPart * deltaAmpl) / vertexCount;
        for (let i = 0; i < vertexCount; i++) {
          lastX += xPerVertex;
          lastPhase += HALF_PI;
          lastAmpl += amplPerVertex;
          verts.push({ x: lastX, y: Math.round(Math.sin(lastPhase)) * lastAmpl, on });
        }
      }
    }

    // Runs of the vertices this layer draws, each starting and ending on the row's middle - at the
    // row's own ends where they reach them, as the sketch's do, and elsewhere where the tone itself
    // starts and stops, found a step at a time. Vertices are a quarter wave apart, which in pale
    // tones is far: ended at the next one, a run spilled that far into white as a flat tail.
    const runs: Run[] = [];
    let run: Run | null = null;
    // Where the tone starts after `from`, or stops before `to`, a step at a time - the row's own end where it's drawn to.
    const startOn = (from: number, to: number) => { for (let x = from; x < to; x += xstep) if (zAt(x) >= 0) return x; return to; };
    const stopOn = (from: number, to: number) => { for (let x = to; x > from; x -= xstep) if (zAt(x) >= 0) return x; return from; };
    for (let i = 0; i <= verts.length; i++) {
      const v = verts[i];
      if (v?.on) {
        if (!run) {
          const from = startOn(i === 0 ? 0 : verts[i - 1].x, v.x);
          run = { points: [inBox(at(from, 0))], fromStart: from === 0, toEnd: false };
        }
        run.points.push(inBox(at(v.x, v.y)));
        continue;
      }
      if (run) {
        const last = verts[i - 1].x;
        const to = stopOn(last, i === verts.length ? length : v.x);
        run.toEnd = to === length;
        run.points.push(inBox(at(to, 0)));
        runs.push(run);
        run = null;
      }
    }
    if (!verts.length && zAt(length / 2) >= 0) runs.push({ points: [inBox(at(0, 0)), inBox(at(length, 0))], fromStart: true, toEnd: true });
    // Every other row runs back the way the last came: the same curve, drawn from its other end.
    if (rows.length % 2 === 1) {
      runs.reverse();
      for (const r of runs) {
        r.points.reverse();
        [r.fromStart, r.toEnd] = [r.toEnd, r.fromStart];
      }
    }
    rows.push(runs);
  }

  // Each line: its points with an aiming point before and after - a tenth of a step past a row's
  // end, along it; at a break, the end itself. Connected, a row that reaches its end turns round
  // into the next where that starts at its edge, through a point out past the edge by a third of a row.
  const lines: P[][] = [];
  const past = (a: P, b: P, by: number): P => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: b.x + ((b.x - a.x) / len) * by, y: b.y + ((b.y - a.y) / len) * by };
  };
  const tenth = 0.1 * xstep * unit;
  const lead = (r: Run) => (r.fromStart ? [past(r.points[1], r.points[0], tenth)] : [r.points[0]]);
  const tail = (r: Run) => (r.toEnd ? [past(r.points[r.points.length - 2], r.points[r.points.length - 1], tenth)] : [r.points[r.points.length - 1]]);
  let open: P[] | null = null;
  let openRun: Run | null = null;
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].length; i++) {
      const runNow = rows[r][i];
      if (open && openRun && photo.squiggleJoin && i === 0 && runNow.fromStart && openRun.toEnd && rows[r - 1]?.[rows[r - 1].length - 1] === openRun) {
        const end = open[open.length - 1];
        const start = runNow.points[0];
        const [a, b] = [openRun.points[openRun.points.length - 2], end];
        const out = past(a, b, tenth + row / 3);
        open.push({ x: out.x + (start.x - end.x) / 2, y: out.y + (start.y - end.y) / 2 }, ...runNow.points);
        openRun = runNow;
        continue;
      }
      if (open && openRun) lines.push([...open, ...tail(openRun)]);
      open = [...lead(runNow), ...runNow.points];
      openRun = runNow;
    }
  }
  if (open && openRun) lines.push([...open, ...tail(openRun)]);

  // Each line as Processing's curveVertex draws it: a Catmull-Rom spline through all but its first
  // and last points, which only aim it - written as cubics, the handles scaled by the smoothness.
  const k = Math.min(2, Math.max(0, photo.squiggleSmooth ?? 1)) / 6;
  const parts: string[] = [];
  for (const pts of lines) {
    if (pts.length < 4) continue;
    let d = `M${n(pts[1].x)} ${n(pts[1].y)}`;
    for (let i = 1; i < pts.length - 2; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      d += `C${n(p1.x + (p2.x - p0.x) * k)} ${n(p1.y + (p2.y - p0.y) * k)} ${n(p2.x - (p3.x - p1.x) * k)} ${n(p2.y - (p3.y - p1.y) * k)} ${n(p2.x)} ${n(p2.y)}`;
    }
    parts.push(d);
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Outlines ----------

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

function outlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const gw = Math.max(2, Math.round((OUTLINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(2, Math.round((OUTLINE_EDGE * h) / Math.max(w, h)));
  const cell = w / (gw - 1);
  const cellY = h / (gh - 1);
  const count = Math.max(1, Math.min(40, Math.round(photo.contours ?? OUTLINE_DEFAULTS.contours)));
  const { field, levels } = fieldOf(tones, photo, gw, gh, count);
  blurGrid(field, gw, gh, Math.max(0, photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm) / 25.4 / cell);
  // A contour shorter than this is a speck, not a shape.
  const shortest = 2 / 25.4;
  const n = (val: number) => Number(val.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  for (const level of levels) {
    for (const run of contour(field, gw, gh, level)) {
      let length = 0;
      for (let i = 1; i < run.length; i++) length += Math.hypot((run[i][0] - run[i - 1][0]) * cell, (run[i][1] - run[i - 1][1]) * cellY);
      if (length < shortest) continue;
      parts.push(`M${run.map(([gx, gy]) => `${n(gx * cell)} ${n(gy * cellY)}`).join("L")}`);
      strokes++;
    }
  }
  return { passes: [parts.join("")], strokes };
}

// ---------- Centerlines ----------

function edges(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const traced = edgesOn(tones, photo, w, h);
  const marks = centerlines(tones, { ...photo, centerShortestMm: photo.edgeShortestMm ?? EDGE_DEFAULTS.shortestMm, centerMode: photo.centerMode ?? "mixed" }, w, h, traced);
  return { ...marks, widthMm: undefined };
}

/**
 * Line art as centerlines: each dark stroke of the picture drawn once, down its middle, however wide
 * it is - a ring is one circle rather than the two edges of a filled band. The picture is made black
 * and white at `centerFrom`, worn down to lines one point wide, and those are walked into strokes:
 * whiskers off, lines carried straight on through where others cross them, smoothed into curves, and
 * a loop that is a circle drawn as an exact one. Split into bands or colours, each layer traces its
 * own part the same way.
 */
function centerlines(tones: Tones, photo: Photo, w: number, h: number, traced = centerOn(tones, photo, w, h)): PhotoMarks {
  const { gw, gh, cell, cellY, on } = traced;
  const dist = distances(on, gw, gh);
  thin(on, gw, gh);
  const shortest = Math.max(0, photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm) / 25.4 / cell;
  prune(on, gw, gh, dist, Math.max(2, shortest));

  // How wide the picture's lines are: twice the distance to the edge, along their middles.
  const widths: number[] = [];
  for (let i = 0; i < on.length; i++) if (on[i]) widths.push(dist[i] * 2);
  widths.sort((a, b) => a - b);
  const widthMm = widths.length ? widths[Math.floor(widths.length / 2)] * cell * 25.4 : undefined;

  const tips = new Set<number>();
  const runs = joinRuns(joinTips(traceRuns(on, gw, gh), gw, dist, tips), gw);
  const toPoint = (i: number): Point => ({ x: (i % gw) * cell, y: Math.floor(i / gw) * cellY });
  // Curves, straight lines within a tolerance (inches here), or mixed - and, curving, sharp where a
  // line turns more than cornerDeg.
  const mode = centerModeOf(photo);
  const within = Math.max(0.05, photo.centerStraightMm ?? CENTER_DEFAULTS.straightMm) / 25.4;
  const long = Math.max(0.1, photo.centerLongMm ?? CENTER_DEFAULTS.longMm) / 25.4;
  const cornerDeg = mode !== "straight" && photo.centerCornerDeg && photo.centerCornerDeg > 0 ? photo.centerCornerDeg : 0;
  // Turns are read about a millimetre either way, so a pixel's step isn't a corner.
  const reach = Math.max(2, Math.round(1 / 25.4 / cell));
  const strokes: Node[][] = [];
  let circles = 0;
  for (const run of runs) {
    let pts = run.pts.map(toPoint);
    // A tip stays where it is and stays sharp - and so, set to, does a turn sharper than cornerDeg.
    const corners: number[] = [];
    run.pts.forEach((g, i) => { if (tips.has(g)) corners.push(i); });
    if (cornerDeg) for (const i of turnsOver(pts, run.closed, reach, cornerDeg)) if (!corners.includes(i)) corners.push(i);
    corners.sort((a, b) => a - b);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(2, shortest) * cell) continue;
    // Pixel steps smoothed out: each point moved to the average of its neighbours, a few either
    // way. A loop wraps round; an open line keeps its ends where they are, so lines still meet.
    const k = 2;
    const n = pts.length;
    pts = pts.map((p, i) => {
      if (!run.closed && (i < 1 || i > n - 2)) return p;
      if (corners.includes(i)) return p;
      let sx = p.x, sy = p.y, c = 1;
      // Out either way as far as `k`, stopping short of a tip: the straight run into it is a long
      // step, and averaging across it would pull the line out of true.
      for (const way of [-1, 1]) {
        for (let d = 1; d <= k; d++) {
          const j = run.closed ? (i + way * d + n) % n : Math.min(n - 1, Math.max(0, i + way * d));
          if (corners.includes(j)) break;
          sx += pts[j].x;
          sy += pts[j].y;
          c++;
        }
      }
      return { x: sx / c, y: sy / c };
    });
    if (run.closed) {
      const ring = circleOf(pts, cell * 1.2);
      if (ring) {
        // Clockwise on the page (y down) when the area it goes round is positive.
        let area = 0;
        for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y;
        strokes.push(circleNodes(ring, Math.atan2(pts[0].y - ring.cy, pts[0].x - ring.cx), area > 0));
        circles++;
        continue;
      }
      pts.push({ ...pts[0] });
    }
    const fitTol = Math.max(cell, cellY) * FIT_CELLS;
    strokes.push(mode === "straight" ? straightened(pts, within, corners)
      : mode === "mixed" ? mixedLine(pts, within, long, corners, fitTol)
        : fitNodes(pts, fitTol, corners));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length, widthMm, circles };
}

function silhouette(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const { gw, gh, cell, cellY, field } = paintField(tones, photo, w, h);
  const from = Math.min(0.99, Math.max(0.01, photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from));
  const smallest = Math.max(0, photo.silhouetteSmallestMm ?? SILHOUETTE_DEFAULTS.smallestMm) / 25.4;
  const strokes: Node[][] = [];
  for (const run of contour(field, gw, gh, 1 - from)) {
    const pts = run.map(([gx, gy]) => ({ x: gx * cell, y: gy * cellY }));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(smallest, 2 * cell)) continue;
    strokes.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length };
}

function hatch(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
  // Along each line, a look at the photo every half a line-spacing: fine enough that a line stops
  // where the tone does, coarse enough that a big sheet is still quick.
  const step = spacing / 2;
  // Anything shorter than this is a dot, not a line: the pen would only tap the paper. One and a half
  // line spacings, unless the card says otherwise.
  const shortest = photo.hatchShortestMm !== undefined ? photo.hatchShortestMm / 25.4 : spacing * 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  const passes: string[] = [];
  let strokes = 0;
  // A tone band takes the passes whose thresholds fall in its band, measured against the whole photo,
  // rather than running every pass across its own band: the bands together then draw what one layer
  // would, and the darks get the lighter bands' lines as well as their own. Run across its own band,
  // a light band was crosshatched black just under its top edge while the band above it started
  // sparse - the tones turned over at every edge between bands.
  // Split around the paper, each band is a pen of its own - black, a gray - and draws its own region
  // whole, graded across it, rather than taking a share of one ink's passes.
  const band = photo.band && !onePlate(photo) && !photo.ink && !photo.side ? photo.band : null;
  const { toneAt, fromWhite } = toneSampler(tones, band ? { ...photo, band: undefined } : photo, w, h);

  for (let k = 0; k < levels; k++) {
    const threshold = fromWhite ? (k + 1) / (levels + 1) : k / levels;
    if (band && !(threshold >= band[0] && (threshold < band[1] || band[1] >= 1))) {
      passes.push("");
      continue;
    }
    const rad = ((photo.angle + (k % 2 ? 90 : 0) + (k >= 4 ? 45 : 0)) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Lines two spacings apart in each pass; the third and fourth passes fall between the first two's,
    // and the fifth and sixth run on the diagonals.
    const gap = spacing * 2;
    const shift = k === 2 || k === 3 ? spacing : 0;
    const parts: string[] = [];
    let line = 0;
    for (let o = -reach + shift; o <= reach; o += gap, line++) {
      // Every other line runs back the way the last one came, so the pen doesn't travel home between them.
      const back = line % 2 === 1;
      let start: number | null = null;
      let end = 0;
      const close = () => {
        if (start !== null && end - start >= shortest) {
          const a = back ? end : start;
          const b = back ? start : end;
          parts.push(`M${n(cx - dy * o + dx * a)} ${n(cy + dx * o + dy * a)}L${n(cx - dy * o + dx * b)} ${n(cy + dx * o + dy * b)}`);
          strokes++;
        }
        start = null;
      };
      for (let t = -reach; t <= reach; t += step) {
        const x = cx - dy * o + dx * t;
        const y = cy + dx * o + dy * t;
        const tone = toneAt(x, y);
        if (tone >= 0 && (tone > threshold || (!fromWhite && k === 0))) {
          if (start === null) start = t;
          end = t;
        } else {
          close();
        }
      }
      close();
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}


// ---------- Paint ----------

function paint(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const { gw, gh, cell, cellY, labels, mine } = paintRegions(tones, photo, w, h);
  const labelAt = (x: number, y: number) => {
    const gx = Math.round(x / cell);
    const gy = Math.round(y / cellY);
    return gx >= 0 && gx < gw && gy >= 0 && gy < gh ? labels[gy * gw + gx] : -1;
  };
  const isMine = (x: number, y: number) => labelAt(x, y) === mine;
  const outline = photo.paintOutline ?? paintDefaultsOf(photo).outline;
  // The paper's label: the last of a split's colors; a single layer's is 0, and it has no other pen.
  const colour = Boolean(photo.ink && photo.regions && photo.region !== undefined && !photo.key);
  const paper = colour ? photo.regions!.length : 0;
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const step = Math.min(spacing / 2, cell);
  // With no outline to cover the seam, a line that ends at another color's region runs on past the
  // border - half a step to reach it, half a line's width beyond - so the two colors meet with no
  // paper showing between them. Against the paper, or the box's edge, it stops where it is.
  const overrun = step / 2 + spacing / 2;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const rad = (photo.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const n = (v: number) => Number(v.toFixed(4));
  const fill: string[] = [];
  let strokes = 0;
  let line = 0;
  for (let o = -reach; o <= reach; o += spacing, line++) {
    // Every other line runs back the way the last one came, so the pen doesn't travel home between them.
    const back = line % 2 === 1;
    const runs: [number, number][] = [];
    let start: number | null = null;
    let end = 0;
    for (let t = -reach; t <= reach; t += step) {
      if (isMine(cx - dy * o + dx * t, cy + dx * o + dy * t)) {
        if (start === null) start = t;
        end = t;
      } else if (start !== null) {
        runs.push([start, end]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, end]);
    if (back) runs.reverse();
    for (let [a0, b0] of runs) {
      if (b0 - a0 < spacing) continue; // a dab, not a line
      if (!outline) {
        const meets = (t: number) => {
          const k = labelAt(cx - dy * o + dx * t, cy + dx * o + dy * t);
          return k >= 0 && k !== mine && k !== paper;
        };
        if (meets(a0 - step)) a0 -= overrun;
        if (meets(b0 + step)) b0 += overrun;
      }
      const a = back ? b0 : a0;
      const b = back ? a0 : b0;
      fill.push(`M${n(cx - dy * o + dx * a)} ${n(cy + dx * o + dy * a)}L${n(cx - dy * o + dx * b)} ${n(cy + dx * o + dy * b)}`);
      strokes++;
    }
  }
  const passes = [fill.join("")];
  if (outline) {
    // Round each of this layer's regions: where its own area meets anything else, the box's edge included.
    const field = new Float32Array(gw * gh);
    for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) field[gy * gw + gx] = labels[gy * gw + gx] === mine ? 1 : 0;
    const rings: Node[][] = [];
    for (const run of contour(field, gw, gh, 0.5)) {
      const pts = run.map(([gx, gy]) => ({ x: gx * cell, y: gy * cellY }));
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (length < 2 * Math.max(cell, cellY)) continue;
      rings.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS));
    }
    const ordered = shortTravel(rings);
    passes.push(pathData(ordered));
    strokes += ordered.length;
  }
  return { passes, strokes };
}

// ---------- Hilbert curve ----------

/**
 * Tone as a Hilbert curve: one line that fills the picture by folding into itself, square within
 * square, folded finer where it's darker. A square of the curve is as wide as the spacing over the
 * darkness there - the line through it covers the paper in proportion - but never wider than
 * Coarsest, so light areas still meander gently. The tone shows in steps, each fold halving the
 * square: that stepped, mechanical halftone is the look. A picture that isn't square is a row of
 * near-square tiles, each curve ending where the next begins, so it is one line - broken only, if
 * asked, where there's nothing to draw, or where a turned curve runs off the picture and back.
 *
 * Or a Peano curve, which folds each square into nine and runs corner to opposite corner: a woven,
 * back-and-forth texture, with fewer and bigger steps of tone - each three times as dense as the
 * last - so it's at its best blended. Its corners can be rounded; its steps of tone blended, each square
 * folding or not by chance in proportion to how far its tone lies between two steps; and the whole
 * curve turned.
 */
function hilbert(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const coarsest = Math.max(spacing, (photo.hilbertCoarsestMm ?? HILBERT_DEFAULTS.coarsestMm) / 25.4);
  const lift = Boolean(photo.hilbertLift);
  const peano = photo.hilbertCurve === "peano";
  // Each fold divides a square's side by this.
  const split = peano ? 3 : 2;
  const round = Math.min(1, Math.max(0, photo.hilbertRound ?? 0));
  const blend = Math.min(1, Math.max(0, photo.hilbertBlend ?? 0));
  const { toneAt } = toneSampler(tones, photo, w, h, true);

  // The darkness, summed across and down, so any box's average is four look-ups.
  const gw = Math.max(4, Math.round((HILBERT_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(4, Math.round((HILBERT_EDGE * h) / Math.max(w, h)));
  const sum = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let row = 0;
    for (let x = 0; x < gw; x++) {
      const t = toneAt(((x + 0.5) * w) / gw, ((y + 0.5) * h) / gh);
      row += t > 0 ? t : 0;
      sum[(y + 1) * (gw + 1) + x + 1] = sum[y * (gw + 1) + x + 1] + row;
    }
  }
  const at = (x: number, y: number) => sum[y * (gw + 1) + x];
  // The average darkness over the part of a box, in inches, that's on the picture: none if it's all
  // off it. For a box smaller than a grid square, the square it's in.
  const toneOver = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return 0;
    const a = Math.max(0, Math.min(gw - 1, Math.floor((x0 / w) * gw)));
    const b = Math.max(0, Math.min(gh - 1, Math.floor((y0 / h) * gh)));
    const c = Math.max(a + 1, Math.min(gw, Math.ceil((x1 / w) * gw)));
    const d = Math.max(b + 1, Math.min(gh, Math.ceil((y1 / h) * gh)));
    return (at(c, d) - at(a, d) - at(c, b) + at(a, b)) / ((c - a) * (d - b));
  };
  // A number from 0 to 1 that's always the same for the same square, for blending its fold.
  const chance = (x: number, y: number, side: number) => {
    let k = Math.imul(Math.round(x * 4096), 0x27d4eb2d) ^ Math.imul(Math.round(y * 4096), 0x165667b1) ^ Math.imul(Math.round(side * 65536), 0x9e3779b1);
    k = Math.imul(k ^ (k >>> 15), 0x85ebca6b);
    k = Math.imul(k ^ (k >>> 13), 0xc2b2ae35);
    return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
  };

  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let length = 0;
  let piece: number[][] = [];
  const close = () => {
    if (piece.length > 1) {
      // Points in a straight run are one segment: the curve is mostly straight runs.
      const kept = [piece[0]];
      for (let i = 1; i < piece.length - 1; i++) {
        const [ax, ay] = kept[kept.length - 1];
        const [bx, by] = piece[i];
        const [cx, cy] = piece[i + 1];
        if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-10) kept.push(piece[i]);
      }
      kept.push(piece[piece.length - 1]);
      for (let i = 1; i < kept.length; i++) length += Math.hypot(kept[i][0] - kept[i - 1][0], kept[i][1] - kept[i - 1][1]);
      let d = `M${n(kept[0][0])} ${n(kept[0][1])}`;
      if (round > 0) {
        // Rounded: each corner cut back along both its legs, by up to half the shorter, and the gap
        // bridged by a curve with the corner as its handle.
        for (let i = 1; i < kept.length - 1; i++) {
          const [ax, ay] = kept[i - 1];
          const [px, py] = kept[i];
          const [bx, by] = kept[i + 1];
          const la = Math.hypot(px - ax, py - ay);
          const lb = Math.hypot(bx - px, by - py);
          const r = (round * Math.min(la, lb)) / 2;
          d += `L${n(px + ((ax - px) * r) / la)} ${n(py + ((ay - py) * r) / la)}Q${n(px)} ${n(py)} ${n(px + ((bx - px) * r) / lb)} ${n(py + ((by - py) * r) / lb)}`;
        }
        const last = kept[kept.length - 1];
        d += `L${n(last[0])} ${n(last[1])}`;
      } else {
        for (let i = 1; i < kept.length; i++) d += `L${n(kept[i][0])} ${n(kept[i][1])}`;
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  // One square of the curve, at (x0, y0), `i` the way it travels and `j` across: folded into smaller
  // squares, in the curve's order, until it's fine enough for its tone, then a point at its middle.
  const fold = (x0: number, y0: number, ix: number, iy: number, jx: number, jy: number) => {
    const side = Math.max(Math.hypot(ix, iy), Math.hypot(jx, jy));
    const xs = [x0, x0 + ix, x0 + jx, x0 + ix + jx];
    const ys = [y0, y0 + iy, y0 + jy, y0 + iy + jy];
    const tone = toneOver(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    const wanted = tone > 0 ? spacing / tone : Infinity;
    // How many folds short of the size its tone wants this square is, on the curve's own scale: past
    // one half it folds, so each takes the nearest step. Blended, the half-way mark moves square by
    // square, by chance, so between two steps the squares take each in proportion and the bands
    // between steps soften into a mix. The finest step is within a half-step of the spacing.
    const short = Math.log(side / wanted) / Math.log(split);
    const mark = 0.5 + blend * (chance(x0 + (ix + jx) / 2, y0 + (iy + jy) / 2, side) - 0.5);
    if (side / split >= spacing / Math.sqrt(split) && (side > coarsest || short > mark)) {
      if (peano) {
        // Nine squares, column by column along `i`, up the first, down the second, up the third;
        // each turned so it starts where the last ended - mirrored along `i` in the middle row,
        // across `j` in the middle column.
        const [tix, tiy, tjx, tjy] = [ix / 3, iy / 3, jx / 3, jy / 3];
        for (let c = 0; c < 3; c++) {
          for (let k = 0; k < 3; k++) {
            const r = c === 1 ? 2 - k : k;
            const flipI = r === 1;
            const flipJ = c === 1;
            const ox = x0 + c * tix + r * tjx + (flipI ? tix : 0) + (flipJ ? tjx : 0);
            const oy = y0 + c * tiy + r * tjy + (flipI ? tiy : 0) + (flipJ ? tjy : 0);
            fold(ox, oy, flipI ? -tix : tix, flipI ? -tiy : tiy, flipJ ? -tjx : tjx, flipJ ? -tjy : tjy);
          }
        }
      } else {
        const [hix, hiy, hjx, hjy] = [ix / 2, iy / 2, jx / 2, jy / 2];
        fold(x0, y0, hjx, hjy, hix, hiy);
        fold(x0 + hjx, y0 + hjy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + hix, y0 + hjy + hiy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + ix, y0 + hjy + iy, -hjx, -hjy, -hix, -hiy);
      }
      return;
    }
    const cx = x0 + (ix + jx) / 2;
    const cy = y0 + (iy + jy) / 2;
    // Off the picture - a turned curve's corners - or, lifting, nothing to draw: the pen comes up.
    if (cx < 0 || cx > w || cy < 0 || cy > h || (lift && tone <= 0.01)) {
      close();
      return;
    }
    piece.push([cx, cy]);
  };
  // The curve turned: worked out on axes `u` and `v` at its angle, over the box that holds the
  // picture at that angle. A row of tiles along that box's long side, as many as divide it into
  // near-squares, so it's covered exactly. A Hilbert tile runs from its first corner along `i` to
  // the next tile's first corner; a Peano tile runs to its opposite corner, so every other one is
  // flipped across to start there.
  const rad = ((photo.hilbertAngle ?? 0) * Math.PI) / 180;
  const [ux, uy] = [Math.cos(rad), Math.sin(rad)];
  const [vx, vy] = [-uy, ux];
  const us = [0, w * ux, h * uy, w * ux + h * uy];
  const vs = [0, w * vx, h * vy, w * vx + h * vy];
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const lu = u1 - u0;
  const lv = v1 - v0;
  const across = lu >= lv;
  const count = Math.max(1, Math.ceil(Math.max(lu, lv) / Math.min(lu, lv) - 1e-9));
  const along = Math.max(lu, lv) / count;
  // A point on the page from its place on the turned axes.
  const page = (u: number, v: number) => [u * ux + v * vx, u * uy + v * vy];
  for (let k = 0; k < count; k++) {
    const flip = peano && k % 2 === 1;
    if (across) {
      const [ox, oy] = page(u0 + k * along, flip ? v1 : v0);
      fold(ox, oy, along * ux, along * uy, (flip ? -lv : lv) * vx, (flip ? -lv : lv) * vy);
    } else {
      const [ox, oy] = page(flip ? u1 : u0, v0 + k * along);
      fold(ox, oy, along * vx, along * vy, (flip ? -lu : lu) * ux, (flip ? -lu : lu) * uy);
    }
  }
  close();
  return { passes: [parts.join("")], strokes, lengthMm: length * 25.4 };
}

// ---------- One line ----------

/**
 * Tone as one line: the photo stippled - dots scattered thicker where it's darker, then spread evenly
 * (Secord's weighted Voronoi stippling) - and the dots joined by the shortest route that visits each
 * once (a travelling salesman's tour), so the pen goes down once and draws the whole picture. Where
 * the dots are thick the line winds tightly and reads dark; where they're sparse it runs in long
 * strokes and reads light. Lifting over long jumps, if asked, leaves white as paper.
 */
function oneLine(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const count = Math.round(Math.min(ONE_LINE_MOST, Math.max(50, photo.lineDots ?? ONE_LINE_DEFAULTS.dots)));
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  // The grid the dots are spread on: fine enough that each dot's cell is a few squares across.
  const gw = Math.max(8, Math.round((ONE_LINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(8, Math.round((ONE_LINE_EDGE * h) / Math.max(w, h)));
  const sx = w / gw;
  const sy = h / gh;
  // How many dots each square wants. The line's ink goes as the square root of how thick the dots
  // are - twice the dots, about 1.4 times the line - so squared, the ink follows the tone: that's
  // Contrast at its middle. Less spreads the dots into the lights, for detail there; more crowds
  // them into the darks, for a punchier picture.
  const power = 0.5 + 3 * Math.min(1, Math.max(0, photo.lineContrast ?? 0.5));
  const want = new Float32Array(gw * gh);
  let total = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = toneAt((x + 0.5) * sx, (y + 0.5) * sy);
      const d = t > 0 ? t ** power : 0;
      want[y * gw + x] = d;
      total += d;
    }
  }
  if (total <= 0) return { passes: [""], strokes: 0 };

  // The same scatter every time, so a changed number doesn't reshuffle the whole picture.
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // First scatter: each dot in a square picked as often as it wants dots, somewhere inside it.
  const cumulative = new Float64Array(want.length);
  let run = 0;
  for (let i = 0; i < want.length; i++) cumulative[i] = run += want[i];
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const r = random() * run;
    let lo = 0;
    let hi = want.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    px[k] = (lo % gw) + random();
    py[k] = Math.floor(lo / gw) + random();
  }

  // Then spread them evenly: each dot moved to the weighted middle of the squares nearest it (Lloyd's
  // relaxation), so they sit apart like stipple rather than clumping like grain.
  const cell = Math.max(1, Math.sqrt((gw * gh) / count));
  const bw = Math.ceil(gw / cell) + 1;
  const bh = Math.ceil(gh / cell) + 1;
  const head = new Int32Array(bw * bh);
  const next = new Int32Array(count);
  const file = () => {
    head.fill(-1);
    for (let k = 0; k < count; k++) {
      const b = Math.min(bh - 1, Math.floor(py[k] / cell)) * bw + Math.min(bw - 1, Math.floor(px[k] / cell));
      next[k] = head[b];
      head[b] = k;
    }
  };
  // The dot nearest a point: the squares round it in widening rings until no nearer can be found.
  const nearest = (x: number, y: number) => {
    const bx = Math.min(bw - 1, Math.floor(x / cell));
    const by = Math.min(bh - 1, Math.floor(y / cell));
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring < Math.max(bw, bh); ring++) {
      if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestD)) break;
      for (let cy = by - ring; cy <= by + ring; cy++) {
        if (cy < 0 || cy >= bh) continue;
        for (let cx = bx - ring; cx <= bx + ring; cx++) {
          if (cx < 0 || cx >= bw || (Math.abs(cx - bx) !== ring && Math.abs(cy - by) !== ring)) continue;
          for (let k = head[cy * bw + cx]; k >= 0; k = next[k]) {
            const d = (px[k] - x) ** 2 + (py[k] - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
    }
    return best;
  };
  const mx = new Float64Array(count);
  const my = new Float64Array(count);
  const mw = new Float64Array(count);
  // Grain: fewer spreads, and the dots keep more of their first scatter's clumps and gaps.
  const spreads = Math.round(ONE_LINE_SPREAD * (1 - Math.min(1, Math.max(0, photo.lineGrain ?? 0))));
  for (let pass = 0; pass < spreads; pass++) {
    file();
    mx.fill(0);
    my.fill(0);
    mw.fill(0);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const d = want[y * gw + x];
        if (d <= 0) continue;
        const k = nearest(x + 0.5, y + 0.5);
        mx[k] += d * (x + 0.5);
        my[k] += d * (y + 0.5);
        mw[k] += d;
      }
    }
    for (let k = 0; k < count; k++) {
      if (mw[k] > 0) {
        px[k] = mx[k] / mw[k];
        py[k] = my[k] / mw[k];
      }
    }
  }
  // Into inches on the page.
  for (let k = 0; k < count; k++) {
    px[k] *= sx;
    py[k] *= sy;
  }

  // Direction: the route is planned with the page stretched across the way the line should run, so
  // a step across costs more than a step along and the line runs in streaks that way. At full
  // strength a step across costs four times as much.
  const bias = Math.min(1, Math.max(0, photo.lineBias ?? 0));
  let order: Int32Array;
  if (bias > 0) {
    const rad = ((photo.lineAngle ?? 0) * Math.PI) / 180;
    const [c, sn] = [Math.cos(rad), Math.sin(rad)];
    const stretch = 1 + 3 * bias;
    const tx = new Float64Array(count);
    const ty = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      tx[k] = px[k] * c + py[k] * sn;
      ty[k] = (-px[k] * sn + py[k] * c) * stretch;
    }
    order = tour(tx, ty);
  } else {
    order = tour(px, py);
  }
  // The tour is a loop; the line is the loop opened at its longest jump, so that one is never drawn.
  const dist = (a: number, b: number) => Math.hypot(px[a] - px[b], py[a] - py[b]);
  let cut = 0;
  for (let i = 0; i < count; i++) if (dist(order[i], order[(i + 1) % count]) > dist(order[cut], order[(cut + 1) % count])) cut = i;
  const line = Array.from({ length: count }, (_, i) => order[(cut + 1 + i) % count]);
  // Lifting over jumps longer than asked, so white is left as paper. Absent or 0, one unbroken line.
  const lift = (photo.lineLiftMm ?? 0) / 25.4;
  // Curviness: each step a curve through the dots, its handles along the line from the dot before to
  // the dot after (Catmull-Rom), as long as asked - at 1, the usual sixth of that; past it they
  // overshoot into loops, up to 2. 0, straight.
  const curve = Math.min(2, Math.max(0, photo.lineCurve ?? 0));
  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let piece: number[] = [];
  let length = 0;
  const close = () => {
    if (piece.length > 1) {
      const at = (i: number) => piece[Math.max(0, Math.min(piece.length - 1, i))];
      let d = `M${n(px[piece[0]])} ${n(py[piece[0]])}`;
      for (let i = 1; i < piece.length; i++) {
        const [a, b, c, e] = [at(i - 2), at(i - 1), at(i), at(i + 1)];
        if (curve > 0) {
          const k = curve / 6;
          d += `C${n(px[b] + (px[c] - px[a]) * k)} ${n(py[b] + (py[c] - py[a]) * k)} ${n(px[c] - (px[e] - px[b]) * k)} ${n(py[c] - (py[e] - py[b]) * k)} ${n(px[c])} ${n(py[c])}`;
        } else {
          d += `L${n(px[c])} ${n(py[c])}`;
        }
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const jump = dist(line[i - 1], line[i]);
      if (lift > 0 && jump > lift) close();
      else length += jump;
    }
    piece.push(line[i]);
  }
  close();
  return { passes: [parts.join("")], strokes, dots: count, lengthMm: length * 25.4 };
}

function scribble(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const longest = Math.max(2, photo.scribbleLengthMm ?? SCRIBBLE_DEFAULTS.lengthMm) / 25.4;
  const shortest = Math.min(longest, Math.max(0, photo.scribbleMinMm ?? SCRIBBLE_DEFAULTS.minMm) / 25.4);
  const wiggle = Math.min(100, Math.max(0, photo.scribbleWiggle ?? SCRIBBLE_DEFAULTS.wiggle)) / 100;
  // Straight runs this long between corners: the stroke wanders as before, but its pen keeps a straight
  // line and takes the turn it has gathered all at once at the corner. 0, every step turns: smooth.
  const segment = Math.max(0, photo.scribbleSegmentMm ?? SCRIBBLE_DEFAULTS.segmentMm) / 25.4;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const n = (v: number) => Number(v.toFixed(4));
  // Random, from the seed and the layer: the same scribble every time it's worked out.
  let state = (photo.scribbleSeed ?? SCRIBBLE_DEFAULTS.seed) * 0x9e3779b1;
  for (const ch of layerOf(photo)) state = Math.imul(state ^ ch.charCodeAt(0), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  // The ink grid: each cell's ink wanted and laid, in spacings' worth of line across it.
  const cell = Math.max(spacing * 2, 1 / 25.4);
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const MOST = 3; // -ln(1 - 0.95): past that, random lines add little the eye sees
  const want = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = toneAt(Math.min(w, (c + 0.5) * cell), Math.min(h, (r + 0.5) * cell));
      want[r * cols + c] = t > 0 ? Math.min(MOST, -Math.log(1 - Math.min(0.999, t))) : 0;
    }
  }
  const laid = new Float32Array(cols * rows);
  const cellAt = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const need = (x: number, y: number) => (x < 0 || x > w || y < 0 || y > h ? -1 : want[cellAt(x, y)] - laid[cellAt(x, y)]);
  // A step of line `step` long, in spacings' worth across its cell.
  const step = Math.max(spacing, 0.4 / 25.4);
  const inkPerStep = (step * spacing) / (cell * cell);

  // How tightly it curls: about 30 mm across just above 0, 1 mm at 100 - and at 0, not at all: straight
  // lines, which don't lean toward the ink either. The turn wanders at random about
  // nothing, steadied each step, so it bends one way for a while and then the other.
  const curl = wiggle > 0 ? 1 / (30 / 25.4 * (1 / 30) ** wiggle) : 0;
  const steady = 0.85;
  const jolt = curl * Math.sqrt(1 - steady * steady);
  const look = Math.max(spacing * 3, 1.5 / 25.4);
  const slack = spacing * 4; // how far a stroke may run through what has enough before it stops

  const drawn: number[][][] = [];
  let misses = 0;
  const tries = 4000;
  for (let guard = 0; misses < tries && guard < 400000; guard++) {
    const sx = random() * w;
    const sy = random() * h;
    const wanted = need(sx, sy);
    if (wanted <= 0.05 || random() * MOST > wanted) {
      misses++;
      continue;
    }
    const missed = misses;
    misses = 0;
    let x = sx;
    let y = sy;
    let heading = random() * Math.PI * 2;
    let turn = gauss() * curl;
    let going = heading; // the way the pen is drawing: the wander's heading, caught up at each corner
    let run = 0; // drawn since the last corner
    const pts: number[][] = [[x, y]];
    const inked: number[] = []; // the cell each step laid its ink in, to take back if it's left out
    let length = 0;
    let idle = 0;
    while (length < longest) {
      // Lean toward the side that wants more ink, a little ahead.
      const toLeft = need(x + Math.cos(heading - 0.6) * look, y + Math.sin(heading - 0.6) * look);
      const toRight = need(x + Math.cos(heading + 0.6) * look, y + Math.sin(heading + 0.6) * look);
      turn = turn * steady + gauss() * jolt + Math.sign(toRight - toLeft) * Math.min(1, Math.abs(toRight - toLeft)) * curl * 0.5;
      heading += turn * step;
      if (run >= segment) [going, run] = [heading, 0];
      run += step;
      const nx = x + Math.cos(going) * step;
      const ny = y + Math.sin(going) * step;
      const here = need(nx, ny);
      if (here < -0.5) break; // off the box, or outside the picture
      idle = here > 0 ? 0 : idle + step;
      if (idle > slack) break;
      const at = cellAt(nx, ny);
      laid[at] += inkPerStep;
      inked.push(at);
      x = nx;
      y = ny;
      pts.push([x, y]);
      length += step;
    }
    // Trailing steps through what had enough are taken back off.
    while (idle > 0 && pts.length > 1) {
      pts.pop();
      idle -= step;
    }
    // Too short once trimmed: left out, its ink given back, and counted as a miss so a spot only
    // that short a stroke fits doesn't keep the tries going.
    if (shortest > 0 && (pts.length - 1) * step < shortest) {
      for (const at of inked) laid[at] -= inkPerStep;
      misses = missed + 1;
      continue;
    }
    // A straight stroke needs only its ends.
    if (length >= spacing * 2 && pts.length > 2) drawn.push(curl ? pts : [pts[0], pts[pts.length - 1]]);
  }

  // Drawn nearest first, each from whichever end is nearer the pen, so it doesn't cross the page between them.
  const parts: string[] = [];
  const left = new Set(drawn.map((_, i) => i));
  let px = 0;
  let py = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (const i of left) {
      const a = drawn[i][0];
      const b = drawn[i][drawn[i].length - 1];
      const da = (a[0] - px) ** 2 + (a[1] - py) ** 2;
      const db = (b[0] - px) ** 2 + (b[1] - py) ** 2;
      if (da < bestD) [best, bestD, flip] = [i, da, false];
      if (db < bestD) [best, bestD, flip] = [i, db, true];
    }
    left.delete(best);
    const run = flip ? [...drawn[best]].reverse() : drawn[best];
    const kept = simplified(run, 0.02 / 25.4);
    parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
    [px, py] = run[run.length - 1];
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Sketch lines ----------

/**
 * Tone as DrawingBotV3's Sketch Lines (its open-source core, AbstractSketchPFM and PFMSketchLinesBasic):
 * the picture read as a grid of pixels, 0 black to 255 white, each a Pixel size across. A squiggle
 * starts at the darkest pixel of the darkest 10-pixel tile. From where the pen is, it tries Angle
 * Tests straight lines (a random length from Line Min to Line Max, at angles spread round Drawing
 * Delta Angle from a random start between the Start Angles) and takes the darkest - the point along
 * any of them where the line so far is darkest on average. That line is drawn, the pixels under it
 * lightened by between Erase Min and Erase Max (more where it's already lighter, curved by Tone), and
 * the pen goes on from its end. Past Squiggle Min Length lines, the squiggle ends when its next line
 * would be lighter than where it started by more than Squiggle Max Deviation, or than the picture's
 * average; at Squiggle Max Length it ends regardless. It all stops once the picture has been
 * lightened Line Density of the way to white, or Line Max Limit lines are drawn. Shading, once that far
 * through, tries just two angles, Shading Delta Angle apart. Edges (ours, not DrawingBot's) darkens
 * where the tone changes sharply first, so lines gather along them. Not lifting the pen, one unbroken line:
 * each squiggle joined to the next. Random, but the same for the same seed and layer.
 */
function sketchLines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sk = sketchLinesOf(photo);
  const [minLen, maxLen] = sk.lineMin <= sk.lineMax ? [sk.lineMin, sk.lineMax] : [sk.lineMax, sk.lineMin];
  const [sqMin, sqMax] = sk.squiggleMin <= sk.squiggleMax ? [sk.squiggleMin, sk.squiggleMax] : [sk.squiggleMax, sk.squiggleMin];
  const [eraseMin, eraseMax] = sk.eraseMin <= sk.eraseMax ? [sk.eraseMin, sk.eraseMax] : [sk.eraseMax, sk.eraseMin];
  const density = sk.lineDensity / 100;
  const deviation = sk.squiggleDeviation / 100;
  const tone = sk.tone / 100;
  const DESIRED = 253.5;

  // The pixels: a Pixel size each, a few million at most.
  let px = Math.max(0.05, photo.spacingMm) / 25.4;
  if ((w / px) * (h / px) > 3e6) px = Math.sqrt((w * h) / 3e6);
  const cols = Math.max(1, Math.round(w / px));
  const rows = Math.max(1, Math.round(h / px));
  const sx = w / cols;
  const sy = h / rows;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const lum = new Float64Array(cols * rows);
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = toneAt((c + 0.5) * sx, (r + 0.5) * sy);
      const v = t > 0 ? Math.round(255 * (1 - Math.min(1, t))) : 255;
      lum[r * cols + c] = v;
      sum += v;
    }
  }
  // Edges: where the tone changes sharply - by Sobel, over the pixels smoothed a little so grain
  // doesn't count - darkened, both sides of the edge, so the lines gather and run along them.
  if (sk.edges > 0) {
    const soft = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let s = 0;
      let k = 0;
      for (let y = Math.max(0, r - 1); y <= Math.min(rows - 1, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(cols - 1, c + 1); x++) { s += lum[y * cols + x]; k++; }
      soft[r * cols + c] = s / k;
    }
    const at = (x: number, y: number) => soft[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
    const strength = sk.edges / 100;
    sum = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const gx = at(c + 1, r - 1) + 2 * at(c + 1, r) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c - 1, r) - at(c - 1, r + 1);
      const gy = at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c, r - 1) - at(c + 1, r - 1);
      // A step from black to white is 1020; half that counts as a full edge.
      const edge = Math.min(1, Math.hypot(gx, gy) / 510);
      const i = r * cols + c;
      lum[i] = Math.max(0, Math.round(lum[i] - strength * 255 * edge));
      sum += lum[i];
    }
  }
  const total = cols * rows;
  const initial = sum / total;
  if (density <= 0 || initial >= DESIRED) return { passes: [], strokes: 0 };

  // Tiles keeping their darkness, to find the darkest part fast.
  const tw = Math.max(10, Math.floor(cols / 200));
  const th = Math.max(10, Math.floor(rows / 200));
  const tCols = Math.ceil(cols / tw);
  const tRows = Math.ceil(rows / th);
  const tileSum = new Float64Array(tCols * tRows);
  const tileCount = new Int32Array(tCols * tRows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = Math.floor(r / th) * tCols + Math.floor(c / tw);
    tileSum[t] += lum[r * cols + c];
    tileCount[t]++;
  }
  const setLum = (i: number, v: number) => {
    const c = i % cols;
    const r = (i - c) / cols;
    const d = v - lum[i];
    lum[i] = v;
    sum += d;
    tileSum[Math.floor(r / th) * tCols + Math.floor(c / tw)] += d;
  };
  const darkest = (): [number, number] => {
    let best = -1;
    let bestV = Infinity;
    for (let t = 0; t < tileSum.length; t++) {
      if (!tileCount[t]) continue;
      const v = Math.floor(tileSum[t] / tileCount[t]);
      if (best === -1 || v < bestV) [best, bestV] = [t, v];
    }
    const tx = (best % tCols) * tw;
    const ty = Math.floor(best / tCols) * th;
    let bx = tx;
    let by = ty;
    let bl = Infinity;
    for (let x = tx; x < Math.min(cols, tx + tw); x++) for (let y = ty; y < Math.min(rows, ty + th); y++) {
      if (lum[y * cols + x] < bl) [bx, by, bl] = [x, y, lum[y * cols + x]];
    }
    return [bx, by];
  };

  // Random, from the seed and the layer.
  let state = (sk.seed + 1) * 0x9e3779b1;
  for (const ch of layerOf(photo)) state = Math.imul(state ^ ch.charCodeAt(0), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomInt = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));

  // Each pixel of a line, Bresenham's way, from its start.
  const plotLine = (x0: number, y0: number, x1: number, y1: number, each: (x: number, y: number) => void) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      each(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += stepX; }
      if (e2 <= dx) { err += dx; y0 += stepY; }
    }
  };
  // The ring of pixels a radius out, for unlimited tests all round.
  const circle = (r: number) => {
    const out: [number, number][] = [];
    let x = -r;
    let y = 0;
    let err = 2 - 2 * r;
    do {
      out.push([-x, y], [-y, -x], [x, -y], [y, x]);
      const rr = err;
      if (rr <= y) err += ++y * 2 + 1;
      if (rr > x || err > y) err += ++x * 2 + 1;
    } while (x < 0);
    return out;
  };

  // The darkest line from a point: where it ends, and how light it is on average; -1, none.
  const findDarkestLine = (x0: number, y0: number, length: number, startAngle: number, delta: number, shadingNow: boolean): [number, number, number] => {
    let best = -1;
    let bx = x0;
    let by = y0;
    const tests = sk.unlimitedTests ? -1 : sk.angleTests;
    const ends: [number, number][] = [];
    const ring = delta === 360 && !shadingNow ? circle(length) : null;
    if (ring && (tests === -1 || ring.length <= tests)) {
      for (const [ex, ey] of ring) ends.push([x0 + ex, y0 + ey]);
    } else {
      const n = shadingNow ? 2 : Math.max(1, tests === -1 ? Math.ceil(2 * Math.PI * length) : tests);
      const step = shadingNow ? delta : delta / n;
      for (let d = 0; d < n; d++) {
        const a = ((step * d + startAngle) * Math.PI) / 180;
        ends.push([Math.trunc(Math.cos(a) * length) + x0, Math.trunc(Math.sin(a) * length) + y0]);
      }
    }
    for (const [ex, ey] of ends) {
      // Straight across or down is a touch lighter, as DrawingBot has it, against grid-like marks in solid black.
      let s = x0 === ex || y0 === ey ? 1 : 0;
      let count = 0;
      let lx = x0;
      let ly = y0;
      plotLine(x0, y0, ex, ey, (x, y) => {
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
          // Off the picture: the line so far, if nothing's been found yet.
          if (best === -1 && count > minLen) [bx, by, best] = [lx, ly, s / count];
          return;
        }
        s += lum[y * cols + x];
        count++;
        [lx, ly] = [x, y];
        const avg = s / count;
        if ((best === -1 || avg < best) && count > minLen) [bx, by, best] = [x, y, avg];
      });
    }
    return [bx, by, best];
  };

  // A line drawn: the pixels under it lightened, more where it starts lighter.
  const erase = (x0: number, y0: number, x1: number, y1: number) => {
    const start = x0 >= 0 && y0 >= 0 && x0 < cols && y0 < rows ? lum[y0 * cols + x0] : 255;
    const xp = start / 255;
    const yp = xp ** 3 * tone + xp * (1 - tone);
    const amount = Math.trunc(eraseMin + yp * (eraseMax - eraseMin));
    plotLine(x0, y0, x1, y1, (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = y * cols + x;
      setLum(i, Math.min(255, lum[i] + amount));
    });
  };

  let lines = 0;
  let lumProgress = 0;
  const done = () => {
    const avg = sum / total;
    const lineProgress = sk.lineLimit === -1 ? 0 : lines / Math.max(1, sk.lineLimit);
    lumProgress = avg >= DESIRED ? 1 : (avg - initial) / ((DESIRED - initial) * density);
    return Math.max(lineProgress, lumProgress) >= 1;
  };

  const squiggles: number[][][] = [];
  let pts: number[][] | null = null; // not lifting, the one line
  let cur: [number, number] = [0, 0];
  let fails = 0;
  let count = 0;
  const MOST_LINES = 2e6;
  outer: while (!done() && lines < MOST_LINES) {
    const last = cur;
    cur = darkest();
    let run: number[][];
    if (!sk.liftPen && pts) {
      // DrawingBot joins only when both x and y have changed.
      if (count > 0 && last[0] !== cur[0] && last[1] !== cur[1]) {
        erase(last[0], last[1], cur[0], cur[1]);
        lines++;
      }
      pts.push(cur);
      run = pts;
    } else {
      run = [cur];
      if (!sk.liftPen) pts = run;
    }
    const startDark = lum[cur[1] * cols + cur[0]];
    const allowable = sk.liftPen ? startDark + Math.max(1, DESIRED * deviation) : DESIRED;
    let failed = false;
    for (let s = 0; !sk.liftPen || s < sqMax; s++) {
      const shadingNow = sk.shading && sk.shadingThreshold / 100 < lumProgress;
      const delta = shadingNow ? sk.shadingDeltaAngle : sk.deltaAngle;
      const startAngle = sk.startAngleMin + random() * (sk.startAngleMax - sk.startAngleMin);
      const length = randomInt(minLen, maxLen);
      const [dx, dy, avg] = findDarkestLine(cur[0], cur[1], length, startAngle, delta, shadingNow);
      if (avg === -1) { failed = true; break; }
      if (sk.liftPen && s >= sqMin && (avg > allowable || avg > sum / total)) break;
      if (!sk.liftPen && avg > allowable) { failed = true; break; }
      erase(cur[0], cur[1], dx, dy);
      lines++;
      cur = [dx, dy];
      run.push(cur);
      if (done() || lines >= MOST_LINES) {
        if (sk.liftPen && run.length > 1) squiggles.push(run);
        break outer;
      }
    }
    count++;
    if (sk.liftPen && run.length > 1) squiggles.push(run);
    if (failed) {
      // Nowhere to go from here: it's taken as drawn.
      setLum(cur[1] * cols + cur[0], 255);
      if (++fails >= 1000) break;
    } else fails = 0;
  }
  if (pts && pts.length > 1) squiggles.push(pts);

  // Pixel centres to the box, in inches; squiggles drawn nearest first, each from its nearer end.
  const n = (v: number) => Number(v.toFixed(4));
  const toBox = (run: number[][]) => run.map(([x, y]) => [(x + 0.5) * sx, (y + 0.5) * sy]);
  const parts: string[] = [];
  const left = new Set(squiggles.map((_, i) => i));
  let qx = 0;
  let qy = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (const i of left) {
      const a = squiggles[i][0];
      const b = squiggles[i][squiggles[i].length - 1];
      const da = (a[0] - qx) ** 2 + (a[1] - qy) ** 2;
      const db = (b[0] - qx) ** 2 + (b[1] - qy) ** 2;
      if (da < bestD) [best, bestD, flip] = [i, da, false];
      if (db < bestD) [best, bestD, flip] = [i, db, true];
    }
    left.delete(best);
    const run = flip ? [...squiggles[best]].reverse() : squiggles[best];
    [qx, qy] = run[run.length - 1];
    const kept = simplified(toBox(run), 0.01 / 25.4);
    parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Streamlines ----------

/**
 * Tone as streamlines, after Jobard and Lefer: lines that flow along the picture's own shapes - round
 * a cheek, down a fold - rather than straight across it, closer together where it's darker. Each line
 * runs on until it comes within half its spacing of another, then stops; the next starts its spacing
 * away from one already drawn, so they lie evenly, the way an engraver's do. Where the picture has no
 * shape to follow - sky, a flat wall - they settle to the layer's angle. A second pass runs across the
 * first for the deepest darks; a third, on the diagonal between them, for the darkest third.
 */
function streamlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const widest = Math.max(spacing, (photo.streamWidestMm ?? STREAM_DEFAULTS.widestMm) / 25.4);
  const passCount = Math.min(3, Math.max(1, Math.round(photo.streamPasses ?? STREAM_DEFAULTS.passes)));
  // One look at the photo every half a spacing along a line: close enough that a neighbour can't slip
  // between two of them unseen.
  const step = spacing / 2;
  const shortest = Math.max(1 / 25.4, spacing * 4);
  // A band draws where the photo's tone is its own, at the whole photo's darkness, so bands together
  // draw what one layer would.
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const field = flowField(tones, photo, w, h);
  const n = (v: number) => Number(v.toFixed(4));

  // Every point drawn so far, filed by where it is, so the nearest are quick to find. Each grid square
  // keeps its last point; each point the one filed there before it.
  const cell = Math.max(spacing * 2, 0.4 / 25.4);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const head = new Int32Array(cols * rows).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const lineOf: number[] = [];
  const indexOf: number[] = [];
  const next: number[] = [];
  const cellOf = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const file = (x: number, y: number, line: number, index: number) => {
    const c = cellOf(x, y);
    xs.push(x);
    ys.push(y);
    lineOf.push(line);
    indexOf.push(index);
    next.push(head[c]);
    head[c] = xs.length - 1;
  };
  // Whether anything already drawn is nearer than `r` - leaving out this line's own points close along it.
  const crowded = (x: number, y: number, r: number, line = -1, index = 0, ownGap = 0) => {
    const r2 = r * r;
    const cx0 = Math.max(0, Math.floor((x - r) / cell));
    const cx1 = Math.min(cols - 1, Math.floor((x + r) / cell));
    const cy0 = Math.max(0, Math.floor((y - r) / cell));
    const cy1 = Math.min(rows - 1, Math.floor((y + r) / cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let i = head[cy * cols + cx]; i >= 0; i = next[i]) {
          if (lineOf[i] === line && Math.abs(indexOf[i] - index) <= ownGap) continue;
          const ddx = xs[i] - x;
          const ddy = ys[i] - y;
          if (ddx * ddx + ddy * ddy < r2) return true;
        }
      }
    }
    return false;
  };

  const passes: string[] = [];
  let strokes = 0;
  let lineCount = 0;
  for (let k = 0; k < passCount; k++) {
    // Each pass keeps its spacing from its own lines only: the second runs across the first.
    head.fill(-1);
    xs.length = ys.length = lineOf.length = indexOf.length = next.length = 0;
    // Each pass draws its share of the darkness: with two, the first fills in to the middle tones and
    // the second, across it, from there to black; with three, a third each, the last on the diagonal. The spacing is the closest spacing over that share,
    // so the ink laid down follows the tone; past the widest, it's paper.
    const sepAt = (x: number, y: number) => {
      const t = toneAt(x, y);
      if (t < 0) return Infinity;
      const share = Math.min(1, Math.max(0, t * passCount - k));
      const sep = share > 0 ? spacing / share : Infinity;
      return sep <= widest ? sep : Infinity;
    };
    // How far each pass is turned from the flow: along it, across it, then between the two.
    const turnDeg = [0, 90, 45][k];
    const tc = Math.cos((turnDeg * Math.PI) / 180);
    const ts = Math.sin((turnDeg * Math.PI) / 180);
    const turned = ([ux, uy]: [number, number] | number[]): [number, number] => (turnDeg ? [ux * tc - uy * ts, ux * ts + uy * tc] : [ux, uy]);
    const dirAt = (x: number, y: number, fx: number, fy: number): [number, number] => {
      const [ux, uy] = turned(field(x, y));
      return ux * fx + uy * fy < 0 ? [-ux, -uy] : [ux, uy];
    };
    // A line from a seed, both ways, stopping at the edge, in paper, or near another line. Its points
    // are filed as it goes, so it can't run back into itself; if it comes out too short to keep, they
    // are taken out again - the last filed in each square, so the list stays whole.
    const grow = (sx: number, sy: number): number[][] | null => {
      const line = lineCount;
      const start = turned(field(sx, sy));
      const halves: number[][][] = [];
      let length = 0;
      file(sx, sy, line, 0);
      const filed: number[] = [xs.length - 1];
      for (const sign of [1, -1]) {
        const half: number[][] = [];
        let x = sx;
        let y = sy;
        let fx = start[0] * sign;
        let fy = start[1] * sign;
        for (let i = 1; i < 20000; i++) {
          const [ax, ay] = dirAt(x, y, fx, fy);
          const [bx, by] = dirAt(x + (ax * step) / 2, y + (ay * step) / 2, ax, ay);
          const nx = x + bx * step;
          const ny = y + by * step;
          if (nx < 0 || nx > w || ny < 0 || ny > h) break;
          const sep = sepAt(nx, ny);
          if (!Number.isFinite(sep)) break;
          const index = i * sign;
          if (crowded(nx, ny, sep / 2, line, index, Math.ceil((sep * 1.5) / step))) break;
          file(nx, ny, line, index);
          filed.push(xs.length - 1);
          half.push([nx, ny]);
          length += step;
          x = nx;
          y = ny;
          fx = bx;
          fy = by;
        }
        halves.push(half);
      }
      if (length < shortest) {
        for (let j = filed.length - 1; j >= 0; j--) {
          const i = filed[j];
          head[cellOf(xs[i], ys[i])] = next[i];
        }
        xs.length = ys.length = lineOf.length = indexOf.length = next.length = filed[0];
        return null;
      }
      lineCount++;
      return [...halves[1].reverse(), [sx, sy], ...halves[0]];
    };
    // A seed is good where there's something to draw and nothing already within its spacing.
    const seedable = (x: number, y: number) => {
      if (x < 0 || x > w || y < 0 || y > h) return false;
      const sep = sepAt(x, y);
      return Number.isFinite(sep) && !crowded(x, y, sep);
    };

    const drawn: number[][][] = [];
    // Each line kept seeds its neighbours, a spacing away either side, and they theirs, until the
    // area fills; then the search across the photo finds the next area that hasn't been reached.
    const spread = (first: number[][]) => {
      const queue = [first];
      drawn.push(first);
      for (let q = 0; q < queue.length; q++) {
        const pts = queue[q];
        for (let i = 0; i < pts.length; i += 2) {
          const [x, y] = pts[i];
          const [a, b] = pts[Math.min(pts.length - 1, i + 1)];
          const [c, d] = pts[Math.max(0, i - 1)];
          const len = Math.hypot(a - c, b - d) || 1;
          const nx = -(b - d) / len;
          const ny = (a - c) / len;
          const sep = sepAt(x, y);
          if (!Number.isFinite(sep)) continue;
          for (const side of [1, -1]) {
            const qx = x + nx * sep * side;
            const qy = y + ny * sep * side;
            if (!seedable(qx, qy)) continue;
            const grown = grow(qx, qy);
            if (grown) {
              drawn.push(grown);
              queue.push(grown);
            }
          }
        }
      }
    };
    const scan = spacing * 2;
    for (let y = scan / 2; y < h; y += scan) {
      for (let x = scan / 2; x < w; x += scan) {
        if (!seedable(x, y)) continue;
        const grown = grow(x, y);
        if (grown) spread(grown);
      }
    }

    // Drawn in the order they were made - each beside the last - and each turned to start at whichever
    // end is nearer where the pen is, so it doesn't cross the page between them.
    const parts: string[] = [];
    let px = 0;
    let py = 0;
    for (const pts of drawn) {
      const [ax, ay] = pts[0];
      const [bx, by] = pts[pts.length - 1];
      const run = (bx - px) ** 2 + (by - py) ** 2 < (ax - px) ** 2 + (ay - py) ** 2 ? [...pts].reverse() : pts;
      const kept = simplified(run, 0.01 / 25.4);
      parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
      [px, py] = run[run.length - 1];
      strokes++;
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}

const SAVED_STYLES = ["waves", "squiggle", "streamlines", "scribble", "sketch", "oneline", "hilbert", "outlines", "centerlines", "silhouette", "edges", "paint"] as const;
const isSavedStyle = (v: unknown): v is (typeof SAVED_STYLES)[number] => (SAVED_STYLES as readonly unknown[]).includes(v);

/** A photo read back from a saved drawing: only a picture and numbers are kept, so check them on the way in. */
/**
 * An ink set as a drawing kept it, or null when it isn't one. Checked rather than trusted: a drawing
 * is a file like any other, and a set with no inks - or inks with no colour - would separate into
 * nothing at all.
 */
function inkSetFromData(raw: unknown): InkSet | null {
  if (!raw || typeof raw !== "object") return null;
  const set = raw as Record<string, unknown>;
  const inks = Array.isArray(set.inks) ? set.inks : [];
  const made: SetInk[] = inks.flatMap((ink) => {
    const one = ink as Record<string, unknown>;
    return typeof one?.color === "string" && /^#[0-9a-f]{6}$/i.test(one.color)
      ? [{ name: typeof one.name === "string" ? one.name : "Ink", color: one.color, angle: Number.isFinite(Number(one.angle)) ? Number(one.angle) : 0 }]
      : [];
  });
  if (made.length !== inks.length || made.length < 2) return null;
  return {
    key: typeof set.key === "string" && set.key ? set.key : "own",
    label: typeof set.label === "string" && set.label ? set.label : "Inks",
    ...(typeof set.about === "string" ? { about: set.about } : {}),
    inks: made,
    ...(set.own ? { own: true } : {}),
  };
}

export function photoFromData(raw: Record<string, unknown>): Photo | null {
  const src = raw.src;
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    src,
    width: num(raw.width, 1),
    height: num(raw.height, 1),
    ...(Number(raw.ppi) > 0 ? { ppi: Number(raw.ppi) } : {}),
    brightness: num(raw.brightness, PHOTO_DEFAULTS.brightness),
    contrast: num(raw.contrast, PHOTO_DEFAULTS.contrast),
    ...(num(raw.channel_brightness, 0) ? { channelBrightness: num(raw.channel_brightness, 0) } : {}),
    ...(num(raw.channel_contrast, 0) ? { channelContrast: num(raw.channel_contrast, 0) } : {}),
    ...(num(raw.channel_black_point, 0) ? { channelBlackPoint: num(raw.channel_black_point, 0) } : {}),
    ...(num(raw.black_point, 0) ? { blackPoint: num(raw.black_point, 0) } : {}),
    ...(typeof raw.profile === "string" && raw.profile ? {
      profile: raw.profile,
      ...(typeof raw.profile_name === "string" ? { profileName: raw.profile_name } : {}),
      ...([1, 2, 3].includes(Number(raw.profile_intent)) ? { profileIntent: Number(raw.profile_intent) } : {}),
      ...(raw.profile_bpc === true ? { profileBpc: true } : {}),
      profileInk: Math.max(0, Math.floor(num(raw.profile_ink, 0))),
    } : {}),
    angle: num(raw.angle, PHOTO_DEFAULTS.angle),
    spacingMm: num(raw.spacing_mm, 0.3),
    ...(typeof raw.source === "string" && raw.source ? { source: raw.source } : {}),
    ...(Number.isInteger(raw.source_channel) && Number(raw.source_channel) >= 0 ? { sourceChannel: Number(raw.source_channel) } : {}),
    ...(Array.isArray(raw.channel_inks) && raw.channel_inks.every((c) => typeof c === "string") ? { channelInks: raw.channel_inks as string[] } : {}),
    ...([1, 2, 3].includes(Number(raw.quarter_turns)) ? { quarterTurns: Number(raw.quarter_turns) } : {}),
    ...(isPart(raw.cut) ? { cut: raw.cut } : {}),
    ...(raw.idle === true ? { idle: true } : {}),
    levels: num(raw.levels, PHOTO_DEFAULTS.levels),
    ...(typeof raw.group === "string" ? { group: raw.group } : {}),
    ...(typeof raw.link === "string" ? { link: raw.link } : {}),
    ...(Number.isFinite(Number(raw.edge_from)) && raw.edge_from !== undefined ? { edgeFrom: Number(raw.edge_from) } : {}),
    ...(Number.isFinite(Number(raw.edge_smooth_mm)) && raw.edge_smooth_mm !== undefined ? { edgeSmoothMm: Number(raw.edge_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.edge_shortest_mm)) && raw.edge_shortest_mm !== undefined ? { edgeShortestMm: Number(raw.edge_shortest_mm) } : {}),
    ...(typeof raw.edgeMask === "string" && raw.edgeMask.startsWith("data:image/") ? { edgeMask: raw.edgeMask } : {}),
    ...(typeof raw.edgeMaskName === "string" ? { edgeMaskName: raw.edgeMaskName } : {}),
    ...(raw.edgeMaskInvert === true ? { edgeMaskInvert: true } : {}),
    ...(edgeGenFromData(raw.edgeGen) ? { edgeGen: edgeGenFromData(raw.edgeGen) } : {}),
    ...(vignetteFromData(raw.vignette) ? { vignette: vignetteFromData(raw.vignette) } : {}),
    ...(Array.isArray(raw.edgeMaskSides) ? { edgeMaskSides: MASK_SIDES.filter((side) => (raw.edgeMaskSides as unknown[]).includes(side)) } : {}),
    ...(Array.isArray(raw.crop) && raw.crop.length === 4 && raw.crop.every((v) => Number.isFinite(Number(v)))
      ? { crop: raw.crop.map(Number) as [number, number, number, number] }
      : {}),
    ...(raw.fit === "fit" || raw.fit === "fill" ? { fit: raw.fit } : {}),
    ...(raw.align && typeof raw.align === "object"
      && [0, 0.5, 1].includes((raw.align as FitAlign).x) && [0, 0.5, 1].includes((raw.align as FitAlign).y)
      ? { align: { x: (raw.align as FitAlign).x, y: (raw.align as FitAlign).y } } : {}),
    ...(isSavedStyle(raw.style) ? { style: raw.style } : {}),
    ...(Number.isFinite(Number(raw.center_from)) && raw.center_from !== undefined ? { centerFrom: Number(raw.center_from) } : {}),
    ...(Number.isFinite(Number(raw.center_smooth_mm)) && raw.center_smooth_mm !== undefined ? { centerSmoothMm: Number(raw.center_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.center_shortest_mm)) && raw.center_shortest_mm !== undefined ? { centerShortestMm: Number(raw.center_shortest_mm) } : {}),
    ...(raw.center_mode === "curves" || raw.center_mode === "mixed" || raw.center_mode === "straight" ? { centerMode: raw.center_mode } : {}),
    ...(Number(raw.center_straight_mm) > 0 ? { centerStraightMm: Number(raw.center_straight_mm) } : {}),
    ...(Number(raw.center_long_mm) > 0 ? { centerLongMm: Number(raw.center_long_mm) } : {}),
    ...(Number(raw.center_corner_deg) > 0 ? { centerCornerDeg: Math.min(179, Number(raw.center_corner_deg)) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_from)) && raw.silhouette_from !== undefined ? { silhouetteFrom: Number(raw.silhouette_from) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_smooth_mm)) && raw.silhouette_smooth_mm !== undefined ? { silhouetteSmoothMm: Number(raw.silhouette_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_smallest_mm)) && raw.silhouette_smallest_mm !== undefined ? { silhouetteSmallestMm: Number(raw.silhouette_smallest_mm) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_coarsest_mm)) && raw.hilbert_coarsest_mm !== undefined ? { hilbertCoarsestMm: Number(raw.hilbert_coarsest_mm) } : {}),
    ...(raw.hilbert_lift === true ? { hilbertLift: true } : {}),
    ...(raw.hilbert_curve === "peano" ? { hilbertCurve: "peano" as const } : {}),
    ...(Number.isFinite(Number(raw.hilbert_round)) && raw.hilbert_round !== undefined ? { hilbertRound: Number(raw.hilbert_round) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_blend)) && raw.hilbert_blend !== undefined ? { hilbertBlend: Number(raw.hilbert_blend) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_angle)) && raw.hilbert_angle !== undefined ? { hilbertAngle: Number(raw.hilbert_angle) } : {}),
    ...Object.fromEntries((["line_curve", "line_angle", "line_bias", "line_grain", "line_contrast"] as const)
      .filter((k) => raw[k] !== undefined && Number.isFinite(Number(raw[k])))
      .map((k) => [{ line_curve: "lineCurve", line_angle: "lineAngle", line_bias: "lineBias", line_grain: "lineGrain", line_contrast: "lineContrast" }[k], Number(raw[k])])),
    ...(Number.isFinite(Number(raw.line_dots)) && raw.line_dots !== undefined ? { lineDots: Number(raw.line_dots) } : {}),
    ...(Number.isFinite(Number(raw.line_lift_mm)) && raw.line_lift_mm !== undefined ? { lineLiftMm: Number(raw.line_lift_mm) } : {}),
    ...(Number.isFinite(Number(raw.stream_widest_mm)) && raw.stream_widest_mm !== undefined ? { streamWidestMm: Number(raw.stream_widest_mm) } : {}),
    ...(Number.isFinite(Number(raw.scribble_length_mm)) && raw.scribble_length_mm !== undefined ? { scribbleLengthMm: Number(raw.scribble_length_mm) } : {}),
    ...(Number.isFinite(Number(raw.scribble_min_mm)) && raw.scribble_min_mm !== undefined ? { scribbleMinMm: Number(raw.scribble_min_mm) } : {}),
    ...(Number.isFinite(Number(raw.paint_smooth_mm)) && raw.paint_smooth_mm !== undefined ? { paintSmoothMm: Number(raw.paint_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.paint_smallest_mm)) && raw.paint_smallest_mm !== undefined ? { paintSmallestMm: Number(raw.paint_smallest_mm) } : {}),
    ...(raw.paint_outline === false ? { paintOutline: false } : {}),
    ...(Number.isFinite(Number(raw.scribble_wiggle)) && raw.scribble_wiggle !== undefined ? { scribbleWiggle: Number(raw.scribble_wiggle) } : {}),
    ...(Number.isFinite(Number(raw.scribble_segment_mm)) && raw.scribble_segment_mm !== undefined ? { scribbleSegmentMm: Number(raw.scribble_segment_mm) } : {}),
    ...(Number.isFinite(Number(raw.scribble_seed)) && raw.scribble_seed !== undefined ? { scribbleSeed: Number(raw.scribble_seed) } : {}),
    ...(Number.isFinite(Number(raw.stream_passes)) && raw.stream_passes !== undefined ? { streamPasses: Number(raw.stream_passes) } : {}),
    ...(Number.isFinite(Number(raw.stream_flow_mm)) && raw.stream_flow_mm !== undefined ? { streamFlowMm: Number(raw.stream_flow_mm) } : {}),
    ...(Number.isFinite(Number(raw.contours)) && raw.contours !== undefined ? { contours: Number(raw.contours) } : {}),
    ...(Number.isFinite(Number(raw.smooth_mm)) && raw.smooth_mm !== undefined ? { smoothMm: Number(raw.smooth_mm) } : {}),
    ...(typeof raw.ink === "string" ? { ink: raw.ink } : {}),
    ...(Array.isArray(raw.offset_mm) && raw.offset_mm.length === 2 && raw.offset_mm.every((v) => Number.isFinite(Number(v)))
      ? { offsetMm: [Number(raw.offset_mm[0]), Number(raw.offset_mm[1])] as [number, number] }
      : {}),
    ...(Array.isArray(raw.regions) && raw.regions.every((v) => typeof v === "string") ? { regions: raw.regions as string[] } : {}),
    ...(Number.isInteger(Number(raw.region)) && raw.region !== undefined ? { region: Number(raw.region) } : {}),
    ...(typeof raw.fit_paper === "string" ? { fitPaper: raw.fit_paper } : {}),
    ...(Number.isFinite(Number(raw.pen_mm)) && raw.pen_mm !== undefined ? { penMm: Number(raw.pen_mm) } : {}),
    ...(raw.fit_pairs === true ? { fitPairs: true } : {}),
    ...(raw.fit_opaque === true ? { fitOpaque: true } : {}),
    ...(raw.key === true ? { key: true } : {}),
    ...(raw.modes && typeof raw.modes === "object" ? { modes: raw.modes as Photo["modes"] } : {}),
    ...(typeof raw.key_ink === "string" ? { keyInk: raw.key_ink } : {}),
    ...(Number.isFinite(Number(raw.key_strength)) && raw.key_strength !== undefined ? { keyStrength: Number(raw.key_strength) } : {}),
    ...(Number.isFinite(Number(raw.key_from)) && raw.key_from !== undefined ? { keyFrom: Number(raw.key_from) } : {}),
    ...(typeof raw.separation === "string" ? { separation: raw.separation } : {}),
    ...(typeof raw.plate === "string" && "cmykogrv".includes(raw.plate) && raw.plate.length === 1 ? { plate: raw.plate as Plate } : {}),
    ...(Array.isArray(raw.plates) && raw.plates.every((v) => typeof v === "string") ? { plates: raw.plates as string[] } : {}),
    ...(Number.isInteger(raw.ink_at) && Number(raw.ink_at) >= 0 ? { inkAt: Number(raw.ink_at) } : {}),
    ...((() => { const set = inkSetFromData(raw.ink_set); return set ? { inkSet: set } : {}; })()),
    ...(Number.isFinite(Number(raw.black_share)) && raw.black_share !== undefined ? { blackShare: Number(raw.black_share) } : {}),
    ...(Array.isArray(raw.region_inks) ? { regionInks: raw.region_inks.map((c) => (typeof c === "string" ? c : null)) } : {}),
    ...(Number.isFinite(Number(raw.row_mm)) && raw.row_mm !== undefined ? { rowMm: Number(raw.row_mm) } : {}),
    ...(Number.isFinite(Number(raw.wave_mm)) && raw.wave_mm !== undefined ? { waveMm: Number(raw.wave_mm) } : {}),
    ...(Number.isFinite(Number(raw.saturation)) && raw.saturation !== undefined && Number(raw.saturation) !== 0 ? { saturation: Number(raw.saturation) } : {}),
    ...(num(raw.flatten, 0) >= 2 ? { flatten: Math.min(FLATTEN_MOST, Math.round(num(raw.flatten, 0))) } : {}),
    ...(Number.isFinite(Number(raw.hatch_smooth_mm)) && raw.hatch_smooth_mm !== undefined ? { hatchSmoothMm: Number(raw.hatch_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.hatch_shortest_mm)) && raw.hatch_shortest_mm !== undefined ? { hatchShortestMm: Math.max(0, Number(raw.hatch_shortest_mm)) } : {}),
    ...(Number.isFinite(Number(raw.squiggle_amp_mm)) && raw.squiggle_amp_mm !== undefined ? { squiggleAmpMm: Number(raw.squiggle_amp_mm) } : {}),
    ...(Number.isFinite(Number(raw.squiggle_height)) && raw.squiggle_height !== undefined ? { squiggleHeight: Number(raw.squiggle_height) } : {}),
    ...(raw.squiggle_join === true ? { squiggleJoin: true } : {}),
    ...(raw.angle_preset === "classic" || raw.angle_preset === "complementary" || raw.angle_preset === "cardinal" || raw.angle_preset === "golden" || raw.angle_preset === "uniform" ? { anglePreset: raw.angle_preset } : {}),
    ...(Number.isFinite(Number(raw.angle_turn)) && raw.angle_turn !== undefined ? { angleTurn: Number(raw.angle_turn) } : {}),
    ...(raw.squiggle_lift === true ? { squiggleLift: true } : {}),
    ...(Number.isFinite(Number(raw.squiggle_smooth)) && raw.squiggle_smooth !== undefined ? { squiggleSmooth: Number(raw.squiggle_smooth) } : {}),
    ...(raw.squiggle_draw && typeof raw.squiggle_draw === "object" ? { squiggleDraw: Object.fromEntries(Object.entries(raw.squiggle_draw as Record<string, unknown>).filter(([k, v]) => k in SQUIGGLE_DRAW && (k === "invert" ? typeof v === "boolean" : Number.isFinite(Number(v)))).map(([k, v]) => [k, k === "invert" ? v : Number(v)])) as Partial<SquiggleDraw> } : {}),
    ...(raw.sketch_lines && typeof raw.sketch_lines === "object" ? { sketchLines: Object.fromEntries(Object.entries(raw.sketch_lines as Record<string, unknown>).filter(([k, v]) => k in SKETCH_LINES && (typeof SKETCH_LINES[k as keyof SketchLines] === "boolean" ? typeof v === "boolean" : Number.isFinite(Number(v)))).map(([k, v]) => [k, typeof v === "boolean" ? v : Number(v)])) as Partial<SketchLines> } : {}),
    ...(raw.squiggle_version === "inkscape" ? { squiggleVersion: "inkscape" as const } : {}),
    ...(Number.isFinite(Number(raw.squiggle_angle)) && raw.squiggle_angle !== undefined ? { squiggleAngle: Number(raw.squiggle_angle) } : {}),
    ...(raw.squiggle_inkscape && typeof raw.squiggle_inkscape === "object" ? { squiggleInkscape: Object.fromEntries(Object.entries(raw.squiggle_inkscape as Record<string, unknown>).filter(([k, v]) => k in SQUIGGLE_INKSCAPE && (k === "invert" ? typeof v === "boolean" : k === "path" ? v === "uni" || v === "bidi" || v === "join" : Number.isFinite(Number(v)))).map(([k, v]) => [k, k === "invert" || k === "path" ? v : Number(v)])) as Partial<SquiggleInkscape> } : {}),
    ...(Number.isFinite(Number(raw.bleed)) && raw.bleed !== undefined ? { bleed: Number(raw.bleed) } : {}),
    ...(Number.isFinite(Number(raw.margin)) && raw.margin !== undefined ? { margin: Number(raw.margin) } : {}),
    ...(Number.isFinite(Number(raw.margin_bottom)) && raw.margin_bottom !== undefined ? { marginBottom: Number(raw.margin_bottom) } : {}),
    ...(raw.side === "dark" || raw.side === "light" ? { side: raw.side } : {}),
    ...(Array.isArray(raw.paper_tone) && raw.paper_tone.length === 2 && raw.paper_tone.every((v) => Number.isFinite(Number(v)))
      ? { paperTone: [Number(raw.paper_tone[0]), Number(raw.paper_tone[1])] as [number, number] }
      : {}),
    ...(raw.paper_tone_set === true ? { paperToneSet: true } : {}),
    ...(Array.isArray(raw.band) && raw.band.length === 2 && raw.band.every((v) => Number.isFinite(Number(v)))
      ? { band: [Number(raw.band[0]), Number(raw.band[1])] as [number, number] }
      : {}),
  };
}

/** A photo as the design block keeps it. */
export const photoData = (p: Photo) => ({
  src: p.src, width: p.width, height: p.height, brightness: p.brightness, contrast: p.contrast,
  ...(p.ppi ? { ppi: p.ppi } : {}),
  ...(p.channelBrightness ? { channel_brightness: p.channelBrightness } : {}),
  ...(p.channelContrast ? { channel_contrast: p.channelContrast } : {}),
  ...(p.channelBlackPoint ? { channel_black_point: p.channelBlackPoint } : {}),
  ...(p.blackPoint ? { black_point: p.blackPoint } : {}),
  ...(p.profile ? { profile: p.profile, profile_name: p.profileName, profile_intent: p.profileIntent || undefined, profile_bpc: p.profileBpc || undefined, profile_ink: p.profileInk ?? 0 } : {}),
  angle: p.angle, spacing_mm: p.spacingMm, levels: p.levels,
  ...(p.source ? { source: p.source } : {}),
  ...(p.source && p.sourceChannel !== undefined ? { source_channel: p.sourceChannel } : {}),
  ...(p.source && p.channelInks ? { channel_inks: p.channelInks } : {}),
  ...(p.quarterTurns ? { quarter_turns: p.quarterTurns } : {}),
  ...(p.cut ? { cut: p.cut } : {}),
  ...(p.idle ? { idle: true } : {}),
  ...(p.group ? { group: p.group } : {}),
  ...(p.link ? { link: p.link } : {}),
  ...(p.edgeFrom !== undefined ? { edge_from: p.edgeFrom } : {}),
  ...(p.edgeSmoothMm !== undefined ? { edge_smooth_mm: p.edgeSmoothMm } : {}),
  ...(p.edgeShortestMm !== undefined ? { edge_shortest_mm: p.edgeShortestMm } : {}),
  ...(p.band ? { band: p.band } : {}),
  ...(p.side ? { side: p.side, paper_tone: p.paperTone, ...(p.paperToneSet ? { paper_tone_set: true } : {}) } : {}),
  ...(p.crop ? { crop: p.crop } : {}),
  ...(p.edgeMask ? { edgeMask: p.edgeMask, ...(p.edgeMaskName ? { edgeMaskName: p.edgeMaskName } : {}), ...(p.edgeMaskInvert ? { edgeMaskInvert: true } : {}) } : {}),
  ...(p.edgeGen ? { edgeGen: p.edgeGen } : {}),
  ...(p.vignette ? { vignette: p.vignette } : {}),
  ...((p.edgeMask || p.edgeGen) && p.edgeMaskSides ? { edgeMaskSides: p.edgeMaskSides } : {}),
  ...(p.fit ? { fit: p.fit } : {}),
  ...(p.align && (p.align.x !== 0.5 || p.align.y !== 0.5) ? { align: p.align } : {}),
  ...(isSavedStyle(p.style) ? { style: p.style } : {}),
  ...(p.centerFrom !== undefined ? { center_from: p.centerFrom } : {}),
  ...(p.centerSmoothMm !== undefined ? { center_smooth_mm: p.centerSmoothMm } : {}),
  ...(p.centerShortestMm !== undefined ? { center_shortest_mm: p.centerShortestMm } : {}),
  ...(p.centerMode ? { center_mode: p.centerMode } : {}),
  ...(p.centerStraightMm ? { center_straight_mm: p.centerStraightMm } : {}),
  ...(p.centerLongMm ? { center_long_mm: p.centerLongMm } : {}),
  ...(p.centerCornerDeg ? { center_corner_deg: p.centerCornerDeg } : {}),
  ...(p.silhouetteFrom !== undefined ? { silhouette_from: p.silhouetteFrom } : {}),
  ...(p.silhouetteSmoothMm !== undefined ? { silhouette_smooth_mm: p.silhouetteSmoothMm } : {}),
  ...(p.silhouetteSmallestMm !== undefined ? { silhouette_smallest_mm: p.silhouetteSmallestMm } : {}),
  ...(p.hilbertCoarsestMm !== undefined ? { hilbert_coarsest_mm: p.hilbertCoarsestMm } : {}),
  ...(p.hilbertLift ? { hilbert_lift: true } : {}),
  ...(p.hilbertCurve === "peano" ? { hilbert_curve: "peano" } : {}),
  ...(p.hilbertRound ? { hilbert_round: p.hilbertRound } : {}),
  ...(p.hilbertBlend ? { hilbert_blend: p.hilbertBlend } : {}),
  ...(p.hilbertAngle ? { hilbert_angle: p.hilbertAngle } : {}),
  ...(p.lineDots !== undefined ? { line_dots: p.lineDots } : {}),
  ...(p.lineCurve ? { line_curve: p.lineCurve } : {}),
  ...(p.lineAngle ? { line_angle: p.lineAngle } : {}),
  ...(p.lineBias ? { line_bias: p.lineBias } : {}),
  ...(p.lineGrain ? { line_grain: p.lineGrain } : {}),
  ...(p.lineContrast !== undefined ? { line_contrast: p.lineContrast } : {}),
  ...(p.lineLiftMm ? { line_lift_mm: p.lineLiftMm } : {}),
  ...(p.streamWidestMm !== undefined ? { stream_widest_mm: p.streamWidestMm } : {}),
  ...(p.scribbleLengthMm !== undefined ? { scribble_length_mm: p.scribbleLengthMm } : {}),
  ...(p.scribbleMinMm !== undefined ? { scribble_min_mm: p.scribbleMinMm } : {}),
  ...(p.paintSmoothMm !== undefined ? { paint_smooth_mm: p.paintSmoothMm } : {}),
  ...(p.paintSmallestMm !== undefined ? { paint_smallest_mm: p.paintSmallestMm } : {}),
  ...(p.paintOutline === false ? { paint_outline: false } : {}),
  ...(p.scribbleWiggle !== undefined ? { scribble_wiggle: p.scribbleWiggle } : {}),
  ...(p.scribbleSegmentMm !== undefined ? { scribble_segment_mm: p.scribbleSegmentMm } : {}),
  ...(p.scribbleSeed !== undefined ? { scribble_seed: p.scribbleSeed } : {}),
  ...(p.streamPasses !== undefined ? { stream_passes: p.streamPasses } : {}),
  ...(p.streamFlowMm !== undefined ? { stream_flow_mm: p.streamFlowMm } : {}),
  ...(p.contours !== undefined ? { contours: p.contours } : {}),
  ...(p.smoothMm !== undefined ? { smooth_mm: p.smoothMm } : {}),
  ...(p.ink ? { ink: p.ink, regions: p.regions, region: p.region } : {}),
  ...(p.fitPaper ? { fit_paper: p.fitPaper, pen_mm: p.penMm, ...(p.fitPairs ? { fit_pairs: true } : {}), ...(p.fitOpaque ? { fit_opaque: true } : {}) } : {}),
  // A plate's pen width: the separation works out its passes from it.
  ...(onePlate(p) && p.penMm !== undefined ? { pen_mm: p.penMm } : {}),
  ...(p.key ? { key: true } : {}),
  ...(p.modes ? { modes: p.modes } : {}),
  ...(p.keyInk ? { key_ink: p.keyInk } : {}),
  ...(p.keyStrength !== undefined ? { key_strength: p.keyStrength } : {}),
  ...(p.keyFrom !== undefined ? { key_from: p.keyFrom } : {}),
  // A built-in set still writes its plate letter, so a drawing made here opens in an older build.
  ...(onePlate(p) ? {
    ...(p.plate ? { plate: p.plate } : {}),
    plates: p.plates,
    ...(p.inkAt !== undefined ? { ink_at: p.inkAt } : {}),
    ...(p.inkSet ? { ink_set: p.inkSet } : {}),
  } : {}),
  ...(p.separation ? { separation: p.separation } : {}),
  ...(p.blackShare !== undefined ? { black_share: p.blackShare } : {}),
  ...(p.regionInks ? { region_inks: p.regionInks } : {}),
  ...(p.offsetMm && (p.offsetMm[0] || p.offsetMm[1]) ? { offset_mm: p.offsetMm } : {}),
  ...(p.rowMm !== undefined ? { row_mm: p.rowMm } : {}),
  ...(p.waveMm !== undefined ? { wave_mm: p.waveMm } : {}),
  ...(p.hatchSmoothMm ? { hatch_smooth_mm: p.hatchSmoothMm } : {}),
  ...(p.hatchShortestMm !== undefined ? { hatch_shortest_mm: p.hatchShortestMm } : {}),
  ...(p.saturation ? { saturation: p.saturation } : {}),
  ...(p.flatten ? { flatten: p.flatten } : {}),
  ...(p.squiggleAmpMm !== undefined ? { squiggle_amp_mm: p.squiggleAmpMm } : {}),
  ...(p.squiggleHeight !== undefined ? { squiggle_height: p.squiggleHeight } : {}),
  ...(p.squiggleJoin ? { squiggle_join: true } : {}),
  ...(p.anglePreset ? { angle_preset: p.anglePreset } : {}),
  ...(p.angleTurn ? { angle_turn: p.angleTurn } : {}),
  ...(p.squiggleLift ? { squiggle_lift: true } : {}),
  ...(p.squiggleSmooth !== undefined ? { squiggle_smooth: p.squiggleSmooth } : {}),
  ...(p.squiggleDraw && Object.keys(p.squiggleDraw).length ? { squiggle_draw: p.squiggleDraw } : {}),
  ...(p.sketchLines && Object.keys(p.sketchLines).length ? { sketch_lines: p.sketchLines } : {}),
  ...(p.squiggleVersion === "inkscape" ? { squiggle_version: "inkscape" } : {}),
  ...(p.squiggleAngle ? { squiggle_angle: p.squiggleAngle } : {}),
  ...(p.squiggleInkscape && Object.keys(p.squiggleInkscape).length ? { squiggle_inkscape: p.squiggleInkscape } : {}),
  ...(p.bleed ? { bleed: p.bleed } : {}),
  ...(p.margin !== undefined ? { margin: p.margin } : {}),
  ...(p.marginBottom !== undefined ? { margin_bottom: p.marginBottom } : {}),
});

/** Where a photo layer's lines start on the page, in inches: its box's corner, moved by its offset. */
export const photoOrigin = (photo: Photo, x0: number, y0: number) => ({
  x: x0 + (photo.offsetMm?.[0] ?? 0) / 25.4,
  y: y0 + (photo.offsetMm?.[1] ?? 0) / 25.4,
});
