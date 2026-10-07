// What is done to the drawing as a whole: turning it with its page, scaling it, fitting it to the
// paper. Plain geometry over the shapes and their fills, so it can be worked out - and tested -
// apart from the app that keeps them.

import { newFillId, type Fill } from "../../shared/lib/drawing/hatch";
import { type Point } from "../../shared/lib/drawing/parametric";
import { mapNode, type Node } from "../../shared/lib/drawing/path";
import { placements } from "../../shared/lib/drawing/repeat";
import { boxOf, centerOf, drawnRuns, newShapeId, outlinePoints, shiftShape, turnPoint, type Page, type Shape } from "../../shared/lib/drawing/shapes";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The box round what the drawing actually puts on paper: every copy, every turn, a path's curves as
 * drawn. A shape's own box leaves out its copies and doesn't follow its turn, so fitting by it would
 * miss. A word, a curve and a photo are taken as their boxes, which is what they fill.
 */
export function drawnBox(shapes: Shape[]): Box {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of shapes) {
    const b = boxOf(s);
    const own = s.kind === "path" && !s.curve && !s.photo ? drawnRuns(s).flat()
      : s.kind === "rect" || s.kind === "ellipse" || s.kind === "line" ? outlinePoints(s)
      : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
    const c = centerOf(s);
    for (const place of placements(s)) {
      const deg = (s.rotation ?? 0) + place.deg;
      for (const p of own) {
        const q = deg ? turnPoint(p, c, deg) : p;
        const x = q.x + place.dx, y = q.y + place.dy;
        if (x < box.x0) box.x0 = x;
        if (y < box.y0) box.y0 = y;
        if (x > box.x1) box.x1 = x;
        if (y > box.y1) box.y1 = y;
      }
    }
  }
  return box;
}

/** Whether what the drawing puts on paper runs past the page's edges. */
export function runsOffPage(shapes: Shape[], page: Page): boolean {
  const d = drawnBox(shapes);
  return d.x0 < -1e-6 || d.y0 < -1e-6 || d.x1 > page.w + 1e-6 || d.y1 > page.h + 1e-6;
}

/**
 * Turn the whole drawing a quarter turn anticlockwise, page and all, so a drawing laid out one way round
 * suits paper the other way round. Paths and lines have their points turned, so an imported drawing
 * comes out as plain geometry rather than thousands of turned shapes; everything else - a rectangle,
 * a curve, a word, a photo - keeps what it is, turning about its own middle and moving to where that
 * middle lands. Copies are placed relative to the page, so a row's direction and a grid's rows and
 * columns turn with it. A ring always hangs below its shape, which no setting can turn, so a ringed
 * shape is first handed out as its copies.
 */
export function turnDrawingLeft(shapes: Shape[], fills: Fill[], page: Page): { shapes: Shape[]; fills: Fill[]; page: Page } {
  const W = page.w;
  const to = (p: Point): Point => ({ x: p.y, y: W - p.x });
  const nextFills = [...fills];
  const handedOut = shapes.flatMap((s) => {
    if (s.repeat?.kind !== "ring") return [s];
    const copies = placements(s).map((place, i) => ({
      ...shiftShape(s, place.dx, place.dy),
      id: i ? newShapeId() : s.id,
      repeat: undefined,
      rotation: ((s.rotation ?? 0) + place.deg) % 360 || undefined,
    }));
    for (const copy of copies.slice(1)) {
      for (const f of fills.filter((f) => f.shapeId === s.id)) nextFills.push({ ...f, id: newFillId(), shapeId: copy.id });
    }
    return copies;
  });
  const pointsTurned = new Set<string>();
  const turned = handedOut.map((s) => {
    let next: Shape;
    if (s.kind === "line" || (s.kind === "path" && !s.curve && !s.photo)) {
      // The points themselves: a line's ends, a path's nodes and their handles.
      pointsTurned.add(s.id);
      const b = boxOf(s);
      const by = (run: Node[]) => run.map((n) => mapNode(n, to));
      next = s.kind === "line"
        ? { ...s, ...(([a, z]) => ({ x: a.x, y: a.y, x2: z.x, y2: z.y }))([to({ x: s.x, y: s.y }), to({ x: s.x2, y: s.y2 })]) }
        : {
          ...s,
          x: b.y0, y: W - b.x1, x2: b.y1, y2: W - b.x0,
          ...(s.runs ? { runs: s.runs.map(by) } : s.points ? { points: by(s.points) } : {}),
        };
    } else {
      const c = centerOf(s);
      const at = to(c);
      next = { ...shiftShape(s, at.x - c.x, at.y - c.y), rotation: ((s.rotation ?? 0) + 270) % 360 || undefined };
    }
    const r = s.repeat;
    if (r?.kind === "line") {
      next.repeat = { ...r, angle: r.angle - 90 < -360 ? r.angle + 270 : r.angle - 90 };
    } else if (r?.kind === "grid") {
      // Columns become rows. The grid's last column is now its top row, so the shape moves to that
      // corner and the steps stay positive, as the fields need them.
      const across = Math.max(1, Math.round(r.across));
      next = shiftShape(next, 0, -(across - 1) * r.stepX);
      next.repeat = { kind: "grid", across: r.down, down: r.across, stepX: r.stepY, stepY: r.stepX };
    }
    return next;
  });
  return {
    shapes: turned,
    // A fill's angle is the artwork's, so it turns by itself with a shape given a turn - but a shape
    // whose points were turned has no turn of its own, and its fill has to be told.
    fills: nextFills.map((f) => (pointsTurned.has(f.shapeId) ? { ...f, angle: (f.angle + 270) % 360 } : f)),
    page: { w: page.h, h: page.w },
  };
}

/**
 * The whole drawing scaled by `k` about one point and then moved by `by`. Every point and box corner
 * is carried, so a turned shape stays turned and a word grows with its box; copies spread with it.
 * What belongs to the pen rather than the drawing - a fill's spacing, a photo's line spacing - stays
 * as it is.
 */
export function reshapeDrawing(shapes: Shape[], k: number, about: Point, by: Point = { x: 0, y: 0 }): Shape[] {
  const to = (p: Point): Point => ({ x: about.x + (p.x - about.x) * k + by.x, y: about.y + (p.y - about.y) * k + by.y });
  const runsTo = (run: Node[]) => run.map((n) => mapNode(n, to));
  return shapes.map((s) => {
    const [a, z] = [to({ x: s.x, y: s.y }), to({ x: s.x2, y: s.y2 })];
    const r = s.repeat;
    return {
      ...s,
      x: a.x, y: a.y, x2: z.x, y2: z.y,
      ...(s.runs ? { runs: s.runs.map(runsTo) } : s.points ? { points: runsTo(s.points) } : {}),
      ...(r && {
        repeat: r.kind === "line" ? { ...r, step: r.step * k }
          : r.kind === "grid" ? { ...r, stepX: r.stepX * k, stepY: r.stepY * k }
          : { ...r, radius: r.radius * k },
      }),
    };
  });
}

/** The middle of what the drawing puts on paper: what it is scaled about. */
export function drawnMiddle(shapes: Shape[]): Point {
  const d = drawnBox(shapes);
  return { x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 };
}

/**
 * How to fit the drawing to the page inside a margin all round (inches), centred: the scale, and the
 * point it is scaled about and the move after it, for reshapeDrawing. Nothing when it can't be done -
 * no drawing, a margin that leaves no page, or a drawing that is a single point.
 */
export function fitToPage(shapes: Shape[], page: Page, margin: number): { k: number; about: Point; by: Point } | null {
  if (!shapes.length) return null;
  const d = drawnBox(shapes);
  const dw = d.x1 - d.x0, dh = d.y1 - d.y0;
  const room = { w: page.w - 2 * margin, h: page.h - 2 * margin };
  if (room.w <= 0 || room.h <= 0) return null;
  // A drawing that is only a line across or down has no height (or width) to fit by.
  const k = Math.min(dw > 1e-9 ? room.w / dw : Infinity, dh > 1e-9 ? room.h / dh : Infinity);
  if (!Number.isFinite(k)) return null;
  const about = { x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 };
  return { k, about, by: { x: page.w / 2 - about.x, y: page.h / 2 - about.y } };
}
