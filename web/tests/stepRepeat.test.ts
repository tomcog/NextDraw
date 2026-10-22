// A step repeat: each copy the one before moved, scaled and turned. Where the copies land, that they
// survive a save, and that baking them and turning the page both leave the marks where they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import { placements, type StepRepeat } from "../src/shared/lib/drawing/repeat";
import { turnDrawingLeft } from "../src/shared/lib/drawing/whole";
import { bakedCopies, markRuns } from "../src/studio/lib/shapeEdits";
import type { Layer, Page, Shape } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const page: Page = { w: 11, h: 8.5 };
const layers: Layer[] = [{ id: "a", name: "Black", color: "#1d1d1f" }];
const step: StepRepeat = { kind: "step", copies: 3, moveX: 1, moveY: 0, scale: 50, turn: 90 };
const square: Shape = { id: "sq", kind: "rect", x: 1, y: 1, x2: 2, y2: 2, layerId: "a", repeat: step };

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const allPoints = (shapes: Shape[]) => shapes.flatMap((s) => markRuns(s, undefined)).flat()
  .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();

test("each copy steps on from the last, its move turned and scaled with it", () => {
  const p = placements(square);
  assert.equal(p.length, 4); // the shape and its three copies
  // Right 1; then down 0.5 (turned 90°, half size); then left 0.25.
  close(p[1].dx, 1); close(p[1].dy, 0); close(p[1].deg, 90); close(p[1].k ?? 1, 0.5);
  close(p[2].dx, 1); close(p[2].dy, 0.5); close(p[2].deg, 180); close(p[2].k ?? 1, 0.25);
  close(p[3].dx, 0.75); close(p[3].dy, 0.5); close(p[3].k ?? 1, 0.125);
});

test("no copies is the shape alone", () => {
  assert.equal(placements({ ...square, repeat: { ...step, copies: 0 } }).length, 1);
});

test("a step repeat is saved and read back", () => {
  const svg = buildSvg([square], [], layers, page, { paperSizeId: "letter", toolName: "", paperColor: "#ffffff", fonts: {} });
  const back = parseDrawing(svg).shapes.find((s) => s.id === "sq");
  assert.deepEqual(back?.repeat, step);
});

test("baking the copies leaves every mark where it was", () => {
  const made = bakedCopies(square);
  assert.equal(made.length, 4);
  close(made[1].scale ?? 100, 50);
  assert.deepEqual(allPoints(made), allPoints([square]));
});

test("turning the page carries the copies round with it", () => {
  const turned = turnDrawingLeft([square], [], page).shapes;
  const to = (s: string) => {
    const [x, y] = s.split(",").map(Number);
    return `${y.toFixed(4)},${(page.w - x).toFixed(4)}`;
  };
  assert.deepEqual(allPoints(turned), allPoints([square]).map(to).sort());
});
