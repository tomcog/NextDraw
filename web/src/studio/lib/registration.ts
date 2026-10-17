// Registration blocks: a small solid square for each pen, side by side in the page's lower left
// corner, left to right in the order the layers are plotted - so the print shows how each colour
// landed against the others, and in what order they went down. Taken from the drawing they were made
// in (Desktop/registration blocks.svg): each square one path, a zigzag of 21 strokes up and down with
// round turns, close enough together to lay the ink down solid.
import { newShapeId, type Layer, type Shape } from "../../shared/lib/drawing/shapes";
import type { Node } from "../../shared/lib/drawing/path";
import type { Point } from "../../shared/lib/drawing/parametric";

/** What each block is called in the Paths list - and how pressing Registration again finds the old ones. */
export const REGISTRATION_NAME = "Registration";

// A block, in inches: 13.846 by 14.4 points, 21 strokes across it.
const BLOCK_W = 13.846 / 72;
const BLOCK_H = 14.4 / 72;
const STROKES = 21;

/** One block as a path: its zigzag, from the top left, each turn a curve flat at the top or bottom. */
function block(layerId: string, at: Point): Shape {
  const step = BLOCK_W / STROKES;
  const points: Node[] = [];
  for (let i = 0; i <= STROKES; i++) {
    const x = at.x + i * step;
    const y = i % 2 ? at.y + BLOCK_H : at.y;
    // The handles lie flat, half a step either side, so the pen turns round rather than stabbing.
    points.push({
      x, y,
      ...(i > 0 ? { in: { x: x - step / 2, y } } : {}),
      ...(i < STROKES ? { out: { x: x + step / 2, y } } : {}),
    });
  }
  return {
    id: newShapeId(), layerId, kind: "path", points, name: REGISTRATION_NAME,
    x: at.x, y: at.y, x2: at.x + BLOCK_W, y2: at.y + BLOCK_H,
  };
}

/**
 * A block for each layer, butted side by side from `at` (the row's bottom left), layer 1 first: the
 * order Plot draws them in. A hidden layer gets none, and leaves no gap: the next one butts up.
 */
export function registrationShapes(layers: Layer[], at: Point): Shape[] {
  return layers.filter((l) => !l.hidden).map((l, i) => block(l.id, { x: at.x + i * BLOCK_W, y: at.y - BLOCK_H }));
}

/** How much room the row takes, in inches: a block for each shown layer. */
export function registrationSize(layers: Layer[]): { w: number; h: number } {
  return { w: layers.filter((l) => !l.hidden).length * BLOCK_W, h: BLOCK_H };
}

/** Whether a shape is one of the blocks: what pressing Registration again takes away first. */
export const isRegistrationBlock = (s: Shape) => s.kind === "path" && s.name === REGISTRATION_NAME && !s.group;
