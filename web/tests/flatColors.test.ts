import { test } from "node:test";
import assert from "node:assert/strict";
import { colourGroups, FLAT_ENOUGH, flatColours, readTones } from "../src/shared/lib/drawing/photo";

// A made-up picture, read without a browser, its color at each pixel from `rgb(x, y)`.
const W = 300;
const H = 300;
async function picture(src: string, rgb: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...rgb(x, y), 255], (y * W + x) * 4);
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}

const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const of = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
const far = (a: string, b: string) => Math.max(...[0, 1, 2].map((i) => Math.abs(of(a)[i] - of(b)[i])));
/** The one of `found` nearest this color, and how far off it is, per channel. */
const nearest = (found: string[], want: [number, number, number]) =>
  found.map((f) => far(f, hex(want))).reduce((a, b) => Math.min(a, b), 255);

// A poster: five flat colors, each smeared a level or two the way a resaved picture comes back, and
// one-pixel blended borders between areas - the colors that belong to neither side.
const BLUE: [number, number, number] = [1, 104, 186];
const NAVY: [number, number, number] = [11, 56, 112];
const CREAM: [number, number, number] = [253, 233, 203];
const GOLD: [number, number, number] = [253, 179, 46];
const RED: [number, number, number] = [236, 67, 27];
const FLATS = [BLUE, NAVY, CREAM, GOLD, RED];

/** Which of the five areas a point is in: bands, with a disc of gold over them. */
const area = (x: number, y: number) =>
  Math.hypot(x - 150, y - 150) < 55 ? 3 : y < 90 ? 0 : y < 150 ? 1 : y < 210 ? 2 : x < 150 ? 0 : 4;

// The smear a resaved picture comes back with: a level or two, and blocky - compression works in
// blocks, so neighbours inside one match and only the seams between them differ.
const noise = (x: number, y: number) => ((((x >> 3) * 73856093) ^ ((y >> 3) * 19349663)) % 5) - 2;

const poster = (x: number, y: number): [number, number, number] => {
  const here = area(x, y);
  // A border pixel: its neighbours aren't all the same area, so it's the blend of the two sides.
  const round = [area(x - 1, y), area(x + 1, y), area(x, y - 1), area(x, y + 1)];
  const other = round.find((a) => a !== here);
  if (other !== undefined) return [0, 1, 2].map((i) => (FLATS[here][i] + FLATS[other][i]) / 2) as [number, number, number];
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, FLATS[here][i] + noise(x + i, y)))) as [number, number, number];
};

test("flat colors: the picture's own colors, read not guessed, with its own count", async () => {
  await picture("data:poster", poster);
  const { colours, share, covered } = flatColours("data:poster", 10, 0, 0);


  assert.equal(colours.length, 5, `expected the picture's five colors, got ${colours.join(" ")}`);
  // Each flat color is found within a couple of levels - the smear it was read through.
  for (const want of FLATS) {
    assert.ok(nearest(colours, want) <= 4, `${hex(want)} not among ${colours.join(" ")}`);
  }
  // Lightest first, as every color list here is ordered.
  const light = colours.map((c) => of(c).reduce((a, b) => a + b, 0));
  assert.deepEqual(light, [...light].sort((a, b) => b - a), `not lightest first: ${colours.join(" ")}`);
  assert.ok(share > 0.8, `most of this picture is flat areas, got ${share}`);
  assert.ok(covered > 0.95, `the colors found should account for the flat area, got ${covered}`);
});

test("flat colors: the blue and the navy stay apart, and no border blend takes a pen", async () => {
  await picture("data:poster", poster);
  const flat = flatColours("data:poster", 10, 0, 0).colours;
  // Both blues are there in their own right.
  assert.ok(nearest(flat, BLUE) <= 4 && nearest(flat, NAVY) <= 4, `blues lost: ${flat.join(" ")}`);
  // And nothing found is a blend of two of the flats rather than one of them.
  for (const found of flat) {
    assert.ok(FLATS.some((f) => far(found, hex(f)) <= 4), `${found} is in no area of the picture`);
  }

  // What gathering a scattering of pixels into five groups does with the same picture: this is the
  // reason the Flat mode reads the picture instead. If this ever stops being true, Flat is no longer
  // earning its place - but while it is, the two must not give the same answer.
  const guessed = colourGroups("data:poster", 5, 0, 0);
  const missed = FLATS.filter((f) => nearest(guessed, f) > 4);
  assert.ok(missed.length > 0, `colourGroups found every flat color: ${guessed.join(" ")}`);
});

test("flat colors: paper is not a color to draw, and a photo says it isn't flat", async () => {
  // The same poster on white: the white is paper and gets no pen, the five colors still do.
  await picture("data:onwhite", (x, y) => (x < 60 || y < 60 ? [255, 255, 255] : poster(x, y)));
  const onWhite = flatColours("data:onwhite", 10, 0, 0).colours;
  assert.ok(!onWhite.some((c) => far(c, "#ffffff") <= 6), `the paper took a pen: ${onWhite.join(" ")}`);

  // A photo: shading everywhere and a border nowhere. Nearly all of it counts as flat - it changes by
  // less than a level from pixel to pixel - so what gives it away is that its colors are slices of the
  // ramp, each with a little area, accounting for nothing like the whole.
  await picture("data:gradient", (x, y) => [(x * 255) / W, (y * 255) / H, 128]);
  const ramp = flatColours("data:gradient", 10, 0, 0);
  assert.ok(ramp.covered < FLAT_ENOUGH, `a gradient should not read as flat color, covered ${ramp.covered}`);
  assert.equal(ramp.colours.length, 10, "a ramp fills the cap: it has no colors of its own to find");
});

test("flat colors: flattened to a number asked for, by joining the nearest", async () => {
  await picture("data:poster", poster);
  // Down to three. Which of the three each of the picture's five colors ends up in says it exactly,
  // without leaning on how far apart two colors "should" be: the nearest pair joins first, so the two
  // blues become one and the gold and the red become one, and every area still belongs somewhere -
  // nothing is dropped to no color at all.
  const three = flatColours("data:poster", 10, 0, 0, 0, 3).colours;
  assert.equal(three.length, 3, `expected three, got ${three.join(" ")}`);
  const into = (want: [number, number, number]) =>
    three.indexOf(three.reduce((best, c) => (far(c, hex(want)) < far(best, hex(want)) ? c : best)));
  assert.equal(into(BLUE), into(NAVY), `the two blues should have joined: ${three.join(" ")}`);
  assert.equal(into(GOLD), into(RED), `the gold and the red should have joined: ${three.join(" ")}`);
  assert.equal(new Set([into(BLUE), into(GOLD), into(CREAM)]).size, 3, `three colors, three groups: ${three.join(" ")}`);
  // The cream is far from everything else, so it comes through as itself.
  assert.ok(nearest(three, CREAM) <= 6, `the cream should survive at three: ${three.join(" ")}`);

  // One: every color joined into one, somewhere among them.
  assert.equal(flatColours("data:poster", 10, 0, 0, 0, 1).colours.length, 1);
  // Asking for more than the effect allows is held to it.
  assert.ok(flatColours("data:poster", 4, 0, 0, 0, 9).colours.length <= 4);
  // Asking for its own number gives its own colors back.
  const five = flatColours("data:poster", 10, 0, 0, 0, 5).colours;
  for (const want of FLATS) assert.ok(nearest(five, want) <= 6, `${hex(want)} lost at five: ${five.join(" ")}`);
});
