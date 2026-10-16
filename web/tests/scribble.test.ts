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
  src, width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.5, levels: 4, style: "scribble", ...more,
});

const runs = (d: string) => d.split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.trim().split(" ").map(Number)));
const lengthOf = (pts: number[][]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test("scribble: a minimum length leaves out every shorter stroke, and the tone is still built up", async () => {
  // Dark blobs on white: plenty of strokes cut short at their edges.
  await picture("data:blobs", (x, y) => 0.3 + 0.7 * Math.abs(Math.sin(x / 13) * Math.cos(y / 17)));
  const all = runs(photoMarks(photo("data:blobs"), 2, 2)!.passes.join("")).map(lengthOf);
  const min = 10 / 25.4;
  assert.ok(all.some((l) => l < min), "without a minimum, some strokes are shorter than 10 mm");

  const kept = runs(photoMarks(photo("data:blobs", { scribbleMinMm: 10 }), 2, 2)!.passes.join("")).map(lengthOf);
  assert.ok(kept.length > 5);
  for (const l of kept) assert.ok(l >= min - 0.001, `no stroke under 10 mm (${(l * 25.4).toFixed(2)} mm)`);
  // The ink left out is laid again by longer strokes: about as much line overall.
  const total = (ls: number[]) => ls.reduce((a, b) => a + b, 0);
  assert.ok(total(kept) > total(all) * 0.75, "the tone is still built up");
});
