// A drawing saved by Studio and opened again comes back as it went: shapes, layers, fills, the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import type { Fill } from "../src/shared/lib/drawing/hatch";
import type { Layer, Page, Shape } from "../src/shared/lib/drawing/shapes";

// Reading a drawing uses the browser's parser; linkedom stands in for it here.
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const page: Page = { w: 11, h: 8.5 };
const layers: Layer[] = [
  { id: "a", name: "Black", color: "#1d1d1f" },
  { id: "b", name: "Red", color: "#e5322d" },
];
const shapes: Shape[] = [
  { id: "rect", kind: "rect", x: 1, y: 1, x2: 3, y2: 2, layerId: "a" },
  { id: "ellipse", kind: "ellipse", x: 4, y: 1, x2: 6, y2: 2.5, layerId: "a" },
  { id: "line", kind: "line", x: 7, y: 3, x2: 9, y2: 1, layerId: "a" },
  { id: "turned", kind: "rect", x: 1, y: 4, x2: 2, y2: 5, rotation: 30, layerId: "b" },
  {
    id: "path", kind: "path", x: 4, y: 4, x2: 6, y2: 6, layerId: "b",
    points: [{ x: 4, y: 6 }, { x: 5, y: 4, in: { x: 4.5, y: 4 }, out: { x: 5.5, y: 4 } }, { x: 6, y: 6 }],
  },
  { id: "row", kind: "rect", x: 7, y: 4, x2: 7.5, y2: 4.5, repeat: { kind: "line", count: 3, step: 0.75, angle: 0 }, layerId: "b" },
  { id: "grid", kind: "ellipse", x: 7, y: 6, x2: 7.4, y2: 6.4, repeat: { kind: "grid", across: 3, down: 2, stepX: 0.5, stepY: 0.6 }, layerId: "b" },
  { id: "turnedRow", kind: "ellipse", x: 1, y: 7, x2: 1.6, y2: 7.3, rotation: 45, repeat: { kind: "line", count: 3, step: 0.8, angle: 0 }, layerId: "a" },
  { id: "ring", kind: "rect", x: 2, y: 6, x2: 2.4, y2: 6.4, repeat: { kind: "ring", count: 5, radius: 0.8, facing: true }, layerId: "a" },
];
const fills: Fill[] = [
  { id: "f1", shapeId: "rect", angle: 45, spacingMm: 1.5, scale: 100 },
  { id: "f2", shapeId: "rect", angle: 135, spacingMm: 1.5, scale: 100, custom: true },
];

const reopened = () => parseDrawing(buildSvg(shapes, fills, layers, page, { paperSizeId: "letter", toolName: "Paper-Mate Flair Medium" }));
const near = (a: number | undefined, b: number | undefined, what: string) =>
  assert.ok(Math.abs((a ?? 0) - (b ?? 0)) < 1e-3, `${what}: ${a} ≠ ${b}`);

test("the page, layers and tool come back", () => {
  const back = reopened();
  near(back.page.w, page.w, "page width");
  near(back.page.h, page.h, "page height");
  assert.deepEqual(back.layers.map((l) => [l.name, l.color]), layers.map((l) => [l.name, l.color]));
  assert.equal(back.tool, "Paper-Mate Flair Medium");
  assert.equal(back.unsupported, 0);
});

test("every shape comes back once, on its layer, with its box, turn and copies", () => {
  const back = reopened();
  assert.equal(back.shapes.length, shapes.length, `shapes: ${back.shapes.map((s) => s.kind).join(", ")}`);
  const layerName = (list: Layer[], id: string) => list.find((l) => l.id === id)?.name;
  for (const before of shapes) {
    const after = back.shapes.find((s) => s.id === before.id);
    assert.ok(after, `${before.id} is missing`);
    assert.equal(after.kind, before.kind, before.id);
    assert.equal(layerName(back.layers, after.layerId), layerName(layers, before.layerId), `${before.id}'s layer`);
    for (const k of ["x", "y", "x2", "y2"] as const) near(after[k], before[k], `${before.id}.${k}`);
    near(after.rotation, before.rotation, `${before.id}'s turn`);
    assert.deepEqual(after.repeat, before.repeat, `${before.id}'s copies`);
  }
});

test("a path's points and their curve handles come back", () => {
  const before = shapes.find((s) => s.id === "path")!;
  const after = reopened().shapes.find((s) => s.id === "path")!;
  const points = after.points ?? after.runs?.[0];
  assert.ok(points, "the path has no points");
  assert.equal(points.length, before.points!.length);
  points.forEach((p, i) => {
    const q = before.points![i];
    near(p.x, q.x, `point ${i} x`);
    near(p.y, q.y, `point ${i} y`);
    // A handle left off sits on its point, which draws the same as one written there.
    for (const side of ["in", "out"] as const) {
      near((p[side] ?? p).x, (q[side] ?? q).x, `point ${i} handle ${side} x`);
      near((p[side] ?? p).y, (q[side] ?? q).y, `point ${i} handle ${side} y`);
    }
  });
});

test("fills come back on their shape, with their angle, spacing and whether they were set by hand", () => {
  const back = reopened();
  const mine = back.fills.filter((f) => f.shapeId === "rect").sort((a, b) => a.angle - b.angle);
  assert.deepEqual(mine.map((f) => [f.angle, f.spacingMm, Boolean(f.custom)]), [[45, 1.5, false], [135, 1.5, true]]);
});

test("saving what was opened writes the same file again", () => {
  const back = reopened();
  const again = (o: typeof back) => buildSvg(o.shapes, o.fills, o.layers, o.page, { paperSizeId: "letter", toolName: o.tool ?? "" });
  assert.equal(again(parseDrawing(again(back))), again(back));
});
