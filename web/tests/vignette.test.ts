// The vignette: darker (or lighter) toward the edges, none in the middle, kept with the drawing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoData, photoFromData, type Photo } from "../src/shared/lib/drawing/photo";
import { VIGNETTE_DEFAULTS, vignetted, vignetteKey, vignetteStrength } from "../src/shared/lib/drawing/vignette";

const at = (s: Float32Array, w: number, x: number, y: number) => s[y * w + x];

test("none in the middle, strongest in the corners, as strong as the amount", () => {
  const w = 120, h = 80;
  const s = vignetteStrength({ ...VIGNETTE_DEFAULTS, amount: 60 }, w, h);
  assert.ok(at(s, w, 60, 40) < 0.01);
  assert.ok(at(s, w, 0, 0) > at(s, w, 0, 40));
  assert.ok(at(s, w, 0, 0) <= 0.6 + 1e-6 && at(s, w, 0, 0) > 0.5);
});

test("bigger reaches further in", () => {
  const w = 100, h = 100;
  const small = vignetteStrength({ ...VIGNETTE_DEFAULTS, size: 20 }, w, h);
  const big = vignetteStrength({ ...VIGNETTE_DEFAULTS, size: 80 }, w, h);
  assert.ok(at(big, w, 20, 50) > at(small, w, 20, 50));
});

test("off, or no amount: nothing", () => {
  assert.ok(vignetteStrength({ ...VIGNETTE_DEFAULTS, off: true }, 10, 10).every((k) => k === 0));
  assert.ok(vignetteStrength({ ...VIGNETTE_DEFAULTS, amount: 0 }, 10, 10).every((k) => k === 0));
  assert.equal(vignetteKey({ ...VIGNETTE_DEFAULTS, off: true }), "");
});

test("darker takes a tone toward black, lighter toward white; white stays white when lightening", () => {
  assert.equal(vignetted(0.8, 0.5, true), 0.4);
  assert.equal(vignetted(0.2, 0.5, false), 0.6);
  assert.equal(vignetted(255, 0.5, false, 255), 255);
});

test("kept with the drawing, off and all", () => {
  const p = { src: "data:image/jpeg;base64,", width: 1, height: 1, brightness: 0, contrast: 0, angle: 45, spacingMm: 1, levels: 4, vignette: { amount: -30, size: 70, softness: 20, roundness: 40, off: true } } as Photo;
  assert.deepEqual(photoFromData(photoData(p))?.vignette, p.vignette);
});
