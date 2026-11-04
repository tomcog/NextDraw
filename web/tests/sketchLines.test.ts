import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, photoFromData, photoData, readTones, type Photo } from "../src/shared/lib/drawing/photo";

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
  src, width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.4, levels: 4, style: "sketch", ...more,
});
const runs = (d: string) => d.split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.trim().split(" ").map(Number)));
const lengthOf = (pts: number[][]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test("sketch lines: ink goes where it's dark, none where it's white", async () => {
  // Left half black, right half white.
  await picture("data:half", (x) => (x < W / 2 ? 0 : 1));
  const strokes = runs(photoMarks(photo("data:half"), 2, 2)!.passes.join(""));
  assert.ok(strokes.length > 3);
  let leftLen = 0;
  let rightLen = 0;
  for (const pts of strokes) for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if ((pts[i][0] + pts[i - 1][0]) / 2 < 1) leftLen += l; else rightLen += l;
  }
  assert.ok(leftLen > rightLen * 20, `mostly in the black (${leftLen.toFixed(1)} vs ${rightLen.toFixed(1)} in)`);
});

test("sketch lines: more Line Density, more line; the same seed, the same drawing", async () => {
  await picture("data:grad", (x) => x / W);
  const total = (d: Partial<Photo>) => runs(photoMarks(photo("data:grad", d), 2, 2)!.passes.join("")).map(lengthOf).reduce((a, b) => a + b, 0);
  assert.ok(total({ sketchLines: { lineDensity: 80 } }) > total({ sketchLines: { lineDensity: 30 } }) * 1.5);
  const a = photoMarks(photo("data:grad", { sketchLines: { seed: 3 } }), 2, 2)!.passes.join("");
  assert.equal(photoMarks(photo("data:grad", { sketchLines: { seed: 3 } }), 2.0000001, 2)!.passes.join(""), a);
  assert.notEqual(photoMarks(photo("data:grad", { sketchLines: { seed: 4 } }), 2, 2)!.passes.join(""), a);
});

test("sketch lines: not lifting the pen draws one line", async () => {
  await picture("data:grad", (x) => x / W);
  assert.equal(photoMarks(photo("data:grad", { sketchLines: { liftPen: false } }), 2, 2)!.strokes, 1);
});

test("sketch lines: the settings are saved and read back", () => {
  const p = photo("data:image/png;base64,AA", { sketchLines: { lineDensity: 70, liftPen: false } });
  const back = photoFromData(photoData(p) as Record<string, unknown>)!;
  assert.equal(back.style, "sketch");
  assert.deepEqual(back.sketchLines, { lineDensity: 70, liftPen: false });
});

test("sketch lines: Edges gathers the lines along a change of tone", async () => {
  // Two greys, darker left, meeting down the middle.
  await picture("data:step", (x) => (x < W / 2 ? 0.55 : 0.85));
  const nearEdge = (d: Partial<Photo>) => {
    let near = 0;
    let all = 0;
    for (const pts of runs(photoMarks(photo("data:step", d), 2, 2)!.passes.join(""))) for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      all += l;
      if (Math.abs((pts[i][0] + pts[i - 1][0]) / 2 - 1) < 0.1) near += l;
    }
    return near / all;
  };
  assert.ok(nearEdge({ sketchLines: { edges: 100 } }) > nearEdge({}) * 1.5, "a bigger share of the line near the edge");
});
