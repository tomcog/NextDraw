// Cutting a drawing at a box: what Fill does to the lines that run past the margins, as it crops a
// picture. Exact: a straight stretch is cut where it crosses the edge, and a curve is split on the
// curve itself (de Casteljau), so what is kept is drawn just as it was. Every app's Fill uses this.

import type { Fill } from "./hatch";
import type { StrokeFont } from "./font";
import { fillMarks, markNodes } from "./marks";
import { flattenRun, type Node } from "./path";
import type { Point } from "./parametric";
import { newShapeId, pointsBox, type Shape } from "./shapes";

export interface CropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EPS = 1e-7;
const inside = (p: Point, b: CropBox) => p.x >= b.x0 - EPS && p.x <= b.x1 + EPS && p.y >= b.y0 - EPS && p.y <= b.y1 + EPS;

type Cubic = [Point, Point, Point, Point];
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const at = (c: Cubic, t: number): Point => {
  const u = 1 - t;
  return {
    x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x,
    y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y,
  };
};
/** The part of a cubic from t0 to t1, as a cubic of its own. */
function part(c: Cubic, t0: number, t1: number): Cubic {
  // Split at t1, keep the first half; split that at t0 / t1, keep the second.
  const split = (q: Cubic, t: number): [Cubic, Cubic] => {
    const a = lerp(q[0], q[1], t), b = lerp(q[1], q[2], t), d = lerp(q[2], q[3], t);
    const e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
    return [[q[0], a, e, g], [g, f, d, q[3]]];
  };
  const head = t1 < 1 ? split(c, t1)[0] : c;
  return t0 > 0 ? split(head, t0 / t1)[1] : head;
}

/** Where along a stretch it crosses an edge of the box, in order, ends excluded. */
function crossings(c: Cubic, straight: boolean, b: CropBox): number[] {
  const ts: number[] = [];
  const edges: [keyof Point, number][] = [["x", b.x0], ["x", b.x1], ["y", b.y0], ["y", b.y1]];
  for (const [axis, v] of edges) {
    if (straight) {
      const d = c[3][axis] - c[0][axis];
      if (Math.abs(d) > 1e-12) {
        const t = (v - c[0][axis]) / d;
        if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
      }
      continue;
    }
    // A cubic crosses a line at most three times: walk it finely, then pin each change of side down.
    const f = (t: number) => at(c, t)[axis] - v;
    const N = 48;
    let t0 = 0, f0 = f(0);
    for (let i = 1; i <= N; i++) {
      const t1 = i / N, f1 = f(t1);
      if ((f0 < 0 && f1 > 0) || (f0 > 0 && f1 < 0)) {
        let lo = t0, hi = t1, flo = f0;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2, fm = f(mid);
          if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        const t = (lo + hi) / 2;
        if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
      }
      t0 = t1; f0 = f1;
    }
  }
  return ts.sort((a, b2) => a - b2);
}

/** A run cut at the box: the runs of it that are inside, each drawn just as it was there. */
export function cropRun(run: Node[], b: CropBox): Node[][] {
  if (run.length < 2) return [];
  const out: Node[][] = [];
  let current: Node[] | null = null;
  // Whether the first kept piece starts at the run's very start, and the last ends at its very end:
  // a closed run cut that way joins up again round its start, so the pen doesn't lift there.
  let fromStart = false, toEnd = false;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], z = run[i];
    const straight = !a.out && !z.in;
    const c: Cubic = [{ x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y }, z.in ?? { x: z.x, y: z.y }, { x: z.x, y: z.y }];
    const cuts = [0, ...crossings(c, straight, b), 1];
    for (let j = 1; j < cuts.length; j++) {
      const t0 = cuts[j - 1], t1 = cuts[j];
      if (t1 - t0 < 1e-12) continue;
      const kept = inside(at(c, (t0 + t1) / 2), b);
      // A run being built always ends where this piece starts: anything outside between them ended it.
      const touching = current !== null;
      if (!kept) {
        if (current) { out.push(current); current = null; }
        continue;
      }
      const piece = straight ? c : part(c, t0, t1);
      const start: Point = straight ? lerp(c[0], c[3], t0) : piece[0];
      const end: Point = straight ? lerp(c[0], c[3], t1) : piece[3];
      if (!current || !touching) {
        if (current) out.push(current);
        current = [{ x: start.x, y: start.y }];
        if (i === 1 && t0 === 0) fromStart = true;
      }
      const last = current[current.length - 1];
      if (!straight) last.out = piece[1];
      const node: Node = { x: end.x, y: end.y };
      if (!straight) node.in = piece[2];
      current.push(node);
      if (i === run.length - 1 && t1 === 1) toEnd = true;
    }
  }
  if (current) out.push(current);
  const closed = Math.hypot(run[0].x - run[run.length - 1].x, run[0].y - run[run.length - 1].y) < 1e-9;
  if (closed && fromStart && toEnd && out.length > 1) {
    // The last piece runs on into the first.
    const first = out.shift()!;
    const last = out.pop()!;
    const joinAt = last[last.length - 1];
    if (first[0].out) joinAt.out = first[0].out;
    out.push([...last, ...first.slice(1)]);
  }
  return out.filter((r) => r.length > 1);
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

/**
 * The drawing cut at the box: whatever is wholly inside stays as it is, whatever is wholly outside
 * goes, and a shape that crosses the edge becomes a path of the parts of it inside - its fills, if it
 * has any, a path of their own beside it, cut the same way. Trim marks and pictures are left alone:
 * the marks are meant to sit round the drawing, and a picture is cropped by its own Fill.
 */
export function cropDrawing(shapes: Shape[], fills: Fill[], box: CropBox, fonts: Record<string, StrokeFont>): { shapes: Shape[]; fills: Fill[] } {
  const outShapes: Shape[] = [];
  const gone = new Set<string>();
  for (const s of shapes) {
    if (s.kind === "photo" || isTrim(s)) {
      outShapes.push(s);
      continue;
    }
    const own = markNodes(s, fonts[s.font ?? ""]);
    const filled = fillMarks(s, fills);
    const allIn = own.every((run) => flattenRun(run).every((p) => inside(p, box))) && filled.every((run) => run.every((p) => inside(p, box)));
    if (allIn) {
      outShapes.push(s);
      continue;
    }
    gone.add(s.id);
    const keptOwn = own.flatMap((run) => cropRun(run, box));
    const keptFill = filled.flatMap((run) => cropRun(run.map((p) => ({ x: p.x, y: p.y })), box));
    if (keptOwn.length) outShapes.push(pathShape(s, keptOwn, s.id));
    if (keptFill.length) outShapes.push(pathShape(s, keptFill, keptOwn.length ? newShapeId() : s.id));
  }
  return { shapes: outShapes, fills: fills.filter((f) => !gone.has(f.shapeId)) };
}
