// Trim marks: ticks at the trim's corners, outside it, kept with the drawing as the numbers that drew them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import { curveStrokes } from "../src/shared/lib/drawing/parametric";
import { drawingBoxOf, newTrimMarks, trimOffPaper, trimShapeOf, trimSizeIdOf, withDrawingMoved, withTrimOff, withTrimOn, withTrimSize } from "../src/shared/lib/drawing/trimMarks";
import { turnWhole } from "../src/shared/lib/drawing/whole";
import { boxOf, type Page } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) };

const page: Page = { w: 11, h: 8.5 };
const box = { x0: 2, y0: 1, x1: 9, y1: 6 };
const palette = [{ name: "Red", color: "#e5322d" }, { name: "Black", color: "#1d1d1f" }];

test("eight marks, two at each corner, in line with the trim's edges and off its corners", () => {
  const { shape, layer } = newTrimMarks(box, palette);
  assert.equal(layer.name, "Black - Trim marks");
  const runs = curveStrokes(shape);
  assert.equal(runs.length, 8);
  const gap = 3.175 / 25.4, len = 6.35 / 25.4;
  for (const run of runs) {
    assert.equal(run.length, 2);
    const [a, b] = run;
    const across = Math.abs(a.y - b.y) < 1e-9;
    // Each lies along an edge of the trim, as long as it says, and never inside the trim.
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - len) < 1e-9);
    if (across) assert.ok([box.y0, box.y1].some((y) => Math.abs(a.y - y) < 1e-9));
    else assert.ok([box.x0, box.x1].some((x) => Math.abs(a.x - x) < 1e-9));
    for (const p of run) assert.ok(p.x <= box.x0 - gap + 1e-9 || p.x >= box.x1 + gap - 1e-9 || p.y <= box.y0 - gap + 1e-9 || p.y >= box.y1 + gap - 1e-9);
  }
});

test("saved and opened again: the same trim, the same numbers", () => {
  const { shape, layer } = newTrimMarks(box, palette);
  const marks = { ...shape, curve: { kind: "trim" as const, length: 5, offset: 2 } };
  const back = parseDrawing(buildSvg([marks], [], [layer], page, { paperSizeId: "letter", toolName: "" }));
  const trim = trimShapeOf(back.shapes);
  assert.ok(trim);
  assert.deepEqual(trim.curve, { kind: "trim", length: 5, offset: 2 });
  const b = boxOf(trim);
  for (const [k, v] of Object.entries(box)) assert.ok(Math.abs(b[k as keyof typeof b] - v) < 1e-3, k);
  assert.equal(back.layers.find((l) => l.id === trim.layerId)?.name, "Black - Trim marks");
});

test("the paper turned: the trim stands the other way, unturned, its size swapped", () => {
  const { shape } = newTrimMarks(box, palette);
  const turned = turnWhole([shape], [], page, 1).shapes[0];
  assert.equal(turned.rotation, undefined);
  const b = boxOf(turned);
  assert.ok(Math.abs(b.x1 - b.x0 - 5) < 1e-9 && Math.abs(b.y1 - b.y0 - 7) < 1e-9);
});

test("marks past the paper's edge are noticed; sizes are known either way round", () => {
  const { shape } = newTrimMarks({ x0: 0.1, y0: 1, x1: 5, y1: 6 }, palette);
  assert.equal(trimOffPaper(shape, page), true);
  assert.equal(trimOffPaper(newTrimMarks(box, palette).shape, page), false);
  assert.equal(trimSizeIdOf(7, 5), "5x7");
  assert.equal(trimSizeIdOf(7.1, 5), "custom");
});

test("the edits every app makes: on round the drawing, sized, the drawing moved in it, off", () => {
  const ink = { id: "ink", name: "Red", color: "#e5322d" };
  const varnish = { id: "v", name: "Varnish", color: "#e6e8ec" };
  const drawn = { id: "r", kind: "rect" as const, x: 3, y: 2, x2: 7, y2: 5, layerId: "ink" };
  let d = withTrimOn({ shapes: [drawn], layers: [ink, varnish], page }, palette);
  const trim = trimShapeOf(d.shapes)!;
  assert.deepEqual(boxOf(trim), { x0: 3, y0: 2, x1: 7, y1: 5 });
  // Its own layer, under the varnish.
  assert.deepEqual(d.layers.map((l) => l.name), ["Red", "Black - Trim marks", "Varnish"]);
  assert.equal(withTrimOn(d, palette), d, "on twice is still one set of marks");
  d = withTrimSize(d, 5, 7);
  assert.deepEqual(boxOf(trimShapeOf(d.shapes)!), { x0: 2.5, y0: 0, x1: 7.5, y1: 7 });
  d = withDrawingMoved(d, 0.5, -1);
  assert.deepEqual(drawingBoxOf(d.shapes), { x0: 3.5, y0: 1, x1: 7.5, y1: 4 });
  assert.deepEqual(boxOf(trimShapeOf(d.shapes)!), { x0: 2.5, y0: 0, x1: 7.5, y1: 7 }, "the trim stays put");
  d = withTrimOff(d);
  assert.equal(trimShapeOf(d.shapes), undefined);
  assert.deepEqual(d.layers.map((l) => l.name), ["Red", "Varnish"]);
});
