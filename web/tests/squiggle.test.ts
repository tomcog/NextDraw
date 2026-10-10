import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, readTones, type Photo } from "../src/shared/lib/drawing/photo";

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
  const tall = photoMarks(photo({ squiggleHeight: 3 }), 4, 2)!;
  const flat = photoMarks(photo({ squiggleHeight: 0 }), 4, 2)!;
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
