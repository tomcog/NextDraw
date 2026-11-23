// Marks a drawing carries. Since 2026-11-23 Plot generates trim marks when it plots (the server's
// tests/trim_marks_are_made_at_plot_time.py covers that); what is left here is a drawing made before
// then, whose marks are an ordinary parametric shape that can still be moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CURVE, type Trim } from "../src/shared/lib/drawing/parametric";
import { TRIM_LABEL, trimShapeOf, withTrimMoved } from "../src/shared/lib/drawing/trimMarks";
import { boxOf, type Layer, type Page, type Shape } from "../src/shared/lib/drawing/shapes";

const page: Page = { w: 10, h: 8 };
const layers: Layer[] = [{ id: "l", name: `Black - ${TRIM_LABEL}`, color: "#231f20" }];
const marks: Shape = { id: "t", kind: "curve", curve: { ...(DEFAULT_CURVE.trim as Trim) }, layerId: "l", x: 1, y: 1, x2: 6, y2: 7 };
const drawn: Shape = { id: "r", kind: "rect", x: 2, y: 2, x2: 5, y2: 6, layerId: "l" };

test("trim marks: a drawing that carries them is read back as having them", () => {
  assert.equal(trimShapeOf([drawn, marks])?.id, "t");
  assert.equal(trimShapeOf([drawn]), undefined);
});

test("trim marks: dragging them moves them at their size, and nothing else", () => {
  const moved = withTrimMoved({ shapes: [drawn, marks], layers, page }, 0.5, -1);
  assert.deepEqual(boxOf(trimShapeOf(moved.shapes)!), { x0: 1.5, y0: 0, x1: 6.5, y1: 6 });
  assert.deepEqual(boxOf(moved.shapes[0]), boxOf(drawn), "the drawing stays where it is");
  assert.equal(withTrimMoved({ shapes: [drawn], layers, page }, 1, 1).shapes[0], drawn, "nothing to move, nothing changed");
});
