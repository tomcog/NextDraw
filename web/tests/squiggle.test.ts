import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, readTones, squiggleAmp, type Photo } from "../src/shared/lib/drawing/photo";

// A made-up photo, read without a browser: white on the left darkening to black on the right.
const W = 200;
const H = 100;
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

const photo = (more: Partial<Photo>): Photo => ({
  src: "data:gradient", width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.3, levels: 4,
  style: "squiggle", rowMm: 5, waveMm: 2, ...more,
});

test("squiggle: one smooth line per row, unbroken through white", async () => {
  await gradient("data:gradient");
  const w = 4;
  const h = 2;
  const marks = photoMarks(photo({}), w, h)!;
  const rows = Math.round(h / (5 / 25.4));
  assert.equal(marks.strokes, rows);
  const d = marks.passes[0];
  assert.ok(!d.includes("L"), "curves only");
  // Every row runs the full width: from the left edge to the right.
  for (const run of d.split("M").filter(Boolean)) {
    const xs = run.split(/[C ]/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 0);
    assert.ok(Math.min(...xs) < 0.01 && Math.max(...xs) > w - 0.01);
  }
});

test("squiggle: joined rows are one line, and darker waves are taller", async () => {
  await gradient("data:gradient");
  const joined = photoMarks(photo({ squiggleJoin: true }), 4, 2)!;
  assert.equal(joined.strokes, 1);
  const tall = photoMarks(photo({ squiggleAmpMm: 3 }), 4, 2)!;
  const flat = photoMarks(photo({ squiggleAmpMm: 0 }), 4, 2)!;
  const ys = (d: string) => d.split(/[MC ]/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1);
  const spread = (d: string) => Math.max(...ys(d)) - Math.min(...ys(d));
  assert.ok(spread(tall.passes[0]) > spread(flat.passes[0]));
});

test("squiggle: no angle or row spacing throws, even where a run is a single point", async () => {
  await gradient("data:gradient");
  for (let angle = -180; angle <= 180; angle += 5) for (const rowMm of [0.5, 2, 7]) {
    for (const band of [undefined, [0, 0.5], [0.5, 1]] as const) {
      const m = photoMarks(photo({ angle, rowMm, squiggleJoin: angle % 10 === 0, ...(band ? { band: [band[0], band[1]] as [number, number] } : {}) }), 3, 2)!;
      assert.ok(!/NaN|Infinity/.test(m.passes[0]));
    }
  }
});

test("hatching: six passes, the fifth and sixth on the diagonals, each stroke two points", async () => {
  await gradient("data:gradient");
  const marks = photoMarks(photo({ style: undefined, levels: 6, angle: 0, spacingMm: 1 }), 4, 2)!;
  assert.equal(marks.passes.length, 6);
  for (const [k, d] of marks.passes.entries()) {
    assert.ok(d.length > 0, `pass ${k + 1} draws`);
    const [x0, y0, x1, y1] = d.split("L")[0].slice(1).split(" ").concat(d.split("L")[1].split("M")[0].split(" ")).map(Number);
    const deg = (((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI) % 180 + 180) % 180;
    assert.ok(Math.abs(deg - [0, 90, 0, 90, 45, 135][k]) < 1, `pass ${k + 1} at ${deg}°`);
  }
  for (const run of marks.passes.join("").split("M").filter(Boolean)) assert.equal(run.split("L").length, 2);
});

test("hatching: smoothing turns a speckled patch into fewer, longer strokes", async () => {
  // Mid grey with a fine random speckle: unsmoothed, every speck crosses a threshold and breaks a line.
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(110 + (rand() - 0.5) * 120);
    data.set([v, v, v, 255], i * 4);
  }
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones("data:speckle");
  const at = (hatchSmoothMm?: number) => photoMarks(photo({ src: "data:speckle", style: undefined, angle: 0, spacingMm: 0.5, levels: 4, hatchSmoothMm }), 4, 2)!.strokes;
  const raw = at();
  const smooth = at(1);
  assert.ok(smooth < raw / 2, `${raw} strokes unsmoothed, ${smooth} smoothed`);
});

test("squiggle: the amplitude is in mm, whatever the rows' spacing; old drawings keep theirs", async () => {
  await gradient("data:gradient");
  // How far the curve's points stray from their row's middle, in mm: a row starts on its middle.
  const swing = (more: Partial<Photo>) => {
    const d = photoMarks(photo({ angle: 0, waveMm: 2, ...more }), 4, 2)!.passes[0];
    let most = 0;
    for (const run of d.split("M").filter(Boolean)) {
      const nums = run.split(/[C ]/).filter(Boolean).map(Number);
      const middle = nums[1];
      for (let i = 1; i < nums.length; i += 2) if ((i - 1) % 6 === 4 || i === 1) most = Math.max(most, Math.abs(nums[i] - middle));
    }
    return most * 25.4;
  };
  const narrow = swing({ rowMm: 2, squiggleAmpMm: 1 });
  const wide = swing({ rowMm: 6, squiggleAmpMm: 1 });
  assert.ok(Math.abs(narrow - wide) < 0.1, `${narrow.toFixed(2)} mm at 2 mm rows, ${wide.toFixed(2)} mm at 6 mm rows`);
  assert.ok(narrow > 0.8 && narrow <= 1.01, `swings ${narrow.toFixed(2)} mm for 1 mm`);
  // Saved before, as 150% of half a 2 mm row: 1.5 mm.
  assert.equal(squiggleAmp({ squiggleHeight: 1.5, rowMm: 2 }), 1.5);
});

test("squiggle: lifting leaves white as paper, and still draws the darks", async () => {
  await gradient("data:gradient");
  const xs = (d: string) => d.split("M").filter(Boolean).map((run) => Number(run.split(/[C ]/).filter(Boolean)[0]));
  const flat = photoMarks(photo({ angle: 0 }), 4, 2)!;
  const lifted = photoMarks(photo({ angle: 0, squiggleLift: true }), 4, 2)!;
  // The left edge is white: unbroken rows start there; lifted ones start once there's tone.
  assert.ok(Math.min(...xs(flat.passes[0])) < 0.01);
  assert.ok(Math.min(...xs(lifted.passes[0])) > 0.01);
  assert.equal(lifted.strokes, flat.strokes); // one run per row still, each from the first tone to the edge
});
