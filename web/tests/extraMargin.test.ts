// The Paper card's extra margin goes on one side: across from where the drawing is aligned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraMarginSide } from "../src/shared/lib/geometry";

test("extra margin: across from the alignment, one side only", () => {
  // Against one edge: the side across from it, whichever way the paper lies.
  for (const landscape of [true, false]) {
    assert.equal(extraMarginSide({ x: 0, y: 0.5 }, landscape), "right");
    assert.equal(extraMarginSide({ x: 1, y: 0.5 }, landscape), "left");
    assert.equal(extraMarginSide({ x: 0.5, y: 0 }, landscape), "bottom");
    assert.equal(extraMarginSide({ x: 0.5, y: 1 }, landscape), "top");
    // Centred both ways: the bottom, as before there were sides.
    assert.equal(extraMarginSide({ x: 0.5, y: 0.5 }, landscape), "bottom");
  }
  // Into a corner: landscape goes by left and right (a drawing turned on its side), portrait by top and bottom.
  assert.equal(extraMarginSide({ x: 0, y: 0 }, true), "right");
  assert.equal(extraMarginSide({ x: 0, y: 0 }, false), "bottom");
  assert.equal(extraMarginSide({ x: 1, y: 1 }, true), "left");
  assert.equal(extraMarginSide({ x: 1, y: 1 }, false), "top");
});
