// The geometry under what the pen draws: hatch fills, and simplifying a path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hatchLines, stepInches, type Fill } from "../src/studio/lib/hatch";
import { parsePath, pathData, simplifyRun } from "../src/studio/lib/path";
import type { Point } from "../src/studio/lib/parametric";
import type { Shape } from "../src/studio/lib/shapes";

const rect: Shape = { id: "r", kind: "rect", x: 1, y: 1, x2: 3, y2: 2, layerId: "l" };
const fill = (over: Partial<Fill>): Fill => ({ id: "f", shapeId: "r", angle: 0, spacingMm: 2.54, scale: 100, ...over });
const eps = 1e-6;

test("hatch lines stay inside the box, run at the fill's angle, and stand a step apart", () => {
  for (const angle of [0, 30, 45, 90, 135]) {
    const f = fill({ angle });
    const lines = hatchLines(rect, f);
    assert.ok(lines.length > 5, `${angle}°: only ${lines.length} lines`);
    const rad = (angle * Math.PI) / 180;
    const across = { x: -Math.sin(rad), y: Math.cos(rad) }; // at right angles to the lines
    const offsets = lines.map((l) => {
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        assert.ok(x >= 1 - eps && x <= 3 + eps && y >= 1 - eps && y <= 2 + eps, `${angle}°: (${x}, ${y}) is outside the box`);
      }
      // Each line points along the angle, one way or the other.
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      if (len > 1e-3) {
        const along = Math.abs(((l.x2 - l.x1) * Math.cos(rad) + (l.y2 - l.y1) * Math.sin(rad)) / len);
        assert.ok(Math.abs(along - 1) < 1e-6, `${angle}°: a line runs off its angle`);
      }
      return l.x1 * across.x + l.y1 * across.y;
    }).sort((a, b) => a - b);
    for (let i = 1; i < offsets.length; i++) {
      assert.ok(Math.abs(offsets[i] - offsets[i - 1] - stepInches(f)) < 1e-3, `${angle}°: lines ${i - 1} and ${i} aren't a step apart`);
    }
  }
});

test("the spacing is measured on paper, so a drawing plotted at 200% is hatched at half the step", () => {
  assert.equal(stepInches(fill({ spacingMm: 2.54 })), 0.1);
  assert.equal(stepInches(fill({ spacingMm: 2.54, scale: 200 })), 0.05);
});

test("nothing is hatched where there's nothing to fill or the spacing is too fine to draw", () => {
  assert.deepEqual(hatchLines({ ...rect, kind: "line" }, fill({})), []);
  assert.deepEqual(hatchLines(rect, fill({ spacingMm: 0.01 })), []);
});

const offLine = (p: Point, a: Point, b: Point) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len ** 2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
};

test("simplifying keeps the ends and corners, drops points on a straight run, and stays within the tolerance", () => {
  const straight = Array.from({ length: 11 }, (_, i) => ({ x: i / 10, y: 0 }));
  assert.deepEqual(simplifyRun(straight, 0.001), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);

  const corner = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }];
  assert.deepEqual(simplifyRun(corner, 0.001), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);

  const wave = Array.from({ length: 200 }, (_, i) => ({ x: i / 50, y: Math.sin(i / 10) }));
  for (const tolerance of [0.001, 0.01, 0.1]) {
    const kept = simplifyRun(wave, tolerance);
    assert.deepEqual(kept[0], wave[0]);
    assert.deepEqual(kept[kept.length - 1], wave[wave.length - 1]);
    assert.ok(kept.length < wave.length, `${tolerance}: nothing was taken out`);
    // Every point taken out lies within the tolerance of what is left.
    let at = 0;
    for (const p of wave) {
      while (at < kept.length - 2 && p.x > kept[at + 1].x) at++;
      assert.ok(offLine(p, kept[at], kept[at + 1]) <= tolerance + 1e-9, `${tolerance}: a point is ${offLine(p, kept[at], kept[at + 1])} off`);
    }
  }
  assert.equal(simplifyRun(wave, 0), wave);
});

test("path data read in and written out again is the same path", () => {
  const d = "M 1 1 L 2 1 C 2.5 1 3 1.5 3 2 M 4 4 L 5 5";
  const runs = parsePath(d);
  assert.equal(runs.length, 2);
  assert.deepEqual(parsePath(pathData(runs)), runs);
});
