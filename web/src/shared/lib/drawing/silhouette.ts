// The silhouette of a drawing: the outline round everything it draws, holes and the paper inside it
// filled in - what the Varnish layer's "whole drawing" hatches inside, so the glitter covers the
// subject and not the paper round it. Worked out as a picture rather than as geometry: every stroke
// is drawn onto a fine grid at the pen's width, gaps narrower than `closeMm` are closed, everything
// the outside can't reach is filled, and the edge of what's left is traced and thinned to a few
// points - a mask to be tweaked by hand, not a final answer.

import { boxOf, centerOf, drawnRuns, outlinePoints, type Shape } from "./shapes";
import { contour, photoMarks, photoOrigin, simplified } from "./photo";
import { curveStrokes, type Point } from "./parametric";
import type { Node } from "./path";

/** A shape's lines as drawn on the page, in inches: its runs, turned as it is turned. */
function inkRuns(s: Shape): Point[][] {
  const b = boxOf(s);
  let runs: Point[][];
  if (s.kind === "photo" && s.photo) {
    // A photo's own lines, not its box: the silhouette is the subject the lines make.
    const marks = photoMarks(s.photo, b.x1 - b.x0, b.y1 - b.y0);
    const at = photoOrigin(s.photo, b.x0, b.y0);
    runs = [];
    for (const d of marks?.passes ?? []) {
      for (const run of d.split("M").filter(Boolean)) {
        runs.push(run.split("L").map((p) => {
          const [x, y] = p.trim().split(/\s+/).map(Number);
          return { x: at.x + x, y: at.y + y };
        }));
      }
    }
  } else if (s.curve) {
    // A spirograph, spiral or the like: the lines it draws, not the few points it's set by.
    runs = curveStrokes(s);
  } else if (s.kind === "path") {
    runs = drawnRuns(s);
  } else if (s.kind === "text") {
    runs = [[{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }, { x: b.x0, y: b.y0 }]];
  } else {
    runs = [outlinePoints(s)];
  }
  if (!s.rotation) return runs;
  const c = centerOf(s);
  const r = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return runs.map((run) => run.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos })));
}

/**
 * A closed loop thinned to fewer points. Thinning measures each point against the line between a
 * run's two ends, and a loop's ends are the same point, so it's thinned as two halves - from its
 * start to the point furthest from it, and back - and joined again.
 */
function simplifiedLoop(pts: number[][], tolerance: number): number[][] {
  const loop = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
  if (loop.length < 4) return pts;
  let far = 0;
  let farD = -1;
  loop.forEach((p, i) => {
    const d = Math.hypot(p[0] - loop[0][0], p[1] - loop[0][1]);
    if (d > farD) { farD = d; far = i; }
  });
  const first = simplified(loop.slice(0, far + 1), tolerance);
  const second = simplified([...loop.slice(far), loop[0]], tolerance);
  return [...first, ...second.slice(1)];
}

/** How far each cell is from the nearest set one, in cells: a two-pass chamfer, near enough a circle. */
function distanceTo(on: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  const far = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = on[i] ? 0 : far;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Ink drawn onto a grid: which cells a stroke covers, and where the grid sits on the page. */
interface InkGrid { ink: Uint8Array; w: number; h: number; ox: number; oy: number; cell: number }

/**
 * Every stroke of these shapes drawn onto a grid at the pen's width (at least a cell), with `pad`
 * inches of paper round it. `across` is about how many cells the drawing's longer side gets, `minMm`
 * the finest a cell may be.
 */
function inkGrid(shapes: Shape[], penMm: number, pad: number, across: number, minMm: number): InkGrid | null {
  const runs = shapes.flatMap(inkRuns).filter((r) => r.length);
  if (!runs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const run of runs) for (const p of run) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const cell = Math.max(minMm / 25.4, Math.max(x1 - x0, y1 - y0) / across);
  pad += 4 * cell;
  const ox = x0 - pad;
  const oy = y0 - pad;
  const w = Math.ceil((x1 - x0 + 2 * pad) / cell) + 1;
  const h = Math.ceil((y1 - y0 + 2 * pad) / cell) + 1;
  const ink = new Uint8Array(w * h);
  const r = Math.max(0, Math.round(penMm / 25.4 / 2 / cell));
  const mark = (px: number, py: number) => {
    const cx = Math.round((px - ox) / cell);
    const cy = Math.round((py - oy) / cell);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) ink[y * w + x] = 1;
    }
  };
  for (const run of runs) {
    mark(run[0].x, run[0].y);
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)));
      for (let k = 1; k <= steps; k++) mark(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
    }
  }
  return { ink, w, h, ox, oy, cell };
}

/**
 * Made solid: grown by `reach` cells, everything the outside can't reach filled in, then shrunk back
 * by it - gaps narrower than twice `reach` closed, holes filled. A thin part the shrinking took away
 * entirely is the ink itself, kept.
 */
function solidified(ink: Uint8Array, w: number, h: number, reach: number): Float32Array {
  const grown = distanceTo(ink, w, h);
  const thick = new Uint8Array(w * h);
  for (let i = 0; i < thick.length; i++) thick[i] = grown[i] <= reach ? 1 : 0;
  const outside = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let x = 0; x < w; x++) { queue.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
  while (queue.length) {
    const i = queue.pop()!;
    if (outside[i] || thick[i]) continue;
    outside[i] = 1;
    const x = i % w;
    if (x > 0) queue.push(i - 1);
    if (x < w - 1) queue.push(i + 1);
    if (i >= w) queue.push(i - w);
    if (i < w * (h - 1)) queue.push(i + w);
  }
  const fromOutside = distanceTo(outside, w, h);
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i++) field[i] = !outside[i] && fromOutside[i] > reach ? 1 : 0;
  for (let i = 0; i < field.length; i++) if (ink[i]) field[i] = 1;
  return field;
}

/**
 * The edges of a solid field as closed runs of nodes in inches, biggest first. Thinned to `smoothMm`,
 * then further while there are more than `maxPoints` in all - more than a hand can sensibly drag, and
 * past that Studio gives no grip on each point. Specks a couple of millimetres across are dropped.
 */
function tracedLoops(field: Float32Array, { w, h, ox, oy, cell }: InkGrid, smoothMm: number, maxPoints: number, eachLoop = false): Node[][] {
  const traced = contour(field, w, h, 0.5);
  const thin = (loops: number[][][]) => {
    let tolerance = smoothMm / 25.4 / cell;
    let thinned = loops.map((pts) => simplifiedLoop(pts, tolerance));
    while (thinned.reduce((n, pts) => n + pts.length, 0) > maxPoints && tolerance < Math.max(w, h)) {
      tolerance *= 1.5;
      thinned = loops.map((pts) => simplifiedLoop(pts, tolerance));
    }
    return thinned;
  };
  // `eachLoop`: every part kept to `maxPoints` of its own, for parts that each become a path.
  const thinned = eachLoop ? traced.flatMap((pts) => thin([pts])) : thin(traced);
  const loops = thinned
    .filter((pts) => pts.length >= 4)
    .map((pts) => {
      const area = Math.abs(pts.reduce((sum, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0)) / 2;
      return { pts, area };
    })
    .filter((l) => l.area * cell * cell > (2 / 25.4) ** 2)
    .sort((a, b) => b.area - a.area);
  // Only the outer edges: the field was made solid, so the only loops left are outer ones.
  return loops.map(({ pts }) => {
    const nodes: Node[] = pts.map(([x, y]) => ({ x: ox + x * cell, y: oy + y * cell }));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) nodes.push({ x: first.x, y: first.y });
    return nodes;
  });
}

/**
 * The silhouette round these shapes, as closed runs of nodes in inches - one per separate part, the
 * biggest first; none when there's nothing drawn. `penMm` is the line the shapes are drawn with,
 * `closeMm` the widest gap closed over, `smoothMm` how far the outline may stray from the traced edge
 * to have fewer points, and `maxPoints` the most it may have in all, thinned further to fit.
 */
export function silhouetteOf(shapes: Shape[], { penMm = 0.5, closeMm = 4, smoothMm = 0.6, maxPoints = 110 } = {}): Node[][] {
  const close = closeMm / 25.4;
  // Fine enough to follow the subject, coarse enough to stay quick: about 800 cells across.
  const grid = inkGrid(shapes, penMm, close, 800, 0.3);
  if (!grid) return [];
  return tracedLoops(solidified(grid.ink, grid.w, grid.h, close / grid.cell), grid, smoothMm, maxPoints);
}

/**
 * How much of the paper round each cell the ink covers, 0 to 1: the share of inked cells in the
 * square `radius` cells out from it, by a summed-area table so it costs the same at any radius.
 */
function coverage({ ink, w, h }: InkGrid, radius: number): Float32Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += ink[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - radius);
    const b = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const c = Math.max(0, x - radius);
      const d = Math.min(w, x + radius + 1);
      const n = sum[b * (w + 1) + d] - sum[a * (w + 1) + d] - sum[b * (w + 1) + c] + sum[a * (w + 1) + c];
      out[y * w + x] = n / ((b - a) * (d - c));
    }
  }
  return out;
}

/** A layer's ink, read for picking areas out of: worked out once, then clicked in as often as wanted. */
export interface AreaPicker {
  /**
   * The solid patch under this point, in inches, as closed runs of nodes - the edge of the stretch
   * of near-solid ink the point is in, holes filled, each part thinned to `maxPoints` of its own so it
   * can be a path with a grip on every point. None when there's no solid ink there or near it.
   */
  at(p: Point): Node[][];
}

/**
 * Picking out the solid parts of a drawing one at a time: a stripe filled in with close hatching,
 * from the same pen's scattered strokes round it. Solid is where the ink covers at least `solid` of
 * the paper within `windowMm` of a point; a click takes the solid stretch it's in, or the nearest
 * within `reachMm`. Gaps under `closeMm` in its edge are closed over.
 *
 * `penMm` is how thick a stroke is drawn on the grid, and is kept hairline on purpose rather than the
 * pen's real width: at the pen's width a close single hatch fills in and reads as solid as a packed
 * cross-hatch, and the two can't be told apart (measured on a photo's bandana stripes, 2026-10-12).
 */
export function areaPicker(shapes: Shape[], { penMm = 0.1, windowMm = 1.5, solid = 0.6, reachMm = 3, closeMm = 1, smoothMm = 0.4, maxPoints = 110 } = {}): AreaPicker | null {
  // Finer than the whole drawing's silhouette: a hatch's gaps have to show to be told from solid.
  const grid = inkGrid(shapes, penMm, closeMm / 25.4 + windowMm / 25.4, 1600, 0.15);
  if (!grid) return null;
  const { w, h, ox, oy, cell } = grid;
  const radius = Math.max(1, Math.round(windowMm / 25.4 / cell));
  const covered = coverage(grid, radius);
  let fine: Float32Array | undefined;
  return {
    at(p) {
      const px = Math.round((p.x - ox) / cell);
      const py = Math.round((p.y - oy) / cell);
      const dense = (i: number) => covered[i] >= solid;
      // The click, or the nearest solid cell to it: a click on a gap between strokes still counts.
      const near = Math.round(reachMm / 25.4 / cell);
      let seed = -1;
      let best = Infinity;
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = dx * dx + dy * dy;
        if (d < best && d <= near * near && dense(y * w + x)) { best = d; seed = y * w + x; }
      }
      if (seed < 0) return [];
      // The solid stretch it's in, and only that one.
      const region = new Uint8Array(w * h);
      const queue = [seed];
      while (queue.length) {
        const i = queue.pop()!;
        if (region[i] || !dense(i)) continue;
        region[i] = 1;
        const x = i % w;
        if (x > 0) queue.push(i - 1);
        if (x < w - 1) queue.push(i + 1);
        if (i >= w) queue.push(i - w);
        if (i < w * (h - 1)) queue.push(i + w);
      }
      // Averaging over the window pulls the edge in by about the window, so it's let back out by as
      // much - but only where the ink is as solid close up, judged over a much smaller window that
      // the solid patch next door doesn't reach into: never onto the paper, or into looser hatching.
      fine ??= coverage(grid, Math.max(1, Math.round(0.4 / 25.4 / cell)));
      const out = distanceTo(region, w, h);
      for (let i = 0; i < region.length; i++) if (!region[i] && out[i] <= radius + 1 && fine[i] >= solid) region[i] = 1;
      return tracedLoops(solidified(region, w, h, closeMm / 25.4 / cell / 2), grid, smoothMm, maxPoints, true);
    },
  };
}
