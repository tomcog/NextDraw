import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenedColours, readTones } from "../src/shared/lib/drawing/photo";

const W = 240;
const H = 240;
async function picture(src: string, rgb: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...rgb(x, y), 255], (y * W + x) * 4);
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}
const of = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
const far = (a: string, b: [number, number, number]) => Math.max(...[0, 1, 2].map((i) => Math.abs(of(a)[i] - b[i])));
const nearest = (found: string[], want: [number, number, number]) => found.reduce((best, c) => Math.min(best, far(c, want)), 255);

const RED: [number, number, number] = [220, 40, 40];
const BLUE: [number, number, number] = [30, 70, 200];
const CREAM: [number, number, number] = [250, 235, 200];
const NAVY: [number, number, number] = [15, 40, 90];
const FLATS = [RED, BLUE, CREAM, NAVY];

test("flatten: art that is already flat keeps its own colours", async () => {
  await picture("data:quarters", (x, y) => FLATS[(x < W / 2 ? 0 : 1) + (y < H / 2 ? 0 : 2)]);
  const four = flattenedColours("data:quarters", 4);
  assert.equal(four.length, 4);
  for (const want of FLATS) assert.ok(nearest(four, want) <= 3, `${want} lost: ${four.join(" ")}`);
});

test("flatten: a photograph is cut down to the number asked for, spanning its tones", async () => {
  // A smooth ramp: nothing flat in it at all, so the colours come from sampling the whole picture.
  await picture("data:ramp", (x) => [Math.round((x * 255) / W), Math.round((x * 255) / W), Math.round((x * 255) / W)]);
  for (const count of [2, 3, 5, 8]) {
    const got = flattenedColours("data:ramp", count);
    assert.equal(got.length, count, `asked for ${count}, got ${got.join(" ")}`);
    // Lightest first, and spread across the ramp rather than bunched at one end.
    const light = got.map((c) => of(c)[0]);
    assert.deepEqual(light, [...light].sort((a, b) => b - a), `not lightest first: ${got.join(" ")}`);
    assert.ok(light[0] - light[light.length - 1] > 120, `should span the ramp: ${got.join(" ")}`);
  }
});

test("flatten: asking for more colours than the picture has gives what there is", async () => {
  await picture("data:quarters", (x, y) => FLATS[(x < W / 2 ? 0 : 1) + (y < H / 2 ? 0 : 2)]);
  const many = flattenedColours("data:quarters", 12);
  assert.ok(many.length <= 12 && many.length >= 4, `got ${many.length}: ${many.join(" ")}`);
  // Whatever it returns, every one is a colour the picture actually has.
  for (const c of many) assert.ok(FLATS.some((f) => far(c, f) <= 6), `${c} is in no part of the picture`);
});

test("flatten: the paper is a colour here, not left out", async () => {
  // White is two thirds of this picture; flattening must keep it, unlike a split, which calls it paper.
  await picture("data:onwhite", (x, y) => (x < (W * 2) / 3 ? [255, 255, 255] : RED));
  const two = flattenedColours("data:onwhite", 2);
  assert.equal(two.length, 2);
  assert.ok(nearest(two, [255, 255, 255]) <= 3, `white should be one of them: ${two.join(" ")}`);
  assert.ok(nearest(two, RED) <= 3, `the red should be the other: ${two.join(" ")}`);
});
