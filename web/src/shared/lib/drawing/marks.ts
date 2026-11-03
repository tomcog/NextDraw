// The marks a shape makes on the paper - its own lines, its copies, its turn, its fills - in inches on
// the page. Shared, so every app works out the same lines from the same shapes.

import { fillRuns, type Fill } from "./hatch";
import type { StrokeFont } from "./font";
import { curveStrokes, type Point } from "./parametric";
import { flattenPath, mapNode, parsePath, type Node } from "./path";
import { placePoint, placements } from "./repeat";
import { centerOf, drawnNodes, drawnRuns, outlinePoints, turnPoint, type Shape } from "./shapes";
import { textRuns } from "./text";

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
      return placePoint(centre, place, turnPoint(p, centre, shape.rotation ?? 0));
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
  }
  if (fills) runs.push(...fillMarks(shape, fills));
  return runs;
}

/** Every line a shape's fills draw, in inches on the page: its copies and its turn too. */
export function fillMarks(shape: Shape, fills: Fill[]): Point[][] {
  const mine = fills.filter((f) => f.shapeId === shape.id);
  if (!mine.length) return [];
  const centre = centerOf(shape);
  const runs: Point[][] = [];
  for (const place of placements(shape)) {
    const put = (p: Point) => placePoint(centre, place, turnPoint(p, centre, shape.rotation ?? 0));
    for (const fill of mine) {
      for (const run of fillRuns(shape, fill)) {
        if (run.length > 1) runs.push(run.map(put));
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
      return placePoint(centre, place, turnPoint(p, centre, shape.rotation ?? 0));
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

