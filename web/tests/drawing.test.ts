// The whole-drawing operations in studio/lib/drawing.ts: turning with the page, scaling, fitting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnBox, fitToPage, reshapeDrawing, runsOffPage, turnDrawingLeft } from "../src/studio/lib/drawing";
import type { Fill } from "../src/shared/lib/drawing/hatch";
import type { Page, Shape } from "../src/shared/lib/drawing/shapes";

const page: Page = { w: 11, h: 8.5 };
const shape = (over: Partial<Shape>): Shape => ({ id: "s", kind: "rect", x: 0, y: 0, x2: 1, y2: 1, layerId: "l", ...over });
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} ≠ ${b}`);
const sameBox = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => {
  close(a.x0, b.x0, "x0");
  close(a.y0, b.y0, "y0");
  close(a.x1, b.x1, "x1");
  close(a.y1, b.y1, "y1");
};

test("turning left swaps the page and carries the top-left corner to the bottom-left", () => {
  const line = shape({ kind: "line", x: 0, y: 0, x2: 2, y2: 0 });
  const turned = turnDrawingLeft([line], [], page);
  assert.deepEqual(turned.page, { w: 8.5, h: 11 });
  const [l] = turned.shapes;
  // (0, 0) lands at the new page's bottom-left; a line running right now runs up.
  close(l.x, 0); close(l.y, 11);
  close(l.x2, 0); close(l.y2, 9);
});

test("a rectangle keeps its box and turns a quarter left about its middle", () => {
  const [r] = turnDrawingLeft([shape({ x: 1, y: 2, x2: 3, y2: 3 })], [], page).shapes;
  assert.equal(r.rotation, 270);
  close((r.x + r.x2) / 2, 2.5); // the middle (2, 2.5) goes to (2.5, 11 - 2)
  close((r.y + r.y2) / 2, 9);
  close(r.x2 - r.x, 2);
});

test("four turns left bring every kind of shape back where it was", () => {
  const shapes = [
    shape({ id: "rect", x: 1, y: 1, x2: 2, y2: 3 }),
    shape({ id: "line", kind: "line", x: 4, y: 1, x2: 6, y2: 2 }),
    shape({ id: "path", kind: "path", x: 1, y: 5, x2: 3, y2: 7, points: [{ x: 1, y: 5 }, { x: 3, y: 6 }, { x: 2, y: 7 }] }),
    shape({ id: "row", x: 7, y: 1, x2: 8, y2: 2, repeat: { kind: "line", count: 3, step: 1.5, angle: 30 } }),
    shape({ id: "grid", x: 7, y: 4, x2: 7.5, y2: 4.5, repeat: { kind: "grid", across: 3, down: 2, stepX: 1, stepY: 0.75 } }),
  ];
  let now = { shapes, fills: [] as Fill[], page };
  for (let i = 0; i < 4; i++) now = turnDrawingLeft(now.shapes, now.fills, now.page);
  assert.deepEqual(now.page, page);
  for (const before of shapes) {
    const after = now.shapes.find((s) => s.id === before.id)!;
    sameBox(drawnBox([after]), drawnBox([before]));
    assert.equal(after.rotation ?? 0, before.rotation ?? 0, before.id);
  }
});

test("a turn keeps what a row and a grid draw, turned with the page", () => {
  const row = shape({ x: 1, y: 1, x2: 2, y2: 2, repeat: { kind: "line", count: 3, step: 2, angle: 0 } });
  const grid = shape({ id: "g", x: 1, y: 4, x2: 2, y2: 5, repeat: { kind: "grid", across: 3, down: 2, stepX: 2, stepY: 1.5 } });
  for (const s of [row, grid]) {
    const b = drawnBox([s]);
    const [t] = turnDrawingLeft([s], [], page).shapes;
    // The drawn box turned left on an 11-wide page: x' = y, y' = 11 - x.
    sameBox(drawnBox([t]), { x0: b.y0, y0: 11 - b.x1, x1: b.y1, y1: 11 - b.x0 });
  }
});

test("a path's fill turns with its points; a rectangle's fill rides on its turn", () => {
  const path = shape({ id: "p", kind: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  const rect = shape({ id: "r" });
  const fills = [
    { id: "f1", shapeId: "p", angle: 45, spacingMm: 1 },
    { id: "f2", shapeId: "r", angle: 45, spacingMm: 1 },
  ] as Fill[];
  const turned = turnDrawingLeft([path, rect], fills, page).fills;
  assert.equal(turned.find((f) => f.id === "f1")!.angle, 315);
  assert.equal(turned.find((f) => f.id === "f2")!.angle, 45);
});

test("a ring is handed out as its copies, each with the fill", () => {
  const ring = shape({ x: 4, y: 1, x2: 5, y2: 2, repeat: { kind: "ring", count: 4, radius: 1, facing: false } });
  const turned = turnDrawingLeft([ring], [{ id: "f", shapeId: "s", angle: 0, spacingMm: 1 } as Fill], page);
  assert.equal(turned.shapes.length, 4);
  assert.ok(turned.shapes.every((s) => !s.repeat));
  assert.equal(turned.fills.length, 4);
  assert.equal(new Set(turned.fills.map((f) => f.shapeId)).size, 4);
});

test("the drawn box takes in copies and turns", () => {
  sameBox(drawnBox([shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } })]), { x0: 0, y0: 0, x1: 5, y1: 1 });
  // A unit square turned 45° about its middle reaches half a diagonal out from it.
  const h = Math.SQRT2 / 2;
  sameBox(drawnBox([shape({ rotation: 45 })]), { x0: 0.5 - h, y0: 0.5 - h, x1: 0.5 + h, y1: 0.5 + h });
});

test("scaling carries boxes, points and copy spacing, and leaves turns alone", () => {
  const s = shape({ kind: "path", x: 1, y: 1, x2: 2, y2: 3, rotation: 30, points: [{ x: 1, y: 1 }, { x: 2, y: 3 }], repeat: { kind: "grid", across: 2, down: 2, stepX: 1, stepY: 2 } });
  const [t] = reshapeDrawing([s], 2, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.deepEqual([t.x, t.y, t.x2, t.y2], [3, 2, 5, 6]);
  assert.deepEqual(t.points!.map((p) => [p.x, p.y]), [[3, 2], [5, 6]]);
  assert.deepEqual(t.repeat, { kind: "grid", across: 2, down: 2, stepX: 2, stepY: 4 });
  assert.equal(t.rotation, 30);
});

test("fitting fills the page inside the margin on the tighter side, centred both ways", () => {
  const shapes = [
    shape({ x: 1, y: 1, x2: 2, y2: 2 }),
    shape({ id: "t", kind: "line", x: 3, y: 1.5, x2: 5, y2: 1.5, repeat: { kind: "line", count: 2, step: 0.5, angle: 90 } }),
  ];
  const fit = fitToPage(shapes, page, 0.5)!;
  const after = reshapeDrawing(shapes, fit.k, fit.about, fit.by);
  const d = drawnBox(after);
  // Drawn 4 wide by 1 high: width is the tight side, so it spans the 10 inches between the margins.
  close(d.x0, 0.5); close(d.x1, 10.5);
  close((d.y0 + d.y1) / 2, 4.25);
  assert.equal(runsOffPage(after, page), false);
});

test("nothing to fit: no drawing, no room, or a single point", () => {
  assert.equal(fitToPage([], page, 0.5), null);
  assert.equal(fitToPage([shape({})], page, 5), null);
  assert.equal(fitToPage([shape({ kind: "line", x: 1, y: 1, x2: 1, y2: 1 })], page, 0.5), null);
});
