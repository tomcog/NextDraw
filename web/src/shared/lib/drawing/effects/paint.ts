// Paint: the picture as flat regions of colour, each filled solid in its own pen - painting by
// numbers, finished.

import type { Node } from "../path";
import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { FIT_CELLS } from "../photoDefaults";
import { contour, paintDefaultsOf, paintRegions, shortTravel } from "../photoSample";
import { fitNodes, pathData } from "../path";

export function paint(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
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
