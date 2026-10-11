import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, readTones, type Photo } from "../src/shared/lib/drawing/photo";

// A made-up photo, read without a browser, its lightness at each pixel from `light(x, y)`, 0 to 1.
const W = 200;
const H = 200;
async function picture(src: string, light: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round(255 * Math.min(1, Math.max(0, light(x, y))));
    data.set([v, v, v, 255], (y * W + x) * 4);
  }
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}

const photo = (src: string, more: Partial<Photo> = {}): Photo => ({
  src, width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.5, levels: 4, style: "streamlines", ...more,
});

const runs = (d: string) => d.split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.split(" ").map(Number)));

test("streamlines: along the shapes - a left-to-right gradient gives lines running down it, closer where it's darker, none in white", async () => {
  await picture("data:across", (x) => 1 - x / (W - 1));
  const marks = photoMarks(photo("data:across"), 3, 3)!;
  assert.ok(marks.strokes > 10);
  const lines = runs(marks.passes[0]);
  for (const pts of lines) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // Down the page: they move far more in y than in x.
    assert.ok(Math.max(...ys) - Math.min(...ys) > 4 * (Math.max(...xs) - Math.min(...xs)), "lines run along the shape");
  }
  // Paper past the widest spacing (3 mm at 0.5 mm closest: lighter than a sixth of the way to black).
  const xsAll = lines.map((pts) => pts[0][0]);
  assert.ok(Math.min(...xsAll) > 3 * (1 / 6) * 0.8, "white left as paper");
  // More lines in the dark right third than the middle third.
  const inThird = (a: number, b: number) => xsAll.filter((x) => x >= a && x < b).length;
  assert.ok(inThird(2, 3) > inThird(1, 2) * 1.3, "closer together where darker");
});

test("streamlines: round a dark spot, the lines go round it; no two closer than half their spacing", async () => {
  await picture("data:spot", (x, y) => Math.hypot(x - 100, y - 100) / 140);
  const w = 3;
  const marks = photoMarks(photo("data:spot", { streamWidestMm: 4 }), w, w)!;
  const lines = runs(marks.passes[0]);
  // Round it: along a long line the distance from the middle hardly changes.
  const c = w / 2;
  const long = lines.filter((pts) => pts.length > 6);
  assert.ok(long.length > 5);
  for (const pts of long.slice(0, 20)) {
    const r = pts.map(([x, y]) => Math.hypot(x - c, y - c));
    assert.ok(Math.max(...r) - Math.min(...r) < 0.25 * Math.max(...r) + 0.05, "lines circle the spot");
  }
});

test("streamlines: a second pass crosses the first, only in the darker half", async () => {
  await picture("data:across2", (x) => 1 - x / (W - 1));
  const marks = photoMarks(photo("data:across2", { streamPasses: 2 }), 3, 3)!;
  assert.equal(marks.passes.length, 2);
  const second = runs(marks.passes[1]);
  assert.ok(second.length > 3);
  for (const pts of second) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    assert.ok(Math.min(...xs) > 1.4, "the darker half only");
    assert.ok(Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys), "across the first pass");
  }
});
