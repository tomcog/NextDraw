// Room round the artwork: the margin that grows the ARTBOARD instead of shrinking the artwork
// (Tom, 2026-11-24). A one-shot - the artboard is set once and the two are independent again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomRound } from "../src/shared/lib/drawing/whole";
import { marginsAll } from "../src/shared/lib/geometry";

test("an inch all round a 10 x 10 artwork makes a 12 x 12 artboard", () => {
  const { artboard, by } = roomRound({ x0: 0, y0: 0, x1: 10, y1: 10 }, marginsAll(1));
  assert.deepEqual(artboard, { w: 12, h: 12 });
  assert.deepEqual(by, { x: 1, y: 1 }); // the artwork moves in by the margin
});

test("the artwork keeps its size wherever it was, and lands on the margin", () => {
  // The same artwork, 10 x 10, sitting off at (4, 7) - the move brings it to the margin, no scaling.
  const { artboard, by } = roomRound({ x0: 4, y0: 7, x1: 14, y1: 17 }, marginsAll(1));
  assert.deepEqual(artboard, { w: 12, h: 12 });
  assert.deepEqual(by, { x: -3, y: -6 });
});

test("a deeper foot is just a bigger bottom", () => {
  const { artboard, by } = roomRound({ x0: 0, y0: 0, x1: 10, y1: 10 }, { top: 1, right: 1, bottom: 2, left: 1 });
  assert.deepEqual(artboard, { w: 12, h: 13 });
  assert.deepEqual(by, { x: 1, y: 1 }); // the extra room is below the artwork, so it doesn't move it
});

test("no margin is the artboard trimmed to the artwork", () => {
  const { artboard, by } = roomRound({ x0: 2, y0: 2, x1: 12, y1: 9 }, marginsAll(0));
  assert.deepEqual(artboard, { w: 10, h: 7 });
  assert.deepEqual(by, { x: -2, y: -2 });
});
