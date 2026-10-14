// Hatching's angle presets: each plate at its angle, whether it came from a CMYK split or from
// separations made elsewhere, which know their plate only by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plateOfPhoto, presetAngle, type Plate } from "../src/shared/lib/drawing/photo";

test("complementary: CMYK as classic, each extra ink on its opposite's angle", () => {
  const at = (plate: Plate) => presetAngle("complementary", 0, plate);
  assert.deepEqual(["c", "m", "y", "k"].map((p) => at(p as Plate)), ["c", "m", "y", "k"].map((p) => presetAngle("classic", 0, p as Plate)));
  assert.equal(at("o"), at("c"));
  assert.equal(at("g"), at("m"));
  assert.equal(at("v"), at("y"));
  // Red keeps its own: orange already has cyan's angle, and the two print side by side.
  assert.equal(at("r"), presetAngle("classic", 0, "r"));
  // Layers that aren't plates spread as classic's do.
  assert.equal(presetAngle("complementary", 2), presetAngle("classic", 2));
});

test("a separation's plate is read from its name, so presets put it at its plate's angle", () => {
  assert.equal(plateOfPhoto({ separation: "Violet" }), "v");
  assert.equal(plateOfPhoto({ separation: "Cyan" }), "c");
  assert.equal(plateOfPhoto({ separation: "Peach" }), undefined);
  assert.equal(plateOfPhoto({ plate: "m" }), "m");
});
