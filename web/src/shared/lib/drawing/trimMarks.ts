// Trim marks: a live layer marking where a print is to be cut, for the size it's finished at. The marks
// are a parametric curve (`Trim` in parametric.ts) whose box is the trim, so they're redrawn from the
// size and the two numbers every time - set in Photo's Trim marks card, or in Studio's Curve card - and
// Plot plots them as the lines they're written out as.

import { DEFAULT_CURVE, curveStrokes, type Trim } from "./parametric";
import { lightness } from "../color";
import { LABEL_SEPARATOR } from "../ink";
import type { PenColor } from "../types";
import { newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";

/** What the layer's name says after its pen: "Black - Trim marks". */
export const TRIM_LABEL = "Trim marks";

/** Finished sizes a print is commonly trimmed to, in inches, width first (portrait). */
export const TRIM_SIZES: { id: string; name: string; w: number; h: number }[] = [
  { id: "4x6", name: "4 × 6 in", w: 4, h: 6 },
  { id: "5x7", name: "5 × 7 in", w: 5, h: 7 },
  { id: "8x10", name: "8 × 10 in", w: 8, h: 10 },
  { id: "letter", name: "8.5 × 11 in", w: 8.5, h: 11 },
  { id: "9x12", name: "9 × 12 in", w: 9, h: 12 },
  { id: "11x14", name: "11 × 14 in", w: 11, h: 14 },
  { id: "11x17", name: "11 × 17 in", w: 11, h: 17 },
  { id: "12x16", name: "12 × 16 in", w: 12, h: 16 },
  { id: "12x18", name: "12 × 18 in", w: 12, h: 18 },
  { id: "16x20", name: "16 × 20 in", w: 16, h: 20 },
  { id: "18x24", name: "18 × 24 in", w: 18, h: 24 },
  { id: "a5", name: "A5", w: 148 / 25.4, h: 210 / 25.4 },
  { id: "a4", name: "A4", w: 210 / 25.4, h: 297 / 25.4 },
  { id: "a3", name: "A3", w: 297 / 25.4, h: 420 / 25.4 },
];

/** The trim size a box is, either way round, or "custom". */
export const trimSizeIdOf = (w: number, h: number) =>
  TRIM_SIZES.find((s) => (Math.abs(s.w - w) < 0.005 && Math.abs(s.h - h) < 0.005) || (Math.abs(s.h - w) < 0.005 && Math.abs(s.w - h) < 0.005))?.id ?? "custom";

/** The drawing's trim marks, if it has them: the first, should there somehow be more. */
export const trimShapeOf = (shapes: Shape[]) => shapes.find((s) => s.curve?.kind === "trim") as (Shape & { curve: Trim }) | undefined;

/**
 * New trim marks, round `box` (inches on the page), and the layer they're drawn on: the palette's
 * darkest pen, labelled, so Plot loads that pen for them and it's plain what the layer is for.
 */
export function newTrimMarks(box: { x0: number; y0: number; x1: number; y1: number }, palette: PenColor[]): { shape: Shape; layer: Layer } {
  const pen = [...palette].sort((a, b) => (lightness(a.color) ?? 1) - (lightness(b.color) ?? 1))[0] ?? { name: "Black", color: "#262626" };
  const layer: Layer = { id: newLayerId(), name: `${pen.name}${LABEL_SEPARATOR}${TRIM_LABEL}`, color: pen.color };
  const shape: Shape = { id: newShapeId(), kind: "curve", curve: { ...(DEFAULT_CURVE.trim as Trim) }, layerId: layer.id, x: box.x0, y: box.y0, x2: box.x1, y2: box.y1 };
  return { shape, layer };
}

/** The box of a trim of `w` by `h` inches with the same middle as `around`. */
export const trimAbout = (around: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number) => {
  const cx = (around.x0 + around.x1) / 2;
  const cy = (around.y0 + around.y1) / 2;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
};

/** Whether any mark runs past the paper's edge, where the plotter can't draw it. */
export function trimOffPaper(shape: Shape, page: Page): boolean {
  const e = 1e-6;
  return curveStrokes(shape).some((run) => run.some((p) => p.x < -e || p.y < -e || p.x > page.w + e || p.y > page.h + e));
}
