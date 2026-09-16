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
  shapeId: string;
  /** Degrees, clockwise, relative to the artwork rather than to the paper. */
  angle: number;
  /** Millimetres between lines, measured on the paper. */
  spacingMm: number;
  /** The plot scale these lines were generated for, as a percentage. */
  scale: number;
  /**
   * Whether the shape's own outline is drawn as well as the hatching. With it off the shape still
   * lives in the file - a fill needs its shape to be regenerated from - but on a `%`-prefixed layer,
   * which NextDraw skips and which Plot leaves out of the drawing's bounds.
   */
  outline: boolean;
}

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A line has no interior, so there's nothing to fill. */
export const canFill = (s: Shape) => s.kind !== "line";

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

  const segs: Seg[] = [];
  for (let i = -Math.ceil(reach / step); i <= Math.ceil(reach / step); i++) {
    const t = i * step;
    const px = cx + nx * t;
    const py = cy + ny * t;
    const seg =
      shape.kind === "rect"
        ? clipToBox(px, py, dx, dy, b)
        : clipToEllipse(px, py, dx, dy, cx, cy, w / 2, h / 2);
    if (seg && Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) > 1e-6) segs.push(seg);
  }
  return segs;
}
