// SVG transforms, as a drawing program writes them on a group and Studio can't keep: everything here
// is in inches on the page with no transform at all, so what a file says is scaled, moved or turned
// is baked into the coordinates on the way in. An affine map of a curve is exactly a curve - the
// handles move with the points - so nothing is approximated by it.

import type { Point } from "./parametric";

/** A 2×3 affine matrix in SVG's own order: [a b c d e f], mapping (x, y) to (ax + cy + e, bx + dy + f). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m × n: applying n first, then m - which is how a list of transforms reads, left to right. */
export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export const apply = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

export const isIdentity = (m: Matrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

/** Whether the map keeps axes as axes: only scaling and moving, so a box stays a box. */
export const axisAligned = (m: Matrix) => Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12;

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * A transform attribute as one matrix. The functions apply right to left to a point, which is the
 * same as composing them left to right; an unknown function is skipped rather than guessed at.
 */
export function parseTransform(text: string | null | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!text) return m;
  for (const [, name, inside] of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = (inside.match(NUM) ?? []).map(Number);
    let t: Matrix | null = null;
    switch (name) {
      case "matrix":
        if (n.length === 6) t = [n[0], n[1], n[2], n[3], n[4], n[5]];
        break;
      case "translate":
        t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
        break;
      case "scale":
        t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((n[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const cx = n[1] ?? 0;
        const cy = n[2] ?? 0;
        // rotate(a cx cy) is translate(cx cy) rotate(a) translate(-cx -cy)
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}
