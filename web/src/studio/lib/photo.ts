// A photo on the page, drawn as hatching: lines whose spacing follows how dark the photo is there.
// The photo itself is kept - a working copy of it, small enough to travel inside the drawing - with a
// few numbers, and the lines are made from those every time. Nothing here is a shape to edit line by
// line: a photo is tens of thousands of strokes, and it is the photo and its numbers that are edited.

import type { Point } from "./parametric";
import { fitNodes, pathData, type Node } from "./path";

/** What a photo shape keeps: its working copy, and how it is turned into lines. */
export interface Photo {
  /** The working copy, as a data URL: a JPEG no longer than WORKING_EDGE pixels on its longer side. */
  src: string;
  /** The working copy's size in pixels, so its proportions are known before it has been read. */
  width: number;
  height: number;
  /** -100 to 100: lighter or darker overall. */
  brightness: number;
  /** -100 to 100: flatter or more contrasty. */
  contrast: number;
  /** Degrees: the direction of the first set of lines. The second crosses it at a right angle. */
  angle: number;
  /** The closest the lines ever come, in mm: the spacing the tool fills solid at. */
  spacingMm: number;
  /** How many passes of lines build up the darks, 1 to 4: two directions, then each again between. */
  levels: number;
  /**
   * What the tone is drawn as: hatching, lines crossing and filling in as it darkens; or tone lines,
   * one line along each row that waves harder and tighter where it's darker. Absent, hatching.
   */
  style?: "hatch" | "waves" | "outlines" | "centerlines";
  /** Outlines: how many contours, spread across the tones this layer draws. */
  contours?: number;
  /** Outlines: how much fine detail and noise is smoothed away first, in mm on the page. */
  smoothMm?: number;
  /**
   * Centerlines: how dark, 0 to 1, a part of the picture is before it counts as a line. Each dark
   * stroke of the picture is drawn once, down its middle, however wide it is.
   */
  centerFrom?: number;
  /** Centerlines: how much the picture is smoothed first, in mm on the page, so a ragged edge doesn't sprout whiskers. */
  centerSmoothMm?: number;
  /** Centerlines: lines and whiskers shorter than this are left out, in mm. */
  centerShortestMm?: number;
  /** Tone lines: how far apart the rows are, in mm. */
  rowMm?: number;
  /** Tone lines: the length of one wave where the photo is darkest, in mm. Lighter tones stretch it. */
  waveMm?: number;
  /**
   * Split by colour: the photo's colours gathered into groups of similar colours, `regions`, each
   * the average colour of its group. This layer draws group number `region`'s area, in its pen, `ink`
   * - the palette's nearest to that group, or whichever pen its layer has been given since. Absent,
   * the photo is read by its lightness alone, as black and white.
   */
  ink?: string;
  regions?: string[];
  region?: number;
  /**
   * The key layer of a photo split by colour: shading drawn over the colours in its ink, across the
   * whole photo, heavier where it's darker - like shading a coloured drawing with a black pen. Only
   * one of a photo's layers is the key; it has no `region`.
   */
  key?: boolean;
  /**
   * How the photo was split the other way, kept for when it's split that way again: switching between
   * value and colour puts back the layers and settings it had, rather than starting over.
   */
  modes?: Partial<Record<"value" | "colour" | "cmyk", PhotoPart[]>>;
  /** Split by colour: every group's pen, by group, and the key's, so each layer can be worked out alongside the rest. */
  regionInks?: (string | null)[];
  keyInk?: string;
  /** How heavy the key's shading gets at black, 0 to 1. The whole photo's. Absent, full. */
  keyStrength?: number;
  /** How dark, 0 to 1, a part of the photo is before the key shades it. The whole photo's. */
  keyFrom?: number;
  /**
   * Split into CMYK: this layer is one of four plates - cyan, magenta, yellow, black - drawn across
   * the whole photo in its pen, `ink`, and blended on paper with the others. `plates` is all four
   * pens, in that order, so each plate is worked out alongside the rest.
   */
  plate?: Plate;
  plates?: string[];
  /**
   * A separation made elsewhere: this layer's picture is one greyscale plate of a photo already
   * split - cyan, magenta, yellow, black, or any other ink - darker where more of this layer's pen
   * goes. Named by what it is: a plate's name ("Cyan") or the file's. Its layers are one photo on
   * the page, as a split is, but each draws its own picture rather than a part of a shared one.
   */
  separation?: string;
  /** CMYK: how much of the grey the colours share goes to the black plate, 0 to 1. The whole photo's. */
  blackShare?: number;
  /**
   * How far this layer's lines are shifted from where the photo puts them, in mm across and down:
   * to bring one layer into register with another, or to set it deliberately out of register. Each
   * layer's own; the photo and the other layers stay where they are.
   */
  offsetMm?: [number, number];
  /**
   * A photo split into tone bands is several photo shapes, one per band, each on a layer of its own:
   * the same picture in the same place, each drawing only the part of it whose tone is in its band.
   * They share this, so they move and size as one photo.
   */
  group?: string;
  /** How dark this band is, from and to: 0 is white, 1 black. Absent, the whole photo. */
  band?: [number, number];
  /**
   * How far each band reaches into its neighbours, as a share of the whole range from white to black:
   * 0.05 takes a middle third from 33-67% to 28-72%. Where bands meet, both draw, so their lines
   * overlap there rather than stopping at a hard edge. The whole photo's, like its contrast.
   */
  bleed?: number;
  /**
   * The part of the picture that is drawn, as fractions of it across and down: left, top, right,
   * bottom. Absent, all of it. Filling the page crops whatever would hang off it, rather than
   * drawing lines past the paper's edge.
   */
  crop?: [number, number, number, number];
  /** Sized to the page: all of it as large as it fits, or filling the page and cropped. Absent once
   *  it has been moved or sized by hand. A photo sized to the page is sized again when the page is. */
  fit?: "fit" | "fill";
  /** The margin, in inches, it is fitted or filled inside. */
  margin?: number;
}

/**
 * Where a photo goes to fit or fill a page, inside a margin: its box, and the part of it that shows.
 * `aspect` is the picture's width over its height.
 */
export function placeOnPage(aspect: number, page: { w: number; h: number }, how: "fit" | "fill", margin: number) {
  const m = Math.max(0, Math.min(margin, page.w / 2 - 0.1, page.h / 2 - 0.1));
  const aw = page.w - m * 2;
  const ah = page.h - m * 2;
  if (how === "fit") {
    const k = Math.min(aw / aspect, ah);
    const w = aspect * k;
    const h = k;
    const x = (page.w - w) / 2;
    const y = (page.h - h) / 2;
    return { x, y, x2: x + w, y2: y + h, crop: undefined };
  }
  // Filling: the whole area inside the margin, with the picture cropped evenly on the sides that
  // don't fit - the middle of the photo is what stays.
  const area = aw / ah;
  const crop: [number, number, number, number] = aspect > area
    ? [(1 - area / aspect) / 2, 0, 1 - (1 - area / aspect) / 2, 1]
    : [0, (1 - aspect / area) / 2, 1, 1 - (1 - aspect / area) / 2];
  return { x: m, y: m, x2: page.w - m, y2: page.h - m, crop };
}

/** The four plates of a CMYK split, in the order they're worked out. */
export type Plate = "c" | "m" | "y" | "k";
export const PLATES: Plate[] = ["c", "m", "y", "k"];

/**
 * What each plate aims for - printing's own cyan, magenta, yellow and black, to find the nearest pen
 * to - and the angle it's hatched at: print's screen angles, apart enough that the four don't make
 * moiré patterns where they cross.
 */
export const PLATE_AIMS: Record<Plate, { name: string; color: string; angle: number }> = {
  c: { name: "Cyan", color: "#00a3e0", angle: 15 },
  m: { name: "Magenta", color: "#d6007a", angle: 75 },
  y: { name: "Yellow", color: "#ffe500", angle: 0 },
  k: { name: "Black", color: "#1a1a1a", angle: 45 },
};

/** A colour's hue round the colour wheel (0-360), saturation and value (0-1). */
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
export function platePens<P extends { color: string }>(palette: P[]): (P | undefined)[] {
  const out: (P | undefined)[] = [undefined, undefined, undefined, undefined];
  const used = new Set<P>();
  const darkest = [...palette].sort((a, b) => hsv(a.color)[2] - hsv(b.color)[2])[0];
  if (darkest) { out[3] = darkest; used.add(darkest); }
  const pairs: { plate: number; pen: P; score: number }[] = [];
  PLATES.slice(0, 3).forEach((plate, i) => {
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
  return out;
}

/**
 * Which plate a separation's file is, from the last word of its name that says: "portrait_C",
 * "portrait-cyan", "Portrait K". Undefined when none does.
 */
export function plateNamed(name: string): Plate | undefined {
  const words = name.replace(/\.[^.]+$/, "").toLowerCase().split(/[\s_\-.()]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (w === "c" || w === "cyan") return "c";
    if (w === "m" || w === "magenta") return "m";
    if (w === "y" || w === "yellow") return "y";
    if (w === "k" || w === "black" || w === "key") return "k";
  }
  return undefined;
}

/** A separation file's name without its plate word, for naming the photo they make together. */
export const stemWithoutPlate = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/[\s_\-.(]+(c|m|y|k|cyan|magenta|yellow|black|key)\)?$/i, "").trim() || name.replace(/\.[^.]+$/, "");

/** How much of the colours' shared grey goes to the black plate unless set: half, as print often does. */
export const BLACK_SHARE = 0.5;

/** One layer of a photo as it was split: the layer, the shape, and that layer's own settings. */
export interface PhotoPart {
  layerName: string;
  layerColor: string;
  shapeName: string;
  photo: Partial<Photo>;
}

/** The settings a layer of a photo keeps as its own, as opposed to the photo's: what a mode remembers. */
export const LAYER_SETTINGS = [
  "style", "angle", "spacingMm", "levels", "rowMm", "waveMm", "contours", "smoothMm", "centerFrom", "centerSmoothMm", "centerShortestMm", "offsetMm",
  "band", "ink", "regions", "region", "key", "regionInks", "keyInk", "plate", "plates",
] as const;

/** What each band is called, lightest first, for a photo split into this many. */
export const BAND_NAMES: Record<number, string[]> = {
  2: ["light", "dark"],
  3: ["light", "mid", "dark"],
  4: ["lightest", "light", "dark", "darkest"],
  5: ["lightest", "light", "mid", "dark", "darkest"],
  6: ["lightest", "lighter", "light", "dark", "darker", "darkest"],
};

/** The most layers a photo is split into, by tone or by ink. */
export const MOST_LAYERS = 6;

/** The longer side of the working copy, in pixels: enough for lines a pen width apart across a big sheet. */
export const WORKING_EDGE = 1600;

export const PHOTO_DEFAULTS = { brightness: 0, contrast: 0, angle: 45, levels: 4 };

/** What tone lines start from: rows a couple of millimetres apart, waves a millimetre long at black. */
export const WAVE_DEFAULTS = { rowMm: 2, waveMm: 1 };

/** What outlines start from: a handful of contours, a millimetre's detail smoothed away. */
export const OUTLINE_DEFAULTS = { contours: 6, smoothMm: 1 };

/** What centerlines start from: anything darker than half-way is a line; a fifth of a millimetre smoothed. */
export const CENTER_DEFAULTS = { from: 0.5, smoothMm: 0.2, shortestMm: 1 };

// ---------- Reading the photo ----------

interface Tones {
  w: number;
  h: number;
  /** Lightness of each pixel, 0 black to 1 white, row by row. */
  light: Float32Array;
  /** The pixels themselves, red, green, blue and alpha, for splitting by colour. */
  rgba: Uint8ClampedArray;
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

/**
 * A photo file made into a working copy: no longer than WORKING_EDGE on its longer side, as a JPEG,
 * so a drawing that carries it stays a size a browser opens without a pause. Rejects with a sentence
 * to show when the browser can't read the file - an iPhone's HEIC, in most of them.
 */
export async function workingCopy(file: File): Promise<Pick<Photo, "src" | "width" | "height">> {
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} is a kind of picture this browser can’t read. Save it as a JPEG or PNG and add that.`);
  }
  try {
    const scale = Math.min(1, WORKING_EDGE / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // a transparent PNG is on white paper, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width, height };
  } finally {
    img.close();
  }
}

// ---------- Hatching ----------

/** The hatching, one path per pass of lines, in inches from the photo's own top-left corner. */
export interface PhotoMarks {
  passes: string[];
  strokes: number;
  /** Centerlines: how wide the picture's lines typically are, in mm on the page. */
  widthMm?: number;
  /** Centerlines: how many of the lines came out as true circles. */
  circles?: number;
}

const marksCache = new Map<string, PhotoMarks>();

/**
 * The lines for a photo in a box of this size, or null until the photo has been read. Worked out
 * in the photo's own corner, not the page's, so moving it about the page reuses them: only a new
 * size or new numbers draws them again.
 */
export function photoMarks(photo: Photo, w: number, h: number): PhotoMarks | null {
  const tones = tonesOf(photo.src);
  if (!tones || w <= 0 || h <= 0) return null;
  const key = [photo.src.length, photo.src.slice(-32), w.toFixed(4), h.toFixed(4), photo.brightness, photo.contrast, photo.angle, photo.spacingMm, photo.levels, photo.band?.join(",") ?? "", photo.crop?.join(",") ?? "", photo.bleed ?? 0, photo.style ?? "hatch", photo.rowMm ?? "", photo.waveMm ?? "", photo.ink ?? "", photo.regions?.join(",") ?? "", photo.region ?? "", photo.contours ?? "", photo.smoothMm ?? "", photo.key ? "key" : "", photo.keyInk ?? "", photo.regionInks?.join(",") ?? "", photo.keyStrength ?? "", photo.keyFrom ?? "", photo.plate ?? "", photo.plates?.join(",") ?? "", photo.blackShare ?? "", photo.centerFrom ?? "", photo.centerSmoothMm ?? "", photo.centerShortestMm ?? ""].join("|");
  const known = marksCache.get(key);
  if (known) return known;
  const made = photo.style === "waves" ? waves(tones, photo, w, h)
    : photo.style === "outlines" ? outlines(tones, photo, w, h)
    : photo.style === "centerlines" ? centerlines(tones, photo, w, h)
    : hatch(tones, photo, w, h);
  if (marksCache.size > 24) marksCache.delete(marksCache.keys().next().value!);
  marksCache.set(key, made);
  return made;
}

/** How dark the photo is at a point of its box (0 to 1 across and down), after brightness and contrast. */
function darknessAt(tones: Tones, u: number, v: number, lift: number, gain: number): number {
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
const linear = (v: number) => {
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * How much light a channel value stops: its optical density, which adds as inks are layered. Held
 * to where an ink reads as solid - past about a tenth of the light through, more density is nothing
 * the eye sees, and left unheld a yellow's near-empty blue would count for more than all the rest.
 */
const MAX_DENSITY = 2.3;
const density = (v: number) => Math.min(MAX_DENSITY, -Math.log(Math.max(1e-3, linear(v))));

/** An ink's density in each channel. */
const densityOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(density) as [number, number, number];
};

/** The longer side the photo's colour areas are worked out at: finer than any pen, and quick to redo. */
const COVER_EDGE = 800;

/** sRGB to CIELAB, where a distance is near enough how different two colours look. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const hexLab = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return lab((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** Brightness and contrast, applied to a channel value 0 to 255. */
const adjuster = (brightness: number, contrast: number) => {
  const lift = brightness / 200;
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  return (v: number) => Math.min(255, Math.max(0, ((v / 255 - 0.5) * gain + 0.5 + lift) * 255));
};

/**
 * Whether a photo is in colour to speak of: enough of it far enough from grey. A black and white
 * photo - or a colour one that's nearly so - is split by value; one in colour, by its colours.
 */
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

/** The darkest colour of a photo to speak of - a dark shade, not its one blackest pixel - as a hex. */
export function darkestOf(src: string): string {
  const tones = tonesOf(src);
  if (!tones) return "#000000";
  const total = tones.w * tones.h;
  const picks: { l: number; p: number }[] = [];
  for (let i = 0; i < 2000; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    picks.push({ l: tones.light[p / 4], p });
  }
  picks.sort((a, b) => a.l - b.l);
  const dark = picks.slice(0, Math.max(1, Math.round(picks.length * 0.05)));
  const avg = [0, 1, 2].map((ch) => dark.reduce((sum, d) => sum + tones.rgba[d.p + ch], 0) / dark.length);
  return toHex(avg);
}

/**
 * A colour group this light and this nearly grey is the paper showing, and gets no layer of its own.
 * Both: a bright yellow is nearly as light as white, but it's a colour to draw, not paper.
 */
const PAPER_LIGHTNESS = 92;
const PAPER_CHROMA = 12;
const isPaper = (c: number[]) => c[0] >= PAPER_LIGHTNESS && Math.hypot(c[1], c[2]) <= PAPER_CHROMA;

/**
 * The photo's colours gathered into this many groups of similar colours: each group's average
 * colour, lightest first, leaving out any group so light it's the paper. Gathered from a scattering
 * of the photo's pixels, the way a painter mixes a limited palette from a scene: start from colours
 * far apart, then settle each group on the average of what's nearest it, a few times over.
 */
export function colourGroups(src: string, count: number, brightness: number, contrast: number): string[] {
  const tones = tonesOf(src);
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

interface Areas {
  w: number;
  h: number;
  /** How many groups, the paper counted last. */
  groups: number;
  /** How far each point's colour is from each group's, in CIELAB units: `groups` to a point. */
  dist: Float32Array;
  /** How far each point is from its nearest group. */
  nearest: Float32Array;
  /** Which group each point is nearest, the paper being the last. */
  best: Uint8Array;
  want: Float32Array;
}

/** Bleed, as a share, in CIELAB units: how much further a group may be than the nearest and still draw. */
const BLEED_LAB = 100;

/**
 * Whether a point of the photo is in this group's area: its colour nearest this group's - or, with
 * bleed, nearly as near as the nearest, so where colours blend two groups both draw.
 */
function inArea(areas: Areas, at: number, group: number, bleed: number) {
  return areas.dist[at * areas.groups + group] <= areas.nearest[at] + bleed * BLEED_LAB;
}
const areasCache = new Map<string, Areas>();

/**
 * Which colour group each point of the photo belongs to - the nearest - and the density of its
 * colour, worked out small and read at its nearest pixel. What each layer draws is its group's area.
 */
function areasOf(tones: Tones, groups: string[], brightness: number, contrast: number): Areas {
  const key = [tones.w, tones.h, tones.light[0], tones.light[tones.light.length >> 1], groups.join(","), brightness, contrast].join("|");
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
      centres.forEach((c, k) => {
        const d = Math.sqrt(dist2(here, c));
        dist[at * count + k] = d;
        if (d < nearest) { nearest = d; bestAll[at] = k; }
      });
      nearestAll[at] = nearest;
      want[at * 3] = density(r);
      want[at * 3 + 1] = density(g);
      want[at * 3 + 2] = density(b);
    }
  }
  const made = { w, h, groups: count, dist, nearest: nearestAll, best: bestAll, want };
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

interface Separation { w: number; h: number; maps: Float32Array[] }
const separationCache = new Map<string, Separation>();

/**
 * How much of each of the four plates' pens the photo needs at every point, 0 to 1, laid over each
 * other on white paper. The black takes `blackShare` of the grey the colours would otherwise share
 * - the darkness every channel has in common - and cyan, magenta and yellow make up the rest between
 * them: at each point the amounts whose densities, added up, come nearest the photo's own, none less
 * than nothing or more than solid. Worked out from the pens' own colours, not printing's, so the
 * blend is what these markers will actually make. Worked out small, and read at its nearest pixel.
 */
function separationOf(tones: Tones, plates: string[], brightness: number, contrast: number, blackShare: number): Separation {
  const key = [tones.w, tones.h, tones.light[0], tones.light[tones.light.length >> 1], plates.join(","), brightness, contrast, blackShare].join("|");
  const known = separationCache.get(key);
  if (known) return known;
  const adjust = adjuster(brightness, contrast);
  const scale = Math.min(1, COVER_EDGE / Math.max(tones.w, tones.h));
  const w = Math.max(1, Math.round(tones.w * scale));
  const h = Math.max(1, Math.round(tones.h * scale));
  const inks = plates.map(densityOf);
  const colours = inks.slice(0, 3);
  const black = inks[3];
  const maps = plates.map(() => new Float32Array(w * h));
  const amounts = new Float64Array(3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(tones.h - 1, Math.round((y / Math.max(1, h - 1)) * (tones.h - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(tones.w - 1, Math.round((x / Math.max(1, w - 1)) * (tones.w - 1)));
      const i = (sy * tones.w + sx) * 4;
      const want = [density(adjust(tones.rgba[i])), density(adjust(tones.rgba[i + 1])), density(adjust(tones.rgba[i + 2]))];
      // The grey every channel shares, in the black pen's own terms: as much black as fits in all three.
      const grey = black ? Math.min(want[0] / Math.max(1e-3, black[0]), want[1] / Math.max(1e-3, black[1]), want[2] / Math.max(1e-3, black[2])) : 0;
      const k = Math.min(1, Math.max(0, grey * blackShare));
      const rest = black ? [want[0] - black[0] * k, want[1] - black[1] * k, want[2] - black[2] * k] : want;
      solveInks(colours, rest, amounts);
      const at = y * w + x;
      for (let n = 0; n < 3; n++) maps[n][at] = amounts[n];
      maps[3][at] = k;
    }
  }
  const made = { w, h, maps };
  if (separationCache.size > 6) separationCache.delete(separationCache.keys().next().value!);
  separationCache.set(key, made);
  return made;
}

/**
 * The amounts of some inks, 0 to 1, whose densities added together come nearest `want` in all three
 * channels: a handful of passes over the inks, each set to what fits best given the others.
 */
function solveInks(inks: [number, number, number][], want: number[], out: Float64Array) {
  out.fill(0);
  const residual = [want[0], want[1], want[2]];
  for (let pass = 0; pass < 12; pass++) {
    for (let k = 0; k < inks.length; k++) {
      const d = inks[k];
      const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (dd < 1e-9) continue;
      const was = out[k];
      const r0 = residual[0] + d[0] * was;
      const r1 = residual[1] + d[1] * was;
      const r2 = residual[2] + d[2] * was;
      const best = Math.min(1, Math.max(0, (r0 * d[0] + r1 * d[1] + r2 * d[2]) / dd));
      out[k] = best;
      residual[0] = r0 - d[0] * best;
      residual[1] = r1 - d[1] * best;
      residual[2] = r2 - d[2] * best;
    }
  }
}

/** A CMYK plate, read at a point of the photo (u and v, 0 to 1): -1 where it draws nothing, else how much. */
function plateSampler(tones: Tones, photo: Photo) {
  const sep = separationOf(tones, photo.plates!, photo.brightness, photo.contrast, Math.min(1, Math.max(0, photo.blackShare ?? BLACK_SHARE)));
  const map = sep.maps[PLATES.indexOf(photo.plate!)];
  return (u: number, v: number) => {
    const amount = map[Math.min(sep.h - 1, Math.round(v * (sep.h - 1))) * sep.w + Math.min(sep.w - 1, Math.round(u * (sep.w - 1)))];
    return amount > 0.02 ? amount : -1;
  };
}

/** How dark a part of a photo is, 0 to 1, before its key starts to shade it, unless set. */
export const KEY_FROM = 0.35;

/**
 * A layer of a photo split by colour, read at a point of the photo (u and v, 0 to 1): -1 where it
 * draws nothing, otherwise how much of its ink. A colour layer draws its group's area - widened by
 * the bleed - as much of its pen as comes nearest the photo there. The key shades over all of them.
 */
function colourSampler(tones: Tones, photo: Photo) {
  const areas = areasOf(tones, photo.regions!, photo.brightness, photo.contrast);
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
 * otherwise how far through the band it is, 0 to 1. Brightness, contrast and the crop are applied.
 * A band draws only where the photo's tone falls in it, and grades its lines across its own range;
 * `fromWhite` says whether it's the lightest, which leaves white as paper where the others draw
 * something everywhere in their band, so two bands meet without a gap. Widened by the bleed, into
 * the bands either side: graded across the wider range, what spills over starts sparse and builds,
 * like a haze rather than a second edge.
 */
function toneSampler(tones: Tones, photo: Photo, w: number, h: number) {
  const lift = photo.brightness / 200;
  const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // Split by colour: this layer draws its colour group's area, as much of its pen's ink there as
  // comes nearest the photo's colour - so a pale part of its area gets few lines.
  if (photo.plate && photo.plates?.length === 4) {
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
  const toneAt = (x: number, y: number) => {
    if (x < 0 || x > w || y < 0 || y > h) return -1;
    const d = darknessAt(tones, c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1), lift, gain);
    if (d < lo || d > hi || (d === hi && hi < 1)) return -1;
    return hi > lo ? (d - lo) / (hi - lo) : 1;
  };
  return { toneAt, fromWhite: lo <= 0 };
}

/**
 * Tone as tone lines: one line along each row, waving across it - harder and tighter where the photo
 * is darker, flattening out as it lightens, and lifted off the paper where there's nothing to draw.
 * At black, neighbouring rows' waves just meet. Every other row runs back the way the last came, so
 * the pen goes on from where it stopped. One path, one stroke per run of line.
 */
function waves(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const row = Math.max(0.2, photo.rowMm ?? WAVE_DEFAULTS.rowMm) / 25.4;
  const shortestWave = Math.max(0.2, photo.waveMm ?? WAVE_DEFAULTS.waveMm) / 25.4;
  const { toneAt, fromWhite } = toneSampler(tones, photo, w, h);
  const rad = (photo.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  // Eight looks at the photo to the tightest wave: enough for the wave to read as a curve.
  const step = shortestWave / 8;
  const n = (v: number) => Number(v.toFixed(4));
  // How strongly the line waves for a tone through the band. The lightest band flattens to nothing at
  // white, so white is paper; the others keep a little wave throughout, so bands meet without a gap.
  const strength = (t: number) => (fromWhite ? t : 0.15 + 0.85 * t);
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

// ---------- Outlines ----------

/** The longer side of the grid outlines are traced on: fine enough for a pen, quick to trace. */
const OUTLINE_EDGE = 480;

/** A blur of a grid, a box three times over - near enough a gaussian - `r` cells either way. */
function blurGrid(v: Float32Array, gw: number, gh: number, r: number) {
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
function contour(v: Float32Array, gw: number, gh: number, level: number): number[][][] {
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

/**
 * What a layer of the photo is traced from, on a grid `gw` by `gh` over its box: how dark the photo
 * is at each point - or, for a colour layer, 1 inside its colour's area and 0 outside; for a plate or
 * the key, how much of its pen is wanted there. With the levels a contour is traced at, `count` of
 * them spread across it (a colour layer has just the one, half-way).
 */
function fieldOf(tones: Tones, photo: Photo, gw: number, gh: number, count: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const field = new Float32Array(gw * gh);
  const levels: number[] = [];
  if (photo.plate && photo.plates?.length === 4) {
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
    const areas = areasOf(tones, photo.regions, photo.brightness, photo.contrast);
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

/** The longer side of the grid centerlines are traced on, at most: fine enough for a line a pen draws. */
const CENTER_EDGE = 1000;

/** How far a centerline's curves may stray from the traced points, in grid steps: past a pixel's jag, short of the picture's own bends. */
const FIT_CELLS = 1.5;

/** The eight neighbours of a grid point, clockwise from above, as steps across and down. */
const RING: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * A black-and-white grid worn down to lines one point wide, down the middle of each dark stroke:
 * Zhang-Suen thinning, which peels a point off a stroke's edge only where that leaves the stroke
 * in one piece and doesn't shorten its ends, from each side in turn until nothing more comes off.
 */
function thin(on: Uint8Array, gw: number, gh: number) {
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

const neighbours = (on: Uint8Array, i: number, gw: number) => {
  const out: number[] = [];
  for (const [dx, dy] of RING) if (on[i + dy * gw + dx]) out.push(i + dy * gw + dx);
  return out;
};

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
function distances(on: Uint8Array, gw: number, gh: number): Float32Array {
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
function prune(on: Uint8Array, gw: number, gh: number, dist: Float32Array, shortest: number) {
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

interface Run {
  pts: number[];
  /** What each end meets: a junction's number, or -1 at a free end. */
  ends: [number, number];
  closed: boolean;
}

/**
 * The thinned lines walked into runs, from junction to junction or free end to free end, and the
 * loops that have neither. A junction is the points of three or more lines' meeting, taken together.
 */
function traceRuns(on: Uint8Array, gw: number, gh: number): Run[] {
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
function joinTips(runs: Run[], gw: number, dist: Float32Array, tips: Set<number>): Run[] {
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
function joinRuns(runs: Run[], gw: number): Run[] {
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
function circleOf(pts: Point[], tolerance: number): { cx: number; cy: number; r: number } | null {
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
function circleNodes(c: { cx: number; cy: number; r: number }, from: number, clockwise: boolean): Node[] {
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

/**
 * Line art as centerlines: each dark stroke of the picture drawn once, down its middle, however wide
 * it is - a ring is one circle rather than the two edges of a filled band. The picture is made black
 * and white at `centerFrom`, worn down to lines one point wide, and those are walked into strokes:
 * whiskers off, lines carried straight on through where others cross them, smoothed into curves, and
 * a loop that is a circle drawn as an exact one. Split into bands or colours, each layer traces its
 * own part the same way.
 */
function centerlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // No finer than the picture itself, which has nothing more to say.
  const across = tones.w * (c2 - c0);
  const down = tones.h * (c3 - c1);
  const edge = Math.min(CENTER_EDGE, Math.max(across, down));
  const gw = Math.max(3, Math.round((edge * w) / Math.max(w, h)));
  const gh = Math.max(3, Math.round((edge * h) / Math.max(w, h)));
  const cell = w / (gw - 1);
  const cellY = h / (gh - 1);
  const { field } = fieldOf(tones, photo, gw, gh, 1);
  blurGrid(field, gw, gh, Math.max(0, photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm) / 25.4 / cell);
  // Which points are line: past `centerFrom`; a colour layer's own area; a band's own tones.
  const from = Math.min(0.99, Math.max(0.01, photo.centerFrom ?? CENTER_DEFAULTS.from));
  const colourArea = photo.ink && photo.regions && photo.region !== undefined && !photo.key;
  const toneBand = !photo.plate && !photo.ink && photo.band;
  const lo = colourArea ? 0.5 : toneBand ? Math.max(from, photo.band![0]) : from;
  const hi = toneBand && photo.band![1] < 1 ? photo.band![1] : Infinity;
  const on = new Uint8Array(gw * gh);
  // The grid's own edge stays light, so a line that runs off the picture ends at its edge.
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const v = field[y * gw + x];
    if (v > lo && v <= hi) on[y * gw + x] = 1;
  }
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
  const strokes: Node[][] = [];
  let circles = 0;
  for (const run of runs) {
    let pts = run.pts.map(toPoint);
    // A tip stays where it is and stays sharp.
    const corners: number[] = [];
    run.pts.forEach((g, i) => { if (tips.has(g)) corners.push(i); });
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
    strokes.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS, corners));
  }
  // Drawn in an order that keeps the pen's travel short: each next the nearest to where the last
  // ended, turned round if its far end is nearer.
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
  return { passes: [pathData(ordered)], strokes: ordered.length, widthMm, circles };
}

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
 * spacing the tool fills solid at, and the lightest are left as paper.
 */
function hatch(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const levels = Math.min(4, Math.max(1, Math.round(photo.levels)));
  // Along each line, a look at the photo every half a line-spacing: fine enough that a line stops
  // where the tone does, coarse enough that a big sheet is still quick.
  const step = spacing / 2;
  // Anything shorter than this is a dot, not a line: the pen would only tap the paper.
  const shortest = spacing * 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  const passes: string[] = [];
  let strokes = 0;
  const { toneAt, fromWhite } = toneSampler(tones, photo, w, h);

  for (let k = 0; k < levels; k++) {
    const threshold = fromWhite ? (k + 1) / (levels + 1) : k / levels;
    const rad = ((photo.angle + (k % 2 ? 90 : 0)) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Lines two spacings apart in each pass; the third and fourth passes fall between the first two's.
    const gap = spacing * 2;
    const shift = k >= 2 ? spacing : 0;
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

/** A photo read back from a saved drawing: only a picture and numbers are kept, so check them on the way in. */
export function photoFromData(raw: Record<string, unknown>): Photo | null {
  const src = raw.src;
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    src,
    width: num(raw.width, 1),
    height: num(raw.height, 1),
    brightness: num(raw.brightness, PHOTO_DEFAULTS.brightness),
    contrast: num(raw.contrast, PHOTO_DEFAULTS.contrast),
    angle: num(raw.angle, PHOTO_DEFAULTS.angle),
    spacingMm: num(raw.spacing_mm, 0.3),
    levels: num(raw.levels, PHOTO_DEFAULTS.levels),
    ...(typeof raw.group === "string" ? { group: raw.group } : {}),
    ...(Array.isArray(raw.crop) && raw.crop.length === 4 && raw.crop.every((v) => Number.isFinite(Number(v)))
      ? { crop: raw.crop.map(Number) as [number, number, number, number] }
      : {}),
    ...(raw.fit === "fit" || raw.fit === "fill" ? { fit: raw.fit } : {}),
    ...(raw.style === "waves" || raw.style === "outlines" || raw.style === "centerlines" ? { style: raw.style } : {}),
    ...(Number.isFinite(Number(raw.center_from)) && raw.center_from !== undefined ? { centerFrom: Number(raw.center_from) } : {}),
    ...(Number.isFinite(Number(raw.center_smooth_mm)) && raw.center_smooth_mm !== undefined ? { centerSmoothMm: Number(raw.center_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.center_shortest_mm)) && raw.center_shortest_mm !== undefined ? { centerShortestMm: Number(raw.center_shortest_mm) } : {}),
    ...(Number.isFinite(Number(raw.contours)) && raw.contours !== undefined ? { contours: Number(raw.contours) } : {}),
    ...(Number.isFinite(Number(raw.smooth_mm)) && raw.smooth_mm !== undefined ? { smoothMm: Number(raw.smooth_mm) } : {}),
    ...(typeof raw.ink === "string" ? { ink: raw.ink } : {}),
    ...(Array.isArray(raw.offset_mm) && raw.offset_mm.length === 2 && raw.offset_mm.every((v) => Number.isFinite(Number(v)))
      ? { offsetMm: [Number(raw.offset_mm[0]), Number(raw.offset_mm[1])] as [number, number] }
      : {}),
    ...(Array.isArray(raw.regions) && raw.regions.every((v) => typeof v === "string") ? { regions: raw.regions as string[] } : {}),
    ...(Number.isInteger(Number(raw.region)) && raw.region !== undefined ? { region: Number(raw.region) } : {}),
    ...(raw.key === true ? { key: true } : {}),
    ...(raw.modes && typeof raw.modes === "object" ? { modes: raw.modes as Photo["modes"] } : {}),
    ...(typeof raw.key_ink === "string" ? { keyInk: raw.key_ink } : {}),
    ...(Number.isFinite(Number(raw.key_strength)) && raw.key_strength !== undefined ? { keyStrength: Number(raw.key_strength) } : {}),
    ...(Number.isFinite(Number(raw.key_from)) && raw.key_from !== undefined ? { keyFrom: Number(raw.key_from) } : {}),
    ...(typeof raw.separation === "string" ? { separation: raw.separation } : {}),
    ...(typeof raw.plate === "string" && (PLATES as string[]).includes(raw.plate) ? { plate: raw.plate as Plate } : {}),
    ...(Array.isArray(raw.plates) && raw.plates.every((v) => typeof v === "string") ? { plates: raw.plates as string[] } : {}),
    ...(Number.isFinite(Number(raw.black_share)) && raw.black_share !== undefined ? { blackShare: Number(raw.black_share) } : {}),
    ...(Array.isArray(raw.region_inks) ? { regionInks: raw.region_inks.map((c) => (typeof c === "string" ? c : null)) } : {}),
    ...(Number.isFinite(Number(raw.row_mm)) && raw.row_mm !== undefined ? { rowMm: Number(raw.row_mm) } : {}),
    ...(Number.isFinite(Number(raw.wave_mm)) && raw.wave_mm !== undefined ? { waveMm: Number(raw.wave_mm) } : {}),
    ...(Number.isFinite(Number(raw.bleed)) && raw.bleed !== undefined ? { bleed: Number(raw.bleed) } : {}),
    ...(Number.isFinite(Number(raw.margin)) && raw.margin !== undefined ? { margin: Number(raw.margin) } : {}),
    ...(Array.isArray(raw.band) && raw.band.length === 2 && raw.band.every((v) => Number.isFinite(Number(v)))
      ? { band: [Number(raw.band[0]), Number(raw.band[1])] as [number, number] }
      : {}),
  };
}

/** A photo as the design block keeps it. */
export const photoData = (p: Photo) => ({
  src: p.src, width: p.width, height: p.height, brightness: p.brightness, contrast: p.contrast,
  angle: p.angle, spacing_mm: p.spacingMm, levels: p.levels,
  ...(p.group ? { group: p.group } : {}),
  ...(p.band ? { band: p.band } : {}),
  ...(p.crop ? { crop: p.crop } : {}),
  ...(p.fit ? { fit: p.fit } : {}),
  ...(p.style === "waves" || p.style === "outlines" || p.style === "centerlines" ? { style: p.style } : {}),
  ...(p.centerFrom !== undefined ? { center_from: p.centerFrom } : {}),
  ...(p.centerSmoothMm !== undefined ? { center_smooth_mm: p.centerSmoothMm } : {}),
  ...(p.centerShortestMm !== undefined ? { center_shortest_mm: p.centerShortestMm } : {}),
  ...(p.contours !== undefined ? { contours: p.contours } : {}),
  ...(p.smoothMm !== undefined ? { smooth_mm: p.smoothMm } : {}),
  ...(p.ink ? { ink: p.ink, regions: p.regions, region: p.region } : {}),
  ...(p.key ? { key: true } : {}),
  ...(p.modes ? { modes: p.modes } : {}),
  ...(p.keyInk ? { key_ink: p.keyInk } : {}),
  ...(p.keyStrength !== undefined ? { key_strength: p.keyStrength } : {}),
  ...(p.keyFrom !== undefined ? { key_from: p.keyFrom } : {}),
  ...(p.plate ? { plate: p.plate, plates: p.plates } : {}),
  ...(p.separation ? { separation: p.separation } : {}),
  ...(p.blackShare !== undefined ? { black_share: p.blackShare } : {}),
  ...(p.regionInks ? { region_inks: p.regionInks } : {}),
  ...(p.offsetMm && (p.offsetMm[0] || p.offsetMm[1]) ? { offset_mm: p.offsetMm } : {}),
  ...(p.rowMm !== undefined ? { row_mm: p.rowMm } : {}),
  ...(p.waveMm !== undefined ? { wave_mm: p.waveMm } : {}),
  ...(p.bleed ? { bleed: p.bleed } : {}),
  ...(p.margin !== undefined ? { margin: p.margin } : {}),
});

/** Where a photo layer's lines start on the page, in inches: its box's corner, moved by its offset. */
export const photoOrigin = (photo: Photo, x0: number, y0: number) => ({
  x: x0 + (photo.offsetMm?.[0] ?? 0) / 25.4,
  y: y0 + (photo.offsetMm?.[1] ?? 0) / 25.4,
});
