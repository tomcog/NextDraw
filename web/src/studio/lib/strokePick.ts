// Cleaning up a drawing stroke by stroke: the Stroke select and Lasso tools pick single strokes - one
// run of one path - on the targeted layers, wherever they sit in the drawing's paths and groups, and
// Delete takes them out. Nothing else about the layer changes: a path of hundreds of strokes stays one
// path, a group stays a group. A path left with no strokes goes.

import type { Point } from "../../shared/lib/drawing/parametric";
import { flattenRun } from "../../shared/lib/drawing/path";
import { centerOf, drawnRuns, pathRuns, pointsBox, turnPoint, type Shape } from "../../shared/lib/drawing/shapes";

/** One stroke: run `run` of the path `shapeId`, as it lies on the page (turned with its path). */
export interface Stroke {
  key: string;
  shapeId: string;
  run: number;
  points: Point[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

export const strokeKey = (shapeId: string, run: number) => `${shapeId}#${run}`;

/** Every stroke of the paths on these layers, where the page shows it. */
export function strokesOf(shapes: Shape[], onLayer: (layerId: string) => boolean): Stroke[] {
  const out: Stroke[] = [];
  for (const sh of shapes) {
    if (!onLayer(sh.layerId) || !pathRuns(sh).length) continue;
    const about = sh.rotation ? centerOf(sh) : null;
    drawnRuns(sh).forEach((run, i) => {
      const points = about ? run.map((p) => turnPoint(p, about, sh.rotation!)) : run;
      if (points.length) out.push({ key: strokeKey(sh.id, i), shapeId: sh.id, run: i, points, box: pointsBox(points) });
    });
  }
  return out;
}

/** How far a point is from the segment a-b. */
function toSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The stroke nearest the point, if any comes within `within` of it (the page's inches). */
export function strokeAt(strokes: Stroke[], p: Point, within: number): Stroke | null {
  let best: Stroke | null = null;
  let bestD = within;
  for (const s of strokes) {
    const { x0, y0, x1, y1 } = s.box;
    if (p.x < x0 - bestD || p.x > x1 + bestD || p.y < y0 - bestD || p.y > y1 + bestD) continue;
    const pts = s.points;
    const d = pts.length === 1
      ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y)
      : pts.slice(1).reduce((m, b, i) => Math.min(m, toSegment(p, pts[i], b)), Infinity);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** The strokes with any point inside the box. */
export function strokesInBox(strokes: Stroke[], box: { x0: number; y0: number; x1: number; y1: number }): Stroke[] {
  return strokes.filter((s) => s.box.x0 <= box.x1 && s.box.x1 >= box.x0 && s.box.y0 <= box.y1 && s.box.y1 >= box.y0
    && s.points.some((p) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1));
}

/** Whether a point is inside a closed loop (even-odd). */
function inLoop(p: Point, loop: Point[]) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The strokes with any point inside a lasso drawn round them. */
export function strokesInLasso(strokes: Stroke[], loop: Point[]): Stroke[] {
  if (loop.length < 3) return [];
  const box = pointsBox(loop);
  return strokesInBox(strokes, box).filter((s) => s.points.some((p) => inLoop(p, loop)));
}

/**
 * The drawing with these strokes taken out. A path keeps whatever strokes it has left - a turned one
 * where they were, though its box (and so the middle it turns about) is now smaller - and a path with
 * none left goes. `gone` lists the paths that went, for their fills and the selection.
 */
export function withoutStrokes(shapes: Shape[], keys: Set<string>): { shapes: Shape[]; gone: string[] } {
  if (!keys.size) return { shapes, gone: [] };
  const gone: string[] = [];
  const next: Shape[] = [];
  for (const sh of shapes) {
    const runs = pathRuns(sh);
    if (!runs.length || !runs.some((_, i) => keys.has(strokeKey(sh.id, i)))) {
      next.push(sh);
      continue;
    }
    const left = runs.filter((_, i) => !keys.has(strokeKey(sh.id, i)));
    if (!left.length) {
      gone.push(sh.id);
      continue;
    }
    next.push(withRunsKept(sh, left));
  }
  return { shapes: next, gone };
}

/** The path with only these runs, its box following them, and a turned one not moving on the page. */
function withRunsKept(sh: Shape, runs: Shape["points"][]): Shape {
  const kept = runs as NonNullable<Shape["points"]>[];
  const boxOfRuns = (rs: typeof kept) => pointsBox(rs.flatMap((run) => flattenRun(run)));
  let b = boxOfRuns(kept);
  let moved = kept;
  if (sh.rotation) {
    // Turned about the middle of its box: with a smaller box the middle moves, and the strokes left
    // would swing with it. Shifting them by (I - R)(c - c') puts them back where they were.
    const c = { x: (Math.min(sh.x, sh.x2) + Math.max(sh.x, sh.x2)) / 2, y: (Math.min(sh.y, sh.y2) + Math.max(sh.y, sh.y2)) / 2 };
    const c2 = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    const diff = { x: c.x - c2.x, y: c.y - c2.y };
    const turned = turnPoint(diff, { x: 0, y: 0 }, sh.rotation);
    const dx = diff.x - turned.x;
    const dy = diff.y - turned.y;
    if (dx || dy) {
      const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
      moved = kept.map((run) => run.map((n) => ({ ...shift(n), ...(n.in ? { in: shift(n.in) } : {}), ...(n.out ? { out: shift(n.out) } : {}) })));
      b = boxOfRuns(moved);
    }
  }
  const { runs: _runs, points: _points, ...rest } = sh;
  return { ...rest, ...(moved.length > 1 ? { runs: moved } : { points: moved[0] }), x: b.x0, y: b.y0, x2: b.x1, y2: b.y1 };
}
