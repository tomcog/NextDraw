// Crop artwork is only offered when it would take something away (Tom, 2026-11-24).
//
// The button used to be live whenever a drawing had any shapes at all, and cutToArtboard quietly
// returned without doing anything when nothing was outside - so clicking it looked like a no-op
// with no way to tell whether it had run. drawnOutside is what decides now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnOutside } from "../src/shared/lib/drawing/whole";
import { marginsAll } from "../src/shared/lib/geometry";
import type { Page, Shape } from "../src/shared/lib/drawing/shapes";

const artboard: Page = { w: 10, h: 10 };

const line = (x: number, y: number, x2: number, y2: number): Shape =>
  ({ id: `l${x}${y}`, layerId: "a", kind: "line", x, y, x2, y2 });

test("artwork well inside the margins has nothing to crop", () => {
  assert.equal(drawnOutside([line(2, 2, 8, 8)], artboard, marginsAll(1)), false);
});

test("artwork reaching past a margin has", () => {
  // Inside the artboard, but across the 1in margin at the right: the old check missed this entirely.
  assert.equal(drawnOutside([line(2, 2, 9.5, 8)], artboard, marginsAll(1)), true);
});

test("artwork reaching past the artboard itself has", () => {
  assert.equal(drawnOutside([line(2, 2, 12, 8)], artboard, marginsAll(0)), true);
});

test("a line exactly on the margin is inside", () => {
  assert.equal(drawnOutside([line(1, 1, 9, 9)], artboard, marginsAll(1)), false);
});

test("the same artwork flips as the margins grow round it", () => {
  const art = [line(2, 2, 8, 8)];
  assert.equal(drawnOutside(art, artboard, marginsAll(1)), false);
  assert.equal(drawnOutside(art, artboard, marginsAll(2.5)), true);
});

test("an empty drawing has nothing to crop", () => {
  assert.equal(drawnOutside([], artboard, marginsAll(0)), false);
});

test("margins wider than the artboard leave no live area, so nothing is offered", () => {
  // Cropping to a box with no inside would delete the whole drawing; the button stays off.
  assert.equal(drawnOutside([line(2, 2, 8, 8)], artboard, marginsAll(6)), false);
});

test("a turned shape is judged by where it really reaches, not by its upright box", () => {
  // A live area 8 wide and 2 tall, and a 6 x 0.2 bar lying across it. Upright it is well inside;
  // stood on end by a quarter turn it is 6 tall in a 2in band, so most of it is outside. The shape's
  // stored box is the same either way, which is why this is read from the geometry.
  const wide = { top: 4, right: 1, bottom: 4, left: 1 };
  const bar = { id: "b", layerId: "a", kind: "rect" as const, x: 2, y: 4.9, x2: 8, y2: 5.1 };
  assert.equal(drawnOutside([bar], artboard, wide), false);
  assert.equal(drawnOutside([{ ...bar, rotation: 90 }], artboard, wide), true);
});
