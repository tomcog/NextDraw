// Knocking out: a shape - a name set in outlined letters, say - laid over the drawing, and every line
// on every other layer cut away inside it, so the paper shows through in that shape. The same cut as
// Fill's crop (crop.ts), with the shape in place of the box. A stretch that never comes near the mask
// is kept exactly as it was, curve and all; one that does is walked out and cut where it crosses.
//
// The mask is read the way an SVG fill is: each run a closed outline, whether or not it was closed,
// the even-odd way within one shape - so the hole in an "o" stays a hole - and every shape of the
// mask added together, so letters that overlap knock out as one. It is also grown by `gap`: half the
// pen's width, so the ink of a line that stops at the edge stops at the edge too, not half a line in.

import type { Fill } from "./hatch";
import { fillTarget } from "./hatch";
import type { StrokeFont } from "./font";
import { fillMarks, markNodes, markRuns } from "./marks";
import { flattenRun, type Node } from "./path";
import type { Point } from "./parametric";
import { groupsOf, newGroupId, newLayerId, newShapeId, pointsBox, scaleInto, type Shape } from "./shapes";

interface Box { x0: number; y0: number; x1: number; y1: number }

/** The area a knockout cuts away, ready to be asked about quickly. */
export interface KnockoutArea {
  /** How far round the outlines it reaches as well, in inches. */
  gap: number;
  /** Round the outlines, the gap included: nothing outside it is touched. */
  box: Box;
  /** Every edge of every outline: ax, ay, bx, by, and which shape it belongs to. */
  edges: Float64Array;
  shapeOf: Int32Array;
  shapes: number;
  /** Edges by cell, for what's near a stretch of line. */
  grid: { cols: number; rows: number; cell: number; cells: Int32Array[] };
  /** Edges by band across, for whether a point is inside. */
  bands: { count: number; height: number; lists: Int32Array[] };
}

const EPS = 1e-9;
/** Kept pieces shorter than this (inches, 0.1 mm) are only a dot of ink: left out. */
const STUB = 0.1 / 25.4;

const overlaps = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * The area these shapes cover, as filled shapes, grown by `gap` inches. Null when there is nothing
 * closed in them to cut with: a single line, or text set in a single-stroke font.
 */
export function knockoutArea(maskShapes: Shape[], fonts: Record<string, StrokeFont>, gap: number): KnockoutArea | null {
  const outlines: Point[][][] = [];
  for (const s of maskShapes) {
    // The outline even where it isn't drawn: a mask made from a hatched shape still has its shape.
    const runs = markRuns({ ...s, outline: true }, fonts[s.font ?? ""]).filter((r) => r.length > 2);
    if (runs.length) outlines.push(runs);
  }
  if (!outlines.length) return null;
  const list: number[] = [];
  const owner: number[] = [];
  outlines.forEach((runs, si) => {
    for (const run of runs) {
      for (let i = 0; i < run.length; i++) {
        const a = run[i], b = run[(i + 1) % run.length];
        if (Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12) continue;
        list.push(a.x, a.y, b.x, b.y);
        owner.push(si);
      }
    }
  });
  if (!owner.length) return null;
  const edges = Float64Array.from(list);
  const shapeOf = Int32Array.from(owner);
  const inner = pointsBox(outlines.flat(2));
  const box = { x0: inner.x0 - gap, y0: inner.y0 - gap, x1: inner.x1 + gap, y1: inner.y1 + gap };
  const w = Math.max(box.x1 - box.x0, 1e-6), h = Math.max(box.y1 - box.y0, 1e-6);

  // About 200 cells across the longer side, none smaller than a hundredth of an inch.
  const cell = Math.max(Math.max(w, h) / 200, 0.01);
  const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const count = 256;
  const height = h / count;
  const bandBuckets: number[][] = Array.from({ length: count }, () => []);
  for (let e = 0; e < owner.length; e++) {
    const ax = edges[e * 4], ay = edges[e * 4 + 1], bx = edges[e * 4 + 2], by = edges[e * 4 + 3];
    const c0 = Math.floor((Math.min(ax, bx) - gap - box.x0) / cell), c1 = Math.floor((Math.max(ax, bx) + gap - box.x0) / cell);
    const r0 = Math.floor((Math.min(ay, by) - gap - box.y0) / cell), r1 = Math.floor((Math.max(ay, by) + gap - box.y0) / cell);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) buckets[r * cols + c].push(e);
    }
    const b0 = Math.floor((Math.min(ay, by) - box.y0) / height), b1 = Math.floor((Math.max(ay, by) - box.y0) / height);
    for (let b = Math.max(0, b0); b <= Math.min(count - 1, b1); b++) bandBuckets[b].push(e);
  }
  return {
    gap, box, edges, shapeOf, shapes: outlines.length,
    grid: { cols, rows, cell, cells: buckets.map((b) => Int32Array.from(b)) },
    bands: { count, height, lists: bandBuckets.map((b) => Int32Array.from(b)) },
  };
}

/** Whether a point is inside any shape of the mask (the gap not counted: that is measured apart). */
function insideMask(area: KnockoutArea, x: number, y: number, parity: Uint8Array): boolean {
  const { box, bands, edges, shapeOf } = area;
  if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return false;
  const band = Math.min(bands.count - 1, Math.max(0, Math.floor((y - box.y0) / bands.height)));
  parity.fill(0);
  for (const e of bands.lists[band]) {
    const ay = edges[e * 4 + 1], by = edges[e * 4 + 3];
    if ((ay > y) === (by > y)) continue;
    const ax = edges[e * 4], bx = edges[e * 4 + 2];
    const xi = ax + ((y - ay) / (by - ay)) * (bx - ax);
    if (xi > x) parity[shapeOf[e]] ^= 1;
  }
  for (let i = 0; i < parity.length; i++) if (parity[i]) return true;
  return false;
}

/** Where along p→q (0 to 1) it is within `g` of the edge a→b: one span, or none. */
function nearSpan(px: number, py: number, dx: number, dy: number, ax: number, ay: number, bx: number, by: number, g: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const take = (t0: number, t1: number) => {
    if (t1 < t0) return;
    if (t0 < lo) lo = t0;
    if (t1 > hi) hi = t1;
  };
  // Round each end of the edge.
  const disk = (cx: number, cy: number) => {
    const fx = px - cx, fy = py - cy;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - g * g;
    if (A < 1e-24) {
      if (C <= 0) take(-Infinity, Infinity);
      return;
    }
    const disc = B * B - 4 * A * C;
    if (disc < 0) return;
    const s = Math.sqrt(disc);
    take((-B - s) / (2 * A), (-B + s) / (2 * A));
  };
  disk(ax, ay);
  disk(bx, by);
  // The band along it: along the edge between its ends, and no further off it than g.
  const ex = bx - ax, ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len > 1e-12) {
    const ux = ex / len, uy = ey / len;
    let t0 = -Infinity, t1 = Infinity;
    // value(t) = v0 + t * dv, wanted between min and max
    const within = (v0: number, dv: number, min: number, max: number) => {
      if (Math.abs(dv) < 1e-15) {
        if (v0 < min || v0 > max) { t0 = Infinity; t1 = -Infinity; }
        return;
      }
      let a = (min - v0) / dv, b = (max - v0) / dv;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    };
    within((px - ax) * ux + (py - ay) * uy, dx * ux + dy * uy, 0, len);
    within(-(px - ax) * uy + (py - ay) * ux, -dx * uy + dy * ux, -g, g);
    take(t0, t1);
  }
  if (hi < lo) return null;
  const a = Math.max(0, lo), b = Math.min(1, hi);
  return b > a ? [a, b] : null;
}

/** The spans of p→q (0 to 1) the mask takes away, in order and not overlapping. */
function removedSpans(area: KnockoutArea, p: Point, q: Point, stamp: Int32Array, mark: { n: number }, parity: Uint8Array): [number, number][] {
  const { box, gap, grid, edges } = area;
  const sb = { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  if (!overlaps(sb, box)) return [];
  const dx = q.x - p.x, dy = q.y - p.y;
  const spans: [number, number][] = [];
  const cuts: number[] = [0, 1];
  mark.n++;
  const c0 = Math.max(0, Math.floor((sb.x0 - box.x0) / grid.cell)), c1 = Math.min(grid.cols - 1, Math.floor((sb.x1 - box.x0) / grid.cell));
  const r0 = Math.max(0, Math.floor((sb.y0 - box.y0) / grid.cell)), r1 = Math.min(grid.rows - 1, Math.floor((sb.y1 - box.y0) / grid.cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const e of grid.cells[r * grid.cols + c]) {
        if (stamp[e] === mark.n) continue;
        stamp[e] = mark.n;
        const ax = edges[e * 4], ay = edges[e * 4 + 1], bx = edges[e * 4 + 2], by = edges[e * 4 + 3];
        // Where it crosses the outline: the places inside can begin or end.
        const ex = bx - ax, ey = by - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > 1e-18) {
          const t = ((ax - p.x) * ey - (ay - p.y) * ex) / den;
          const u = ((ax - p.x) * dy - (ay - p.y) * dx) / den;
          if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) cuts.push(t);
        }
        if (gap > 0) {
          const near = nearSpan(p.x, p.y, dx, dy, ax, ay, bx, by, gap);
          if (near) spans.push(near);
        }
      }
    }
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const t0 = cuts[i - 1], t1 = cuts[i];
    if (t1 - t0 < 1e-12) continue;
    const m = (t0 + t1) / 2;
    if (insideMask(area, p.x + dx * m, p.y + dy * m, parity)) spans.push([t0, t1]);
  }
  if (!spans.length) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[spans[0][0], spans[0][1]]];
  for (const [a, b] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

const runLength = (run: Node[]) => flattenRun(run).reduce((sum, p, i, all) => (i ? sum + Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) : 0), 0);

/** Scratch space for one knockout, so nothing is allocated per stretch of line. */
function scratch(area: KnockoutArea) {
  return { stamp: new Int32Array(area.shapeOf.length), mark: { n: 0 }, parity: new Uint8Array(area.shapes) };
}

/**
 * A run with the mask taken out of it: the runs that are left, or null if the mask doesn't touch it
 * (then it stays exactly as it is). Stretches clear of the mask keep their curves; stretches near it
 * are walked out into points and cut where they cross.
 */
export function knockOutRun(run: Node[], area: KnockoutArea, work = scratch(area)): Node[][] | null {
  if (run.length < 2) return null;
  const out: Node[][] = [];
  // The run being built, in a box so the helpers below can start and end it.
  const st: { cur: Node[] | null } = { cur: null };
  let touched = false;
  let startsAtStart = true;
  const begin = (p: Point): Node[] => {
    if (st.cur) out.push(st.cur);
    st.cur = [{ x: p.x, y: p.y }];
    return st.cur;
  };
  const end = () => {
    if (st.cur) out.push(st.cur);
    st.cur = null;
  };
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], z = run[i];
    const curved = !!(a.out || z.in);
    const hull = pointsBox(curved ? [a, a.out ?? a, z.in ?? z, z] : [a, z]);
    if (!overlaps(hull, area.box)) {
      const cur = st.cur ?? begin(a);
      if (curved) {
        cur[cur.length - 1].out = a.out ?? { x: a.x, y: a.y };
        cur.push({ x: z.x, y: z.y, in: z.in ?? { x: z.x, y: z.y } });
      } else cur.push({ x: z.x, y: z.y });
      continue;
    }
    const pts = curved ? flattenRun([{ x: a.x, y: a.y, out: a.out }, { x: z.x, y: z.y, in: z.in }]) : [a, z];
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      const gone = removedSpans(area, p, q, work.stamp, work.mark, work.parity);
      if (!gone.length) {
        (st.cur ?? begin(p)).push({ x: q.x, y: q.y });
        continue;
      }
      touched = true;
      let t = 0;
      const keep = (t0: number, t1: number) => {
        if (t1 - t0 < 1e-9) return;
        const from = { x: p.x + (q.x - p.x) * t0, y: p.y + (q.y - p.y) * t0 };
        const to = { x: p.x + (q.x - p.x) * t1, y: p.y + (q.y - p.y) * t1 };
        (t0 > 1e-9 || !st.cur ? begin(from) : st.cur).push(to);
      };
      for (const [g0, g1] of gone) {
        keep(t, g0);
        if (g0 <= 1e-9 && i === 1 && k === 1) startsAtStart = false;
        end();
        t = g1;
      }
      keep(t, 1);
    }
  }
  if (!touched) return null;
  const endsAtEnd = st.cur !== null;
  if (st.cur) out.push(st.cur);
  const closed = Math.hypot(run[0].x - run[run.length - 1].x, run[0].y - run[run.length - 1].y) < 1e-9;
  if (closed && startsAtStart && endsAtEnd && out.length > 1
    && Math.hypot(out[0][0].x - run[0].x, out[0][0].y - run[0].y) < 1e-9) {
    // The last piece runs on into the first, round the start of the loop.
    const first = out.shift()!;
    const last = out.pop()!;
    if (first[0].out) last[last.length - 1].out = first[0].out;
    out.push([...last, ...first.slice(1)]);
  }
  return out.filter((r) => r.length > 1 && runLength(r) >= STUB);
}

const isTrim = (s: Shape) => s.curve?.kind === "trim";

/** A path shape drawing these runs, in the place of `from`: its layer, group and name. */
function pathShape(from: Shape, runs: Node[][], id: string): Shape {
  const b = pointsBox(runs.flatMap((run) => flattenRun(run)));
  return {
    id, kind: "path", layerId: from.layerId, runs, points: undefined,
    x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    ...(from.group ? { group: from.group, groupName: from.groupName } : {}),
    ...(from.name ? { name: from.name } : {}),
  };
}

/** Each run cut, and whether any of them was. */
function cutAll(runs: Node[][], area: KnockoutArea, work: ReturnType<typeof scratch>): { runs: Node[][]; touched: boolean } {
  let touched = false;
  const kept: Node[][] = [];
  for (const run of runs) {
    const cut = knockOutRun(run, area, work);
    if (cut) {
      touched = true;
      for (const r of cut) kept.push(r);
    } else if (run.length > 1) kept.push(run);
  }
  return { runs: kept, touched };
}

/**
 * The drawing with the mask knocked out of it. A shape the mask doesn't touch stays as it is; one it
 * does becomes a path of what's left of its lines, its fills beside it as a path of their own, cut the
 * same way. Pictures still to be made into lines are left alone - turn them into lines first - and so
 * are trim marks, which sit round the drawing. `cut` is how many shapes were cut.
 */
export function knockOutDrawing(shapes: Shape[], fills: Fill[], area: KnockoutArea, fonts: Record<string, StrokeFont>): { shapes: Shape[]; fills: Fill[]; cut: number } {
  const work = scratch(area);
  const out: Shape[] = [];
  const gone = new Set<string>();
  const goneFills = new Set<string>();
  const groups = groupsOf(shapes);
  let cut = 0;
  for (const s of shapes) {
    if (s.kind === "photo" || isTrim(s)) {
      out.push(s);
      continue;
    }
    const own = cutAll(markNodes(s, fonts[s.font ?? ""]), area, work);
    const filled = cutAll(fillMarks(s, fills).map((run) => run.map((p) => ({ x: p.x, y: p.y }))), area, work);
    if (!own.touched && !filled.touched) {
      out.push(s);
      continue;
    }
    cut++;
    gone.add(s.id);
    if (own.runs.length) out.push(pathShape(s, own.runs, s.id));
    if (filled.runs.length) out.push(pathShape(s, filled.runs, own.runs.length ? newShapeId() : s.id));
  }
  // A fill made for a whole shape of several paths: its lines cut too, and kept beside the shape.
  for (const f of fills) {
    const members = groups.get(f.shapeId);
    if (!members) continue;
    const target = fillTarget(shapes, f.shapeId);
    if (!target) continue;
    const lines = cutAll(fillMarks(target, [f]).map((run) => run.map((p) => ({ x: p.x, y: p.y }))), area, work);
    if (!lines.touched) continue;
    goneFills.add(f.id);
    cut++;
    if (lines.runs.length) out.push(pathShape(members[0], lines.runs, newShapeId()));
  }
  return { shapes: out, fills: fills.filter((f) => !gone.has(f.shapeId) && !goneFills.has(f.id)), cut };
}

// ---- The Knockout layer: a live mask kept in the drawing ----
//
// The shapes on a layer named Knockout are the mask. They are never plotted - the layer is written to
// the file as "%Knockout", which NextDraw and Plot skip - and they stay shapes like any other, to be
// moved, sized, hidden or deleted. Every other layer is cut by them as the drawing is written out
// (buildSvg), so the file Plot plots already has the paper showing through, while the shapes under
// them are kept whole in the file too, on another skipped layer, for the apps to read back.

export const KNOCKOUT = "Knockout";
/** How the layer is called in the file: the % is what keeps NextDraw from plotting it. */
export const KNOCKOUT_FILE_LABEL = `%${KNOCKOUT}`;
/** The swatch the layer shows in the lists. Never plotted, so never a pen's color. */
export const KNOCKOUT_COLOR = "#8a8f98";
/**
 * How far past its outlines the knockout cuts, in mm: half the line of a typical pen, so the ink of a
 * line stopping at the edge stops at the edge. One number for every app and pen, so what the preview
 * shows and what the file plots always agree.
 */
export const KNOCKOUT_GAP_MM = 0.25;
export const knockoutGapIn = () => KNOCKOUT_GAP_MM / 25.4;

export const isKnockoutLayer = (name: string) => name.trim().toLowerCase() === KNOCKOUT.toLowerCase();

/** The shapes the knockout is made of: everything on a Knockout layer that isn't hidden. */
export function knockoutShapes<L extends { id: string; name: string; hidden?: boolean }>(shapes: Shape[], layers: L[]): Shape[] {
  const on = new Set(layers.filter((l) => isKnockoutLayer(l.name) && !l.hidden).map((l) => l.id));
  return on.size ? shapes.filter((s) => on.has(s.layerId)) : [];
}

/** The knockout's outlines as path data in inches on the page, one path per shape: for the preview. */
export function knockoutPaths(maskShapes: Shape[], fonts: Record<string, StrokeFont>): string[] {
  return maskShapes
    .map((s) => markRuns({ ...s, outline: true }, fonts[s.font ?? ""])
      .filter((r) => r.length > 2)
      .map((r) => `M${r.map((p) => `${+p.x.toFixed(5)} ${+p.y.toFixed(5)}`).join("L")}Z`)
      .join(""))
    .filter(Boolean);
}

/** One run of nodes with every point put through `f`. */
const mapRun = (run: Node[], f: (p: Point) => Point): Node[] => run.map((n) => ({
  ...f(n),
  ...(n.in ? { in: f(n.in) } : {}),
  ...(n.out ? { out: f(n.out) } : {}),
}));

/**
 * Cutting for the file: what buildSvg asks of each shape and fill while a knockout is on. Each answer
 * is the lines left in inches on the page, or null when the knockout doesn't touch it and it is
 * written as it always is.
 */
export interface KnockoutCutter {
  /** A shape's own lines - its copies and turn worked in - cut. */
  shape: (s: Shape) => Node[][] | null;
  /** A fill's lines, from the shape (or group) it fills, cut. */
  fill: (target: Shape, fill: Fill) => Node[][] | null;
  /** Runs in a frame of their own - a photo's lines, in its corner - cut in that frame: `toPage`
   *  takes a point of them onto the page, `fromPage` brings it back. */
  local: (runs: Node[][], toPage: (p: Point) => Point, fromPage: (p: Point) => Point) => Node[][] | null;
}

export function knockoutCutter(maskShapes: Shape[], fonts: Record<string, StrokeFont>, gap = knockoutGapIn()): KnockoutCutter | null {
  const area = maskShapes.length ? knockoutArea(maskShapes, fonts, gap) : null;
  if (!area) return null;
  const work = scratch(area);
  const cut = (runs: Node[][]) => {
    const done = cutAll(runs, area, work);
    return done.touched ? done.runs : null;
  };
  return {
    shape: (s) => cut(markNodes(s, fonts[s.font ?? ""])),
    fill: (target, fill) => cut(fillMarks(target, [fill]).map((run) => run.map((p) => ({ x: p.x, y: p.y })))),
    local: (runs, toPage, fromPage) => {
      const done = cut(runs.map((r) => mapRun(r, toPage)));
      return done && done.map((r) => mapRun(r, fromPage));
    },
  };
}

/**
 * A knockout read from a file - a name in outlined letters, say - ready to lay over the drawing: every
 * closed shape in it, as one group named after the file, scaled to `width` inches across and centered
 * on `at`. Null, with the reason, when there's nothing in it to knock out with.
 */
export function placedKnockout(file: { shapes: Shape[]; unsupported: number }, name: string, layerId: string, at: Point, width: number, fonts: Record<string, StrokeFont> = {}): { shapes: Shape[] } | { error: string } {
  const closed = file.shapes.filter((s) => s.kind !== "photo" && s.kind !== "line"
    && markRuns({ ...s, outline: true }, fonts[s.font ?? ""]).some((r) => r.length > 2));
  if (!closed.length) {
    return { error: file.unsupported
      ? "That file has only text or images in it: convert the letters to outlines, save it, and load it again"
      : "That file has no closed shapes to knock out with" };
  }
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of closed) {
    for (const r of markRuns({ ...s, outline: true }, fonts[s.font ?? ""])) {
      const b = pointsBox(r);
      box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0);
      box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1);
    }
  }
  const w = Math.max(box.x1 - box.x0, 1e-6);
  const k = width / w;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const group = newGroupId();
  const f = (p: Point) => ({ x: at.x + (p.x - cx) * k, y: at.y + (p.y - cy) * k });
  const shapes = closed.map((s): Shape => {
    // Walked through its own marks, so a box, an ellipse or a turned shape comes in as the path it
    // draws: one kind of thing to move and scale, in whichever app it's adjusted.
    const runs = markNodes({ ...s, outline: true }, fonts[s.font ?? ""]).map((r) => mapRun(r, f)).filter((r) => r.length > 2);
    const b = pointsBox(runs.flatMap((r) => flattenRun(r)));
    return {
      id: newShapeId(), kind: "path", layerId, runs, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
      ...(closed.length > 1 ? { group, groupName: name } : { name }),
    };
  }).filter((s) => s.runs!.length);
  return { shapes };
}

/**
 * The drawing with a knockout loaded into it: on the Knockout layer - made, at the top, if there isn't
 * one, shown if it was hidden - in place of whatever knockout was there before. `around` is the box
 * it's laid over (the drawing, or the image), centered and half as wide. The new shapes' ids come
 * back too, to pick them.
 */
export function withKnockout<L extends { id: string; name: string; color: string; hidden?: boolean }>(
  shapes: Shape[], layers: L[], file: { shapes: Shape[]; unsupported: number }, name: string, around: Box, fonts: Record<string, StrokeFont> = {},
): { shapes: Shape[]; layers: L[]; layerId: string; ids: string[] } | { error: string } {
  const existing = layers.find((l) => isKnockoutLayer(l.name));
  const layer = existing ?? ({ id: newLayerId(), name: KNOCKOUT, color: KNOCKOUT_COLOR } as L);
  const at = { x: (around.x0 + around.x1) / 2, y: (around.y0 + around.y1) / 2 };
  const placed = placedKnockout(file, name, layer.id, at, Math.max((around.x1 - around.x0) / 2, 0.5), fonts);
  if ("error" in placed) return placed;
  return {
    shapes: [...shapes.filter((s) => s.layerId !== layer.id), ...placed.shapes],
    layers: existing ? layers.map((l) => (l.id === layer.id && l.hidden ? { ...l, hidden: false } : l)) : [...layers, layer],
    layerId: layer.id,
    ids: placed.shapes.map((s) => s.id),
  };
}

/** The knockout's shapes moved and scaled from the box they're in to `to`, as one. */
export function knockoutPlaced(shapes: Shape[], layerId: string, to: Box): Shape[] {
  const mine = shapes.filter((s) => s.layerId === layerId);
  if (!mine.length) return shapes;
  const from = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of mine) {
    from.x0 = Math.min(from.x0, s.x, s.x2); from.y0 = Math.min(from.y0, s.y, s.y2);
    from.x1 = Math.max(from.x1, s.x, s.x2); from.y1 = Math.max(from.y1, s.y, s.y2);
  }
  const moved = new Map(scaleInto(mine, from, to).map((s) => [s.id, s]));
  return shapes.map((s) => moved.get(s.id) ?? s);
}
