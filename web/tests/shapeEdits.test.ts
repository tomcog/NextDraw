// Flattening, baking, joining, splitting and simplifying shapes, in studio/lib/shapeEdits.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnBox } from "../src/studio/lib/drawing";
import type { Fill } from "../src/shared/lib/drawing/hatch";
import { bakedCopies, flattened, handOutFills, joined, markRuns, pointCount, simplified, simplifyDrawing, splitApart } from "../src/studio/lib/shapeEdits";
import { pathRuns, type Shape } from "../src/shared/lib/drawing/shapes";

const shape = (over: Partial<Shape>): Shape => ({ id: "s", kind: "rect", x: 1, y: 1, x2: 3, y2: 2, layerId: "l", ...over });
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6, `${what} ${a} ≠ ${b}`);
const sameBox = (a: ReturnType<typeof drawnBox>, b: typeof a) => {
  close(a.x0, b.x0, "x0"); close(a.y0, b.y0, "y0"); close(a.x1, b.x1, "x1"); close(a.y1, b.y1, "y1");
};

test("flattening a rectangle leaves its corners as a path, under its own id, drawing the same", () => {
  const rect = shape({ rotation: 20, repeat: { kind: "line", count: 2, step: 3, angle: 0 } });
  const [path, ...rest] = flattened(rect, undefined);
  assert.equal(rest.length, 0);
  assert.equal(path.id, "s");
  assert.equal(path.kind, "path");
  assert.equal(path.points?.length, 5); // closed on its first corner
  // The turn and the copies are settings it keeps, so what lands on paper is the same.
  assert.equal(path.rotation, 20);
  assert.deepEqual(path.repeat, rect.repeat);
  sameBox(drawnBox([path]), drawnBox([rect]));
});

test("flattening a curve leaves its strokes as smoothed paths, the first under its id", () => {
  const poly = shape({ kind: "curve", x: 0, y: 0, x2: 2, y2: 2, curve: { kind: "polygon", sides: 6 } });
  const made = flattened(poly, undefined);
  assert.ok(made.length >= 1);
  assert.equal(made[0].id, "s");
  assert.ok(made.every((s) => s.kind === "path" && s.smooth && !s.curve));
});

test("baking a row makes each copy a shape where it was drawn, the first keeping the id", () => {
  const row = shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } });
  const made = bakedCopies(row);
  assert.equal(made.length, 3);
  assert.equal(made[0].id, "s");
  assert.ok(made.every((s) => !s.repeat));
  assert.deepEqual(made.map((s) => s.x), [1, 3, 5]);
  sameBox(drawnBox(made), drawnBox([row]));
});

test("baking a ring that faces out gives each copy its own turn", () => {
  const ring = shape({ repeat: { kind: "ring", count: 4, radius: 1, facing: true } });
  assert.deepEqual(bakedCopies(ring).map((s) => s.rotation ?? 0), [0, 90, 180, 270]);
  sameBox(drawnBox(bakedCopies(ring)), drawnBox([ring]));
});

test("a replaced shape's fills go to everything that replaced it", () => {
  const fills = [{ id: "f", shapeId: "s", angle: 0, spacingMm: 1, scale: 100 }, { id: "g", shapeId: "other", angle: 0, spacingMm: 1, scale: 100 }] as Fill[];
  const made = bakedCopies(shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } }));
  const out = handOutFills(fills, "s", made);
  assert.deepEqual(out.filter((f) => f.shapeId !== "other").map((f) => f.shapeId), made.map((s) => s.id));
  assert.equal(out.find((f) => f.shapeId === "s")!.id, "f");
  assert.ok(out.some((f) => f.id === "g"));
});

test("joining makes one path of every mark, and taking it apart gives them back", () => {
  const a = shape({ id: "a" });
  const b = shape({ id: "b", kind: "ellipse", x: 5, y: 3, x2: 7, y2: 4 });
  const one = joined([a, b], {})!;
  assert.equal(one.id, "a");
  assert.equal(one.kind, "path");
  assert.equal(pathRuns(one).length, 2);
  sameBox(drawnBox([one]), drawnBox([a, b]));
  const apart = splitApart(one);
  assert.equal(apart.length, 2);
  assert.equal(apart[0].id, "a");
  sameBox(drawnBox([apart[0]]), drawnBox([a]));
});

test("joining leaves photos out, and needs two shapes to join", () => {
  const photo = shape({ id: "p", kind: "photo" });
  assert.equal(joined([shape({}), photo], {}), null);
  assert.equal(joined([shape({})], {}), null);
});

test("a shape's marks take in its copies and, when asked, its fill", () => {
  const row = shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } });
  assert.equal(markRuns(row, undefined).length, 3);
  const fills = [{ id: "f", shapeId: "s", angle: 0, spacingMm: 2.54, scale: 100 }] as Fill[];
  const withFill = markRuns(row, undefined, fills);
  assert.ok(withFill.length > 3);
  // A shape only there to be filled draws its fill and not its outline.
  assert.equal(markRuns({ ...row, outline: false }, undefined, fills).length, withFill.length - 3);
});

test("simplifying drops the points a path doesn't need, and leaves alone one that needs them all", () => {
  const straight = shape({ kind: "path", x: 0, y: 0, x2: 1, y2: 0, points: Array.from({ length: 11 }, (_, i) => ({ x: i / 10, y: 0 })) });
  const simpler = simplified(straight, 0.001)!;
  assert.equal(simpler.points?.length, 2);
  assert.equal(simpler.smooth, true);
  assert.equal(simplified({ ...straight, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 0.001), null);
});

test("the Simplifier thins straight runs, joins ends that meet, drops specks, and leaves the rest", () => {
  const off = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0 };
  // A straight line walked in 101 points, then a second run starting where it ended, then a speck.
  const line = Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: 0 }));
  const on = { x: 1.001, y: 0 };
  const path = shape({ kind: "path", runs: [line, [on, { x: 1, y: 1 }], [{ x: 3, y: 3 }, { x: 3.001, y: 3 }]] });
  const words = shape({ id: "t", kind: "text", text: "hi" });
  assert.equal(pointCount([path, words]), 105);

  // All off: nothing changes.
  assert.deepEqual(pathRuns(simplifyDrawing([path], () => true, off).shapes[0]), pathRuns(path));

  const { shapes, gone } = simplifyDrawing([path, words], () => true, { mergeShort: 0.004, straighten: 0.002, joinEnds: 0.01, dropTiny: 0.01 });
  assert.deepEqual(gone, []);
  const runs = pathRuns(shapes[0]);
  // The line is its two ends, carried on into the run that starts where it stopped; the speck is gone.
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(shapes[1], words); // a word is drawn from its letters, not its points

  // A path with nothing but specks goes altogether; another layer's paths are left alone.
  const speck = shape({ id: "p", kind: "path", points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }] });
  const other = shape({ id: "q", kind: "path", layerId: "m", points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }] });
  const r = simplifyDrawing([speck, other], (s) => s.layerId === "l", { ...off, dropTiny: 0.01 });
  assert.deepEqual(r.gone, ["p"]);
  assert.deepEqual(r.shapes, [other]);
});
