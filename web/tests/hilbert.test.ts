import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, readTones, type Photo } from "../src/shared/lib/drawing/photo";

// A made-up photo, read without a browser: white on the left darkening to black on the right.
const W = 200;
const H = 200;
async function gradient(src: string) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round(255 * (1 - x / (W - 1)));
    data.set([v, v, v, 255], (y * W + x) * 4);
  }
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}

const photo = (more: Partial<Photo> = {}): Photo => ({
  src: "data:hil", width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.5, levels: 4, style: "hilbert", ...more,
});

const points = (d: string) => d.split("M").filter(Boolean).flatMap((r) => r.split("L").map((p) => p.split(" ").map(Number)));

// How much line lies in a band across the picture, measured along it.
function lineIn(d: string, x0: number, x1: number) {
  let total = 0;
  for (const run of d.split("M").filter(Boolean)) {
    const pts = run.split("L").map((p) => p.split(" ").map(Number));
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i][0] + pts[i - 1][0]) / 2;
      if (mx >= x0 && mx < x1) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
  }
  return total;
}

test("hilbert: one line, only right-angle steps, folded finer where it's darker", async () => {
  await gradient("data:hil");
  const marks = photoMarks(photo(), 3, 3)!;
  assert.equal(marks.strokes, 1);
  const d = marks.passes[0];
  const pts = points(d);
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    // Square to the picture, except the short step where a fine square meets a coarser one.
    assert.ok(dx < 1e-6 || dy < 1e-6 || Math.hypot(dx, dy) < 0.3, "steps run across or down");
  }
  assert.ok(lineIn(d, 2, 3) > lineIn(d, 1, 2) * 1.5, "more line where darker");
  assert.ok(lineIn(d, 1, 2) > lineIn(d, 0, 1) * 1.2);
});

test("hilbert: a picture that isn't square is still one line, inside it; lifting leaves white bare", async () => {
  await gradient("data:hil");
  for (const [w, h] of [[5, 2], [2, 5]]) {
    const marks = photoMarks(photo(), w, h)!;
    assert.equal(marks.strokes, 1, `${w}x${h}`);
    for (const [x, y] of points(marks.passes[0])) assert.ok(x >= 0 && x <= w && y >= 0 && y <= h);
  }
  // Lifting in white: the band whose tone falls in 70-100% dark, so the light side has nothing to draw.
  const lifted = photoMarks(photo({ hilbertLift: true, band: [0.7, 1] }), 3, 3)!;
  const xs = points(lifted.passes[0]).map((p) => p[0]);
  assert.ok(Math.min(...xs) > 1.5, "nothing drawn on the light side");
});

test("hilbert: Peano is one line of right-angle steps inside the picture; rounding curves the corners; blend keeps it one line", async () => {
  await gradient("data:hil");
  for (const [w, h] of [[3, 3], [5, 2], [2, 5]]) {
    const marks = photoMarks(photo({ hilbertCurve: "peano" }), w, h)!;
    assert.equal(marks.strokes, 1, `peano ${w}x${h}`);
    const pts = points(marks.passes[0]);
    for (const [x, y] of pts) assert.ok(x >= 0 && x <= w && y >= 0 && y <= h);
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
      const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
      assert.ok(dx < 1e-6 || dy < 1e-6 || Math.hypot(dx, dy) < 0.4, "steps run across or down");
    }
  }
  const rounded = photoMarks(photo({ hilbertRound: 1 }), 3, 3)!.passes[0];
  assert.ok(rounded.includes("Q"), "rounded corners are curves");
  const blended = photoMarks(photo({ hilbertBlend: 1 }), 3, 3)!;
  assert.equal(blended.strokes, 1);
  assert.notEqual(blended.passes[0], photoMarks(photo(), 3, 3)!.passes[0]);
});

test("hilbert: turned, the curve stays on the picture and its steps run at the angle", async () => {
  await gradient("data:hil");
  const marks = photoMarks(photo({ hilbertAngle: 45 }), 3, 3)!;
  const runs = marks.passes[0].split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.split(" ").map(Number)));
  let diagonal = 0;
  let total = 0;
  for (const pts of runs) {
    for (const [x, y] of pts) assert.ok(x >= -1e-6 && x <= 3 + 1e-6 && y >= -1e-6 && y <= 3 + 1e-6);
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
      const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
      total++;
      if (Math.abs(dx - dy) < 2e-4) diagonal++;
    }
  }
  assert.ok(diagonal / total > 0.85, `steps at 45°: ${(diagonal / total).toFixed(2)}`);
});
