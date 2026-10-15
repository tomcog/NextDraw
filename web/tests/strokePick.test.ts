// Stroke select and the Lasso: single strokes picked out of a layer's paths and deleted, the paths
// left whole (studio/lib/strokePick.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { centerOf, pathRuns, turnPoint, type Shape } from "../src/shared/lib/drawing/shapes";
import { strokeAt, strokeKey, strokesInBox, strokesInLasso, strokesOf, withoutStrokes } from "../src/studio/lib/strokePick";

const run = (...xy: number[]) => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }));
// One path of three strokes, as an imported layer often is; another path on its own; one on another layer.
const many: Shape = { id: "many", layerId: "a", kind: "path", runs: [run(0, 0, 1, 0), run(0, 1, 1, 1), run(5, 5, 6, 6)], x: 0, y: 0, x2: 6, y2: 6 };
const one: Shape = { id: "one", layerId: "a", kind: "path", points: run(2, 2, 3, 2), x: 2, y: 2, x2: 3, y2: 2 };
const other: Shape = { id: "other", layerId: "b", kind: "path", points: run(0, 0, 1, 0), x: 0, y: 0, x2: 1, y2: 0 };
const drawing = [many, one, other];
const onA = (id: string) => id === "a";

test("a press picks the stroke under it, on the targeted layers only", () => {
  const strokes = strokesOf(drawing, onA);
  assert.equal(strokes.length, 4);
  assert.equal(strokeAt(strokes, { x: 0.5, y: 1.02 }, 0.05)?.key, strokeKey("many", 1));
  assert.equal(strokeAt(strokes, { x: 0.5, y: 0.5 }, 0.05), null);
});

test("a box or a lasso picks every stroke with a point inside it", () => {
  const strokes = strokesOf(drawing, onA);
  assert.deepEqual(strokesInBox(strokes, { x0: -0.5, y0: -0.5, x1: 0.5, y1: 1.5 }).map((s) => s.key), [strokeKey("many", 0), strokeKey("many", 1)]);
  const loop = run(1.5, 1.5, 7, 1.5, 7, 7, 1.5, 7);
  assert.deepEqual(strokesInLasso(strokes, loop).map((s) => s.key).sort(), [strokeKey("many", 2), strokeKey("one", 0)].sort());
});

test("deleting strokes keeps the path whole with what's left, and drops a path left empty", () => {
  const { shapes, gone } = withoutStrokes(drawing, new Set([strokeKey("many", 2), strokeKey("one", 0)]));
  assert.deepEqual(gone, ["one"]);
  const kept = shapes.find((s) => s.id === "many")!;
  assert.equal(pathRuns(kept).length, 2);
  assert.deepEqual([kept.x, kept.y, kept.x2, kept.y2], [0, 0, 1, 1], "its box follows what's left");
  assert.ok(shapes.includes(other), "other paths untouched");
});

test("a turned path's remaining strokes stay where they were on the page", () => {
  const turned = { ...many, rotation: 30 };
  const onPage = (sh: Shape) => pathRuns(sh).slice(0, 2).flat().map((p) => turnPoint(p, centerOf(sh), sh.rotation ?? 0));
  const before = onPage(turned);
  const after = onPage(withoutStrokes([turned], new Set([strokeKey("many", 2)])).shapes[0]);
  before.forEach((p, i) => {
    assert.ok(Math.abs(p.x - after[i].x) < 1e-9 && Math.abs(p.y - after[i].y) < 1e-9, `point ${i} moved`);
  });
});
