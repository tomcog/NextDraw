// Studio's drawing model. Everything is in inches from the page's top-left corner, the same way
// Plot measures a drawing's footprint, so what's on the page here is what lands on the paper there.

import { CURVE_LABEL, type Curve, type Point } from "./parametric";
import type { Repeat } from "./repeat";

export type ShapeKind = "rect" | "ellipse" | "line" | "curve" | "path" | "text";

export interface Shape {
  id: string;
  kind: ShapeKind;
  // For rect and ellipse: the box the shape is drawn in. For a line: its two ends, so x2/y2 may be
  // left of or above x/y - a line has a direction, a box doesn't.
  x: number;
  y: number;
  x2: number;
  y2: number;
  /** Text set in a single-stroke font: what it says, and which font draws it. The box's height is
   *  the size it is set at, and its width follows from the words. */
  text?: string;
  font?: string;
  /** Extra room between letters, as a percent of the size: a wet pen needs more of it. */
  tracking?: number;
  /** Space from one line to the next, as a multiple of the font's own: 1 is what the font says. */
  leading?: number;
  /**
   * A path: the points it is drawn through, in inches on the page. A curve becomes one when it is
   * baked - the numbers behind it are given up, and every point can be dragged instead.
   */
  points?: Point[];
  /** Drawn more than once: in rows and columns, or round a ring. The shape itself is the one you
   *  edit, and every copy follows it. */
  repeat?: Repeat;
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
/** The box a path's own points occupy, which is what its handles and its fill are measured against. */
export const pointsBox = (points: Point[]) => ({
  x0: Math.min(...points.map((p) => p.x)),
  y0: Math.min(...points.map((p) => p.y)),
  x1: Math.max(...points.map((p) => p.x)),
  y1: Math.max(...points.map((p) => p.y)),
});

export const boxOf = (s: Shape) => ({
  x0: Math.min(s.x, s.x2),
  y0: Math.min(s.y, s.y2),
  x1: Math.max(s.x, s.x2),
  y1: Math.max(s.y, s.y2),
});

export const shapeName = (s: Shape, index: number) =>
  `${s.kind === "text" ? (s.text?.trim().split("\n")[0].slice(0, 20) || "Text")
    : s.curve ? CURVE_LABEL[s.curve.kind]
    : { rect: "Rectangle", ellipse: "Ellipse", line: "Line", curve: "Curve", path: "Path", text: "Text" }[s.kind]} ${s.kind === "text" ? "" : index + 1}`.trim();

/**
 * The outline of a shape that has no points of its own, in the drawing's inches: the corners of a
 * rectangle, the rim of an ellipse, the two ends of a line. What baking turns into a path.
 */
export const outlinePoints = (s: Shape): Point[] => {
  const b = boxOf(s);
  if (s.kind === "line") return [{ x: s.x, y: s.y }, { x: s.x2, y: s.y2 }];
  if (s.kind === "rect") {
    return [
      { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }, { x: b.x0, y: b.y0 },
    ];
  }
  if (s.kind === "ellipse") {
    // A point every few degrees: fine enough that the pen draws a circle, not a polygon.
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const rx = (b.x1 - b.x0) / 2;
    const ry = (b.y1 - b.y0) / 2;
    const steps = 72;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * 2 * Math.PI - Math.PI / 2;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
  }
  return s.points ?? [];
};

/** The same shape in a new box, with a path's points carried across so they keep their places in it. */
export const withBox = (s: Shape, box: { x0: number; y0: number; x1: number; y1: number }): Shape => {
  const next = { ...s, x: box.x0, y: box.y0, x2: box.x1, y2: box.y1 };
  if (!s.points?.length) return next;
  const from = boxOf(s);
  const kx = from.x1 - from.x0 > 1e-9 ? (box.x1 - box.x0) / (from.x1 - from.x0) : 1;
  const ky = from.y1 - from.y0 > 1e-9 ? (box.y1 - box.y0) / (from.y1 - from.y0) : 1;
  next.points = s.points.map((p) => ({ x: box.x0 + (p.x - from.x0) * kx, y: box.y0 + (p.y - from.y0) * ky }));
  return next;
};

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
  return {
    ...s,
    x: s.x + byX, y: s.y + byY, x2: s.x2 + byX, y2: s.y2 + byY,
    ...(s.points ? { points: s.points.map((p) => ({ x: p.x + byX, y: p.y + byY })) } : {}),
  };
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

/**
 * The same shape at a given width and height, in inches, held by its top-left corner - or, for a
 * line, by the end it was drawn from, since a line's direction is its own.
 */
export const resizeTo = (s: Shape, w: number, h: number): Shape => {
  if (s.kind === "line") {
    return { ...s, x2: s.x + Math.sign(s.x2 - s.x || 1) * w, y2: s.y + Math.sign(s.y2 - s.y || 1) * h };
  }
  const b = boxOf(s);
  return { ...s, x: b.x0, y: b.y0, x2: b.x0 + w, y2: b.y0 + h };
};

/** The corners a selected shape can be dragged by: a box has four, a line has its two ends. */
export type Handle = "nw" | "ne" | "sw" | "se" | "a" | "b" | `p${number}`;

/** A path with more points than this is dragged by its corners: a thousand grips is not an edit. */
export const POINT_HANDLE_LIMIT = 120;

export const handlesOf = (s: Shape): { id: Handle; x: number; y: number; point?: true }[] => {
  // A path has both: the corners of its box, which scale the whole of it, and - while there are few
  // enough of them to pick one out - a grip on every point, which moves that point alone.
  if (s.points?.length && s.points.length <= POINT_HANDLE_LIMIT) {
    const b = boxOf(s);
    return [
      { id: "nw" as Handle, x: b.x0, y: b.y0 },
      { id: "ne" as Handle, x: b.x1, y: b.y0 },
      { id: "sw" as Handle, x: b.x0, y: b.y1 },
      { id: "se" as Handle, x: b.x1, y: b.y1 },
      ...s.points.map((p, i) => ({ id: `p${i}` as Handle, x: p.x, y: p.y, point: true as const })),
    ];
  }
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
  // One point of a path: the point moves, and the box follows it rather than the other way round.
  if (handle.startsWith("p") && s.points) {
    const i = Number(handle.slice(1));
    const points = s.points.map((p, k) => (k === i ? { x, y } : p));
    const b = pointsBox(points);
    return { ...s, points, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1 };
  }
  const n = normalized(s);
  switch (handle) {
    case "a": return { ...n, x, y };
    case "b": return { ...n, x2: x, y2: y };
    case "nw": return withBox(n, { ...boxOf(n), x0: x, y0: y });
    case "ne": return withBox(n, { ...boxOf(n), x1: x, y0: y });
    case "sw": return withBox(n, { ...boxOf(n), x0: x, y1: y });
    case "se": return withBox(n, { ...boxOf(n), x1: x, y1: y });
    default: return n;
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

const OPPOSITE: Record<string, Handle> = { nw: "se", se: "nw", ne: "sw", sw: "ne", a: "b", b: "a" };

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

const CURSORS: Record<string, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", a: "move", b: "move",
};

export const CURSOR = new Proxy({} as Record<Handle, string>, {
  get: (_t, key: string) => CURSORS[key] ?? "move", // a path's points are all "move"
});
