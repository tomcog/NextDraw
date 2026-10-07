// Curves that keep their numbers. A parametric shape is drawn from its parameters every time, so it
// can be re-tuned after the fact - the same bargain as a hatch fill (see hatch.ts): the file holds
// both the lines the pen will draw and the numbers that made them, and Studio regenerates the lines.
//
// Every generator fills the shape's box, so moving and resizing a curve works like any other shape
// and the box stays its footprint.

import { boxOf, pointsBox, type Shape } from "./shapes";

export type CurveKind = "hypotrochoid" | "parabolic" | "polygon" | "star" | "spiral" | "arc" | "wave";

/** A spirograph: a circle of radius `r` rolling inside one of radius `R`, pen `d` from its centre. */
export interface Hypotrochoid {
  kind: "hypotrochoid";
  R: number; // the fixed circle, in arbitrary units - only the ratios matter, the box sets the size
  r: number; // the rolling circle; negative rolls it around the outside (an epitrochoid)
  d: number; // how far the pen sits from the rolling circle's centre (the second one's, if there is one)
  turns: number; // how many times round the fixed circle to draw
  // A second circle rolling inside the first (outside, if negative), carrying the pen: flowers
  // within flowers. 0 is none, the plain spirograph. Missing in drawings made before it: none.
  r2?: number;
  laps?: number; // how many times it goes round inside the first, each turn round the fixed circle
  // How much the pen offset grows (or, negative, shrinks) by the last turn, in %: loops that swell
  // or tighten as they go, so the figure never retraces itself. 0, or missing, is a steady pen.
  drift?: number;
}

/** A corner of a shape's box: top left, top right, bottom right, bottom left. */
export type Corner = "tl" | "tr" | "br" | "bl";
/** Every corner, in the order a parabolic draws them: across the diagonals, as it always has. */
export const CORNERS: Corner[] = ["tl", "br", "tr", "bl"];

/** Curve stitching: straight strings across a corner, whose envelope is a parabola. */
export interface Parabolic {
  kind: "parabolic";
  strings: number; // strings per corner
  corners: Corner[]; // which of the box's corners it's drawn from, any of the four
}

/** A regular polygon, drawn round the box: three sides up, and as many as you like. */
export interface Polygon {
  kind: "polygon";
  sides: number;
}

/** A star: `points` spikes, with the inner corners at `inner` percent of the way out. */
export interface Star {
  kind: "star";
  points: number;
  inner: number;
}

/** An Archimedean spiral: evenly spaced turns, wound out from `inner` percent of the way out. */
export interface Spiral {
  kind: "spiral";
  turns: number;
  inner: number; // where the winding starts, as a percent of the full radius
}

/**
 * A piece of the box's ellipse: `sweep` degrees of it, starting `start` degrees round from the top.
 * More than one arc nests them inside each other - a rainbow, or an open hatch that never closes -
 * with the innermost at `inner` percent of the way out.
 */
export interface Arc {
  kind: "arc";
  start: number;
  sweep: number;
  arcs: number;
  inner: number;
}

/** A wave across the box: `waves` of them, swinging `swing` percent of the box's height. */
export interface Wave {
  kind: "wave";
  waves: number;
  swing: number;
}

export type Curve = Hypotrochoid | Parabolic | Polygon | Star | Spiral | Arc | Wave;

export interface Point {
  x: number;
  y: number;
}

export const DEFAULT_CURVE: Record<CurveKind, Curve> = {
  hypotrochoid: { kind: "hypotrochoid", R: 5, r: 3, d: 5, turns: 3, r2: 0, laps: 3, drift: 0 },
  parabolic: { kind: "parabolic", strings: 12, corners: CORNERS },
  polygon: { kind: "polygon", sides: 6 },
  star: { kind: "star", points: 5, inner: 40 },
  spiral: { kind: "spiral", turns: 4, inner: 5 },
  arc: { kind: "arc", start: 0, sweep: 180, arcs: 1, inner: 40 },
  wave: { kind: "wave", waves: 3, swing: 100 },
};

export const CURVE_LABEL: Record<CurveKind, string> = {
  hypotrochoid: "Spirograph",
  parabolic: "Parabolic curve",
  polygon: "Polygon",
  star: "Star",
  spiral: "Spiral",
  arc: "Arc",
  wave: "Wave",
};

/** The numbers a curve shows in the panel: what to call each one and how far it may go. */
export const CURVE_FIELDS: Record<CurveKind, { key: string; label: string; min: number; max: number; step: number; unit?: string }[]> = {
  hypotrochoid: [
    { key: "R", label: "Fixed circle", min: 1, max: 200, step: 1 },
    { key: "r", label: "Rolling circle", min: -200, max: 200, step: 1 },
    { key: "d", label: "Pen offset", min: -200, max: 200, step: 1 },
    { key: "turns", label: "Turns", min: 1, max: 200, step: 1 },
    { key: "r2", label: "Second circle", min: -200, max: 200, step: 1 },
    { key: "laps", label: "Its laps", min: -50, max: 50, step: 1 },
    { key: "drift", label: "Offset change", min: -100, max: 500, step: 10, unit: "%" },
  ],
  parabolic: [
    { key: "strings", label: "Strings", min: 1, max: 200, step: 1 },
  ], // and which corners, picked on the Curve card rather than typed
  polygon: [{ key: "sides", label: "Sides", min: 3, max: 100, step: 1 }],
  star: [
    { key: "points", label: "Points", min: 2, max: 100, step: 1 },
    { key: "inner", label: "Inner", min: 1, max: 99, step: 5, unit: "%" },
  ],
  spiral: [
    { key: "turns", label: "Turns", min: 0.25, max: 100, step: 0.5 },
    { key: "inner", label: "Starts at", min: 0, max: 95, step: 5, unit: "%" },
  ],
  wave: [
    { key: "waves", label: "Waves", min: 0.25, max: 200, step: 0.5 },
    { key: "swing", label: "Swing", min: 1, max: 100, step: 5, unit: "%" },
  ],
  arc: [
    { key: "start", label: "From", min: -360, max: 360, step: 15, unit: "°" },
    { key: "sweep", label: "Sweep", min: -360, max: 360, step: 15, unit: "°" },
    { key: "arcs", label: "Arcs", min: 1, max: 200, step: 1 },
    { key: "inner", label: "Innermost", min: 1, max: 99, step: 5, unit: "%" },
  ],
};

/**
 * How many turns of the fixed circle before a spirograph is back where it started, pen and wheels
 * alike - past that it retraces, and retracing means the pen goes over the same line twice on paper.
 * Every wheel spins at a fixed rate per turn; the figure closes once every one of those rates has
 * come round a whole number of times. For one wheel that's r / gcd(R, r), as it always was.
 * Null when that's more than a thousand turns, or never (a rate that isn't a fraction of whole
 * numbers typed in).
 */
export function closingTurns(c: Hypotrochoid): number | null {
  const gcd = (m: number, n: number): number => (n ? gcd(n, m % n) : Math.abs(m));
  // A rate as a fraction of whole numbers, from the numbers as typed (to a thousandth).
  const fraction = (top: number, bottom: number) => {
    const t = Math.round(top * 1000);
    const b = Math.round(bottom * 1000);
    if (!b) return null;
    const g = gcd(t, b) || 1;
    return { t: t / g, b: Math.abs(b / g) };
  };
  const { R, r } = c;
  const r2 = c.r2 ?? 0;
  const rates = [fraction(R - r, r)];
  if (r2) {
    const laps = c.laps ?? 0;
    rates.push(fraction(laps, 1), fraction(laps * (r - r2), r2));
  }
  let turns = 1;
  for (const f of rates) {
    if (!f) return null;
    turns = (turns * f.b) / gcd(turns, f.b);
    if (turns > 1000) return null;
  }
  return turns;
}

/** The hypotrochoid in its own units, centred on 0,0: one point per degree of the rolling circle. */
function hypotrochoidPoints(c: Hypotrochoid): Point[] {
  const R = c.R;
  const r = c.r;
  const r2 = c.r2 ?? 0;
  const laps = c.laps ?? 0;
  const drift = (c.drift ?? 0) / 100;
  const turns = Math.max(1, Math.round(c.turns));
  const k = (R - r) / (r || 1); // how fast the first wheel spins, against how fast it goes round
  const k2 = (r - r2) / (r2 || 1); // the same for the second wheel, inside the first
  // A degree a step for the plain spirograph, as always. A second wheel spins faster, so it gets
  // more, enough to keep its small loops round rather than angular.
  const fastest = r2 ? Math.abs(k) + Math.abs(laps) * (1 + Math.abs(k2)) : 0;
  const perTurn = Math.max(360, Math.round(fastest * 60));
  const steps = Math.max(64, Math.min(r2 ? 40000 : 20000, Math.round(turns * perTurn)));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    // The pen's distance from its wheel's centre, grown or shrunk evenly from first turn to last.
    const d = c.d * (1 + drift * (i / steps));
    // The first wheel's centre goes round the fixed circle; the wheel itself spins the other way.
    let x = (R - r) * Math.cos(t);
    let y = (R - r) * Math.sin(t);
    const spin = -k * t;
    if (!r2) {
      x += d * Math.cos(spin);
      y += d * Math.sin(spin);
    } else {
      // The second wheel goes round inside the first, `laps` times a turn, measured in the first
      // wheel's own frame - so it's carried round by that wheel's spin as well - and spins itself.
      const u = laps * t;
      x += (r - r2) * Math.cos(spin + u) + d * Math.cos(spin - k2 * u);
      y += (r - r2) * Math.sin(spin + u) + d * Math.sin(spin - k2 * u);
    }
    points.push({ x, y });
  }
  return points;
}

/**
 * Corners round the box, starting straight up: a polygon's, or a star's alternating out and in. The
 * box is the circle they sit on, so dragging a wide box gives a wide shape.
 */
function cornerPoints(c: Polygon | Star): Point[] {
  const n = Math.max(c.kind === "polygon" ? 3 : 2, Math.round(c.kind === "polygon" ? c.sides : c.points));
  const inner = c.kind === "star" ? Math.max(1, Math.min(99, c.inner)) / 100 : 1;
  const steps = c.kind === "polygon" ? n : n * 2;
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * 2 * Math.PI;
    const r = i % 2 && c.kind === "star" ? inner : 1;
    points.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  points.push(points[0]); // closed, so the pen finishes where it started
  return points;
}

/** A wave from one side of the box to the other, in the box's own inches. */
function wavePoints(c: Wave, b: ReturnType<typeof boxOf>): Point[] {
  const waves = Math.max(0.05, c.waves);
  const swing = Math.max(0, Math.min(100, c.swing)) / 100;
  const cy = (b.y0 + b.y1) / 2;
  const height = ((b.y1 - b.y0) / 2) * swing;
  const steps = Math.max(16, Math.min(8000, Math.ceil(waves * 24)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: b.x0 + t * (b.x1 - b.x0), y: cy - height * Math.sin(2 * Math.PI * waves * t) };
  });
}

/** One arc of the unit circle, at `radius`: the ring an arc shape draws, before it is fitted. */
function arcPoints(c: Arc, radius: number): Point[] {
  const sweep = Math.max(-360, Math.min(360, c.sweep));
  const steps = Math.max(8, Math.round(Math.abs(sweep) / 2));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((c.start - 90 + (sweep * i) / steps) * Math.PI) / 180;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
  });
}

/** A spiral wound out from the middle, and an arc round the same circle: both in their own units. */
function roundPoints(c: Spiral | Arc): Point[] {
  const points: Point[] = [];
  if (c.kind === "spiral") {
    const turns = Math.max(0.05, c.turns);
    const from = Math.max(0, Math.min(95, c.inner)) / 100;
    const steps = Math.max(64, Math.min(20000, Math.round(turns * 180)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = -Math.PI / 2 + t * turns * 2 * Math.PI;
      const r = from + (1 - from) * t;
      points.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return points;
  }
  return arcPoints(c, 1);
}

/**
 * Nested arcs, all fitted the way the outermost is: they share one centre and one scale, so they stay
 * concentric however the box is stretched. Each is its own stroke, since they never join up.
 */
function arcRings(c: Arc, b: ReturnType<typeof boxOf>): Point[][] {
  const arcs = Math.max(1, Math.round(c.arcs));
  const inner = Math.max(0.01, Math.min(0.99, c.inner / 100));
  const o = pointsBox(arcPoints(c, 1));
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  const kx = w > 1e-9 ? (b.x1 - b.x0) / w : 1;
  const ky = h > 1e-9 ? (b.y1 - b.y0) / h : 1;
  // Where the unit circle's middle lands once the outermost arc fills the box.
  const cx = b.x0 + (0 - o.x0) * kx;
  const cy = b.y0 + (0 - o.y0) * ky;
  return Array.from({ length: arcs }, (_, i) => {
    const radius = arcs === 1 ? 1 : inner + ((1 - inner) * i) / (arcs - 1);
    return arcPoints(c, radius).map((p) => ({ x: cx + p.x * kx, y: cy + p.y * ky }));
  });
}

/** Scale and shift points so they just fill the box, keeping their proportions. */
function fitToBox(points: Point[], b: ReturnType<typeof boxOf>, stretch = false): Point[] {
  if (!points.length) return points;
  const pb = pointsBox(points);
  const w = pb.x1 - pb.x0;
  const h = pb.y1 - pb.y0;
  const across = w > 0 ? (b.x1 - b.x0) / w : Infinity;
  const down = h > 0 ? (b.y1 - b.y0) / h : Infinity;
  // Proportional by default: a spirograph's shape is the point of it. Stretched where the box is
  // meant to be the shape's own outline, as it is for a polygon or a star.
  const scale = stretch ? { x: across, y: down } : { x: Math.min(across, down), y: Math.min(across, down) };
  const k = { x: Number.isFinite(scale.x) ? scale.x : 1, y: Number.isFinite(scale.y) ? scale.y : 1 };
  // Centred in the box, so a curve that isn't square doesn't sit against one edge.
  const cx = (pb.x0 + pb.x1) / 2;
  const cy = (pb.y0 + pb.y1) / 2;
  return points.map((p) => ({
    x: (b.x0 + b.x1) / 2 + (p.x - cx) * k.x,
    y: (b.y0 + b.y1) / 2 + (p.y - cy) * k.y,
  }));
}

/**
 * Curve stitching across the box's corners. Each string joins a point up one side to a point along
 * the next, and the strings are drawn in a run that never lifts: out along one, back along the next.
 */
function parabolicPoints(c: Parabolic, b: ReturnType<typeof boxOf>): Point[][] {
  const n = Math.max(1, Math.round(c.strings));
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  // Each corner is its own point, with the two arms running from it along the box's sides.
  const armsAt: Record<Corner, { at: Point; a: Point; b: Point }> = {
    tl: { at: { x: b.x0, y: b.y0 }, a: { x: b.x0 + w, y: b.y0 }, b: { x: b.x0, y: b.y0 + h } },
    br: { at: { x: b.x1, y: b.y1 }, a: { x: b.x1 - w, y: b.y1 }, b: { x: b.x1, y: b.y1 - h } },
    tr: { at: { x: b.x1, y: b.y0 }, a: { x: b.x1 - w, y: b.y0 }, b: { x: b.x1, y: b.y0 + h } },
    bl: { at: { x: b.x0, y: b.y1 }, a: { x: b.x0 + w, y: b.y1 }, b: { x: b.x0, y: b.y1 - h } },
  };
  // In the one order, whatever order they were picked in, so the pen's path doesn't depend on it.
  const arms = CORNERS.filter((k) => c.corners.includes(k)).map((k) => armsAt[k]);
  const along = (from: Point, to: Point, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  return arms.map(({ at, a, b: arm }) => {
    const run: Point[] = [];
    // From 0 rather than 1, so both arms are drawn and not just the one. The string at either end
    // is the degenerate one - it runs from the far end of an arm to the corner, which is that whole
    // side - and stopping at 1 drew the last of them but never the first, leaving the corner with a
    // solid line down one side and nothing down the other.
    for (let i = 0; i <= n; i++) {
      // Out along one string and back along the next, so one corner is a single stroke.
      const first = along(at, a, i / n);
      const second = along(arm, at, i / n);
      if (i % 2) run.push(first, second);
      else run.push(second, first);
    }
    return run;
  });
}

/**
 * The strokes a parametric shape draws, in the page's inches. More than one where the curve is drawn
 * in separate passes (each corner of a parabolic), so the pen lifts only where it has to.
 */
export function curveStrokes(shape: Shape): Point[][] {
  const curve = shape.curve;
  if (!curve) return [];
  const b = boxOf(shape);
  if (curve.kind === "parabolic") return parabolicPoints(curve, b);
  if (curve.kind === "polygon" || curve.kind === "star") return [fitToBox(cornerPoints(curve), b, true)];
  // A spiral and an arc are drawn round the box the way an ellipse is, so a wide box gives a wide one.
  if (curve.kind === "wave") return [wavePoints(curve, b)];
  if (curve.kind === "arc") return arcRings(curve, b);
  if (curve.kind === "spiral") return [fitToBox(roundPoints(curve), b, true)];
  return [fitToBox(hypotrochoidPoints(curve), b)];
}

/** One stroke as an SVG points list. */
export const pointsAttr = (points: Point[]) =>
  points.map((p) => `${Number(p.x.toFixed(4))},${Number(p.y.toFixed(4))}`).join(" ");

/** A curve read back from a saved drawing: only the numbers are kept, so check them on the way in. */
export function curveFromData(raw: unknown): Curve | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const n = (key: string, fallback: number) => (Number.isFinite(Number(d[key])) ? Number(d[key]) : fallback);
  if (d.kind === "hypotrochoid") {
    return {
      kind: "hypotrochoid", R: n("R", 5), r: n("r", 3), d: n("d", 5), turns: n("turns", 3),
      r2: n("r2", 0), laps: n("laps", 3), drift: n("drift", 0),
    };
  }
  if (d.kind === "parabolic") {
    // Corners by name; a drawing saved when they were a count (1-4) took them in the order drawn.
    const named = Array.isArray(d.corners) ? CORNERS.filter((k) => (d.corners as unknown[]).includes(k)) : null;
    const corners = named ?? CORNERS.slice(0, Math.max(1, Math.min(4, Math.round(n("corners", 4)))));
    return { kind: "parabolic", strings: n("strings", 12), corners: corners.length ? corners : CORNERS };
  }
  if (d.kind === "polygon") return { kind: "polygon", sides: n("sides", 6) };
  if (d.kind === "star") return { kind: "star", points: n("points", 5), inner: n("inner", 40) };
  if (d.kind === "spiral") return { kind: "spiral", turns: n("turns", 4), inner: n("inner", 5) };
  if (d.kind === "wave") return { kind: "wave", waves: n("waves", 3), swing: n("swing", 100) };
  if (d.kind === "arc") {
    return { kind: "arc", start: n("start", 0), sweep: n("sweep", 180), arcs: n("arcs", 1), inner: n("inner", 40) };
  }
  return null;
}
