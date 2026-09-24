// Straight lines that lie along one another merged into single strokes. A halftone made of short
// dashes - Vectoraster's, say - lays each row down as dashes that overrun their neighbours, so the
// pen would draw most of every row two or three times over. Joined where they overlap or touch, a
// row is the few strokes it looks like, and what is drawn doesn't change: the same pen over the same
// line covers the same ink.

import type { Point } from "./parametric";
import type { Node } from "./path";
import { newShapeId, pathRuns, type Shape } from "./shapes";

/** How near, in inches, two lines count as one line, and two ends as touching: far under any pen. */
const NEAR = 0.001;

/**
 * Whether a shape is nothing but straight lines from one point to the next, each drawn once as it
 * stands: a line, or a path of two-point runs with no curve in them. Anything turned, repeated,
 * filled, smoothed or not itself drawn is left as it is - merging it would change what it is.
 */
function straightPieces(s: Shape, filled: Set<string>): [Point, Point][] | null {
  if (s.rotation || s.repeat || s.smooth || s.outline === false || s.curve || s.photo || filled.has(s.id)) return null;
  if (s.kind === "line") return [[{ x: s.x, y: s.y }, { x: s.x2, y: s.y2 }]];
  if (s.kind !== "path") return null;
  const runs = pathRuns(s);
  if (!runs.length || runs.some((run) => run.length !== 2 || run.some((n) => n.in || n.out))) return null;
  return runs.map((run) => [{ x: run[0].x, y: run[0].y }, { x: run[1].x, y: run[1].y }]);
}

export interface Merged {
  shapes: Shape[];
  /** How many lines went in, and how many strokes they came out as. */
  before: number;
  after: number;
  /** How much less the pen draws, in inches. */
  saved: number;
}

/**
 * Every layer's straight lines that overlap or touch along the same line joined into one stroke. The
 * shapes that took part become one path per layer - "Merged lines", in place of the first of them -
 * drawn row by row, each row the other way from the last so the pen doesn't cross back. Lines that
 * meet nothing are left as the shapes they were. Null when nothing overlaps.
 */
export function mergeLines(shapes: Shape[], filledIds: string[]): Merged | null {
  const filled = new Set(filledIds);
  let before = 0;
  let after = 0;
  let saved = 0;
  const replaced = new Map<string, Shape | null>(); // shape id -> its layer's merged path (at the first), or gone
  const layers = [...new Set(shapes.map((s) => s.layerId))];
  for (const layerId of layers) {
    // Each piece, and the line it lies along: its direction, one way round, and how far that line
    // passes from the corner.
    type Piece = { shape: string; t0: number; t1: number };
    const lines = new Map<string, { dx: number; dy: number; c: number; pieces: Piece[] }>();
    for (const s of shapes) {
      if (s.layerId !== layerId) continue;
      for (const [a, b] of straightPieces(s, filled) ?? []) {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < NEAR) continue;
        dx /= len;
        dy /= len;
        if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0)) {
          dx = -dx;
          dy = -dy;
        }
        const c = -dy * a.x + dx * a.y;
        const key = `${Math.round(Math.atan2(dy, dx) / (NEAR / 10))}:${Math.round(c / NEAR)}`;
        const line = lines.get(key) ?? lines.set(key, { dx, dy, c, pieces: [] }).get(key)!;
        const ta = a.x * dx + a.y * dy;
        const tb = b.x * dx + b.y * dy;
        line.pieces.push({ shape: s.id, t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
      }
    }
    // Along each line, pieces that overlap or touch are one stroke.
    type Stroke = { line: { dx: number; dy: number; c: number }; t0: number; t1: number; from: Set<string>; drawn: number };
    const strokes: Stroke[] = [];
    for (const line of lines.values()) {
      line.pieces.sort((p, q) => p.t0 - q.t0);
      let cur: Stroke | null = null;
      for (const p of line.pieces) {
        if (cur && p.t0 <= cur.t1 + NEAR) {
          cur.t1 = Math.max(cur.t1, p.t1);
          cur.from.add(p.shape);
          cur.drawn += p.t1 - p.t0;
        } else {
          cur = { line, t0: p.t0, t1: p.t1, from: new Set([p.shape]), drawn: p.t1 - p.t0 };
          strokes.push(cur);
        }
      }
    }
    // A shape takes part if any of its lines ran into another: then all of its lines go in the path.
    const joined = new Set<string>();
    for (const st of strokes) if (st.from.size > 1 || st.drawn > st.t1 - st.t0 + NEAR) for (const id of st.from) joined.add(id);
    if (!joined.size) continue;
    const kept = strokes.filter((st) => [...st.from].some((id) => joined.has(id)));
    // Line by line - by direction, then across - and along each, every other line the other way.
    kept.sort((p, q) => Math.atan2(p.line.dy, p.line.dx) - Math.atan2(q.line.dy, q.line.dx) || p.line.c - q.line.c || p.t0 - q.t0);
    const runs: Node[][] = [];
    let lastLine: Stroke["line"] | null = null;
    let back = true;
    let row: Node[][] = [];
    const flush = () => {
      runs.push(...(back ? row.reverse().map((r) => [r[1], r[0]]) : row));
      row = [];
    };
    for (const st of kept) {
      if (st.line !== lastLine) {
        flush();
        back = !back;
        lastLine = st.line;
      }
      const { dx, dy, c } = st.line;
      const at = (t: number): Node => ({ x: dx * t - dy * c, y: dy * t + dx * c });
      row.push([at(st.t0), at(st.t1)]);
    }
    flush();
    const count = shapes.filter((s) => joined.has(s.id)).reduce((n, s) => n + (straightPieces(s, filled)?.length ?? 0), 0);
    before += count;
    after += runs.length;
    saved += kept.reduce((sum, st) => sum + st.drawn - (st.t1 - st.t0), 0);
    const all = runs.flat();
    const merged: Shape = {
      id: newShapeId(),
      layerId,
      kind: "path",
      name: "Merged lines",
      ...(runs.length > 1 ? { runs } : { points: runs[0] }),
      x: Math.min(...all.map((p) => p.x)),
      y: Math.min(...all.map((p) => p.y)),
      x2: Math.max(...all.map((p) => p.x)),
      y2: Math.max(...all.map((p) => p.y)),
    };
    let first = true;
    for (const s of shapes) {
      if (!joined.has(s.id)) continue;
      replaced.set(s.id, first ? merged : null);
      first = false;
    }
  }
  if (!replaced.size) return null;
  const out: Shape[] = [];
  for (const s of shapes) {
    if (!replaced.has(s.id)) out.push(s);
    else if (replaced.get(s.id)) out.push(replaced.get(s.id)!);
  }
  return { shapes: out, before, after, saved };
}
