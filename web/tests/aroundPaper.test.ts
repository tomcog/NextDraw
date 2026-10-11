import { test } from "node:test";
import assert from "node:assert/strict";
import { photoData, photoFromData, photoMarks, readTones, type Photo } from "../src/shared/lib/drawing/photo";

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
  src, width: W, height: H, brightness: 0, contrast: 0, angle: 90, spacingMm: 0.5, levels: 4, ...more,
});

// Where a layer's hatching runs across the page, left to right: the x of every line's ends.
const xsOf = (marks: { passes: string[] }) =>
  marks.passes.join("").split("M").filter(Boolean).flatMap((r) => r.split("L").map((p) => Number(p.split(" ")[0])));
// How much line a layer draws between two x's, as the ends that fall there.
const between = (xs: number[], a: number, b: number) => xs.filter((x) => x >= a && x < b).length;

test("split around the paper: on gray, black draws the darks, white the lights, and the middle is bare", async () => {
  // White on the left to black on the right.
  await picture("data:ramp", (x) => 1 - x / (W - 1));
  const w = 3;
  const tone: [number, number] = [1 / 3, 2 / 3];
  const black = xsOf(photoMarks(photo("data:ramp", { side: "dark", paperTone: tone }), w, w)!);
  const white = xsOf(photoMarks(photo("data:ramp", { side: "light", paperTone: tone }), w, w)!);
  assert.ok(black.length > 0 && white.length > 0);
  // Black only in the dark third, white only in the light third: the middle third is paper.
  assert.ok(Math.min(...black) >= 2 - 0.1, "black stays in the darks");
  assert.ok(Math.max(...white) <= 1 + 0.1, "white stays in the lights");
  // Each heavier the further it is from the paper: black towards the right, white towards the left.
  assert.ok(between(black, 2.5, 3) > between(black, 2, 2.5), "more black the darker");
  assert.ok(between(white, 0, 0.5) > between(white, 0.5, 1), "more white the lighter");
});

test("split around the paper: kept when the drawing is saved and opened again", () => {
  const p = photo("data:image/png;base64,AA", { side: "light", paperTone: [0.2, 0.6], band: [0, 0.5] });
  const back = photoFromData(JSON.parse(JSON.stringify(photoData(p))))!;
  assert.equal(back.side, "light");
  assert.deepEqual(back.paperTone, [0.2, 0.6]);
  assert.deepEqual(back.band, [0, 0.5]);
});

test("split around the paper: with one pass, two dark and two light bands each fill their own region", async () => {
  await picture("data:ramp1", (x) => 1 - x / (W - 1));
  const w = 3;
  const tone: [number, number] = [1 / 3, 2 / 3];
  const at = (side: "dark" | "light", band: [number, number]) =>
    xsOf(photoMarks(photo("data:ramp1", { side, paperTone: tone, band, levels: 1 }), w, w)!);
  // Dark side, darkness 2/3 to 1 across x = 2 to 3: the gray nearer the paper, black further out.
  const gray = at("dark", [0, 0.5]);
  const black = at("dark", [0.5, 1]);
  assert.ok(gray.length > 0 && black.length > 0, "both dark bands draw");
  assert.ok(Math.min(...gray) >= 2 - 0.1 && Math.max(...gray) <= 2.5 + 0.1, "the dark gray's region");
  assert.ok(Math.min(...black) >= 2.5 - 0.1, "black's region");
  // Light side, x = 0 to 1: white outermost (lightest), light gray nearer the paper.
  const lightGray = at("light", [0, 0.5]);
  const white = at("light", [0.5, 1]);
  assert.ok(lightGray.length > 0 && white.length > 0, "both light bands draw");
  assert.ok(Math.min(...lightGray) >= 0.5 - 0.1 && Math.max(...lightGray) <= 1 + 0.1, "the light gray's region");
  assert.ok(Math.max(...white) <= 0.5 + 0.1, "white's region");
});
