// Typing a size into the Artwork section resizes the whole drawing to measure it (Tom, 2026-11-24).
//
// The section had no absolute size at all: the artwork could be scaled by a percent of whatever it
// happened to be, or fitted inside the margins, and neither says "make this 8 inches wide". The
// field divides the typed length by what the artwork measures now and hands that over as a percent,
// so this walks the arithmetic the two meet on: scale, then measure, and get back what was asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnBox, drawnMiddle, reshapeDrawing } from "../src/shared/lib/drawing/whole";
import type { Shape } from "../src/shared/lib/drawing/shapes";

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
