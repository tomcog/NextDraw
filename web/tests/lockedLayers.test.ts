// A locked layer stays locked when the drawing is saved and opened again; the others stay unlocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import type { Layer, Page, Shape } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const page: Page = { w: 11, h: 8.5 };
const layers: Layer[] = [
  { id: "a", name: "Black", color: "#1d1d1f", locked: true },
  { id: "b", name: "Red", color: "#d02020" },
];
const shapes: Shape[] = [
  { id: "one", kind: "rect", x: 1, y: 1, x2: 2, y2: 2, layerId: "a" },
  { id: "two", kind: "rect", x: 3, y: 1, x2: 4, y2: 2, layerId: "b" },
];

test("a locked layer comes back locked", () => {
  const back = parseDrawing(buildSvg(shapes, [], layers, page, { paperSizeId: "letter", toolName: "" })).layers;
  assert.deepEqual(back.map((l) => [l.name, Boolean(l.locked)]), [["Black", true], ["Red", false]]);
});
