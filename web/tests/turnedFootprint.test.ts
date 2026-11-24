// The artboard turned a quarter on the sheet: Plot asks whether a piece that doesn't fit as it lies
// would fit turned, and the answer has to match what the server does to the document when it plots
// at a rotation (rotate_document: a point (x, y) in the page lands at (pageH - y, x)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsOnBed, fitsOnPaper, turnedFootprint, type Footprint } from "../src/shared/lib/geometry";
import type { PlotterModel, Settings } from "../src/shared/lib/types";

// A 4 × 10 in page at (2, 1) on the bed, its lines an inch in from the top left and 2 × 6 in.
const fp: Footprint = {
  rotated: false,
  x: 2,
  y: 1,
  w: 4,
  h: 10,
  pad: { x: 0, y: 0 },
  ink: { x0: 3, y0: 2, x1: 5, y1: 8 },
};

test("the page's width and height swap, and the lines turn with them", () => {
  const t = turnedFootprint(fp);
  assert.equal(t.w, 10);
  assert.equal(t.h, 4);
  assert.equal(t.rotated, true);
  // The lines' box, in the page's own terms, was x 1..3 and y 1..7 of a 4 × 10 page. Turned
  // clockwise it is x 10-7..10-1 = 3..9 and y 1..3 of a 10 × 4 page, at the same corner (2, 1).
  assert.deepEqual(t.ink, { x0: 5, y0: 2, x1: 11, y1: 4 });
});

test("turning it twice is the page the same shape, with its lines half turned inside it", () => {
  // Two quarter turns are a half turn, which the server takes back to the page's own corner: the
  // page measures what it did, and the lines sit where a 180 degree turn leaves them - not where
  // they started, unless they happened to be centred.
  const back = turnedFootprint(turnedFootprint(fp));
  assert.deepEqual([back.w, back.h], [fp.w, fp.h]);
  assert.deepEqual(back.ink, { x0: 3, y0: 4, x1: 5, y1: 10 });
  assert.equal(back.rotated, fp.rotated);
  // Four of them is the page and its lines back as they were.
  assert.deepEqual(turnedFootprint(turnedFootprint(back)).ink, fp.ink);
});

test("a tall piece that doesn't fit a wide bed or sheet fits turned", () => {
  const model = { travel_in: [12, 6] } as PlotterModel;
  const paper: Settings = { paper_x: 25.4, paper_y: 25.4, paper_w: 11 * 25.4, paper_h: 5 * 25.4 } as Settings;
  assert.equal(fitsOnBed(fp, model), false); // its lines reach 8 in down a 6 in bed
  assert.equal(fitsOnPaper(fp, paper), false);
  const t = turnedFootprint(fp);
  assert.equal(fitsOnBed(t, model), true);
  assert.equal(fitsOnPaper(t, paper), true);
});
