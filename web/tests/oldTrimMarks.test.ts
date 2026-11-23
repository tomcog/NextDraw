// Trim marks in a drawing made before 2026-11-23, when they were a parametric shape of their own.
// They are Plot's now, drawn round the artboard at plot time, so a drawing that carries a set is read
// as what is actually in the file: the lines themselves, on their layer, to keep, move or throw away
// like any other art. Nothing may be lost on the way in or out - that is what this checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { TRIM_LABEL } from "../src/shared/lib/ink";
import type { Page } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
(globalThis as { CSS?: unknown }).CSS ??= { escape: (t: string) => t.replace(/[^\w-]/g, (c) => `\\${c}`) };

const page: Page = { w: 8, h: 10 };
// Two of the eight marks, as Studio wrote them: a polyline each, the first under the shape's own id.
const marks = ['<polyline id="t" points="0.625,1 0.875,1"/>', '<polyline id="t-2" points="1,0.625 1,0.875"/>'];
const design = {
  on: { r: "Black", t: `Black - ${TRIM_LABEL}`, "t-2": `Black - ${TRIM_LABEL}` },
  curves: [{ shape: "t", box: [1, 1, 7, 9], kind: "trim", length: 6.35, offset: 3.175 }],
};
const old = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:nds="https://github.com/tomcog/NextDraw"
     width="8in" height="10in" viewBox="0 0 8 10">
  <metadata id="nextdraw-studio"><nds:design>${JSON.stringify(design)}</nds:design></metadata>
  <g inkscape:groupmode="layer" inkscape:label="Black" id="l1" fill="none" stroke="#231f20" stroke-width="0.008">
    <rect id="r" x="2" y="2" width="4" height="6"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Black - ${TRIM_LABEL}" id="l2" fill="none" stroke="#231f20" stroke-width="0.008">
    ${marks.join("\n    ")}
  </g>
</svg>`;

test("old trim marks: they come back as the lines in the file, not as a curve", () => {
  const back = parseDrawing(old);
  const layer = back.layers.find((l) => l.name === `Black - ${TRIM_LABEL}`)!;
  assert.ok(layer, "the layer they were drawn on is still there");
  const on = back.shapes.filter((s) => s.layerId === layer.id);
  assert.equal(on.length, 2, "a shape for each mark");
  assert.equal(on.filter((s) => s.curve).length, 0, "and not one of them is a curve");
});

test("old trim marks: writing the drawing back keeps every line", () => {
  const back = parseDrawing(old);
  const again = buildSvg(back.shapes, [], back.layers, page, { paperSizeId: "custom", toolName: "EnerGel" });
  assert.ok(!again.includes('"kind":"trim"'), "nothing calls them a curve any more");
  const read = parseDrawing(again);
  const layer = read.layers.find((l) => l.name === `Black - ${TRIM_LABEL}`)!;
  assert.equal(read.shapes.filter((s) => s.layerId === layer.id).length, 2, "both marks survive the round trip");
  // And where they were: the first mark runs from 0.625 to 0.875 inches across, at 1 inch down.
  const first = read.shapes.filter((s) => s.layerId === layer.id)[0];
  assert.ok(Math.abs(first.x - 0.625) < 1e-9 && Math.abs(first.y - 1) < 1e-9, `kept its place, got ${first.x},${first.y}`);
});
