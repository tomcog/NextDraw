import { test } from "node:test";
import assert from "node:assert/strict";
import { inkAtOf, inkSetOf, onePlate, photoData, photoFromData, type InkSet, type Photo } from "../src/shared/lib/drawing/photo";

const base: Photo = {
  src: "data:image/png;base64,AA", width: 10, height: 10,
  brightness: 0, contrast: 0, angle: 45, spacingMm: 0.5, levels: 4,
};
const CMYK_PENS = ["#0093d0", "#d6007a", "#ffe500", "#231f20"];
const back = (p: Photo) => photoFromData(photoData(p) as Record<string, unknown>)!;

test("ink sets: a drawing made before ink sets still knows which ink each layer is", () => {
  // What a CMYK drawing saved before today looks like: a plate letter and the set's pens, no ink_at.
  const old = photoFromData({
    ...(photoData(base) as Record<string, unknown>), plate: "y", plates: CMYK_PENS,
  })!;
  assert.equal(old.plate, "y");
  assert.equal(old.inkAt, undefined, "an old drawing has no ink_at to read");
  assert.ok(onePlate(old), "it is still one ink of a set");
  assert.equal(inkAtOf(old), 2, "yellow is the third of CMYK, worked out from its letter");
  assert.equal(inkSetOf(old).key, "cmyk", "four pens means print's four");
  assert.equal(inkSetOf(old).inks[2].name, "Yellow");
});

test("ink sets: an extended set is still known by how many pens it has", () => {
  const seven = photoFromData({
    ...(photoData(base) as Record<string, unknown>), plate: "v", plates: [...CMYK_PENS, "#ff6a13", "#00a650", "#5b2c8f"],
  })!;
  assert.equal(inkSetOf(seven).key, "cmykogv");
  assert.equal(inkAtOf(seven), 6, "violet is the seventh of CMYK + OGV");
});

test("ink sets: a set of your own is kept with the drawing and read back whole", () => {
  const own: InkSet = {
    key: "own:My inks", label: "My inks", own: true,
    inks: [
      { name: "Red", color: "#e4002b", angle: 15 },
      { name: "Black", color: "#231f20", angle: 45 },
      { name: "Pink", color: "#f984ca", angle: 75 },
      { name: "Lime Green", color: "#9acd32", angle: 0 },
    ],
  };
  const layer: Photo = { ...base, inkSet: own, inkAt: 3, plates: own.inks.map((i) => i.color), ink: "#9acd32" };
  const read = back(layer);
  assert.deepEqual(read.inkSet, own, "the whole set travels with the drawing");
  assert.equal(read.inkAt, 3);
  assert.equal(read.plate, undefined, "a set of your own has no plate letter");
  assert.ok(onePlate(read), "it is still one ink of a set");
  assert.equal(inkAtOf(read), 3);
  assert.equal(inkSetOf(read).label, "My inks", "not read as CMYK just because it has four inks");
  assert.equal(inkSetOf(read).inks[3].name, "Lime Green");
});

test("ink sets: a built-in split still writes its plate letter, so an older build can open it", () => {
  const plate: Photo = { ...base, plate: "m", inkAt: 1, plates: CMYK_PENS, ink: "#d6007a" };
  const data = photoData(plate) as Record<string, unknown>;
  assert.equal(data.plate, "m", "the letter is still written");
  assert.equal(data.ink_at, 1);
  assert.deepEqual(data.plates, CMYK_PENS);
});

test("ink sets: a set that is nonsense in the file is refused, not half-read", () => {
  const bad = (set: unknown) => photoFromData({ ...(photoData(base) as Record<string, unknown>), ink_at: 0, ink_set: set })!.inkSet;
  assert.equal(bad({ label: "No inks", inks: [] }), undefined, "a set with no inks");
  assert.equal(bad({ label: "One ink", inks: [{ name: "Red", color: "#e4002b" }] }), undefined, "a set of one ink");
  assert.equal(bad({ label: "Bad colour", inks: [{ name: "Red", color: "red" }, { name: "Black", color: "#231f20" }] }), undefined, "an ink with no real colour");
  assert.equal(bad("not a set at all"), undefined);
  // And a good one with a missing angle still reads, since 0 is a fair angle.
  const ok = bad({ label: "Two", inks: [{ name: "Red", color: "#e4002b" }, { name: "Black", color: "#231f20" }] });
  assert.equal(ok?.inks[0].angle, 0);
});
