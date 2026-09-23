// A photo on the page, drawn as hatching: lines whose spacing follows how dark the photo is there.
// The photo itself is kept - a working copy of it, small enough to travel inside the drawing - with a
// few numbers, and the lines are made from those every time. Nothing here is a shape to edit line by
// line: a photo is tens of thousands of strokes, and it is the photo and its numbers that are edited.

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
  style?: "hatch" | "waves" | "outlines";
  /** Outlines: how many contours, spread across the tones this layer draws. */
  contours?: number;
  /** Outlines: how much fine detail and noise is smoothed away first, in mm on the page. */
  smoothMm?: number;
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
  "style", "angle", "spacingMm", "levels", "rowMm", "waveMm", "contours", "smoothMm", "offsetMm",
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
  const key = [photo.src.length, photo.src.slice(-32), w.toFixed(4), h.toFixed(4), photo.brightness, photo.contrast, photo.angle, photo.spacingMm, photo.levels, photo.band?.join(",") ?? "", photo.crop?.join(",") ?? "", photo.bleed ?? 0, photo.style ?? "hatch", photo.rowMm ?? "", photo.waveMm ?? "", photo.ink ?? "", photo.regions?.join(",") ?? "", photo.region ?? "", photo.contours ?? "", photo.smoothMm ?? "", photo.key ? "key" : "", photo.keyInk ?? "", photo.regionInks?.join(",") ?? "", photo.keyStrength ?? "", photo.keyFrom ?? "", photo.plate ?? "", photo.plates?.join(",") ?? "", photo.blackShare ?? ""].join("|");
  const known = marksCache.get(key);
  if (known) return known;
  const made = photo.style === "waves" ? waves(tones, photo, w, h)
    : photo.style === "outlines" ? outlines(tones, photo, w, h)
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
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const field = new Float32Array(gw * gh);
  const levels: number[] = [];
  const count = Math.max(1, Math.min(40, Math.round(photo.contours ?? OUTLINE_DEFAULTS.contours)));
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
    ...(raw.style === "waves" || raw.style === "outlines" ? { style: raw.style } : {}),
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
  ...(p.style === "waves" || p.style === "outlines" ? { style: p.style } : {}),
  ...(p.contours !== undefined ? { contours: p.contours } : {}),
  ...(p.smoothMm !== undefined ? { smooth_mm: p.smoothMm } : {}),
  ...(p.ink ? { ink: p.ink, regions: p.regions, region: p.region } : {}),
  ...(p.key ? { key: true } : {}),
  ...(p.modes ? { modes: p.modes } : {}),
  ...(p.keyInk ? { key_ink: p.keyInk } : {}),
  ...(p.keyStrength !== undefined ? { key_strength: p.keyStrength } : {}),
  ...(p.keyFrom !== undefined ? { key_from: p.keyFrom } : {}),
  ...(p.plate ? { plate: p.plate, plates: p.plates } : {}),
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
