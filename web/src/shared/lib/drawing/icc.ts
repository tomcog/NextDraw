// A printer's ICC profile applied to a photo: how much of each of its inks every pixel takes. Read
// here, not by macOS, whose converter refuses profiles of more or fewer inks than four - a Riso set of
// three, extended gamut's seven. Only what printer profiles mostly are: from Lab, through a 16- or 8-bit
// lookup table (mft2, mft1); the server lists only those (server.py, profile_info).

/** A profile's photo-to-ink table, one per rendering intent it has, and its inks' names and colors. */
export interface InkProfile {
  inks: number;
  /** Each ink's name and color, from the profile's colorant table; absent, "Channel 1" and so on. */
  names?: string[];
  colors?: string[];
  /** Perceptual, relative colorimetric, saturation: whichever the profile has. */
  tables: (Lut | undefined)[];
}

interface Lut {
  inputs: number;
  outputs: number;
  grid: number;
  /** Each curve and the grid as 0 to 1. */
  inCurves: Float32Array[];
  clut: Float32Array;
  outCurves: Float32Array[];
  /** mft1's Lab is 8-bit: L 0-255 for 0-100, a and b +128; mft2's 16-bit, L to 0xFF00 for 100. */
  eightBit: boolean;
}

/** The rendering intents a profile's tables are for, in the profile's own order. */
export const INTENTS = ["Perceptual", "Relative colorimetric", "Saturation"] as const;

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
  const clrt = tags.get("clrt");
  if (clrt !== undefined && tag4(clrt) === "clrt") {
    const n = d.getUint32(clrt + 8);
    if (n === inks) {
      profile.names = [];
      profile.colors = [];
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
      }
    }
  }
  return profile;
}

function readLut(d: DataView, at: number, tag4: (at: number) => string): Lut | undefined {
  const kind = tag4(at);
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
  return { inputs, outputs, grid, inCurves, clut, outCurves, eightBit: !wide };
}

/** A curve read at 0 to 1, straight between its entries. */
const along = (c: Float32Array, x: number) => {
  const t = Math.min(1, Math.max(0, x)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(t));
  return c[i] + (c[i + 1] - c[i]) * (t - i);
};

/**
 * Every pixel's inks, 0 to 1 - 1 the most of that ink - by the profile's table for the intent (0, 1 or
 * 2; one the profile lacks falls back to perceptual). One array per ink, a value per pixel.
 */
export function inksOf(profile: InkProfile, rgba: Uint8ClampedArray, intent = 0): Float32Array[] {
  const lut = profile.tables[intent] ?? profile.tables[0]!;
  const n = rgba.length >> 2;
  const out = Array.from({ length: profile.inks }, () => new Float32Array(n));
  const g = lut.grid;
  const k = lut.outputs;
  const at = new Float32Array(k);
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    srgbLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], lab);
    // Lab as the table takes it, 0 to 1.
    const u = lut.eightBit ? [lab[0] / 100, (lab[1] + 128) / 255, (lab[2] + 128) / 255]
      : [(lab[0] / 100) * (65280 / 65535), ((lab[1] + 128) * 256) / 65535, ((lab[2] + 128) * 256) / 65535];
    // Through the input curves to grid positions, then between the eight grid points around it.
    const pos = [0, 1, 2].map((c) => along(lut.inCurves[c], u[c]) * (g - 1));
    const base = pos.map((v) => Math.min(g - 2, Math.floor(v)));
    const f = pos.map((v, c) => v - base[c]);
    at.fill(0);
    for (let corner = 0; corner < 8; corner++) {
      const dx = (corner >> 2) & 1, dy = (corner >> 1) & 1, dz = corner & 1;
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      if (!w) continue;
      const cell = (((base[0] + dx) * g + base[1] + dy) * g + base[2] + dz) * k;
      for (let o = 0; o < k; o++) at[o] += w * lut.clut[cell + o];
    }
    for (let o = 0; o < profile.inks && o < k; o++) out[o][i] = along(lut.outCurves[o], at[o]);
  }
  return out;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** An sRGB pixel as Lab under D50, the profile's own white: Bradford-adapted, as ColorSync does. */
function srgbLab(r: number, g: number, b: number, out: number[]) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const x = (0.4360747 * R + 0.3850649 * G + 0.1430804 * B) / 0.9642;
  const y = 0.2225045 * R + 0.7168786 * G + 0.0606169 * B;
  const z = (0.0139322 * R + 0.0971045 * G + 0.7141733 * B) / 0.8249;
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
