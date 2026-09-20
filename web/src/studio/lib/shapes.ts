// Studio's drawing model. Everything is in inches from the page's top-left corner, the same way
// Plot measures a drawing's footprint, so what's on the page here is what lands on the paper there.

import { CURVE_LABEL, type Curve } from "./parametric";

export type ShapeKind = "rect" | "ellipse" | "line" | "curve";

export interface Shape {
  id: string;
  kind: ShapeKind;
  // For rect and ellipse: the box the shape is drawn in. For a line: its two ends, so x2/y2 may be
  // left of or above x/y - a line has a direction, a box doesn't.
  x: number;
  y: number;
  x2: number;
  y2: number;
  /** Degrees clockwise about the middle of the box. The box itself is never turned: keeping it
   *  square is what lets a shape still be resized, hatched and measured after it's been turned. */
  rotation?: number;
  /**
   * Whether the shape's own outline is plotted. Off, it still lives in the file - any fill on it is
   * regenerated from it - but on a `%`-prefixed layer, which NextDraw skips and which Plot leaves
   * out of the drawing's bounds. Absent means drawn.
   */
  outline?: boolean;
  /**
   * For a curve: the generator and its numbers. The box above is still the shape's footprint, so a
   * curve moves, resizes and fills like anything else; the lines are drawn from these every time.
   */
  curve?: Curve;
  /**
   * The layer it sits on, which is what decides the colour it's drawn in. A layer is one pen:
   * everything on it plots in that one colour, because plotting a layer is what a pen change is for.
   * Colour is never a property of a shape.
   */
  layerId: string;
}

/**
 * One pen's worth of drawing. The name is also the pen's name, which is the contract with Plot: it
 * colours a layer from the pen whose name it matches, so a drawing arrives already coloured.
 */
export interface Layer {
  id: string;
  name: string;
  color: string;
  hidden?: boolean;
}

let layerCounter = 0;
export const newLayerId = () => `layer-${++layerCounter}-${Date.now().toString(36)}`;

export interface Page {
  w: number; // inches
  h: number;
}

let counter = 0;
export const newShapeId = () => `shape-${++counter}-${Date.now().toString(36)}`;

/** The box a shape occupies, normalised so x0/y0 is the top-left whichever way it was drawn. */
export const boxOf = (s: Shape) => ({
  x0: Math.min(s.x, s.x2),
  y0: Math.min(s.y, s.y2),
  x1: Math.max(s.x, s.x2),
  y1: Math.max(s.y, s.y2),
});

export const shapeName = (s: Shape, index: number) =>
  `${s.curve ? CURVE_LABEL[s.curve.kind] : { rect: "Rectangle", ellipse: "Ellipse", line: "Line", curve: "Curve" }[s.kind]} ${index + 1}`;

/** A shape too small to have been meant - a click rather than a drag. */
export const isDegenerate = (s: Shape) => {
  const b = boxOf(s);
  const across = b.x1 - b.x0;
  const down = b.y1 - b.y0;
  return s.kind === "line" ? Math.hypot(across, down) < 0.02 : across < 0.02 || down < 0.02;
};

/** Keep a shape on the page, so nothing is drawn where the pen can't reach. */
export const clampToPage = (s: Shape, page: Page): Shape => {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return {
    ...s,
    x: clamp(s.x, page.w),
    y: clamp(s.y, page.h),
    x2: clamp(s.x2, page.w),
    y2: clamp(s.y2, page.h),
  };
};

/** The same shape with x/y as its top-left corner, so a handle always means the same corner. */
export const normalized = (s: Shape): Shape => {
  if (s.kind === "line") return s; // a line's ends are its own; normalising would flip it
  const b = boxOf(s);
  return { ...s, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1 };
};

/**
 * Shift a shape, keeping its size and keeping it on the page. The move is limited as a whole rather
 * than corner by corner: clamping each point on its own would squash the shape against the edge.
 */
export const moveBy = (s: Shape, dx: number, dy: number, page: Page): Shape => {
  const b = boxOf(s);
  const byX = Math.max(-b.x0, Math.min(page.w - b.x1, dx));
  const byY = Math.max(-b.y0, Math.min(page.h - b.y1, dy));
  return { ...s, x: s.x + byX, y: s.y + byY, x2: s.x2 + byX, y2: s.y2 + byY };
};

/** The middle of a shape's box, which is what it turns about. */
export const centerOf = (s: Shape) => {
  const b = boxOf(s);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
};

/** A point turned about another by `deg` degrees clockwise. */
export const turnPoint = (p: { x: number; y: number }, about: { x: number; y: number }, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return {
    x: about.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: about.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
};

/** How a turned shape is drawn: the same geometry, turned about its middle. Nothing when it isn't
 *  turned, so an untouched drawing carries no transforms at all. */
export const turnAttr = (s: Shape): string | undefined => {
  if (!s.rotation) return undefined;
  const c = centerOf(s);
  return `rotate(${Number(s.rotation.toFixed(3))} ${Number(c.x.toFixed(4))} ${Number(c.y.toFixed(4))})`;
};

/** The corners a selected shape can be dragged by: a box has four, a line has its two ends. */
export type Handle = "nw" | "ne" | "sw" | "se" | "a" | "b";

export const handlesOf = (s: Shape): { id: Handle; x: number; y: number }[] => {
  if (s.kind === "line") {
    return [
      { id: "a", x: s.x, y: s.y },
      { id: "b", x: s.x2, y: s.y2 },
    ];
  }
  const b = boxOf(s);
  return [
    { id: "nw", x: b.x0, y: b.y0 },
    { id: "ne", x: b.x1, y: b.y0 },
    { id: "sw", x: b.x0, y: b.y1 },
    { id: "se", x: b.x1, y: b.y1 },
  ];
};

/** Put one corner (or one end of a line) where the pointer is. */
export const dragHandle = (s: Shape, handle: Handle, x: number, y: number): Shape => {
  const n = normalized(s);
  switch (handle) {
    case "a": return { ...n, x, y };
    case "b": return { ...n, x2: x, y2: y };
    case "nw": return { ...n, x, y };
    case "ne": return { ...n, x2: x, y };
    case "sw": return { ...n, x, y2: y };
    case "se": return { ...n, x2: x, y2: y };
  }
};

/** Where a handle sits on screen, which for a turned shape is not where it sits in the box. */
export const handlePoints = (s: Shape) => {
  const c = centerOf(s);
  return handlesOf(s).map((h) => ({ ...h, ...(s.rotation ? turnPoint(h, c, s.rotation) : { x: h.x, y: h.y }) }));
};

/** Where the turn grip sits: above the middle of the box's top edge, `out` inches clear of it, and
 *  turned with the shape so it always stands off the same edge. */
export const turnGrip = (s: Shape, out: number) => {
  const b = boxOf(s);
  const c = centerOf(s);
  const p = { x: (b.x0 + b.x1) / 2, y: b.y0 - out };
  return s.rotation ? turnPoint(p, c, s.rotation) : p;
};

/** The angle from a shape's middle to a point, in degrees clockwise from straight up - the same way
 *  the rotation field reads, so dragging the grip to the right of the shape says 90. */
export const angleFromCenter = (s: Shape, x: number, y: number) => {
  const c = centerOf(s);
  return (Math.atan2(x - c.x, c.y - y) * 180) / Math.PI;
};

const OPPOSITE: Record<Handle, Handle> = { nw: "se", se: "nw", ne: "sw", sw: "ne", a: "b", b: "a" };

/**
 * Drag a handle of a turned shape. The pointer is turned back into the box's own frame, the corner
 * is moved there, and the shape is then shifted so the corner opposite the one being dragged stays
 * where it is on screen - otherwise resizing a turned shape slides it sideways.
 */
export const dragHandleTurned = (s: Shape, handle: Handle, x: number, y: number): Shape => {
  const deg = s.rotation ?? 0;
  if (!deg) return dragHandle(s, handle, x, y);
  const before = handlePoints(s).find((h) => h.id === OPPOSITE[handle]);
  const local = turnPoint({ x, y }, centerOf(s), -deg);
  const next = dragHandle(s, handle, local.x, local.y);
  const after = handlePoints(next).find((h) => h.id === OPPOSITE[handle]);
  if (!before || !after) return next;
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  return { ...next, x: next.x + dx, y: next.y + dy, x2: next.x2 + dx, y2: next.y2 + dy };
};

export const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", a: "move", b: "move",
};
