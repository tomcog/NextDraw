// Somewhere clear for the signature and the registration blocks: they go in a corner inside the
// Paper card's margin, but not on top of the drawing. The drawing as it will be written out is
// drawn small into a picture, and the spot nearest the usual corner, along the margin, where that
// picture has no ink (with a little room round it) is where they go.
import type { Page } from "../../shared/lib/drawing/shapes";
import type { Point } from "../../shared/lib/drawing/parametric";

/** Where the drawing has ink: a count of inked cells, summed so any box is looked up at once. */
export interface InkMap {
  /** Cells to the inch. */
  perIn: number;
  cols: number;
  rows: number;
  /** sum[(r) * (cols + 1) + c]: the inked cells above and left of row r, column c. */
  sum: Int32Array;
}

const CELLS_PER_IN = 40;
/** Room kept between the drawing and what's placed, in inches (2 mm). */
const ROOM = 2 / 25.4;
/** How far apart the spots tried along the margin are, in inches. */
const STEP = 0.05;

/** The map from a grid of inked cells, `inked[r * cols + c]`. */
export function inkMapOf(inked: ArrayLike<boolean | number>, cols: number, rows: number, perIn: number): InkMap {
  const sum = new Int32Array((cols + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let line = 0;
    for (let c = 0; c < cols; c++) {
      if (inked[r * cols + c]) line++;
      sum[(r + 1) * (cols + 1) + c + 1] = sum[r * (cols + 1) + c + 1] + line;
    }
  }
  return { perIn, cols, rows, sum };
}

/** Whether any ink lies in the box (inches), the room round it included. */
export function inked(map: InkMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const c0 = clamp(Math.floor((x0 - ROOM) * map.perIn), map.cols);
  const r0 = clamp(Math.floor((y0 - ROOM) * map.perIn), map.rows);
  const c1 = clamp(Math.ceil((x1 + ROOM) * map.perIn), map.cols);
  const r1 = clamp(Math.ceil((y1 + ROOM) * map.perIn), map.rows);
  if (c1 <= c0 || r1 <= r0) return false;
  const w = map.cols + 1;
  return map.sum[r1 * w + c1] - map.sum[r0 * w + c1] - map.sum[r1 * w + c0] + map.sum[r0 * w + c0] > 0;
}

/**
 * Where a box of `size` goes: its top-left, at the spot inside the margin nearest the `corner` it
 * usually sits in that is clear of the drawing - tried all the way round the margin, nearest first.
 * `clear` is false when nowhere round the margin is, and the box is left in its corner.
 */
export function clearSpot(map: InkMap | null, page: Page, inset: number, size: { w: number; h: number }, corner: "bl" | "br"): { at: Point; clear: boolean } {
  const left = inset;
  const top = inset;
  const right = Math.max(left, page.w - inset - size.w);
  const bottom = Math.max(top, page.h - inset - size.h);
  const home = { x: corner === "bl" ? left : right, y: bottom };
  if (!map) return { at: home, clear: true };
  const along = (from: number, to: number) => {
    const n = Math.max(1, Math.round((to - from) / STEP));
    return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  };
  const spots: Point[] = [
    ...along(left, right).flatMap((x) => [{ x, y: bottom }, { x, y: top }]),
    ...along(top, bottom).flatMap((y) => [{ x: left, y }, { x: right, y }]),
  ];
  spots.sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
  const found = spots.find((p) => !inked(map, p.x, p.y, p.x + size.w, p.y + size.h));
  return found ? { at: found, clear: true } : { at: home, clear: false };
}

/**
 * The drawing's ink, from the SVG it is written out as: drawn into a picture at 40 cells to the
 * inch, every line at least a cell wide. Lines on the unplotted sources layer don't count. Null if
 * the browser can't draw it, and then nothing is moved.
 */
export async function inkMap(svg: string, page: Page): Promise<InkMap | null> {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    doc.getElementById("studio-sources")?.remove();
    doc.querySelectorAll("g[stroke]").forEach((g) => g.setAttribute("stroke-width", String(1.5 / CELLS_PER_IN)));
    const text = new XMLSerializer().serializeToString(doc);
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const cols = Math.ceil(page.w * CELLS_PER_IN);
      const rows = Math.ceil(page.h * CELLS_PER_IN);
      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, cols, rows);
      const pixels = ctx.getImageData(0, 0, cols, rows).data;
      const cells = new Uint8Array(cols * rows);
      for (let i = 0; i < cells.length; i++) cells[i] = pixels[i * 4 + 3] > 0 ? 1 : 0;
      return inkMapOf(cells, cols, rows, CELLS_PER_IN);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
