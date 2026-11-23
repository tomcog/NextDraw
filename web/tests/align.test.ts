// The live alignment buttons: pressing one moves the artwork to that corner of the live area, at
// the size it already is (alignOnPage). Fit and Fill, which also scale, are placeOnPaper's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignOnPage } from "../src/shared/lib/drawing/whole";
import { marginsAll } from "../src/shared/lib/geometry";
import type { Shape } from "../src/shared/lib/drawing/shapes";

// A 2 × 1 in box sitting near the top left of an 8 × 10 in artboard.
const art = (x: number, y: number): Shape[] => [{ id: "r", kind: "rect", x, y, x2: x + 2, y2: y + 1, layerId: "a" }];
const board = { w: 8, h: 10 };
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test("align: centered leaves it in the middle of the live area", () => {
  const by = alignOnPage(art(0, 0), board, marginsAll(1), { x: 0.5, y: 0.5 })!;
  // Live area 6 × 8 from (1, 1): a 2 × 1 box centres at x 1 + (6-2)/2 = 3, y 1 + (8-1)/2 = 4.5.
  near(by.x, 3, "x");
  near(by.y, 4.5, "y");
});

test("align: top left puts it against the margins, wherever it was", () => {
  for (const [x, y] of [[0, 0], [5, 7], [-3, 2]]) {
    const by = alignOnPage(art(x, y), board, marginsAll(1), { x: 0, y: 0 })!;
    near(x + by.x, 1, "left edge");
    near(y + by.y, 1, "top edge");
  }
});

test("align: bottom right puts the far edges on the far margins", () => {
  const by = alignOnPage(art(0, 0), board, marginsAll(1), { x: 1, y: 1 })!;
  near(by.x + 2, 7, "right edge"); // 8 - 1
  near(by.y + 1, 9, "bottom edge"); // 10 - 1
});

test("align: margins of their own, not one all round", () => {
  const by = alignOnPage(art(0, 0), board, { top: 0.5, right: 1, bottom: 2, left: 3 }, { x: 0, y: 1 })!;
  near(by.x, 3, "against the left margin");
  near(by.y + 1, 8, "against the bottom margin"); // 10 - 2
});

test("align: artwork larger than the live area still lands, hanging past it - a bleed", () => {
  const wide: Shape[] = [{ id: "r", kind: "rect", x: 0, y: 0, x2: 10, y2: 12, layerId: "a" }];
  const by = alignOnPage(wide, board, marginsAll(1), { x: 0.5, y: 0.5 })!;
  // 10 wide in 6 of room: it hangs 2 past each margin, centred - nothing is clipped or refused.
  near(by.x, 1 + (6 - 10) / 2, "x");
  near(by.y, 1 + (8 - 12) / 2, "y");
});

test("align: a live area with nothing left of it places nothing", () => {
  assert.equal(alignOnPage(art(0, 0), board, { top: 5, right: 0, bottom: 6, left: 0 }, { x: 0, y: 0 }), null);
  assert.equal(alignOnPage([], board, marginsAll(0), { x: 0, y: 0 }), null);
});
