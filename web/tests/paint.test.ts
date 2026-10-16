import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, photoMask, readTones, type Photo } from "../src/shared/lib/drawing/photo";

// A made-up picture, read without a browser, its color at each pixel from `rgb(x, y)`.
const W = 200;
const H = 200;
async function picture(src: string, rgb: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...rgb(x, y), 255], (y * W + x) * 4);
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}

// Red on the left, blue on the right, a white strip along the top, and a blue speck in the red.
const RED: [number, number, number] = [220, 30, 40];
const BLUE: [number, number, number] = [30, 60, 200];
const scene = (x: number, y: number): [number, number, number] =>
  y < 30 ? [255, 255, 255] : x >= 60 && x < 63 && y >= 100 && y < 103 ? BLUE : x < 100 ? RED : BLUE;

const layer = (src: string, region: number, more: Partial<Photo> = {}): Photo => ({
  src, width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.5, levels: 4, style: "paint",
  ink: region ? "#1e3cc8" : "#dc1e28", regions: ["#dc1e28", "#1e3cc8"], region, group: "g", ...more,
});

test("paint: the colors' regions tile the picture - no overlaps, specks merged, paper left bare", async () => {
  await picture("data:paint", scene);
  const red = photoMask(layer("data:paint", 0), 3, 3)!;
  const blue = photoMask(layer("data:paint", 1), 3, 3)!;
  assert.equal(red.w, blue.w);
  let overlap = 0;
  for (let i = 0; i < red.seen.length; i++) if (red.seen[i] && blue.seen[i]) overlap++;
  assert.equal(overlap, 0, "no point painted twice");
  const at = (m: typeof red, fx: number, fy: number) => m.seen[Math.round(fy * (m.h - 1)) * m.w + Math.round(fx * (m.w - 1))];
  assert.ok(at(red, 0.25, 0.6) && !at(blue, 0.25, 0.6), "red on the left");
  assert.ok(at(blue, 0.75, 0.6) && !at(red, 0.75, 0.6), "blue on the right");
  assert.ok(!at(red, 0.5, 0.05) && !at(blue, 0.5, 0.05), "the white strip is paper");
  // The speck, about 0.05 in across, is under the 3 mm smallest: it takes the red around it.
  assert.ok(at(red, 61.5 / W, 101.5 / H) && !at(blue, 61.5 / W, 101.5 / H), "the speck is painted red");
  // Smallest 0 keeps it.
  const keep = photoMask(layer("data:paint", 1, { paintSmallestMm: 0, paintSmoothMm: 0 }), 3, 3)!;
  assert.ok(at(keep, 61.5 / W, 101.5 / H), "kept when nothing is too small");
});

test("paint: each layer's fill stays in its own regions, with an outline unless turned off", async () => {
  await picture("data:paint2", scene);
  const marks = photoMarks(layer("data:paint2", 0), 3, 3)!;
  assert.equal(marks.passes.length, 2, "fill and outline");
  for (const run of marks.passes[0].split("M").filter(Boolean)) {
    for (const p of run.split("L")) {
      const [x, y] = p.trim().split(" ").map(Number);
      assert.ok(x <= 1.55 && y >= 0.4, `red's line at ${x.toFixed(2)}, ${y.toFixed(2)} is in the red`);
    }
  }
  const plain = photoMarks(layer("data:paint2", 0, { paintOutline: false }), 3, 3)!;
  assert.equal(plain.passes.length, 1, "no outline");
});
