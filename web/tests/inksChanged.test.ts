import { test } from "node:test";
import assert from "node:assert/strict";
import { inksAreTheSet, PLATE_OFF, platePens, PLATES, type InkSet, type Photo } from "../src/shared/lib/drawing/photo";

const ENERGEL = [
  { name: "Black", color: "#231f20" }, { name: "Navy Blue", color: "#2c496c" }, { name: "Blue", color: "#4b72c8" },
  { name: "Violet", color: "#8443c5" }, { name: "Magenta", color: "#b721b9" }, { name: "Gray", color: "#838b8e" },
  { name: "Sky Blue", color: "#21a4de" }, { name: "Pink", color: "#f03295" }, { name: "Orange", color: "#fe824e" },
  { name: "Lime Green", color: "#4cc25f" }, { name: "Yellow", color: "#f3e42b" },
];
const base: Photo = {
  src: "data:image/png;base64,AA", width: 10, height: 10,
  brightness: 0, contrast: 0, angle: 45, spacingMm: 0.5, levels: 4, penMm: 0.5,
};
/** The pens CMYK would choose from this palette for this photo's hatching. */
const cmyk = platePens(ENERGEL, PLATES, { penMm: 0.5, spacingMm: 0.5, levels: 4 }).map((p) => p!.color);

test("modified: a split left alone is still its set's", () => {
  const photo: Photo = { ...base, plate: "c", inkAt: 0, plates: cmyk, ink: cmyk[0] };
  assert.ok(inksAreTheSet(photo, ENERGEL), `should match: ${cmyk.join(" ")}`);
});

test("modified: one pen changed by hand is not", () => {
  const changed = [...cmyk];
  changed[0] = "#8443c5"; // cyan's plate drawn in Violet, as happens in the Layers card
  const photo: Photo = { ...base, plate: "c", inkAt: 0, plates: changed, ink: changed[0] };
  assert.ok(!inksAreTheSet(photo, ENERGEL), "a changed pen should show as modified");
});

test("modified: a plate turned off is not a change of ink", () => {
  // Silencing a plate leaves the set the set: it is still CMYK, with one of it not drawn.
  const off = [...cmyk];
  off[1] = PLATE_OFF;
  const photo: Photo = { ...base, plate: "c", inkAt: 0, plates: off, ink: off[0] };
  assert.ok(inksAreTheSet(photo, ENERGEL), "an off plate should not read as modified");
});

test("modified: a set of your own is judged against its own inks, not the palette", () => {
  const own: InkSet = {
    key: "own:Mine", label: "Mine", own: true,
    inks: [
      { name: "Red", color: "#d74a63", angle: 15 },
      { name: "Black", color: "#231f20", angle: 45 },
      { name: "Pink", color: "#f03295", angle: 75 },
    ],
  };
  const kept: Photo = { ...base, inkSet: own, inkAt: 0, plates: own.inks.map((i) => i.color), ink: own.inks[0].color };
  assert.ok(inksAreTheSet(kept, ENERGEL), "its own inks, unchanged");
  const moved: Photo = { ...kept, plates: ["#4cc25f", ...own.inks.slice(1).map((i) => i.color)] };
  assert.ok(!inksAreTheSet(moved, ENERGEL), "one swapped for Lime Green is modified");
});

test("modified: a photo that isn't separated into inks at all says nothing", () => {
  assert.ok(inksAreTheSet(base, ENERGEL), "no plates, nothing to be modified from");
});
