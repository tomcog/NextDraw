// Typing a size into the Artwork section resizes the whole drawing to measure it (Tom, 2026-11-24).
//
// The section had no absolute size at all: the artwork could be scaled by a percent of whatever it
// happened to be, or fitted inside the margins, and neither says "make this 8 inches wide". The
// field divides the typed length by what the artwork measures now and hands that over as a percent,
// so this walks the arithmetic the two meet on: scale, then measure, and get back what was asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnBox, drawnMiddle, reshapeDrawing } from "../src/shared/lib/drawing/whole";
import { boxOf, type Shape } from "../src/shared/lib/drawing/shapes";

const line = (x: number, y: number, x2: number, y2: number): Shape =>
  ({ id: `l${x}${y}${x2}`, layerId: "a", kind: "line", x, y, x2, y2 });

/** What the field does: the percent it hands to onScale, then what Studio does with it. */
const sizeTo = (shapes: Shape[], mm: number, axis: "w" | "h") => {
  const box = drawnBox(shapes);
  const now = axis === "w" ? box.x1 - box.x0 : box.y1 - box.y0;
  const percent = (mm / now) * 100;
  return reshapeDrawing(shapes, percent / 100, drawnMiddle(shapes));
};

const measure = (shapes: Shape[]) => {
  const b = drawnBox(shapes);
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("typing a width makes the artwork that wide", () => {
  const art = [line(2, 2, 8, 6)]; // 6 x 4
  const { w } = measure(sizeTo(art, 12, "w"));
  assert.ok(near(w, 12), `width ${w}`);
});

test("and the height follows in proportion", () => {
  const art = [line(2, 2, 8, 6)]; // 6 x 4, so doubling the width doubles the height
  const { w, h } = measure(sizeTo(art, 12, "w"));
  assert.ok(near(w / h, 6 / 4), `ratio ${w / h}`);
  assert.ok(near(h, 8), `height ${h}`);
});

test("typing a height works the same way round", () => {
  const art = [line(2, 2, 8, 6)];
  const { w, h } = measure(sizeTo(art, 2, "h"));
  assert.ok(near(h, 2), `height ${h}`);
  assert.ok(near(w, 3), `width ${w}`);
});

test("shrinking is the same arithmetic", () => {
  const art = [line(0, 0, 10, 5)];
  const { w, h } = measure(sizeTo(art, 1, "w"));
  assert.ok(near(w, 1) && near(h, 0.5), `${w} x ${h}`);
});

test("the artwork keeps its middle, so it grows where it stands", () => {
  const art = [line(2, 2, 8, 6)];
  const before = drawnMiddle(art);
  const after = drawnMiddle(sizeTo(art, 12, "w"));
  assert.ok(near(before.x, after.x) && near(before.y, after.y), `${after.x}, ${after.y}`);
});

test("a drawing of several shapes is resized as one", () => {
  // Two shapes apart from each other: the gap scales with them, so the whole measures what's asked.
  const art = [line(0, 0, 2, 2), line(8, 6, 10, 8)]; // 10 x 8 together
  const out = sizeTo(art, 5, "w");
  const { w, h } = measure(out);
  assert.ok(near(w, 5) && near(h, 4), `${w} x ${h}`);
});

test("asking for the size it already is changes nothing", () => {
  const art = [line(2, 2, 8, 6)];
  const { w, h } = measure(sizeTo(art, 6, "w"));
  assert.ok(near(w, 6) && near(h, 4), `${w} x ${h}`);
});

// Image sizes the chosen picture rather than everything drawn: Fit, Fill, Scale and the alignment
// in that section all act on the picture, so its box is the one the fields show and move. Studio's
// reads the whole drawing, because there the two are the same thing.

const picture = (x: number, y: number, x2: number, y2: number): Shape =>
  ({ id: "p", layerId: "a", kind: "photo", x, y, x2, y2, photo: { src: "x", inkAt: {} } } as unknown as Shape);

/** What Image's field does: a percent from the picture's own box, then what scalePhoto does with it. */
const pictureTo = (sh: Shape, mm: number, axis: "w" | "h") => {
  const b = boxOf(sh);
  const now = axis === "w" ? b.x1 - b.x0 : b.y1 - b.y0;
  const k = mm / now;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const at = (v: number, c: number) => c + (v - c) * k;
  return { ...sh, x: at(sh.x, cx), y: at(sh.y, cy), x2: at(sh.x2, cx), y2: at(sh.y2, cy) };
};

test("Image: typing a width resizes the picture to it", () => {
  const out = pictureTo(picture(1, 1, 7, 5), 3, "w"); // 6 x 4 to 3 wide
  const b = boxOf(out);
  assert.ok(near(b.x1 - b.x0, 3), `width ${b.x1 - b.x0}`);
});

test("Image: the height follows in proportion", () => {
  const out = pictureTo(picture(1, 1, 7, 5), 3, "w");
  const b = boxOf(out);
  assert.ok(near(b.y1 - b.y0, 2), `height ${b.y1 - b.y0}`);
});

test("Image: the picture keeps its middle", () => {
  const before = boxOf(picture(1, 1, 7, 5));
  const after = boxOf(pictureTo(picture(1, 1, 7, 5), 3, "w"));
  assert.ok(near((before.x0 + before.x1) / 2, (after.x0 + after.x1) / 2));
  assert.ok(near((before.y0 + before.y1) / 2, (after.y0 + after.y1) / 2));
});

test("Image: a picture drawn corner-to-corner either way measures the same", () => {
  // boxOf sorts the corners, so a picture placed bottom-right to top-left is still 6 x 4.
  const flipped = boxOf(picture(7, 5, 1, 1));
  assert.ok(near(flipped.x1 - flipped.x0, 6) && near(flipped.y1 - flipped.y0, 4));
});
