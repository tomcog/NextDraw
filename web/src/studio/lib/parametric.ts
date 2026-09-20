// Curves that keep their numbers. A parametric shape is drawn from its parameters every time, so it
// can be re-tuned after the fact - the same bargain as a hatch fill (see hatch.ts): the file holds
// both the lines the pen will draw and the numbers that made them, and Studio regenerates the lines.
//
// Every generator fills the shape's box, so moving and resizing a curve works like any other shape
// and the box stays its footprint.

import { boxOf, type Shape } from "./shapes";

export type CurveKind = "hypotrochoid" | "parabolic";

/** A spirograph: a circle of radius `r` rolling inside one of radius `R`, pen `d` from its centre. */
export interface Hypotrochoid {
  kind: "hypotrochoid";
  R: number; // the fixed circle, in arbitrary units - only the ratios matter, the box sets the size
  r: number; // the rolling circle; negative rolls it around the outside (an epitrochoid)
  d: number; // how far the pen sits from the rolling circle's centre
  turns: number; // how many times round the fixed circle to draw
}

/** Curve stitching: straight strings across a corner, whose envelope is a parabola. */
export interface Parabolic {
  kind: "parabolic";
  strings: number; // strings per corner
  corners: number; // 1, 2 or 4 corners of the box
}

export type Curve = Hypotrochoid | Parabolic;

export interface Point {
  x: number;
  y: number;
}

export const DEFAULT_CURVE: Record<CurveKind, Curve> = {
  hypotrochoid: { kind: "hypotrochoid", R: 5, r: 3, d: 5, turns: 3 },
  parabolic: { kind: "parabolic", strings: 12, corners: 4 },
};

export const CURVE_LABEL: Record<CurveKind, string> = {
  hypotrochoid: "Spirograph",
  parabolic: "Parabolic curve",
};

/** The numbers a curve shows in the panel: what to call each one and how far it may go. */
export const CURVE_FIELDS: Record<CurveKind, { key: string; label: string; min: number; max: number; step: number }[]> = {
  hypotrochoid: [
    { key: "R", label: "Fixed circle", min: 1, max: 200, step: 1 },
    { key: "r", label: "Rolling circle", min: -200, max: 200, step: 1 },
    { key: "d", label: "Pen offset", min: -200, max: 200, step: 1 },
    { key: "turns", label: "Turns", min: 1, max: 200, step: 1 },
  ],
  parabolic: [
    { key: "strings", label: "Strings", min: 1, max: 200, step: 1 },
    { key: "corners", label: "Corners", min: 1, max: 4, step: 1 },
  ],
};

/**
 * A hypotrochoid closes after r / gcd(R, r) turns of the fixed circle, so drawing more than that
 * just retraces it - and retracing means the pen goes over the same line twice on paper.
 */
export function closingTurns(R: number, r: number): number {
  const a = Math.round(Math.abs(R));
  const b = Math.round(Math.abs(r));
  if (!a || !b) return 1;
  const gcd = (m: number, n: number): number => (n ? gcd(n, m % n) : m);
  return b / gcd(a, b);
}

/** The hypotrochoid in its own units, centred on 0,0: one point per degree of the rolling circle. */
function hypotrochoidPoints(c: Hypotrochoid): Point[] {
  const R = c.R;
  const r = c.r;
  const d = c.d;
  const turns = Math.max(1, Math.round(c.turns));
  const steps = Math.max(64, Math.min(20000, Math.round(turns * 360)));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const k = (R - r) / (r || 1);
    points.push({
      x: (R - r) * Math.cos(t) + d * Math.cos(k * t),
      y: (R - r) * Math.sin(t) - d * Math.sin(k * t),
    });
  }
  return points;
}

/** Scale and shift points so they just fill the box, keeping their proportions. */
function fitToBox(points: Point[], b: ReturnType<typeof boxOf>): Point[] {
  if (!points.length) return points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min(w > 0 ? (b.x1 - b.x0) / w : Infinity, h > 0 ? (b.y1 - b.y0) / h : Infinity);
  const k = Number.isFinite(scale) ? scale : 1;
  // Centred in the box, so a curve that isn't square doesn't sit against one edge.
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => ({
    x: (b.x0 + b.x1) / 2 + (p.x - cx) * k,
    y: (b.y0 + b.y1) / 2 + (p.y - cy) * k,
  }));
}

/**
 * Curve stitching across the box's corners. Each string joins a point up one side to a point along
 * the next, and the strings are drawn in a run that never lifts: out along one, back along the next.
 */
function parabolicPoints(c: Parabolic, b: ReturnType<typeof boxOf>): Point[][] {
  const n = Math.max(1, Math.round(c.strings));
  const corners = Math.max(1, Math.min(4, Math.round(c.corners)));
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  // Each corner is its own point, with the two arms running from it along the box's sides.
  const arms: { at: Point; a: Point; b: Point }[] = [
    { at: { x: b.x0, y: b.y0 }, a: { x: b.x0 + w, y: b.y0 }, b: { x: b.x0, y: b.y0 + h } },
    { at: { x: b.x1, y: b.y1 }, a: { x: b.x1 - w, y: b.y1 }, b: { x: b.x1, y: b.y1 - h } },
    { at: { x: b.x1, y: b.y0 }, a: { x: b.x1 - w, y: b.y0 }, b: { x: b.x1, y: b.y0 + h } },
    { at: { x: b.x0, y: b.y1 }, a: { x: b.x0 + w, y: b.y1 }, b: { x: b.x0, y: b.y1 - h } },
  ].slice(0, corners);
  const along = (from: Point, to: Point, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  return arms.map(({ at, a, b: arm }) => {
    const run: Point[] = [];
    for (let i = 1; i <= n; i++) {
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
    return { kind: "hypotrochoid", R: n("R", 5), r: n("r", 3), d: n("d", 5), turns: n("turns", 3) };
  }
  if (d.kind === "parabolic") {
    return { kind: "parabolic", strings: n("strings", 12), corners: n("corners", 4) };
  }
  return null;
}
