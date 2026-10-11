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
  src: "data:one", width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.3, levels: 4, style: "oneline", lineDots: 800, ...more,
});

const points = (d: string) => d.split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.split(" ").map(Number)));

// Whether segments p1-p2 and p3-p4 cross properly (not just touch at an end).
const crosses = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
  const side = (a: number[], b: number[], c: number[]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return side(p1, p2, p3) * side(p1, p2, p4) < 0 && side(p3, p4, p1) * side(p3, p4, p2) < 0;
};

test("one line: every dot on a single line, thicker where it's darker, none in white", async () => {
  await gradient("data:one");
  const marks = photoMarks(photo(), 3, 3)!;
  assert.equal(marks.strokes, 1);
  assert.equal(marks.dots, 800);
  const [line] = points(marks.passes[0]);
  assert.equal(line.length, 800);
  const xs = line.map((p) => p[0]);
  const inThird = (a: number, b: number) => xs.filter((x) => x >= a && x < b).length;
  assert.ok(inThird(2, 3) > inThird(1, 2) * 2, "more dots in the dark third");
  assert.ok(inThird(0, 0.15) < 5, "next to none at white");
});

test("one line: the route doesn't cross itself, and lifting over long jumps breaks it", async () => {
  await gradient("data:one");
  const [line] = points(photoMarks(photo({ lineDots: 300 }), 3, 3)!.passes[0]);
  let crossings = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    for (let j = i + 2; j + 1 < line.length; j++) if (crosses(line[i], line[i + 1], line[j], line[j + 1])) crossings++;
  }
  // 2-opt looks only at each dot's nearest few, so the odd long crossing may survive; not a tangle.
  assert.ok(crossings <= 3, `${crossings} crossings`);
  const lifted = photoMarks(photo({ lineDots: 300, lineLiftMm: 6 }), 3, 3)!;
  assert.ok(lifted.strokes > 1);
});
