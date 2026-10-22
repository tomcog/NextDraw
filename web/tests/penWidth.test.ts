// One line width for a pen in every app: its own, or the same fallback everywhere for a tip that
// hasn't been measured (Faber-Castell Pitt Sturdy showed 1.41 mm in Plot, 0.7 in Studio and 0.5 in Image).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PEN_WIDTH_FALLBACK_MM, penWidthOf } from "../src/shared/lib/constants";

test("pen width: a measured tip draws its own width", () => {
  assert.equal(penWidthOf({ settings: { pen_width: 1.41 } }), 1.41);
});

test("pen width: an unmeasured tip, or no pen, gets the one shared fallback", () => {
  for (const tool of [{ settings: {} }, { settings: { pen_width: 0 } }, {}, null, undefined]) {
    assert.equal(penWidthOf(tool), PEN_WIDTH_FALLBACK_MM);
  }
});
