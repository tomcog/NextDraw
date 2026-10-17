// The signature and the registration blocks keep off the drawing: they go in their corner when it's
// clear, else straight down into the margin until they are, else as low as they go with a warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearSpot, inkMapOf } from "../src/studio/lib/clearSpot";

const PAGE = { w: 8, h: 10 } as Parameters<typeof clearSpot>[1];
const PER_IN = 40;
const SIZE = { w: 1, h: 0.25 };

/** A map with ink in each box given, in inches. */
function mapWith(...boxes: [number, number, number, number][]) {
  const cols = PAGE.w * PER_IN;
  const rows = PAGE.h * PER_IN;
  const cells = new Uint8Array(cols * rows);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let r = Math.floor(y0 * PER_IN); r < Math.ceil(y1 * PER_IN); r++)
      for (let c = Math.floor(x0 * PER_IN); c < Math.ceil(x1 * PER_IN); c++) cells[r * cols + c] = 1;
  }
  return inkMapOf(cells, cols, rows, PER_IN);
}

test("an empty page leaves each in its own corner", () => {
  const map = mapWith();
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "bl"), { at: { x: 0.5, y: 9.25 }, clear: true });
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "br"), { at: { x: 6.5, y: 9.25 }, clear: true });
});

test("a drawing reaching the corner moves it straight down into the margin until it's clear", () => {
  const map = mapWith([0.5, 1, 7.5, 9.5]); // art right to the margin's edge
  const { at, clear } = clearSpot(map, PAGE, 0.5, SIZE, "bl");
  assert.ok(clear);
  assert.equal(at.x, 0.5, "same column");
  assert.ok(at.y >= 9.5 + 2 / 25.4 - 1e-9, `below the art with room, at ${at.y}`);
  assert.ok(at.y + SIZE.h <= PAGE.h + 1e-9, "still on the page");
  assert.ok(at.y < 9.5 + 2 / 25.4 + 0.06, "no further down than it needs");
});

test("a drawing to the page edge leaves it as low as it goes, said not to be clear", () => {
  const map = mapWith([0, 0, 8, 10]);
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "br"), { at: { x: 6.5, y: 9.75 }, clear: false });
});

test("ink in the middle of the page doesn't move it", () => {
  const map = mapWith([2, 2, 6, 8]);
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "br"), { at: { x: 6.5, y: 9.25 }, clear: true });
});
