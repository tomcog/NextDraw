import { test } from "node:test";
import assert from "node:assert/strict";
import { areaPicker, silhouetteOf } from "../src/shared/lib/drawing/silhouette";
import type { Shape } from "../src/shared/lib/drawing/shapes";

const rect = (x: number, y: number, w: number, h: number): Shape => ({ id: `r${x}${y}`, layerId: "a", kind: "rect", x, y, x2: x + w, y2: y + h });
const ring = (cx: number, cy: number, r: number): Shape => ({ id: "e", layerId: "a", kind: "ellipse", x: cx - r, y: cy - r, x2: cx + r, y2: cy + r });
const boxOfRun = (run: { x: number; y: number }[]) => ({
  x0: Math.min(...run.map((p) => p.x)), x1: Math.max(...run.map((p) => p.x)),
  y0: Math.min(...run.map((p) => p.y)), y1: Math.max(...run.map((p) => p.y)),
});
const inside = (run: { x: number; y: number }[], p: { x: number; y: number }) => {
  let on = false;
  for (let i = 0, j = run.length - 1; i < run.length; j = i++) {
    const a = run[i], b = run[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) on = !on;
  }
  return on;
};

test("silhouette: two shapes a couple of millimetres apart are one outline round both", () => {
  const gap = 2 / 25.4;
  const runs = silhouetteOf([rect(1, 1, 1, 1), rect(2 + gap, 1, 1, 1)], { closeMm: 4 });
  assert.equal(runs.length, 1);
  const b = boxOfRun(runs[0]);
  assert.ok(Math.abs(b.x0 - 1) < 0.05 && Math.abs(b.x1 - (3 + gap)) < 0.05, "spans both");
  // Closed.
  assert.deepEqual(runs[0][0], runs[0][runs[0].length - 1]);
});

test("silhouette: shapes far apart are separate parts, the biggest first", () => {
  const runs = silhouetteOf([rect(1, 1, 0.5, 0.5), rect(4, 1, 1.5, 1.5)], { closeMm: 4 });
  assert.equal(runs.length, 2);
  assert.ok(boxOfRun(runs[0]).x0 > 3, "the bigger one first");
});

test("silhouette: a ring is filled in - the paper inside it is varnished too", () => {
  const runs = silhouetteOf([ring(3, 3, 1)], { closeMm: 2 });
  assert.equal(runs.length, 1);
  assert.ok(inside(runs[0], { x: 3, y: 3 }), "the middle is inside the outline");
  assert.ok(!inside(runs[0], { x: 4.3, y: 3 }), "outside the ring is outside");
});

test("silhouette: nothing drawn, nothing to varnish", () => {
  assert.deepEqual(silhouetteOf([]), []);
});

test("silhouette: a busy drawing is thinned to few enough points to drag", () => {
  // A ring of many small squares: a long, wiggly outline.
  const shapes = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    return rect(4 + 2 * Math.cos(a), 4 + 2 * Math.sin(a), 0.12, 0.12);
  });
  const runs = silhouetteOf(shapes, { closeMm: 6, maxPoints: 110 });
  assert.ok(runs.length >= 1);
  assert.ok(runs.reduce((n, r) => n + r.length, 0) <= 110 + runs.length, "few enough points");
});

// A layer's lines as one path: hatching in both directions over a box, `gapMm` apart.
const crossHatch = (id: string, x: number, y: number, w: number, h: number, gapMm: number): Shape => {
  const gap = gapMm / 25.4;
  const runs: { x: number; y: number }[][] = [];
  for (let v = y; v <= y + h; v += gap) runs.push([{ x, y: v }, { x: x + w, y: v }]);
  for (let u = x; u <= x + w; u += gap) runs.push([{ x: u, y }, { x: u, y: y + h }]);
  return { id, layerId: "a", kind: "path", runs, x, y, x2: x + w, y2: y + h };
};

test("areas: a click in packed hatching takes that patch, not the looser hatching beside it", () => {
  // A packed stripe (0.12 mm apart), touching looser shading of the same pen (0.6 mm apart).
  const stripe = crossHatch("stripe", 1, 1, 2, 0.5, 0.12);
  const shading = crossHatch("shading", 1, 1.5, 2, 1, 0.6);
  const picker = areaPicker([stripe, shading]);
  assert.ok(picker);
  const runs = picker.at({ x: 2, y: 1.25 });
  assert.equal(runs.length, 1);
  const b = boxOfRun(runs[0]);
  assert.ok(Math.abs(b.x0 - 1) < 0.06 && Math.abs(b.x1 - 3) < 0.06, `spans the stripe: ${b.x0}-${b.x1}`);
  assert.ok(Math.abs(b.y0 - 1) < 0.06 && Math.abs(b.y1 - 1.5) < 0.06, `stops at its edge: ${b.y0}-${b.y1}`);
  assert.ok(inside(runs[0], { x: 2, y: 1.25 }));
  // A click in the shading finds nothing solid there.
  assert.equal(picker.at({ x: 2, y: 2.2 }).length, 0);
});
