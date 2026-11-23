// Trim marks: where a print is to be cut, for the size it's finished at.
//
// They are no longer part of a drawing. Plot keeps the two numbers in its own block and the marks are
// drawn round the artboard when the drawing is plotted (server.py, add_trim_marks), so one drawing can
// go on any sheet with the marks that suit it. What is left here is for the drawings made before that:
// they carry marks as a parametric curve on a layer of their own, which Studio and Image still draw
// and move like any other shape, and which Plot leaves out of the plot in favour of its own.

import { boxOf, type Layer, type Page, type Shape } from "./shapes";
import type { Trim } from "./parametric";

/** What the layer's name says after its pen: "Black - Trim marks". */
export const TRIM_LABEL = "Trim marks";

/** The marks a drawing carries, if it has them: the first, should there somehow be more. */
export const trimShapeOf = (shapes: Shape[]) => shapes.find((s) => s.curve?.kind === "trim") as (Shape & { curve: Trim }) | undefined;

/** What the marks are part of: the drawing's shapes and layers. */
export interface TrimDrawing {
  shapes: Shape[];
  layers: Layer[];
  page: Page;
}

const isTrim = (s: Shape) => s.curve?.kind === "trim";

/** The marks at this box, in inches on the page: their size and where they sit. */
const withTrimBox = (d: TrimDrawing, box: { x0: number; y0: number; x1: number; y1: number }): TrimDrawing => ({
  ...d,
  shapes: d.shapes.map((s) => (isTrim(s) ? { ...s, x: box.x0, y: box.y0, x2: box.x1, y2: box.y1 } : s)),
});

/** The marks moved by this much, in inches, at their size: dragged on the canvas. */
export function withTrimMoved(d: TrimDrawing, dx: number, dy: number): TrimDrawing {
  const trim = trimShapeOf(d.shapes);
  if (!trim || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return d;
  const b = boxOf(trim);
  return withTrimBox(d, { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
}
