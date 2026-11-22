import { test } from "node:test";
import assert from "node:assert/strict";
import { solveSeparation } from "../src/shared/lib/drawing/photo";

// A flat patch of one colour, separated into the given inks, as tone per ink (0 = no lines).
const W = 2;
const H = 2;
function split(plates: string[], rgb: [number, number, number], blackShare: number) {
  const pixels = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) pixels.set(rgb, i * 3);
  return solveSeparation({
    rgb: pixels, w: W, h: H, plates, brightness: 0, contrast: 0, blackShare,
    levels: 4, penMm: 0.5, spacingMm: 1,
  }).map((map) => map[0]);
}

const GREY: [number, number, number] = [128, 128, 128];
const CMYK = ["#00a3e0", "#d6007a", "#ffe500", "#231f20"];
// An ink set of a pen's own colours, with its black second rather than fourth.
const OWN = ["#e4002b", "#231f20", "#f984ca", "#9acd32"];
const [RED, BLACK, PINK, LIME] = [0, 1, 2, 3];

test("black generation: CMYK still gives its greys to the fourth ink", () => {
  const all = split(CMYK, GREY, 1);
  assert.ok(all[3] > 0, `the black plate should draw a grey: ${all.join(", ")}`);
  for (const plate of [0, 1, 2]) {
    assert.equal(all[plate], 0, `at all of the black share only black draws a grey: ${all.join(", ")}`);
  }
});

test("black generation: a set whose black isn't fourth gives its greys to the black", () => {
  const all = split(OWN, GREY, 1);
  assert.ok(all[BLACK] > 0, `the black should draw the grey: ${all.join(", ")}`);
  // The point of the fix: the fourth ink is lime, and a grey drawn in lime is lime.
  assert.equal(all[LIME], 0, `lime must not stand in for black: ${all.join(", ")}`);
  assert.equal(all[RED], 0, `red must not stand in for black: ${all.join(", ")}`);
  assert.equal(all[PINK], 0, `pink must not stand in for black: ${all.join(", ")}`);
});

test("black generation: a set with no black at all does none, and still draws", () => {
  // Nothing here is near enough to grey to stand for grey.
  const bright = ["#e4002b", "#00a3e0", "#f984ca", "#9acd32"];
  const all = split(bright, GREY, 1);
  assert.ok(all.some((tone) => tone > 0), `a grey should still be drawn somehow: ${all.join(", ")}`);
  // And a set with no black is unaffected by the black share, having no black to give anything to.
  assert.deepEqual(split(bright, GREY, 0), all, "the black share should do nothing without a black");
});

test("black generation: a higher share takes the greys out of the colours", () => {
  // What the share does is give the grey a colour shares with its neighbours to the black instead.
  // So what falls as it rises is the COLOUR ink. The black's own tone is not monotone and should not
  // be asserted to be: raising the share also moves what the darkest reachable black is, which
  // rescales the tones - a mid grey is black alone at every share, just at a lighter tone.
  const colours = (tones: number[]) => tones[0] + tones[1] + tones[2];
  for (const rgb of [[128, 128, 128], [90, 80, 60], [60, 110, 180]] as [number, number, number][]) {
    const [none, half, all] = [0, 0.5, 1].map((share) => split(CMYK, rgb, share));
    assert.ok(colours(half) <= colours(none) && colours(all) <= colours(half),
      `rgb(${rgb}) should give up colour as the black share rises: ${none.join(",")} / ${half.join(",")} / ${all.join(",")}`);
  }
});

test("black generation: a set whose black isn't fourth does the same for a colour", () => {
  // A dark olive has grey in it for the black to take over - in this set, the second ink.
  const olive: [number, number, number] = [90, 80, 60];
  const none = split(OWN, olive, 0);
  const all = split(OWN, olive, 1);
  assert.ok(all[BLACK] > 0, `the black should take the grey: ${all.join(", ")}`);
  const colours = (t: number[]) => t[RED] + t[PINK] + t[LIME];
  assert.ok(colours(all) <= colours(none), `the colours should give it up: ${none.join(",")} -> ${all.join(",")}`);
});
