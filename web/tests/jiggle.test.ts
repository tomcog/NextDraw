// Jiggle: strokes moved a little for a second pass, every one alike with no randomness.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Shape } from "../src/shared/lib/drawing/shapes";
import { jiggled } from "../src/studio/lib/jiggle";

const MM = 1 / 25.4;
const path = (id: string, layerId: string, runs: { x: number; y: number }[][]): Shape => ({
  id, layerId, kind: "path", x: 0, y: 0, x2: 2, y2: 2, runs,
});
const SHAPES: Shape[] = [
  path("a", "l1", [[{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 2, y: 0 }, { x: 2, y: 2 }]]),
  path("b", "l1", [[{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }]]),
  { id: "r", layerId: "l1", kind: "rect", x: 1, y: 1, x2: 2, y2: 2 },
  path("c", "l2", [[{ x: 0, y: 0 }, { x: 1, y: 0 }]]),
];
const onL1 = (s: Shape) => s.layerId === "l1";
const moves = (before: Shape[], after: Shape[]) =>
  after.flatMap((s, i) => (s.runs ?? [[{ x: s.x, y: s.y }]]).flatMap((run, r) =>
    run.map((p, k) => {
      const was = (before[i].runs ?? [[{ x: before[i].x, y: before[i].y }]])[r][k];
      return { x: p.x - was.x, y: p.y - was.y };
    })));

test("no randomness and no noise: every stroke moves the same distance the same way", () => {
  const out = jiggled(SHAPES, onL1, { distance: 1 * MM, angle: 0, randomness: 0, noise: 0, seed: 1 });
  for (const m of moves(SHAPES.slice(0, 3), out.slice(0, 3))) {
    assert.ok(Math.abs(m.x - MM) < 1e-12 && Math.abs(m.y) < 1e-12, JSON.stringify(m));
  }
  assert.deepEqual(out[3], SHAPES[3], "other layers are left alone");
});

test("90 degrees is up the page", () => {
  const [a] = jiggled(SHAPES, onL1, { distance: 1, angle: 90, randomness: 0, noise: 0, seed: 1 });
  assert.ok(Math.abs(a.runs![0][0].x) < 1e-12 && Math.abs(a.runs![0][0].y + 1) < 1e-12);
});

test("randomness: each stroke moves on its own, within its share of the distance", () => {
  const out = jiggled(SHAPES, onL1, { distance: 1 * MM, angle: 0, randomness: 0.1, noise: 0, seed: 7 });
  const [a] = out;
  const run0 = { x: a.runs![0][0].x - 0, y: a.runs![0][0].y - 0 };
  const run1 = { x: a.runs![1][0].x - 2, y: a.runs![1][0].y - 0 };
  assert.ok(Math.hypot(run0.x - run1.x, run0.y - run1.y) > 0, "the two strokes of one path move differently");
  for (const m of moves(SHAPES.slice(0, 3), out.slice(0, 3))) assert.ok(Math.hypot(m.x - MM, m.y) <= 0.1 * MM + 1e-12);
  // A stroke keeps its own shape: both its points move alike.
  assert.ok(Math.abs((a.runs![0][1].x - 1) - run0.x) < 1e-12 && Math.abs((a.runs![0][1].y - 1) - run0.y) < 1e-12);
});

test("noise: the points of a stroke stray on their own, within the noise", () => {
  const out = jiggled(SHAPES, onL1, { distance: 0, angle: 0, randomness: 0, noise: 0.5 * MM, seed: 3 });
  const ms = moves(SHAPES.slice(0, 2), out.slice(0, 2));
  assert.ok(ms.some((m) => Math.hypot(m.x, m.y) > 0));
  for (const m of ms) assert.ok(Math.hypot(m.x, m.y) <= 0.5 * MM + 1e-12);
  assert.deepEqual(out[2], SHAPES[2], "a rectangle has no points to stray, and nothing moves it");
});

test("the same seed gives the same jiggle; a path's box follows its points", () => {
  const o = { distance: 1 * MM, angle: 30, randomness: 0.5, noise: 0.2 * MM, seed: 11 };
  assert.deepEqual(jiggled(SHAPES, onL1, o), jiggled(SHAPES, onL1, o));
  const [, b] = jiggled(SHAPES, onL1, o);
  const xs = b.runs![0].map((p) => p.x);
  assert.equal(b.x, Math.min(...xs));
  assert.equal(b.x2, Math.max(...xs));
});
