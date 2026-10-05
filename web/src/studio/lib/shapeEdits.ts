// What is done to one shape, or a few, as a whole: flattened to points, its copies baked, several
// joined into one and taken apart again, a path simplified - and the marks a shape makes, worked out
// for whoever needs them. Plain geometry: each returns the shapes that take the old ones' place, and
// App.tsx records, sets and picks.

import { fillRuns, newFillId, type Fill } from "./hatch";
import type { StrokeFont } from "./font";
import { curveStrokes, type Point } from "./parametric";
import { flattenPath, flattenRun, mapNode, parsePath, simplifyRun, type Node } from "./path";
import { placements } from "./repeat";
import { centerOf, drawnNodes, drawnRuns, newShapeId, outlinePoints, pathRuns, pointsBox, turnPoint, type Shape } from "./shapes";
import { textRuns } from "./text";

/**
 * The fills of a shape that has been replaced by others, handed to each of them, so the drawing looks
 * the same afterwards. The first keeps the fill's own id when it kept the shape's.
 */
export function handOutFills(fills: Fill[], id: string, made: Shape[]): Fill[] {
  return fills.flatMap((f) => (f.shapeId === id
    ? made.map((s) => ({ ...f, id: s.id === id ? f.id : newFillId(), shapeId: s.id }))
    : [f]));
}

/**
 * Flatten a shape: give up the numbers behind what it is, and keep what they drew. A curve becomes
 * a path with every point draggable, a word becomes the strokes of its font, a rectangle becomes
 * its four corners. What the shape IS becomes points; where its marks LAND is left alone, so the
 * turn and the copies stay settings and the copies go on following the points that can now be
 * dragged. Nothing is flattened for the sake of another app - the file always carries the marks
 * themselves - so this is only ever about being able to edit a thing by hand. The first of what it
 * becomes keeps the shape's id; nothing at all when there is nothing to keep.
 */
export function flattened(shape: Shape, font: StrokeFont | undefined): Shape[] {
  const made: Shape[] = [];
  if (shape.kind === "text") {
    // Every stroke of every letter becomes its own path: the words are given up, the marks stay.
    for (const glyph of textRuns(shape, font)) {
      // The letter's own curves, kept as curves: a flattened word is the strokes of its font, not
      // the font walked out into segments.
      for (const points of parsePath(glyph.d)) {
        if (points.length < 2) continue;
        const b = pointsBox(flattenRun(points));
        made.push({
          ...shape, id: made.length ? newShapeId() : shape.id,
          kind: "path", points, text: undefined, font: undefined, tracking: undefined,
          leading: undefined,
          x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
        });
      }
    }
  } else if (shape.curve) {
    for (const points of curveStrokes(shape)) {
      if (points.length < 2) continue;
      const b = pointsBox(points);
      made.push({
        ...shape, id: made.length ? newShapeId() : shape.id,
        // The curve's numbers are given up, but not its shape: the points are kept as a curve
        // through them, so simplifying down to a handful still draws what was drawn.
        kind: "path", points, curve: undefined, smooth: true,
        x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
      });
    }
  } else {
    // A rectangle, an ellipse, a line or a path: left as its own points, so each one can be
    // pulled about point by point afterwards. A smoothed path gives up the curve here - what is
    // left is the points the pen was going to be walked through anyway.
    const runs = (shape.kind === "path" ? drawnRuns(shape) : [outlinePoints(shape)])
      .filter((run) => run.length > 1);
    if (!runs.length) return [];
    const b = pointsBox(runs.flat());
    made.push({
      ...shape, id: shape.id,
      kind: "path", smooth: undefined,
      ...(runs.length > 1 ? { runs, points: undefined } : { runs: undefined, points: runs[0] }),
      x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    });
  }
  return made;
}

/**
 * Bake a shape's copies: each one becomes a shape of its own, keeping the numbers behind it. A
 * ring of eight spirographs becomes eight spirographs, each still a spirograph to edit, rather
 * than eight paths - baking says where the marks land, not what they are made of. The turn a ring
 * gave a copy becomes that copy's own turn, and the shape's own turn stays the setting it was, so
 * all this changes is how many shapes there are and where they sit. The first keeps the shape's id.
 */
export function bakedCopies(shape: Shape): Shape[] {
  if (!shape.repeat) return [shape];
  // Turning about the middle and then moving is the same as moving and then turning about the
  // middle where it landed, which is why each copy can be its own shape at its own angle.
  const shift = (run: Node[], dx: number, dy: number) =>
    run.map((n) => mapNode(n, (p) => ({ x: p.x + dx, y: p.y + dy })));
  return placements(shape).map((place, i) => {
    const turn = (shape.rotation ?? 0) + place.deg;
    return {
      ...shape,
      id: i ? newShapeId() : shape.id,
      repeat: undefined,
      rotation: turn || undefined,
      x: shape.x + place.dx, y: shape.y + place.dy,
      x2: shape.x2 + place.dx, y2: shape.y2 + place.dy,
      ...(shape.runs
        ? { runs: shape.runs.map((run) => shift(run, place.dx, place.dy)) }
        : shape.points
          ? { points: shift(shape.points, place.dx, place.dy) }
          : {}),
    };
  });
}

/**
 * Every run of marks a shape makes, in inches on the page: its copies, its turn and all. With its
 * fills, everything the pen draws for it - its own outline left out when it is only there to be
 * filled - rather than the shape's own line alone.
 */
export function markRuns(shape: Shape, font: StrokeFont | undefined, fills?: Fill[]): Point[][] {
  const centre = centerOf(shape);
  const runs: Point[][] = [];
  for (const place of placements(shape)) {
    const put = (p: Point) => {
      const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
      return { x: turned.x + place.dx, y: turned.y + place.dy };
    };
    const own = shape.kind === "text"
      ? textRuns(shape, font).flatMap((g) => flattenPath(g.d))
      : shape.curve ? curveStrokes(shape)
      : shape.kind === "path" ? drawnRuns(shape)
      : [outlinePoints(shape)];
    if (!fills || shape.outline !== false) {
      for (const run of own) {
        if (run.length > 1) runs.push(run.map(put));
      }
    }
    if (fills) {
      for (const fill of fills.filter((f) => f.shapeId === shape.id)) {
        for (const run of fillRuns(shape, fill)) {
          if (run.length > 1) runs.push(run.map(put));
        }
      }
    }
  }
  return runs;
}

/** Every run a shape makes, as nodes: like markRuns, but a curve stays a curve rather than being
 * walked out - what joining wants, so a joined shape is no less exact than its parts. */
export function markNodes(shape: Shape, font: StrokeFont | undefined): Node[][] {
  const centre = centerOf(shape);
  const out: Node[][] = [];
  for (const place of placements(shape)) {
    const put = (p: Point): Point => {
      const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
      return { x: turned.x + place.dx, y: turned.y + place.dy };
    };
    const own: Node[][] = shape.kind === "text"
      ? textRuns(shape, font).flatMap((g) => parsePath(g.d))
      : shape.curve ? curveStrokes(shape)
      : shape.kind === "path" ? drawnNodes(shape)
      : [outlinePoints(shape)];
    // A loop, not push(...runs): a path of many thousands of subpaths is too many arguments for a call.
    if (shape.outline !== false) for (const run of own) out.push(run.map((n) => mapNode(n, put)));
  }
  return out;
}

/**
 * Several shapes joined into one: every mark of every one of them becomes a run of a single path,
 * which then moves, scales and turns as one thing. It is the first of them, under its id. Photos are
 * left out - a photo is its lines made from a picture, not an outline to join - and fewer than two
 * shapes to join is nothing to do.
 */
export function joined(shapes: Shape[], fonts: Record<string, StrokeFont>): Shape | null {
  const picked = shapes.filter((s) => s.kind !== "photo");
  if (picked.length < 2) return null;
  const runs = picked.flatMap((s) => markNodes(s, fonts[s.font ?? ""]));
  if (!runs.length) return null;
  const b = pointsBox(runs.flatMap((run) => flattenRun(run)));
  return {
    ...picked[0], kind: "path", runs, points: undefined,
    curve: undefined, repeat: undefined, rotation: undefined,
    text: undefined, font: undefined, tracking: undefined, leading: undefined,
    x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
  };
}

/**
 * A path with the points it doesn't need dropped, to within `tolerance` inches. A drawing that has
 * been through another program arrives with its curves walked into thousands of points; this leaves
 * the ones that carry the shape, so they can be dragged - and the plotter has less to read. Nothing
 * when it can't do with fewer.
 */
export function simplified(shape: Shape, tolerance: number): Shape | null {
  const runs = pathRuns(shape);
  if (!runs.length) return null;
  // Simplified from the points the path draws - its curves walked out - so a curved path is
  // thinned by what is on the page, not by its handles.
  const simpler = runs.map((run) => simplifyRun(flattenRun(run), tolerance)).filter((run) => run.length > 1);
  if (!simpler.length || simpler.reduce((n, r) => n + r.length, 0) >= runs.reduce((n, r) => n + r.length, 0)) return null;
  // Simplifying is for keeping the shape while dropping the points, so what comes out is drawn as
  // a curve through them: straight lines between a tenth as many points would be a different
  // drawing. The Smooth button turns that off again for a path that really is straight.
  return { ...shape, smooth: true, ...(shape.runs ? { runs: simpler } : { points: simpler[0] }) };
}

/** A joined shape taken apart again: each run a shape of its own, the first keeping its id. */
export function splitApart(shape: Shape): Shape[] {
  const runs = pathRuns(shape);
  if (runs.length < 2) return [shape];
  return runs.map((run, i) => {
    const b = pointsBox(run);
    return {
      ...shape, id: i ? newShapeId() : shape.id, kind: "path" as const,
      runs: undefined, points: run, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    };
  });
}
