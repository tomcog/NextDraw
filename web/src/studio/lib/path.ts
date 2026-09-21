// Reading SVG path data into the runs of points a pen actually travels.
//
// This is what lets a drawing made somewhere else be edited here: Illustrator, Inkscape and the rest
// write paths in every command the format allows, relative ones included, so a reader that only
// understood absolute moves and lines would drop most of what it was given. Curves are walked in
// pieces about `step` inches long, which is finer than the plotter's own resolution.

import type { Point } from "./parametric";

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
 * Every run of points a path draws: one run per stroke, in the path's own coordinates. Curves are
 * walked at about `step`; a command this doesn't know ends the run rather than bending it wrongly.
 */
export function flattenPath(d: string, step = 0.01): Point[][] {
  const tokens = d.match(new RegExp(`${COMMANDS.source}|${NUMBERS.source}`, "g"));
  if (!tokens) return [];
  const runs: Point[][] = [];
  let run: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastControl: Point | null = null; // for S and T, which reflect the one before
  let command = "";
  let numbers: number[] = [];

  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
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
          run = [to];
        } else {
          run.push(to); // the rest of a move is a line
        }
        at = to;
        lastControl = null;
      } else if (upper === "L") {
        at = { x: rx(n[0]), y: ry(n[1]) };
        run.push(at);
        lastControl = null;
      } else if (upper === "H") {
        at = { x: rx(n[0]), y: at.y };
        run.push(at);
        lastControl = null;
      } else if (upper === "V") {
        at = { x: at.x, y: ry(n[0]) };
        run.push(at);
        lastControl = null;
      } else if (upper === "C" || upper === "S") {
        const c1 = upper === "C"
          ? { x: rx(n[0]), y: ry(n[1]) }
          : lastControl
            ? { x: 2 * at.x - lastControl.x, y: 2 * at.y - lastControl.y } // reflected
            : at;
        const c2 = upper === "C" ? { x: rx(n[2]), y: ry(n[3]) } : { x: rx(n[0]), y: ry(n[1]) };
        const to = upper === "C" ? { x: rx(n[4]), y: ry(n[5]) } : { x: rx(n[2]), y: ry(n[3]) };
        run.push(...cubic(at, c1, c2, to, step));
        lastControl = c2;
        at = to;
      } else if (upper === "Q" || upper === "T") {
        const q = upper === "Q"
          ? { x: rx(n[0]), y: ry(n[1]) }
          : lastControl
            ? { x: 2 * at.x - lastControl.x, y: 2 * at.y - lastControl.y }
            : at;
        const to = upper === "Q" ? { x: rx(n[2]), y: ry(n[3]) } : { x: rx(n[0]), y: ry(n[1]) };
        // A quadratic is a cubic whose controls sit two thirds of the way to its own.
        const c1 = { x: at.x + (2 / 3) * (q.x - at.x), y: at.y + (2 / 3) * (q.y - at.y) };
        const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) };
        run.push(...cubic(at, c1, c2, to, step));
        lastControl = q;
        at = to;
      } else if (upper === "A") {
        const to = { x: rx(n[5]), y: ry(n[6]) };
        run.push(...arc(at, n[0], n[1], n[2], n[3], n[4], to, step));
        lastControl = null;
        at = to;
      } else if (upper === "Z") {
        run.push(start);
        flush();
        run = [start];
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
 * A run drawn as a curve through its own points rather than as the straight lines between them: a
 * Catmull-Rom spline, which passes through every point and takes its direction at each from the
 * neighbours on either side. The result is walked out in pieces about `step` long, because the
 * plotter draws segments and Plot reads the drawing back as segments too - the curve is in where
 * they fall, not in the file saying "curve". A run that ends where it began is smoothed round the
 * join, so a closed shape has no corner at its start.
 */
export function smoothRun(points: Point[], step = 0.01): Point[] {
  if (points.length < 3) return points;
  const closed = Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 1e-9;
  const loop = closed ? points.slice(0, -1) : points;
  if (loop.length < 3) return points;
  const at = (i: number) => (closed
    ? loop[((i % loop.length) + loop.length) % loop.length]
    : loop[Math.max(0, Math.min(loop.length - 1, i))]);
  const out: Point[] = [at(0)];
  const last = closed ? loop.length : loop.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // The tangent at a point is a sixth of the way from the point before it to the one after: the
    // usual reading of Catmull-Rom as a cubic.
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    out.push(...cubic(p1, c1, c2, p2, step));
  }
  return out;
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
