// Registration blocks as Studio makes them, against the drawing they were taken from: a block a
// layer, butted left to right in plotting order, each the same zigzag square.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parsePath } from "../src/shared/lib/drawing/path";
import type { Layer } from "../src/shared/lib/drawing/shapes";
import { isRegistrationBlock, registrationShapes } from "../src/studio/lib/registration";

const REFERENCE = `${process.env.HOME}/Desktop/registration blocks.svg`;
const LAYERS: Layer[] = [
  { id: "y", name: "Yellow", color: "#ffff00" },
  { id: "p", name: "Pink", color: "#ff53c8" },
  { id: "t", name: "Teal", color: "#00a6a6" },
  { id: "g", name: "Green", color: "#1e5f43" },
  { id: "v", name: "Varnish", color: "#e8e8e8" },
];

test("a block for each layer, left to right in plotting order, butted, from the corner given", () => {
  const made = registrationShapes(LAYERS, { x: 0.5, y: 8 });
  assert.deepEqual(made.map((s) => s.layerId), ["y", "p", "t", "g", "v"]);
  assert.ok(made.every(isRegistrationBlock));
  assert.ok(Math.abs(made[0].x - 0.5) < 1e-9 && Math.abs(made[0].y2 - 8) < 1e-9, "its bottom left at the corner");
  made.slice(1).forEach((s, i) => assert.ok(Math.abs(s.x - made[i].x2) < 1e-9, "each starts where the last ends"));
});

test("a hidden layer gets no block, and the next butts up against the last", () => {
  const made = registrationShapes(LAYERS.map((l) => (l.id === "p" ? { ...l, hidden: true } : l)), { x: 0.5, y: 8 });
  assert.deepEqual(made.map((s) => s.layerId), ["y", "t", "g", "v"]);
  made.slice(1).forEach((s, i) => assert.ok(Math.abs(s.x - made[i].x2) < 1e-9, "each starts where the last ends"));
});

test("each block is the drawing's: the same zigzag, the same size, turning where it turns", { skip: !existsSync(REFERENCE) }, () => {
  const ds = [...readFileSync(REFERENCE, "utf8").matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(ds.length, 4);
  // The drawing's first block, in inches, from its own top left; ours, from ours.
  const theirs = parsePath(ds[0])[0];
  const x0 = theirs[0].x, y0 = Math.min(...theirs.map((n) => n.y));
  const made = registrationShapes(LAYERS, { x: 0, y: 1 })[0];
  const ours = made.points!;
  assert.equal(ours.length, theirs.length);
  ours.forEach((n, i) => {
    const want = { x: (theirs[i].x - x0) / 72, y: (theirs[i].y - y0) / 72 };
    assert.ok(Math.abs(n.x - made.x - want.x) < 0.0005 && Math.abs(n.y - made.y - want.y) < 0.0005, `point ${i}: ${n.x - made.x}, ${n.y - made.y} against ${want.x}, ${want.y}`);
  });
});
