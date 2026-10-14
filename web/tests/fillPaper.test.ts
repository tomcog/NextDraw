// Fill: the picture covers the paper inside the margin, cropped on the sides that don't fit - keeping
// its middle, or the edge the alignment names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeOnPage } from "../src/shared/lib/drawing/photo";

const page = { w: 11, h: 8.5 };

test("fill covers the paper inside the margin", () => {
  const placed = placeOnPage(1, page, "fill", 0.5);
  assert.deepEqual([placed.x, placed.y, placed.x2, placed.y2], [0.5, 0.5, 10.5, 8]);
});

test("a square picture on landscape paper loses top and bottom, evenly when centered", () => {
  const [, y0, , y1] = placeOnPage(1, page, "fill", 0.5).crop!;
  const kept = 7.5 / 10; // the area's height over its width: the share of the square that shows
  assert.ok(Math.abs(y1 - y0 - kept) < 1e-9);
  assert.ok(Math.abs(y0 - (1 - kept) / 2) < 1e-9);
});

test("aligned to an edge, that edge of the picture is kept", () => {
  assert.equal(placeOnPage(1, page, "fill", 0.5, { x: 0.5, y: 0 }).crop![1], 0);
  assert.ok(Math.abs(placeOnPage(1, page, "fill", 0.5, { x: 0.5, y: 1 }).crop![3] - 1) < 1e-9);
  assert.equal(placeOnPage(4, page, "fill", 0.5, { x: 0, y: 0.5 }).crop![0], 0);
});
