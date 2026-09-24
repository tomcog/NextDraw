// Reading SVG path data into what a pen actually travels, and writing it back out unchanged.
//
// This is what lets a drawing made somewhere else be edited here: Illustrator, Inkscape and the rest
// write paths in every command the format allows, relative ones included, so a reader that only
// understood absolute moves and lines would drop most of what it was given. A curve is kept as the
// curve the file drew - its two handles - rather than walked out into points, so what comes in goes
// back out point for point. Walking it out happens only where points are what is wanted: the hatch
// that clips to it, the box round it, the plotter's own resolution.

import type { Point } from "./parametric";

/**
 * One node of a path: where the pen is, and - when the way in or out of it is curved - the handle
 * that bends it. A corner has neither. The handles are absolute, in the same inches as the node,
 * so moving, scaling and turning treat them like any other point. This is the SVG cubic's own
 * shape: the `C` from one node to the next is (this.out, next.in, next).
 */
export interface Node extends Point {
  in?: Point;
  out?: Point;
}

/** The same node with every point of it - the node and its handles - put through `f`. */
export const mapNode = (n: Node, f: (p: Point) => Point): Node => {
  const at = f(n);
  const out: Node = { x: at.x, y: at.y };
  if (n.in) out.in = f(n.in);
  if (n.out) out.out = f(n.out);
  return out;
};

/** Whether any run bends: the writer and the canvas draw curves only where there are curves. */
export const hasCurves = (runs: Node[][]) => runs.some((run) => run.some((n) => n.in || n.out));

const NUMBERS = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const COMMANDS = /[MmLlHhVvCcSsQqTtAaZz]/;

/** How many numbers each command takes, one repeat at a time. */
const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/** A cubic walked in pieces of about `step`, the first point left to whatever drew it. */
function cubic(from: Point, c1: Point, c2: Point, to: Point, step: number): Point[] {
  const rough = Math.hypot(c1.x - from.x, c1.y - from.y)
    + Math.hypot(c2.x - c1.x, c2.y - c1.y)
    + Math.hypot(to.x - c2.x, to.y - c2.y);
  const steps = Math.max(2, Math.min(200, Math.ceil(rough / step)));
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    const u = 1 - t;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    };
  });
}

/** An elliptical arc, as the format describes it: two ends, two radii, a turn and two flags. */
function arc(from: Point, rx: number, ry: number, deg: number, large: number, sweep: number, to: Point, step: number): Point[] {
  if (!rx || !ry) return [to];
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The ends, taken into the ellipse's own frame, where the arc is a circle.
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let ax = Math.abs(rx);
  let ay = Math.abs(ry);
  const big = (x1 * x1) / (ax * ax) + (y1 * y1) / (ay * ay);
  if (big > 1) {
    ax *= Math.sqrt(big);
    ay *= Math.sqrt(big);
  }
  const denom = ax * ax * y1 * y1 + ay * ay * x1 * x1;
  const factor = Math.sqrt(Math.max(0, (ax * ax * ay * ay - denom) / denom)) * (large === sweep ? -1 : 1);
  const cx1 = (factor * ax * y1) / ay;
  const cy1 = (-factor * ay * x1) / ax;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux);
  const start = angleOf((x1 - cx1) / ax, (y1 - cy1) / ay);
  let sweepAngle = angleOf((-x1 - cx1) / ax, (-y1 - cy1) / ay) - start;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  const around = Math.abs(sweepAngle) * Math.max(ax, ay);
  const steps = Math.max(2, Math.min(400, Math.ceil(around / step)));
  return Array.from({ length: steps }, (_, i) => {
    const a = start + (sweepAngle * (i + 1)) / steps;
    const px = ax * Math.cos(a);
    const py = ay * Math.sin(a);
    return { x: cos * px - sin * py + cx, y: sin * px + cos * py + cy };
  });
}

/**
 * Every run a path draws, as nodes: one run per stroke, in the path's own coordinates, with each
 * curve kept as the handles that bend it. A quadratic is lifted to the cubic it exactly is; an arc,
 * which no single cubic is, is walked out at about `step` - the one place the file's own words are
 * not kept. A command this doesn't know ends the run rather than bending it wrongly.
 */
export function parsePath(d: string, step = 0.01): Node[][] {
  const tokens = d.match(new RegExp(`${COMMANDS.source}|${NUMBERS.source}`, "g"));
  if (!tokens) return [];
  const runs: Node[][] = [];
  let run: Node[] = [];
  let at: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastControl: Point | null = null; // for S and T, which reflect the one before
  let command = "";
  let numbers: number[] = [];

  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  // Every node is its own object: the same point written twice - a closed run's two ends - must
  // not share a handle just because it shares a place.
  const node = (p: Point): Node => ({ x: p.x, y: p.y });
  const bend = (c1: Point, c2: Point, to: Point) => {
    if (run.length) run[run.length - 1].out = { x: c1.x, y: c1.y };
    const n = node(to);
    n.in = { x: c2.x, y: c2.y };
    run.push(n);
  };

  const apply = () => {
    const upper = command.toUpperCase();
    const rel = command !== upper;
    const take = ARITY[upper] ?? 0;
    // Each command repeats while it has numbers for another go; a repeated M is an L, as SVG says.
    let first = true;
    while (take === 0 || numbers.length >= take) {
      const n = numbers.splice(0, take);
      const rx = (v: number) => (rel ? at.x + v : v);
      const ry = (v: number) => (rel ? at.y + v : v);
      if (upper === "M") {
        const to = { x: rx(n[0]), y: ry(n[1]) };
        if (first) {
          flush();
          start = to;
          run = [node(to)];
        } else {
          run.push(node(to)); // the rest of a move is a line
        }
        at = to;
        lastControl = null;
      } else if (upper === "L") {
        at = { x: rx(n[0]), y: ry(n[1]) };
        run.push(node(at));
        lastControl = null;
      } else if (upper === "H") {
        at = { x: rx(n[0]), y: at.y };
        run.push(node(at));
        lastControl = null;
      } else if (upper === "V") {
        at = { x: at.x, y: ry(n[0]) };
        run.push(node(at));
        lastControl = null;
      } else if (upper === "C" || upper === "S") {
        const c1 = upper === "C"
          ? { x: rx(n[0]), y: ry(n[1]) }
          : lastControl
            ? { x: 2 * at.x - lastControl.x, y: 2 * at.y - lastControl.y } // reflected
            : at;
        const c2 = upper === "C" ? { x: rx(n[2]), y: ry(n[3]) } : { x: rx(n[0]), y: ry(n[1]) };
        const to = upper === "C" ? { x: rx(n[4]), y: ry(n[5]) } : { x: rx(n[2]), y: ry(n[3]) };
        bend(c1, c2, to);
        lastControl = c2;
        at = to;
      } else if (upper === "Q" || upper === "T") {
        const q = upper === "Q"
          ? { x: rx(n[0]), y: ry(n[1]) }
          : lastControl
            ? { x: 2 * at.x - lastControl.x, y: 2 * at.y - lastControl.y }
            : at;
        const to = upper === "Q" ? { x: rx(n[2]), y: ry(n[3]) } : { x: rx(n[0]), y: ry(n[1]) };
        // A quadratic is a cubic whose controls sit two thirds of the way to its own - exactly.
        const c1 = { x: at.x + (2 / 3) * (q.x - at.x), y: at.y + (2 / 3) * (q.y - at.y) };
        const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) };
        bend(c1, c2, to);
        lastControl = q;
        at = to;
      } else if (upper === "A") {
        const to = { x: rx(n[5]), y: ry(n[6]) };
        run.push(...arc(at, n[0], n[1], n[2], n[3], n[4], to, step).map(node));
        lastControl = null;
        at = to;
      } else if (upper === "Z") {
        run.push(node(start));
        flush();
        run = [node(start)];
        at = start;
        lastControl = null;
      }
      first = false;
      if (take === 0) break;
    }
    numbers = [];
  };

  for (const token of tokens) {
    if (COMMANDS.test(token)) {
      if (command) apply();
      command = token;
      if (command.toUpperCase() === "Z") apply();
      continue;
    }
    numbers.push(Number(token));
    if (command && numbers.length >= (ARITY[command.toUpperCase()] ?? 0)) apply();
  }
  if (command) apply();
  flush();
  return runs;
}

/**
 * A run walked out into the points a pen travels: each curved stretch in pieces of about `step`,
 * each straight one as its two ends. What every consumer of points asks for - the hatch that clips
 * to a shape, the box round it, a copy for the clipboard - so the curve is kept in one place and
 * walked out wherever it is needed.
 */
export function flattenRun(run: Node[], step = 0.01): Point[] {
  if (!run.length) return [];
  const out: Point[] = [{ x: run[0].x, y: run[0].y }];
  for (let i = 1; i < run.length; i++) {
    const from = run[i - 1];
    const to = run[i];
    if (from.out || to.in) out.push(...cubic(from, from.out ?? from, to.in ?? to, to, step));
    else out.push({ x: to.x, y: to.y });
  }
  return out;
}

/** Every run of points a path draws, walked out at about `step`. */
export function flattenPath(d: string, step = 0.01): Point[][] {
  return parsePath(d, step).map((run) => flattenRun(run, step));
}

/** How many decimals a path is written to: a millionth of an inch, which is exact for any pen. */
const PATH_DECIMALS = 6;
const fmt = (v: number) => Number(v.toFixed(PATH_DECIMALS)).toString();

/**
 * Runs written back as path data: a move to each run's start, then a cubic wherever either end of
 * a stretch has a handle and a line where neither does. A curve that came in as a `C` goes out as
 * the same `C`, to the same numbers.
 */
export function pathData(runs: Node[][]): string {
  return runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const parts = [`M ${fmt(run[0].x)} ${fmt(run[0].y)}`];
      for (let i = 1; i < run.length; i++) {
        const from = run[i - 1];
        const to = run[i];
        if (from.out || to.in) {
          const c1 = from.out ?? from;
          const c2 = to.in ?? to;
          parts.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
        } else {
          parts.push(`L ${fmt(to.x)} ${fmt(to.y)}`);
        }
      }
      return parts.join(" ");
    })
    .join(" ");
}

/**
 * A run drawn as a curve through its own points rather than as the lines between them: a
 * Catmull-Rom spline, which passes through every point and takes its direction at each from the
 * neighbours on either side, given as the handles that bend each stretch. A run that ends where it
 * began is smoothed round the join, so a closed shape has no corner at its start.
 */
export function catmullNodes(points: Point[]): Node[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const closed = Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 1e-9;
  const loop = closed ? points.slice(0, -1) : points;
  if (loop.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const at = (i: number) => (closed
    ? loop[((i % loop.length) + loop.length) % loop.length]
    : loop[Math.max(0, Math.min(loop.length - 1, i))]);
  const out: Node[] = [{ x: at(0).x, y: at(0).y }];
  const last = closed ? loop.length : loop.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // The tangent at a point is a sixth of the way from the point before it to the one after: the
    // usual reading of Catmull-Rom as a cubic.
    out[out.length - 1].out = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    out.push({ x: p2.x, y: p2.y, in: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 } });
  }
  return out;
}

/** The smoothed run walked out in pieces about `step` long. */
export function smoothRun(points: Point[], step = 0.01): Point[] {
  return flattenRun(catmullNodes(points), step);
}

/**
 * A run with the points it doesn't need taken out: Douglas-Peucker, which keeps every point that is
 * further than `tolerance` from the line its neighbours make and drops the rest. The ends are always
 * kept, so a closed run stays closed, and the shape stays within the tolerance of what it was.
 */
export function simplifyRun(points: Point[], tolerance: number): Point[] {
  if (points.length < 3 || tolerance <= 0) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  // Worked through a list rather than by recursion: a path of thousands of points would otherwise
  // go as deep as it is long.
  const spans: [number, number][] = [[0, points.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop()!;
    if (to <= from + 1) continue;
    const a = points[from];
    const b = points[to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = from;
    for (let i = from + 1; i < to; i++) {
      const p = points[i];
      // How far the point lies off the line from a to b - or off a itself, where they meet.
      const away = len < 1e-12
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
      if (away > worst) {
        worst = away;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = true;
      spans.push([from, at], [at, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A run of points drawn as the fewest curves that pass within `tolerance` of every one of them:
 * Schneider's fit, from Graphics Gems. Each stretch is one cubic, its handles found by least
 * squares along the directions the run leaves and arrives; where no cubic is close enough, the
 * stretch is split at its worst point and each half fitted again, meeting smoothly there. So a
 * traced line's pixel steps are passed through rather than drawn, and a long gentle bend is one
 * curve. The points at `corners` are kept sharp: the fit starts afresh on either side of them.
 */
export function fitNodes(points: Point[], tolerance: number, corners: number[] = []): Node[] {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const closed = n > 3 && Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) < 1e-9;
  const breaks = [...new Set([0, ...corners.filter((i) => i > 0 && i < n - 1), n - 1])].sort((a, b) => a - b);
  // Directions are read a few points along, so one pixel's jag doesn't turn a whole curve.
  const reach = 3;
  const toward = (from: Point, to: Point) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };
  // A loop with no corner of its own is smooth round its join: it leaves and arrives along one line.
  const seam = closed && breaks.length === 2 ? toward(points[n - 1 - reach], points[reach]) : null;
  const out: Node[] = [{ x: points[0].x, y: points[0].y }];
  for (let b = 0; b + 1 < breaks.length; b++) {
    const first = breaks[b];
    const last = breaks[b + 1];
    const leave = seam && first === 0 ? seam : toward(points[first], points[Math.min(last, first + reach)]);
    const arrive = seam && last === n - 1 ? { x: -seam.x, y: -seam.y } : toward(points[last], points[Math.max(first, last - reach)]);
    fitCubic(points, first, last, leave, arrive, tolerance, out, reach);
  }
  return out;
}

const bez = (p: Point[], t: number): Point => {
  const s = 1 - t;
  const a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
};

/** One stretch of `fitNodes`: a cubic from `first` to `last` if one is close enough, else two halves. */
function fitCubic(d: Point[], first: number, last: number, leave: Point, arrive: Point, tolerance: number, out: Node[], reach: number) {
  const push = (c: Point[]) => {
    out[out.length - 1].out = c[1];
    out.push({ x: c[3].x, y: c[3].y, in: c[2] });
  };
  const p0 = d[first];
  const p3 = d[last];
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (last - first === 1) {
    push([p0, { x: p0.x + leave.x * span / 3, y: p0.y + leave.y * span / 3 }, { x: p3.x + arrive.x * span / 3, y: p3.y + arrive.y * span / 3 }, p3]);
    return;
  }
  // Where along the curve each point should fall: first by the distance walked, then refined.
  let u: number[] = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y));
  const total = u[u.length - 1] || 1;
  u = u.map((v) => v / total);
  let curve = handles(d, first, last, u, leave, arrive);
  let [worst, split] = maxError(d, first, last, curve, u);
  if (worst < tolerance) return push(curve);
  if (worst < tolerance * 4) {
    for (let k = 0; k < 4; k++) {
      u = reparameterize(d, first, u, curve);
      curve = handles(d, first, last, u, leave, arrive);
      [worst, split] = maxError(d, first, last, curve, u);
      if (worst < tolerance) return push(curve);
    }
  }
  // Split at the worst point, both halves meeting it along the line through its neighbours.
  split = Math.max(first + 1, Math.min(last - 1, split));
  const a = d[Math.max(first, split - reach)];
  const b = d[Math.min(last, split + reach)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  fitCubic(d, first, split, leave, { x: -dx / len, y: -dy / len }, tolerance, out, reach);
  fitCubic(d, split, last, { x: dx / len, y: dy / len }, arrive, tolerance, out, reach);
}

/** The handle lengths along `leave` and `arrive` that bring the cubic closest to the points, by least squares. */
function handles(d: Point[], first: number, last: number, u: number[], leave: Point, arrive: Point): Point[] {
  const p0 = d[first];
  const p3 = d[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a0 = { x: leave.x * b1, y: leave.y * b1 };
    const a1 = { x: arrive.x * b2, y: arrive.y * b2 };
    c00 += a0.x * a0.x + a0.y * a0.y;
    c01 += a0.x * a1.x + a0.y * a1.y;
    c11 += a1.x * a1.x + a1.y * a1.y;
    const rx = d[first + i].x - (p0.x * (b0 + b1) + p3.x * (b2 + b3));
    const ry = d[first + i].y - (p0.y * (b0 + b1) + p3.y * (b2 + b3));
    x0 += a0.x * rx + a0.y * ry;
    x1 += a1.x * rx + a1.y * ry;
  }
  const det = c00 * c11 - c01 * c01;
  let al = det ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det ? (c00 * x1 - c01 * x0) / det : 0;
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // A handle backwards, vanishing or wildly long makes a loop or a kink: a third of the way instead.
  if (!(al > span * 1e-3 && ar > span * 1e-3 && al < span * 2 && ar < span * 2)) al = ar = span / 3;
  return [p0, { x: p0.x + leave.x * al, y: p0.y + leave.y * al }, { x: p3.x + arrive.x * ar, y: p3.y + arrive.y * ar }, p3];
}

/** The furthest any point lies from where the curve puts it, and which point that is. */
function maxError(d: Point[], first: number, last: number, curve: Point[], u: number[]): [number, number] {
  let worst = 0;
  let at = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const q = bez(curve, u[i - first]);
    const e = Math.hypot(q.x - d[i].x, q.y - d[i].y);
    if (e > worst) {
      worst = e;
      at = i;
    }
  }
  return [worst, at];
}

/** Each point's place along the curve moved to where the curve comes nearest it: one Newton step. */
function reparameterize(d: Point[], first: number, u: number[], c: Point[]): number[] {
  return u.map((t, i) => {
    const p = d[first + i];
    const q = bez(c, t);
    const s = 1 - t;
    const q1 = {
      x: 3 * (s * s * (c[1].x - c[0].x) + 2 * s * t * (c[2].x - c[1].x) + t * t * (c[3].x - c[2].x)),
      y: 3 * (s * s * (c[1].y - c[0].y) + 2 * s * t * (c[2].y - c[1].y) + t * t * (c[3].y - c[2].y)),
    };
    const q2 = {
      x: 6 * (s * (c[2].x - 2 * c[1].x + c[0].x) + t * (c[3].x - 2 * c[2].x + c[1].x)),
      y: 6 * (s * (c[2].y - 2 * c[1].y + c[0].y) + t * (c[3].y - 2 * c[2].y + c[1].y)),
    };
    const num = (q.x - p.x) * q1.x + (q.y - p.y) * q1.y;
    const den = q1.x * q1.x + q1.y * q1.y + (q.x - p.x) * q2.x + (q.y - p.y) * q2.y;
    const next = den ? t - num / den : t;
    return Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : t;
  });
}
