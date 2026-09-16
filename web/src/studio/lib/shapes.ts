// Studio's drawing model. Everything is in inches from the page's top-left corner, the same way
// Plot measures a drawing's footprint, so what's on the page here is what lands on the paper there.

export type ShapeKind = "rect" | "ellipse" | "line";

export interface Shape {
  id: string;
  kind: ShapeKind;
  // For rect and ellipse: the box the shape is drawn in. For a line: its two ends, so x2/y2 may be
  // left of or above x/y - a line has a direction, a box doesn't.
  x: number;
  y: number;
  x2: number;
  y2: number;
}

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
  `${{ rect: "Rectangle", ellipse: "Ellipse", line: "Line" }[s.kind]} ${index + 1}`;

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

export const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", a: "move", b: "move",
};
