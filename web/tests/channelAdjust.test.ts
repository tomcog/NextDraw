// A separation's own brightness and contrast, then the whole image's: made one, as the lines read it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelAdjusted, type Photo } from "../src/shared/lib/drawing/photo";

const photo = (p: Partial<Photo>) => ({ src: "", width: 1, height: 1, brightness: 0, contrast: 0, angle: 45, spacingMm: 1, levels: 4, ...p }) as Photo;
/** A tone 0 to 1 as brightness and contrast read it (photo.ts's darknessAt, as lightness). */
const read = (v: number, brightness: number, contrast: number) => {
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  return (v - 0.5) * gain + 0.5 + brightness / 200;
};

test("no channel settings: the photo as it is", () => {
  const p = photo({ brightness: 20, contrast: -10 });
  assert.equal(channelAdjusted(p), p);
});

test("a channel's settings, then the whole image's, come out as one", () => {
  for (const [cb, cc, b, c] of [[30, 0, 0, 0], [0, 40, 0, 0], [20, 30, -10, 25], [-40, -20, 15, -30]]) {
    const one = channelAdjusted(photo({ brightness: b, contrast: c, channelBrightness: cb, channelContrast: cc }));
    assert.equal(one.channelBrightness, undefined);
    for (const v of [0.1, 0.4, 0.5, 0.8]) {
      assert.ok(Math.abs(read(v, one.brightness, one.contrast) - read(read(v, cb, cc), b, c)) < 1e-9, `${[cb, cc, b, c]} at ${v}`);
    }
  }
});

test("a black point makes everything that dark full ink, and leaves white white", () => {
  const one = channelAdjusted(photo({ channelBlackPoint: 40 }));
  assert.ok(Math.abs(read(0.4, one.brightness, one.contrast)) < 1e-9, "the point itself: black");
  assert.ok(read(0.2, one.brightness, one.contrast) < 0, "darker still: black, once clamped");
  assert.ok(Math.abs(read(1, one.brightness, one.contrast) - 1) < 1e-9, "white stays white");
  assert.ok(Math.abs(read(0.7, one.brightness, one.contrast) - 0.5) < 1e-9, "between: stretched to meet it");
});

test("the whole image's black point comes after each plate's own settings", () => {
  const one = channelAdjusted(photo({ channelBrightness: 20, blackPoint: 30 }));
  const point = (v: number) => (v - 0.3) / 0.7;
  for (const v of [0.2, 0.5, 0.9]) assert.ok(Math.abs(read(v, one.brightness, one.contrast) - point(read(v, 20, 0))) < 1e-9);
});
