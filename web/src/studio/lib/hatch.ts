import { curveStrokes, type Point } from "./parametric";
import { boxOf, type Shape } from "./shapes";

// Hatch fills, kept as parameters rather than as the lines they make (see docs/studio.md). A fill
// says which shape it fills, at what angle and how far apart - so changing pen or page size
// regenerates it instead of leaving it wrong.
//
// Spacing is what the fill should measure ON PAPER, because that number comes from the pen rather
// than from the drawing. Plot applies its scale at plot time, multiplying the document's size, so
// generating the lines means dividing by that scale. `scale` is the one the lines were made for; if
// Plot's scale ever differs from it, the fill is stale and wants regenerating.

export interface Fill {
  /** Its own id, because a shape can carry more than one - two angles make a cross-hatch. */
  id: string;
  shapeId: string;
  /** Degrees, clockwise, relative to the artwork rather than to the paper. */
  angle: number;
  /** Millimetres between lines, measured on the paper. */
  spacingMm: number;
  /** The plot scale these lines were generated for, as a percentage. */
  scale: number;
  /**
   * Join each line to the next along the shape's edge, so the pass is one zigzag stroke: the pen goes
   * down once instead of once per line, and the ends of the lines don't blob where it lands.
   */
  connected?: boolean;
  /**
   * Set by hand: this fill keeps its own angle and spacing. Without it a fill follows the drawing
   * tool, since spacing is a fact about the pen rather than about the drawing, and a fill made for
   * a 0.35 mm pen is wrong the moment a 1.7 mm one is loaded.
   */
  custom?: boolean;
}

let fillCounter = 0;
export const newFillId = () => `fill-${++fillCounter}-${Date.now().toString(36)}`;

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * A line has no interior, so there's nothing to fill. Neither has a parabolic: its strings are the
 * drawing rather than an outline round anything. Everything else can be filled, a polygon, a star or
 * a spirograph included - their fills are clipped to the outline itself, not to the box.
 */
export const canFill = (s: Shape) =>
  s.kind !== "line" && s.curve?.kind !== "parabolic" && (s.kind !== "path" || (s.points?.length ?? 0) > 2);

/** The closed outline a fill is clipped to: a curve's generated points, or a path's own. */
const outlineOf = (s: Shape): Point[] => {
  const pts = s.curve ? curveStrokes(s)[0] ?? [] : s.points ?? [];
  if (pts.length > 2 && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
    return [...pts, pts[0]]; // a fill needs a closed outline to count crossings against
  }
  return pts;
};

/**
 * Where a line crosses a closed outline, as the spans that lie inside it. Crossings are counted the
 * even-odd way, which is what makes a star's points fill and the middle of a self-crossing
 * spirograph read as a pattern rather than as one solid lump.
 */
function clipToOutline(px: number, py: number, dx: number, dy: number, pts: Point[]): Seg[] {
  const hits: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue; // the edge runs along the line: no crossing to count
    // How far along the edge (u) and along the line (t) they meet.
    const u = (dx * (a.y - py) - dy * (a.x - px)) / -denom;
    const t = (ex * (a.y - py) - ey * (a.x - px)) / -denom;
    // Half-open, so a crossing exactly on a corner is counted once rather than twice.
    if (u >= 0 && u < 1) hits.push(t);
  }
  hits.sort((m, n) => m - n);
  const segs: Seg[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    segs.push({ x1: px + dx * hits[i], y1: py + dy * hits[i], x2: px + dx * hits[i + 1], y2: py + dy * hits[i + 1] });
  }
  return segs;
}

/** Spacing in the drawing's own inches, which is what the lines are drawn in. */
export const stepInches = (fill: Fill) => fill.spacingMm / 25.4 / (fill.scale / 100);

/** Where a line through (px,py) in direction (dx,dy) enters and leaves an axis-aligned box. */
function clipToBox(px: number, py: number, dx: number, dy: number, b: ReturnType<typeof boxOf>): Seg | null {
  let lo = -Infinity;
  let hi = Infinity;
  const slab = (p: number, d: number, min: number, max: number) => {
    if (Math.abs(d) < 1e-12) return p >= min && p <= max; // parallel: inside or nowhere
    let a = (min - p) / d;
    let z = (max - p) / d;
    if (a > z) [a, z] = [z, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, z);
    return true;
  };
  if (!slab(px, dx, b.x0, b.x1) || !slab(py, dy, b.y0, b.y1) || hi <= lo) return null;
  return { x1: px + dx * lo, y1: py + dy * lo, x2: px + dx * hi, y2: py + dy * hi };
}

/** The same, for an ellipse: squash it to a circle, solve, and read the two roots back. */
function clipToEllipse(px: number, py: number, dx: number, dy: number, cx: number, cy: number, rx: number, ry: number): Seg | null {
  if (rx <= 0 || ry <= 0) return null;
  const ox = (px - cx) / rx;
  const oy = (py - cy) / ry;
  const ux = dx / rx;
  const uy = dy / ry;
  const a = ux * ux + uy * uy;
  const b = 2 * (ox * ux + oy * uy);
  const c = ox * ox + oy * oy - 1;
  const disc = b * b - 4 * a * c;
  if (a <= 0 || disc <= 0) return null; // misses, or just grazes the edge
  const root = Math.sqrt(disc);
  const lo = (-b - root) / (2 * a);
  const hi = (-b + root) / (2 * a);
  return { x1: px + dx * lo, y1: py + dy * lo, x2: px + dx * hi, y2: py + dy * hi };
}

/**
 * The lines a fill makes, in inches on the page. They're swept out from the middle of the shape, so
 * growing it from one side doesn't shift every line in the pattern.
 */
export function hatchLines(shape: Shape, fill: Fill): Seg[] {
  if (!canFill(shape)) return [];
  const b = boxOf(shape);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const step = stepInches(fill);
  // A spacing finer than the plotter could ever draw would make millions of lines; refuse instead.
  if (w <= 0 || h <= 0 || !(step > 0.002)) return [];

  const rad = (fill.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const nx = -dy; // across the lines
  const ny = dx;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const reach = Math.hypot(w, h) / 2;
  const outline = outlineOf(shape);
  if ((shape.curve || shape.kind === "path") && outline.length < 3) return [];

  const segs: Seg[] = [];
  for (let i = -Math.ceil(reach / step); i <= Math.ceil(reach / step); i++) {
    const t = i * step;
    const px = cx + nx * t;
    const py = cy + ny * t;
    if (shape.curve || shape.kind === "path") {
      for (const seg of clipToOutline(px, py, dx, dy, outline)) {
        if (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) > 1e-6) segs.push(seg);
      }
      continue;
    }
    const seg =
      shape.kind === "rect"
        ? clipToBox(px, py, dx, dy, b)
        : clipToEllipse(px, py, dx, dy, cx, cy, w / 2, h / 2);
    if (seg && Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) > 1e-6) segs.push(seg);
  }
  return segs;
}

/**
 * A connected fill as one stroke, in inches on the page: the lines taken alternately forwards and
 * backwards, each end joined to the next line's start along the shape's own edge - round the corner
 * of a rectangle where the two ends fall on different sides, along the curve of an ellipse - so the
 * joins never cut across the inside of the shape.
 */
export function hatchStroke(shape: Shape, fill: Fill): { x: number; y: number }[] {
  const lines = hatchLines(shape, fill);
  const b = boxOf(shape);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const rx = (b.x1 - b.x0) / 2;
  const ry = (b.y1 - b.y0) / 2;
  const eps = 1e-6;

  // A curve joins along its own outline, the short way round, so the join never cuts across a
  // star's notch or through the middle of a spirograph.
  const outline = outlineOf(shape);
  const walkOutline = (from: Point, to: Point) => {
    if (outline.length < 3) return [];
    // Where each end sits on the outline, as the corner it is nearest to.
    const nearest = (p: Point) => {
      let best = 0;
      let dist = Infinity;
      outline.forEach((q, i) => {
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    };
    const a = nearest(from);
    const b2 = nearest(to);
    const n = outline.length - 1; // the last point repeats the first
    const forward = (b2 - a + n) % n;
    const step = forward <= n - forward ? 1 : -1;
    const count = step === 1 ? forward : n - forward;
    const points: Point[] = [];
    for (let k = 1; k < count; k++) points.push(outline[(a + step * k + n * 2) % n]);
    return points;
  };

  const join = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (shape.curve || shape.kind === "path") return walkOutline(from, to);
    if (shape.kind === "rect") {
      // One end on a side (x0 or x1) and the other on the top or bottom: go by the corner they share.
      const side = (p: { x: number; y: number }) =>
        Math.abs(p.x - b.x0) < eps ? b.x0 : Math.abs(p.x - b.x1) < eps ? b.x1 : null;
      const cap = (p: { x: number; y: number }) =>
        Math.abs(p.y - b.y0) < eps ? b.y0 : Math.abs(p.y - b.y1) < eps ? b.y1 : null;
      const [sf, cf, st, ct] = [side(from), cap(from), side(to), cap(to)];
      if (sf !== null && ct !== null && sf !== st && cf !== ct) return [{ x: sf, y: ct }];
      if (cf !== null && st !== null && cf !== ct && sf !== st) return [{ x: st, y: cf }];
      return [];
    }
    // Ellipse: follow the rim the short way round, a point every few degrees.
    const a0 = Math.atan2((from.y - cy) / ry, (from.x - cx) / rx);
    let a1 = Math.atan2((to.y - cy) / ry, (to.x - cx) / rx);
    if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const n = Math.floor(Math.abs(a1 - a0) / (Math.PI / 60));
    return Array.from({ length: n }, (_, k) => {
      const a = a0 + ((a1 - a0) * (k + 1)) / (n + 1);
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
  };

  const points: { x: number; y: number }[] = [];
  lines.forEach((l, i) => {
    const start = i % 2 === 0 ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 };
    const end = i % 2 === 0 ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 };
    if (points.length) points.push(...join(points[points.length - 1], start));
    points.push(start, end);
  });
  return points;
}
