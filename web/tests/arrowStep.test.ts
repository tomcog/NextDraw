import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowStep } from "../src/shared/lib/format";

const up = { key: "ArrowUp", shiftKey: false };
const down = { key: "ArrowDown", shiftKey: false };
const shiftUp = { key: "ArrowUp", shiftKey: true };

test("arrow keys: the step scales to the field's range, a fiftieth rounded down, at most one unit", () => {
  assert.equal(arrowStep(up, { min: 0, max: 20, step: 0.25 }), 0.1);
  assert.equal(arrowStep(down, { min: 0, max: 20, step: 0.25 }), -0.1);
  assert.equal(arrowStep(shiftUp, { min: 0, max: 20, step: 0.25 }), 1);
  assert.equal(arrowStep(up, { min: 0, max: 4, step: 0.25 }), 0.01);
  // A wide range still moves one unit, whatever coarser step the field has.
  assert.equal(arrowStep(up, { min: -180, max: 180, step: 15 }), 1);
  assert.equal(arrowStep(shiftUp, { min: 0, max: 100, step: 5 }), 10);
  // Whole numbers stay whole: a count of 0 to 3 moves by one.
  assert.equal(arrowStep(up, { min: 0, max: 3, step: 1 }), 1);
  // No range: one unit, as before.
  assert.equal(arrowStep(up), 1);
  assert.equal(arrowStep({ key: "a", shiftKey: false }), null);
});
