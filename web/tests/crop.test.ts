// Fill for a drawing of lines: scaled to cover the paper inside the margins, and cut off at them -
// exactly, curves split on the curve, so what is kept is drawn as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { marginsAll } from "../src/shared/lib/geometry";
import { cropDrawing, cropRun } from "../src/shared/lib/drawing/crop";
import { flattenRun, type Node } from "../src/shared/lib/drawing/path";
import { drawnBox, placeOnPaper, reshapeDrawing } from "../src/shared/lib/drawing/whole";
import type { Shape } from "../src/shared/lib/drawing/shapes";

const box = { x0: 0, y0: 0, x1: 2, y1: 2 };
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6, `${what} ${a} ≠ ${b}`);
const shape = (over: Partial<Shape>): Shape => ({ id: "s", kind: "rect", x: 0, y: 0, x2: 1, y2: 1, layerId: "l", ...over });

test("a straight line is cut where it crosses the edges", () => {
  const runs = cropRun([{ x: -1, y: 1 }, { x: 3, y: 1 }], box);
  assert.equal(runs.length, 1);
  close(runs[0][0].x, 0); close(runs[0][1].x, 2);
});

test("a curve is split on the curve: what's kept lies on the original, its ends on the edge", () => {
  const curve: Node[] = [{ x: -1, y: 1, out: { x: 0, y: -1 } }, { x: 3, y: 1, in: { x: 2, y: 3 } }];
  const runs = cropRun(curve, box);
  assert.equal(runs.length, 1);
  const kept = runs[0];
  close(kept[0].x, 0, "starts on the left edge");
  close(kept[kept.length - 1].x, 2, "ends on the right edge");
  // Every point of the kept piece is on the original curve, worked out exactly and finely.
  const on = (t: number) => {
    const u = 1 - t;
    return { x: -u * u * u + 6 * u * t * t + 3 * t * t * t, y: u * u * u - 3 * u * u * t + 9 * u * t * t + t * t * t };
  };
  const original = Array.from({ length: 20001 }, (_, i) => on(i / 20000));
  for (const p of flattenRun(kept, 0.01)) {
    const d = Math.min(...original.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    assert.ok(d < 0.001, `off the curve by ${d}`);
  }
});

test("a closed outline cut once is one run, joined round its start", () => {
  const square: Node[] = [{ x: 0.5, y: 0.5 }, { x: 3, y: 0.5 }, { x: 3, y: 1.5 }, { x: 0.5, y: 1.5 }, { x: 0.5, y: 0.5 }];
  const runs = cropRun(square, box);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((n) => [n.x, n.y]), [[2, 1.5], [0.5, 1.5], [0.5, 0.5], [2, 0.5]]);
});

test("inside stays as it is, outside goes, across becomes the path of what's inside", () => {
  const inside = shape({ id: "in", x: 0.5, y: 0.5, x2: 1, y2: 1 });
  const outside = shape({ id: "out", x: 5, y: 5, x2: 6, y2: 6 });
  const across = shape({ id: "across", kind: "line", x: 1, y: 1, x2: 4, y2: 1 });
  const cut = cropDrawing([inside, outside, across], [], box, {});
  assert.deepEqual(cut.shapes.map((s) => s.id), ["in", "across"]);
  assert.equal(cut.shapes[0], inside);
  assert.equal(cut.shapes[1].kind, "path");
  const d = drawnBox([cut.shapes[1]]);
  close(d.x0, 1); close(d.x1, 2);
});

test("fill covers the room inside the margins, centred, the overflow cut off", () => {
  const page = { x: 0, y: 0, w: 11, h: 8.5 };
  // A 2 × 1 rectangle: to cover 9 × 6.5 it is scaled 6.5 times, 13 wide, centred across.
  const shapes = [shape({ x: 1, y: 1, x2: 3, y2: 2 })];
  const place = placeOnPaper(shapes, page, marginsAll(1), { x: 0.5, y: 0.5 }, "fill")!;
  close(place.k, 6.5);
  const scaled = reshapeDrawing(shapes, place.k, place.about, place.by);
  const d = drawnBox(scaled);
  close(d.x0, -1); close(d.x1, 12); close(d.y0, 1); close(d.y1, 7.5);
  const cut = cropDrawing(scaled, [], place.box, {});
  const c = drawnBox(cut.shapes);
  close(c.x0, 1); close(c.x1, 10); close(c.y0, 1); close(c.y1, 7.5);
});
