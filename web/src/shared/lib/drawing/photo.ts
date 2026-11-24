// A photo on the page, drawn as hatching: lines whose spacing follows how dark the photo is there.
// The photo itself is kept - a working copy of it, small enough to travel inside the drawing - with a
// few numbers, and the lines are made from those every time. Nothing here is a shape to edit line by
// line: a photo is tens of thousands of strokes, and it is the photo and its numbers that are edited.

import { colorNamed } from "../colorNames";
import { FIT_CENTERED, type FitAlign, type Margins } from "../geometry";
import { edgeForLayer, edgeGenFromData, edgeGenKey, edgeKeep } from "./edgeMask";
import { vignetted, vignetteFromData, vignetteKey, vignetteOn, vignetteStrength } from "./vignette";
import { inksOf, parseProfile, usesBpc, type InkProfile } from "./icc";
import type { AnglePreset, Bucket, FlatColour, FlatColours, InkSet, MaskSide, Photo, PhotoMarks, PhotoMask, Plate, SetInk, Tones } from "./photoTypes";
import { BLACK_SHARE, CARDINAL, CLASSIC, DEFAULT_DPI, FINDABLE, FLATTEN_LEAST, FLATTEN_LEAST_FLAT, FLATTEN_MOST, FLATTEN_SAMPLE, FLAT_LEAST, FLAT_LEAST_ASKED, FLAT_MERGE, FLAT_MOST_CANDIDATES, FLAT_NEAR, GOLDEN, MASK_EDGE, MOST_BLACK_POINT, MOST_COLORS, MOST_PAINT_COLORS, OUTLINE_DEFAULTS, PAPER_CHROMA, PAPER_LIGHTNESS, PEN_TEST_COLOURS, PHOTO_DEFAULTS, PLATE_OFF, SILHOUETTE_DEFAULTS, SKETCH_LINES, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, WAVE_DEFAULTS, WORKING_EDGE } from "./photoDefaults";
import type { SketchLines, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";
import { PLATE_SETS, adjuster, blurGrid, centerOn, chooseCovers, coverSteps, coverTone, dist2, fieldOf, hexLab, hexLinear, lab, labOfLinear, layerOf, linear, marksKey, mixOf, onePlate, paintField, paintRegions, plateSetOf, processingBlurred, separationListeners, separationOf, setSeparateNow, smoothedTones, toneSampler, withinReach } from "./photoSample";
import { centerlines, edges } from "./effects/centerlines";
import { hatch } from "./effects/hatching";
import { hilbert } from "./effects/hilbert";
import { oneLine } from "./effects/oneLine";
import { outlines } from "./effects/outlines";
import { paint } from "./effects/paint";
import { scribble } from "./effects/scribble";
import { silhouette } from "./effects/silhouette";
import { sketchLines } from "./effects/sketch";
import { squiggle, squiggleInkscape } from "./effects/squiggle";
import { streamlines } from "./effects/streamlines";
// The picture's own types live in photoTypes.ts; everything imports them from here as before.
export type { AnglePreset, Fit, InkSet, Photo, PhotoPart, Plate, PlateSet, Separation, SeparationRequest, SetInk, Tones } from "./photoTypes";

// The effects' numbers live in photoDefaults.ts; the cards import them from here as they always have.
export { BAND_NAMES, BLACK_SHARE, CENTER_DEFAULTS, EDGE_DEFAULTS, FLATTEN_DEFAULT, FLATTEN_MOST, FLAT_ENOUGH, HILBERT_DEFAULTS, KEY_FROM, MASK_EDGE_PX, MOST_BLACK_POINT, MOST_LAYERS, MOST_PASSES, MOST_SIDE_LAYERS, ONE_LINE_DEFAULTS, ONE_LINE_MOST, OUTLINE_DEFAULTS, PHOTO_DEFAULTS, PLATE_OFF, SCRIBBLE_DEFAULTS, SILHOUETTE_DEFAULTS, SKETCH_LINES, SKETCH_RANGES, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, SQUIGGLE_INKSCAPE_RANGES, SQUIGGLE_RANGES, STREAM_DEFAULTS, WAVE_DEFAULTS } from "./photoDefaults";
export type { SketchLines, SketchNumber, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";
// The engine lives in photoSample.ts; the cards import these from here as they always have.
export { PLATE_SETS, adjuster, centerModeOf, contour, coverSteps, darknessAt, density, fitMenu, hexLinear, inkAtOf, lab, labOfLinear, layerOf, linear, neighbours, onePlate, paintDefaultsOf, paperToneOf, plateSetOf, platesOf, prune, separating, simplified, sketchLinesOf, solveSeparation, squiggleDrawOf, squiggleInkscapeOf, thin } from "./photoSample";

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
