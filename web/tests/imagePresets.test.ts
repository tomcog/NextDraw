// Image presets keep how an image is drawn without its picture, and put those settings on another
// one: what photoData writes, less the picture, has to come back through photoFromData as it went.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoData, photoFromData, type Photo } from "../src/shared/lib/drawing/photo";

const picture = { src: "data:image/jpeg;base64,AAAA", width: 400, height: 300 };

const drawn: Photo = {
  ...picture,
  source: "/Users/tom/Pictures/old.jpg", quarterTurns: 1, crop: [0.1, 0, 0.9, 1], fit: "fit", margin: 0.5,
  brightness: 12, contrast: -8, saturation: 20, angle: 30, spacingMm: 0.4, levels: 5,
  anglePreset: "complementary", angleTurn: 15, hatchSmoothMm: 0.6, hatchShortestMm: 1.2,
  style: "squiggle", rowMm: 2.5, waveMm: 1.2, squiggleAmpMm: 1.1, squiggleJoin: true, squiggleLift: true,
  squiggleSmooth: 1.5, squiggleAngle: 10, squiggleVersion: "inkscape", squiggleInkscape: { rows: 60 },
  band: [0.2, 0.6], bleed: 0.05, offsetMm: [0.5, -0.25], group: "g1", link: "l1",
  edgeGen: undefined, edgeMaskInvert: undefined,
};

test("a preset's settings come back the same on another picture", () => {
  const { src: _s, width: _w, height: _h, source: _src, quarter_turns: _q, crop: _c, fit: _f, margin: _m, ...settings } = photoData(drawn) as Record<string, unknown>;
  const other = { src: "data:image/png;base64,BBBB", width: 900, height: 1200 };
  const back = photoFromData({ ...settings, ...other })!;
  assert.ok(back);
  assert.equal(back.src, other.src);
  assert.equal(back.width, 900);
  // None of the old picture's own: its file, turn and crop stay with it.
  assert.equal(back.source, undefined);
  assert.equal(back.quarterTurns, undefined);
  assert.equal(back.crop, undefined);
  // Every setting as it was.
  const same = (p: Photo) => {
    const { src: _1, width: _2, height: _3, source: _4, quarterTurns: _5, crop: _6, fit: _7, margin: _8, edgeGen: _9, edgeMaskInvert: _10, ...rest } = p;
    return rest;
  };
  assert.deepEqual(same(back), same(drawn));
});
