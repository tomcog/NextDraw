// Jiggle: the strokes of a layer moved a little, for a second pass over the first - the same drawing
// again, not quite where it was, as a hand going over it twice would put it.

import { mapNode, type Node } from "../../shared/lib/drawing/path";
import { pathRuns, pointsBox, shiftShape, type Shape } from "../../shared/lib/drawing/shapes";
import { seeded } from "./shapeEdits";

export interface JiggleOptions {
  /** How far every stroke moves, in inches, and which way: degrees, 0 to the right, 90 up the page. */
  distance: number;
  angle: number;
  /** How much each stroke's move differs from the rest, 0 to 1: a share of the distance, any way. */
  randomness: number;
  /** How far each point of a path strays on its own, in inches: the stroke bent, not only moved. */
  noise: number;
  /** The draw of the random numbers, so the same jiggle is shown until another is asked for. */
  seed: number;
}

/** A point at random in a circle of this radius, evenly spread over it. */
const inCircle = (rand: () => number, radius: number) => {
  const r = radius * Math.sqrt(rand());
  const a = rand() * 2 * Math.PI;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

/**
 * The shapes `on` picks, jiggled; the rest as they are. Each stroke - a run of a path, or a whole
 * shape - moves by the distance and angle, plus its own share of randomness. Noise moves each point
 * of a path on its own, its handles with it; shapes drawn from their numbers - boxes, curves, words,
 * images - have no points to stray, and are only moved.
 */
export function jiggled(shapes: Shape[], on: (s: Shape) => boolean, o: JiggleOptions): Shape[] {
  const rand = seeded(o.seed);
  const rad = (o.angle * Math.PI) / 180;
  const base = { x: o.distance * Math.cos(rad), y: -o.distance * Math.sin(rad) }; // the page's y runs down
  const strokeMove = () => {
    const off = inCircle(rand, o.randomness * o.distance);
    return { x: base.x + off.x, y: base.y + off.y };
  };
  return shapes.map((s) => {
    if (!on(s)) return s;
    const runs = pathRuns(s);
    if (s.kind !== "path" || !runs.length) {
      const by = strokeMove();
      return shiftShape(s, by.x, by.y);
    }
    const moves = runs.map(strokeMove);
    const moved: Node[][] = runs.map((run, i) =>
      run.map((n) => {
        const stray = o.noise > 0 ? inCircle(rand, o.noise) : { x: 0, y: 0 };
        const dx = moves[i].x + stray.x;
        const dy = moves[i].y + stray.y;
        return mapNode(n, (p) => ({ x: p.x + dx, y: p.y + dy }));
      }),
    );
    // The box follows the points. A turned path turns about the middle of its box, so it is carried
    // by the strokes' average move instead, rather than shifting the middle the turn is made about.
    const mean = { x: moves.reduce((t, m) => t + m.x, 0) / moves.length, y: moves.reduce((t, m) => t + m.y, 0) / moves.length };
    const b = s.rotation ? { x0: s.x + mean.x, y0: s.y + mean.y, x1: s.x2 + mean.x, y1: s.y2 + mean.y } : pointsBox(moved.flat());
    return { ...s, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1, ...(s.runs ? { runs: moved } : { points: moved[0] }) };
  });
}
