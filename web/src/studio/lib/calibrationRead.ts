import type { Calibration } from "../../shared/lib/types";
import { CALIBRATION_COVERS } from "./calibration";
import { boxOf, type Shape } from "./shapes";

// Reading a calibration sheet back from a photo of it. The sheet's corner marks are found in the
// photo, which lines the sheet up with the picture however the camera was held; then the middle of
// every patch is measured against the bare paper beside it, so uneven light across the sheet cancels
// out and what's left is what the pen does to the paper.

type Corner = "top left" | "top right" | "bottom left" | "bottom right";
const CORNERS: Corner[] = ["top left", "top right", "bottom left", "bottom right"];

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Patch { pen: string; cover: string; box: Box }

export interface SheetLayout {
  marks: Record<Corner, { x: number; y: number }>;
  patches: Patch[];
}

const coverKey = (cover: number) => `${Math.round(cover * 1000) / 10}`;
const COVER_KEYS = CALIBRATION_COVERS.map(coverKey);
const PATCH_NAME = new RegExp(`^(.+) (${COVER_KEYS.map((k) => k.replace(".", "\\.")).join("|")})%$`);

/** Where the sheet's marks and patches are, in inches, or null when the drawing isn't a sheet. */
export function sheetLayout(shapes: Shape[]): SheetLayout | null {
  const marks = {} as SheetLayout["marks"];
  for (const corner of CORNERS) {
    const mark = shapes.find((s) => s.name === `Corner mark ${corner}`);
    if (!mark) return null;
    const b = boxOf(mark);
    marks[corner] = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  }
  const patches: Patch[] = [];
  for (const s of shapes) {
    const m = s.kind === "rect" ? PATCH_NAME.exec(s.name ?? "") : null;
    if (m) patches.push({ pen: m[1], cover: m[2], box: boxOf(s) });
  }
  return patches.length ? { marks, patches } : null;
}

/* ---------- Pixels ---------- */

const WORKING = 2400; // the photo is read at most this many pixels across

interface Picture { w: number; h: number; data: Uint8ClampedArray }

async function pictureOf(file: File): Promise<Picture> {
  const bitmap = await createImageBitmap(file); // turned the way the camera says it was held
  const scale = Math.min(1, WORKING / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can’t read the photo.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => toLinear(v));
const toByte = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const hexOf = (rgb: number[]) => `#${rgb.map((c) => toByte(c).toString(16).padStart(2, "0")).join("")}`;
const linearOf = (hex: string) => [1, 3, 5].map((i) => LINEAR[parseInt(hex.slice(i, i + 2), 16)]);

/* ---------- Finding the corner marks ---------- */

interface Blob { x: number; y: number; size: number }

/**
 * The solid dark squares in the photo: patches of ink that fill most of their own box, square-ish,
 * clear of the photo's edge (a dark table round the paper touches it), and neither specks nor
 * half the picture.
 */
function darkSquares(pic: Picture): Blob[] {
  const { w, h, data } = pic;
  const light = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) light[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  // Dark against the paper, which is most of a photo of a sheet: under half its brightness.
  const sorted = Float32Array.from(light).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)];
  const dark = paper * 0.5;

  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const smallest = (Math.max(w, h) * 0.004) ** 2;
  const largest = (Math.max(w, h) * 0.06) ** 2;
  const blobs: Blob[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || light[start] >= dark) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    let count = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, edge = false;
    while (top) {
      const at = stack[--top];
      const x = at % w;
      const y = (at - x) / w;
      count++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      const around = [x > 0 ? at - 1 : -1, x < w - 1 ? at + 1 : -1, y > 0 ? at - w : -1, y < h - 1 ? at + w : -1];
      for (const n of around) {
        if (n >= 0 && label[n] === -1 && light[n] < dark) {
          label[n] = next;
          stack[top++] = n;
        }
      }
    }
    next++;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (edge || count < smallest || count > largest) continue;
    if (count / (bw * bh) < 0.6 || bw / bh < 0.6 || bw / bh > 1.6) continue;
    blobs.push({ x: sx / count, y: sy / count, size: Math.sqrt(count) });
  }
  return blobs;
}

/** The four marks: of the dark squares, the one furthest into each corner of the photo. */
function findMarks(pic: Picture): Record<Corner, Blob> | null {
  const blobs = darkSquares(pic);
  if (blobs.length < 4) return null;
  const toward: Record<Corner, (b: Blob) => number> = {
    "top left": (b) => -(b.x + b.y),
    "top right": (b) => b.x - b.y,
    "bottom left": (b) => b.y - b.x,
    "bottom right": (b) => b.x + b.y,
  };
  const found = {} as Record<Corner, Blob>;
  for (const corner of CORNERS) found[corner] = blobs.reduce((best, b) => (toward[corner](b) > toward[corner](best) ? b : best));
  if (new Set(Object.values(found)).size < 4) return null;
  // The marks are all one size: a different one is a patch or the table, not a mark.
  const sizes = CORNERS.map((c) => found[c].size);
  if (Math.max(...sizes) > 1.6 * Math.min(...sizes)) return null;
  return found;
}

/* ---------- From the sheet to the photo ---------- */

type Homography = number[]; // 3x3, row by row, the last entry 1

/** The perspective that carries the sheet's four points onto the photo's. */
function homography(from: { x: number; y: number }[], to: { x: number; y: number }[]): Homography | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination on the 8 x 9 system.
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-12) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [...a.map((row, i) => row[8] / row[i]), 1];
}

const project = (m: Homography, x: number, y: number) => {
  const d = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d };
};

/** The average colour, in linear light, of a box on the sheet: a grid of points across its middle. */
function average(pic: Picture, m: Homography, box: Box, share: number): number[] {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const hw = ((box.x1 - box.x0) * share) / 2;
  const hh = ((box.y1 - box.y0) * share) / 2;
  const sum = [0, 0, 0];
  let n = 0;
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const p = project(m, cx - hw + (2 * hw * i) / (steps - 1), cy - hh + (2 * hh * j) / (steps - 1));
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // A few pixels round each point, so single lines of a sparse patch average out.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= pic.w || py >= pic.h) continue;
          const at = (py * pic.w + px) * 4;
          sum[0] += LINEAR[pic.data[at]];
          sum[1] += LINEAR[pic.data[at + 1]];
          sum[2] += LINEAR[pic.data[at + 2]];
          n++;
        }
      }
    }
  }
  if (!n) throw new Error("Part of the sheet is outside the photo. Take it again with the whole sheet in view.");
  return sum.map((v) => v / n);
}

/* ---------- Reading it ---------- */

const PAPER_SPOT = 0.12; // in: the bare paper measured either side of each pen's patches, this wide
const PAPER_AWAY = 0.15; // and this far from them

/**
 * Measure a photo of a plotted calibration sheet. Each pen's colour at each strength is its patch
 * against the paper either side of that pen's row, set on `paper` - the colour the paper is taken to
 * be - so a sheet photographed under warm light or in shadow still reads as it looks in daylight.
 */
export async function readCalibration(file: File, layout: SheetLayout, paper: string): Promise<Calibration> {
  const pic = await pictureOf(file);
  const found = findMarks(pic);
  if (!found) {
    throw new Error("Couldn’t find the four corner marks. Photograph the whole sheet, flat and evenly lit, with some space round it.");
  }
  const m = homography(CORNERS.map((c) => layout.marks[c]), CORNERS.map((c) => found[c]));
  if (!m) throw new Error("The corner marks don’t make a sheet. Take the photo again, straighter on.");

  const paperLinear = linearOf(paper);
  const byPen = new Map<string, Patch[]>();
  for (const p of layout.patches) byPen.set(p.pen, [...(byPen.get(p.pen) ?? []), p]);

  const pens: Calibration["pens"] = {};
  for (const [pen, patches] of byPen) {
    const x0 = Math.min(...patches.map((p) => p.box.x0));
    const x1 = Math.max(...patches.map((p) => p.box.x1));
    const y0 = Math.min(...patches.map((p) => p.box.y0));
    const y1 = Math.max(...patches.map((p) => p.box.y1));
    const spot = (x: number): Box => ({ x0: x - PAPER_SPOT / 2, x1: x + PAPER_SPOT / 2, y0, y1 });
    const left = average(pic, m, spot(x0 - PAPER_AWAY), 0.5);
    const right = average(pic, m, spot(x1 + PAPER_AWAY), 0.5);
    const covers: Record<string, string> = {};
    for (const patch of patches) {
      // The paper under this patch, from the paper either side, weighted by how near each is.
      const t = ((patch.box.x0 + patch.box.x1) / 2 - (x0 - PAPER_AWAY)) / (x1 - x0 + 2 * PAPER_AWAY);
      const under = left.map((l, i) => l * (1 - t) + right[i] * t);
      const seen = average(pic, m, patch.box, 0.5);
      covers[patch.cover] = hexOf(seen.map((v, i) => Math.min(1, v / Math.max(1e-4, under[i])) * paperLinear[i]));
    }
    pens[pen] = covers;
  }
  return { measured: new Date().toISOString().slice(0, 10), paper, pens };
}

/** What a reading is worth trusting: the solid patches should be well darker than the paper. */
export function readingProblems(calibration: Calibration): string[] {
  const faint = Object.entries(calibration.pens)
    .filter(([, covers]) => covers["100"] && Math.max(...linearOf(covers["100"])) > 0.97 && Math.min(...linearOf(covers["100"])) > 0.9)
    .map(([pen]) => pen);
  return faint.length ? [`${faint.join(", ")} read as almost paper: check they were plotted, or retake the photo.`] : [];
}
