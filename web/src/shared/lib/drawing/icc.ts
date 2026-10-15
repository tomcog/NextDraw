// A printer's ICC profile applied to a photo: how much of each of its inks every pixel takes. Read
// here, not by macOS, whose converter refuses profiles of more or fewer inks than four - a Riso set of
// three, extended gamut's seven. Only what printer profiles mostly are: from Lab, through a 16- or 8-bit
// lookup table (mft2, mft1) or a version 4 one (mBA, which IA ECG B1C X uses); the server lists only
// those (server.py, profile_info).

/** A profile's photo-to-ink table, one per rendering intent it has, and its inks' names and colors. */
export interface InkProfile {
  inks: number;
  /** Each ink's name and color, from the profile's colorant table; absent, "Channel 1" and so on. */
  names?: string[];
  colors?: string[];
  /** The same colors as the profile gives them, Lab (D50): what a Photoshop file records for an ink. */
  labs?: [number, number, number][];
  /** Perceptual, relative colorimetric, saturation: whichever the profile has. */
  tables: (Lut | undefined)[];
  /** The paper's white and the inks' darkest black, as XYZ (D50): the profile's wtpt and bkpt, where
   *  it has them. What Absolute colorimetric and black point compensation work from. */
  white?: [number, number, number];
  black?: [number, number, number];
}

interface Lut {
  inputs: number;
  outputs: number;
  /** Grid points along each input: the same for all three in mft2 and mft1, each its own in mBA. */
  grids: number[];
  /** Each curve and the grid as 0 to 1. */
  inCurves: Float32Array[];
  clut: Float32Array;
  outCurves: Float32Array[];
  /** How Lab goes in: mft1 8-bit (L 0-255 for 0-100, a and b +128); mft2 16-bit, L to 0xFF00 for
   *  100; mBA version 4's, L to 0xFFFF. */
  encoding: "mft1" | "mft2" | "v4";
  /** mBA only: a matrix (3x3 then 3 offsets) and curves after the input curves, before the grid. */
  matrix?: number[];
  mCurves?: Float32Array[];
}

/**
 * The rendering intents, as Photoshop's Convert to Profile offers them: the first three are the
 * profile's own tables, in its order; Absolute colorimetric is the relative table, with the photo's
 * white kept as white rather than moved to the paper's - so a paper that isn't white shows.
 */
export const INTENTS = ["Perceptual", "Relative colorimetric", "Saturation", "Absolute colorimetric"] as const;
/** Black point compensation means something only for the colorimetric intents' black; Perceptual and
 *  Saturation already bring the photo's black to the inks' own. Absolute keeps the paper's, as Photoshop. */
export const usesBpc = (intent: number) => intent === 1;

/** How a photo is fitted to a profile's inks: the intent (0 to 3, as INTENTS) and black point compensation. */
export interface Rendering {
  intent?: number;
  bpc?: boolean;
}

/** Read a profile's file. Throws when it isn't one this can apply. */
export function parseProfile(buf: ArrayBuffer): InkProfile {
  const d = new DataView(buf);
  const tag4 = (at: number) => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
  if (tag4(36) !== "acsp" || tag4(20) !== "Lab ") throw new Error("Not a printer profile from Lab");
  const space = tag4(16);
  const inks = space === "CMYK" ? 4 : /^[2-9A-F]CLR$/.test(space) ? parseInt(space[0], 16) : 0;
  if (!inks) throw new Error(`A ${space.trim()} profile isn't one of inks`);
  const version = d.getUint8(8);
  const tags = new Map<string, number>();
  const count = d.getUint32(128);
  for (let i = 0; i < count; i++) tags.set(tag4(132 + 12 * i), d.getUint32(132 + 12 * i + 4));
  const tables = ["B2A0", "B2A1", "B2A2"].map((t) => (tags.has(t) ? readLut(d, tags.get(t)!, tag4) : undefined));
  if (!tables[0]) throw new Error("The profile has no photo-to-ink table Image can read");
  const profile: InkProfile = { inks, tables };
  const xyz = (tag: string): [number, number, number] | undefined => {
    const at = tags.get(tag);
    if (at === undefined || tag4(at) !== "XYZ ") return undefined;
    return [0, 1, 2].map((i) => d.getInt32(at + 8 + 4 * i) / 65536) as [number, number, number];
  };
  profile.white = xyz("wtpt");
  profile.black = xyz("bkpt");
  const clrt = tags.get("clrt");
  if (clrt !== undefined && tag4(clrt) === "clrt") {
    const n = d.getUint32(clrt + 8);
    if (n === inks) {
      profile.names = [];
      profile.colors = [];
      profile.labs = [];
      for (let i = 0; i < n; i++) {
        const at = clrt + 12 + 38 * i;
        let name = "";
        for (let k = 0; k < 32 && d.getUint8(at + k); k++) name += String.fromCharCode(d.getUint8(at + k));
        // The ink's color in Lab: 16-bit, version 2 profiles counting 100 L as 0xFF00, later ones 0xFFFF.
        const full = version >= 4 ? 65535 : 65280;
        const L = (d.getUint16(at + 32) / full) * 100;
        const a = (d.getUint16(at + 34) / full) * 255 - 128;
        const b = (d.getUint16(at + 36) / full) * 255 - 128;
        profile.names.push(name.trim() || `Channel ${i + 1}`);
        profile.colors.push(labHex(L, a, b));
        profile.labs.push([L, a, b]);
      }
    }
  }
  return profile;
}

function readLut(d: DataView, at: number, tag4: (at: number) => string): Lut | undefined {
  const kind = tag4(at);
  if (kind === "mBA ") return readBtoA(d, at);
  if (kind !== "mft2" && kind !== "mft1") return undefined;
  const wide = kind === "mft2";
  const inputs = d.getUint8(at + 8);
  const outputs = d.getUint8(at + 9);
  const grid = d.getUint8(at + 10);
  if (inputs !== 3 || !outputs || grid < 2) return undefined;
  const inEntries = wide ? d.getUint16(at + 48) : 256;
  const outEntries = wide ? d.getUint16(at + 50) : 256;
  let p = at + (wide ? 52 : 48);
  const size = wide ? 2 : 1;
  const value = (q: number) => (wide ? d.getUint16(q) / 65535 : d.getUint8(q) / 255);
  const curve = (entries: number) => {
    const c = new Float32Array(entries);
    for (let i = 0; i < entries; i++, p += size) c[i] = value(p);
    return c;
  };
  const inCurves = Array.from({ length: inputs }, () => curve(inEntries));
  const clut = curve(grid ** inputs * outputs);
  const outCurves = Array.from({ length: outputs }, () => curve(outEntries));
  return { inputs, outputs, grids: [grid, grid, grid], inCurves, clut, outCurves, encoding: wide ? "mft2" : "mft1" };
}

/**
 * A version 4 table, lutBtoAType: B curves, a matrix, M curves, the grid, then A curves - each part
 * optional, found by its offset from the tag's start. Curves are curv or para; each is sampled here
 * into a table so a pixel reads them as it reads mft2's.
 */
function readBtoA(d: DataView, at: number): Lut | undefined {
  const inputs = d.getUint8(at + 8);
  const outputs = d.getUint8(at + 9);
  if (inputs !== 3 || !outputs) return undefined;
  const [bAt, matrixAt, mAt, clutAt, aAt] = [12, 16, 20, 24, 28].map((o) => d.getUint32(at + o));
  if (!clutAt) return undefined;
  const curves = (from: number, n: number) => {
    const out: Float32Array[] = [];
    let p = at + from;
    for (let i = 0; i < n; i++) {
      const [curve, size] = readCurve(d, p);
      out.push(curve);
      p += size + ((4 - (size % 4)) % 4);
    }
    return out;
  };
  const identity = () => Float32Array.from([0, 1]);
  const inCurves = bAt ? curves(bAt, inputs) : Array.from({ length: inputs }, identity);
  const mCurves = mAt ? curves(mAt, inputs) : undefined;
  let matrix: number[] | undefined;
  if (matrixAt) {
    matrix = Array.from({ length: 12 }, (_, i) => d.getInt32(at + matrixAt + 4 * i) / 65536);
    const plain = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    if (matrix.every((v, i) => Math.abs(v - plain[i]) < 1e-6)) matrix = undefined;
  }
  const c = at + clutAt;
  const grids = [0, 1, 2].map((i) => d.getUint8(c + i));
  if (grids.some((g) => g < 2)) return undefined;
  const precision = d.getUint8(c + 16);
  const count = grids[0] * grids[1] * grids[2] * outputs;
  const clut = new Float32Array(count);
  for (let i = 0; i < count; i++) clut[i] = precision === 1 ? d.getUint8(c + 20 + i) / 255 : d.getUint16(c + 20 + 2 * i) / 65535;
  const outCurves = aAt ? curves(aAt, outputs) : Array.from({ length: outputs }, identity);
  return { inputs, outputs, grids, inCurves, clut, outCurves, encoding: "v4", matrix, mCurves };
}

/** A curv or para curve sampled to a table, and how many bytes it takes. */
function readCurve(d: DataView, at: number): [Float32Array, number] {
  const kind = String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
  const sampled = (f: (x: number) => number) => Float32Array.from({ length: 4096 }, (_, i) => f(i / 4095));
  if (kind === "curv") {
    const n = d.getUint32(at + 8);
    if (n === 0) return [Float32Array.from([0, 1]), 12];
    if (n === 1) {
      const gamma = d.getUint16(at + 12) / 256;
      return [sampled((x) => x ** gamma), 14];
    }
    return [Float32Array.from({ length: n }, (_, i) => d.getUint16(at + 12 + 2 * i) / 65535), 12 + 2 * n];
  }
  if (kind === "para") {
    const type = d.getUint16(at + 8);
    const n = [1, 3, 4, 5, 7][type] ?? 1;
    const [g, a = 1, b = 0, cc = 0, dd = 0, e = 0, f = 0] = Array.from({ length: n }, (_, i) => d.getInt32(at + 12 + 4 * i) / 65536);
    const fn = [
      (x: number) => x ** g,
      (x: number) => (x >= -b / a ? (a * x + b) ** g : 0),
      (x: number) => (x >= -b / a ? (a * x + b) ** g + cc : cc),
      (x: number) => (x >= dd ? (a * x + b) ** g : cc * x),
      (x: number) => (x >= dd ? (a * x + b) ** g + e : cc * x + f),
    ][type] ?? ((x: number) => x);
    return [sampled((x) => Math.min(1, Math.max(0, fn(x)))), 12 + 4 * n];
  }
  throw new Error(`A ${kind.trim()} curve isn't one Image can read`);
}

/** A curve read at 0 to 1, straight between its entries. */
const along = (c: Float32Array, x: number) => {
  const t = Math.min(1, Math.max(0, x)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(t));
  return c[i] + (c[i + 1] - c[i]) * (t - i);
};

/**
 * Every pixel's inks, 0 to 1 - 1 the most of that ink - by the profile's table for the intent (see
 * Rendering; one the profile lacks falls back to perceptual). One array per ink, a value per pixel.
 */
export function inksOf(profile: InkProfile, rgba: Uint8ClampedArray, rendering: number | Rendering = 0): Float32Array[] {
  const n = rgba.length >> 2;
  const out = Array.from({ length: profile.inks }, () => new Float32Array(n));
  eachPixelsInks(profile, rgba, rendering, (i, ink, v) => { out[ink][i] = v; });
  return out;
}

/**
 * The same as inksOf, as a byte a pixel the way a Multichannel Photoshop file keeps an ink: 255 none,
 * 0 all of it. A quarter of the memory, which is what lets a whole photo, not just Image's working
 * copy, be split into seven.
 */
export function inkPlanes(profile: InkProfile, rgba: Uint8ClampedArray, rendering: number | Rendering = 0): Uint8Array[] {
  const n = rgba.length >> 2;
  const out = Array.from({ length: profile.inks }, () => new Uint8Array(n));
  eachPixelsInks(profile, rgba, rendering, (i, ink, v) => { out[ink][i] = Math.round((1 - Math.min(1, Math.max(0, v))) * 255); });
  return out;
}

function eachPixelsInks(profile: InkProfile, rgba: Uint8ClampedArray, rendering: number | Rendering, put: (pixel: number, ink: number, value: number) => void) {
  const { intent = 0, bpc = false } = typeof rendering === "number" ? { intent: rendering } : rendering;
  // Absolute colorimetric reads the relative table.
  const lut = profile.tables[intent === 3 ? 1 : intent] ?? profile.tables[0]!;
  const fit = pcsFit(profile, intent, bpc);
  const n = rgba.length >> 2;
  const [, g1, g2] = lut.grids;
  const grids = lut.grids;
  const k = lut.outputs;
  const at = new Float32Array(k);
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    srgbLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], lab, fit);
    // Lab as the table takes it, 0 to 1.
    const u = lut.encoding === "mft1" ? [lab[0] / 100, (lab[1] + 128) / 255, (lab[2] + 128) / 255]
      : lut.encoding === "mft2" ? [(lab[0] / 100) * (65280 / 65535), ((lab[1] + 128) * 256) / 65535, ((lab[2] + 128) * 256) / 65535]
      : [lab[0] / 100, (lab[1] + 128) / 255, (lab[2] + 128) / 255];
    // Through the input curves (and an mBA's matrix and M curves) to grid positions, then between
    // the eight grid points around it.
    let v = [0, 1, 2].map((c) => along(lut.inCurves[c], u[c]));
    if (lut.matrix) {
      const m = lut.matrix;
      v = [0, 1, 2].map((r) => Math.min(1, Math.max(0, m[3 * r] * v[0] + m[3 * r + 1] * v[1] + m[3 * r + 2] * v[2] + m[9 + r])));
    }
    if (lut.mCurves) v = v.map((x, c) => along(lut.mCurves![c], x));
    const pos = v.map((x, c) => x * (grids[c] - 1));
    const base = pos.map((x, c) => Math.min(grids[c] - 2, Math.floor(x)));
    const f = pos.map((v, c) => v - base[c]);
    at.fill(0);
    for (let corner = 0; corner < 8; corner++) {
      const dx = (corner >> 2) & 1, dy = (corner >> 1) & 1, dz = corner & 1;
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      if (!w) continue;
      const cell = (((base[0] + dx) * g1 + base[1] + dy) * g2 + base[2] + dz) * k;
      for (let o = 0; o < k; o++) at[o] += w * lut.clut[cell + o];
    }
    for (let o = 0; o < profile.inks && o < k; o++) put(i, o, along(lut.outCurves[o], at[o]));
  }
}

const D50 = [0.9642, 1, 0.8249];

/**
 * What is done to a pixel's XYZ before it goes through the table, as a scale and an offset per
 * component - or null for nothing, as the perceptual and saturation tables need.
 *
 * Absolute colorimetric: the table's white is the paper's, so a color is moved by D50 / paper white -
 * the photo's white then lands beyond the paper's and takes no ink, and a paper that is darker or
 * warmer than white shows as it is.
 *
 * Black point compensation (Adobe's, as Photoshop does it): the photo's black, 0, is moved to the
 * inks' darkest black - the profile's bkpt, as the relative table sees it - and everything between
 * scaled to meet it, so the shadows keep their detail rather than all clipping to the same black.
 */
function pcsFit(profile: InkProfile, intent: number, bpc: boolean): { scale: number[]; add: number[] } | null {
  const white = profile.white;
  if (intent === 3 && white) return { scale: D50.map((w, c) => w / white[c]), add: [0, 0, 0] };
  if (bpc && usesBpc(intent) && profile.black) {
    // The black as the relative table sees it: moved by the paper's white to D50's.
    const black = profile.black.map((b, c) => (white ? (b * D50[c]) / white[c] : b));
    return { scale: black.map((b, c) => 1 - b / D50[c]), add: black };
  }
  return null;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** An sRGB pixel as Lab under D50, the profile's own white: Bradford-adapted, as ColorSync does -
 *  moved first, where the intent asks (pcsFit). */
function srgbLab(r: number, g: number, b: number, out: number[], fit: { scale: number[]; add: number[] } | null = null) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  let X = 0.4360747 * R + 0.3850649 * G + 0.1430804 * B;
  let Y = 0.2225045 * R + 0.7168786 * G + 0.0606169 * B;
  let Z = 0.0139322 * R + 0.0971045 * G + 0.7141733 * B;
  if (fit) {
    X = X * fit.scale[0] + fit.add[0];
    Y = Y * fit.scale[1] + fit.add[1];
    Z = Z * fit.scale[2] + fit.add[2];
  }
  const x = X / 0.9642, y = Y, z = Z / 0.8249;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
}

/** A Lab color (D50) as sRGB hex: an ink's color for its layer. */
export function labHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = 0.9642 * inv(fx), y = inv(fy), z = 0.8249 * inv(fz);
  const rgb = [
    3.1338561 * x - 1.6168667 * y - 0.4906146 * z,
    -0.9787684 * x + 1.9161415 * y + 0.033454 * z,
    0.0719453 * x - 0.2289914 * y + 1.4052427 * z,
  ].map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  });
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
