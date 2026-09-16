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
