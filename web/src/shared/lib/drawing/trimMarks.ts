// Trim marks: a live layer marking where a print is to be cut, for the size it's finished at. The marks
// are a parametric curve (`Trim` in parametric.ts) whose box is the trim, so they're redrawn from the
// size and the two numbers every time - set in Photo's Trim marks card, or in Studio's Curve card - and
// Plot plots them as the lines they're written out as.

import { DEFAULT_CURVE, curveStrokes, type Trim } from "./parametric";
import { lightness } from "../color";
import { isVarnishLayer, LABEL_SEPARATOR, splitLayerName } from "../ink";
import type { PenColor } from "../types";
import { boxOf, newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";
import { drawnBox, reshapeDrawing } from "./whole";

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

type Box = { x0: number; y0: number; x1: number; y1: number };

/** What the trim marks change: the drawing's shapes and layers. The same edits in all three apps. */
export interface TrimDrawing {
  shapes: Shape[];
  layers: Layer[];
  page: Page;
}

const isTrim = (s: Shape) => s.curve?.kind === "trim";

/** The box of everything drawn but the trim marks, or null for nothing drawn. */
export function drawingBoxOf(shapes: Shape[]): Box | null {
  const b = drawnBox(shapes.filter((s) => !isTrim(s)));
  return Number.isFinite(b.x0) && b.x1 > b.x0 && b.y1 > b.y0 ? b : null;
}

/**
 * Trim marks put in: round what's drawn, at its size, for a size to be set - or, with nothing drawn,
 * inside `inset` of the paper's edges. On the drawing's Trim marks layer if it has one; otherwise a new
 * one in the palette's darkest pen, under any Varnish so the varnish still goes on last.
 */
export function withTrimOn(d: TrimDrawing, palette: PenColor[], inset = 0.5): TrimDrawing {
  if (trimShapeOf(d.shapes)) return d;
  const box = drawingBoxOf(d.shapes) ?? { x0: inset, y0: inset, x1: d.page.w - inset, y1: d.page.h - inset };
  const made = newTrimMarks(box, palette);
  const known = d.layers.find((l) => splitLayerName(l.name, palette).label.trim().toLowerCase() === TRIM_LABEL.toLowerCase());
  if (known) return { ...d, shapes: [...d.shapes, { ...made.shape, layerId: known.id }] };
  const varnish = d.layers.findIndex((l) => isVarnishLayer(l.name));
  const layers = varnish >= 0 ? [...d.layers.slice(0, varnish), made.layer, ...d.layers.slice(varnish)] : [...d.layers, made.layer];
  return { ...d, shapes: [...d.shapes, made.shape], layers };
}

/** Trim marks taken out, and their layer with them unless something else is on it. */
export function withTrimOff(d: TrimDrawing): TrimDrawing {
  const gone = d.shapes.filter(isTrim);
  if (!gone.length) return d;
  const shapes = d.shapes.filter((s) => !isTrim(s));
  const emptied = new Set(gone.map((s) => s.layerId).filter((id) => !shapes.some((s) => s.layerId === id)));
  return { ...d, shapes, layers: d.layers.filter((l) => !emptied.has(l.id)) };
}

/** The trim at this box, in inches on the page: its size and where it sits. */
export const withTrimBox = (d: TrimDrawing, box: Box): TrimDrawing => ({
  ...d,
  shapes: d.shapes.map((s) => (isTrim(s) ? { ...s, x: box.x0, y: box.y0, x2: box.x1, y2: box.y1 } : s)),
});

/** The trim moved by this much, in inches, at its size: dragged on the canvas. */
export function withTrimMoved(d: TrimDrawing, dx: number, dy: number): TrimDrawing {
  const trim = trimShapeOf(d.shapes);
  if (!trim || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return d;
  const b = boxOf(trim);
  return withTrimBox(d, { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
}

/** The marks' own numbers: their length and offset. */
export const withTrimMarks = (d: TrimDrawing, curve: Trim): TrimDrawing => ({
  ...d,
  shapes: d.shapes.map((s) => (isTrim(s) ? { ...s, curve } : s)),
});

/** Everything drawn but the trim marks moved by this much, in inches: the drawing placed in the trim. */
export function withDrawingMoved(d: TrimDrawing, dx: number, dy: number): TrimDrawing {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return d;
  const moved = new Map(reshapeDrawing(d.shapes.filter((s) => !isTrim(s)), 1, { x: 0, y: 0 }, { x: dx, y: dy }).map((s) => [s.id, s]));
  return { ...d, shapes: d.shapes.map((s) => moved.get(s.id) ?? s) };
}

/** The trim this size, in inches, about its middle. */
export function withTrimSize(d: TrimDrawing, w: number, h: number): TrimDrawing {
  const trim = trimShapeOf(d.shapes);
  if (!trim || !(w > 0) || !(h > 0)) return d;
  return withTrimBox(d, trimAbout(boxOf(trim), w, h));
}
