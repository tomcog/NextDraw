// The signature and the registration blocks keep off the drawing: they go in their corner when it's
// clear, else the clear spot round the margin nearest it, else the corner with a warning.
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

test("a drawing over the corner moves it along to the nearest clear spot, with room to spare", () => {
  const map = mapWith([0, 8, 3, 10]);
  const { at, clear } = clearSpot(map, PAGE, 0.5, SIZE, "bl");
  assert.ok(clear);
  const off = (a: number, b: number) => a >= b;
  assert.ok(off(at.x, 3 + 2 / 25.4) || at.y + SIZE.h <= 8 - 2 / 25.4, `clear of the drawing, at ${JSON.stringify(at)}`);
  assert.ok(Math.hypot(at.x - 0.5, at.y - 9.25) < 3, "and near the corner it was meant for");
});

test("a drawing over every margin leaves it in the corner, said not to be clear", () => {
  const map = mapWith([0, 0, 8, 10]);
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "br"), { at: { x: 6.5, y: 9.25 }, clear: false });
});

test("ink in the middle of the page doesn't move it", () => {
  const map = mapWith([2, 2, 6, 8]);
  assert.deepEqual(clearSpot(map, PAGE, 0.5, SIZE, "br"), { at: { x: 6.5, y: 9.25 }, clear: true });
});
