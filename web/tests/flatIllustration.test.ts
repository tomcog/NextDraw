// Reading a flat illustration: colors painted as fills, and layers marked under whatever namespace
// prefix the file's writer invented (Tom, 2026-11-24).
//
// A drawing exported flat carries no strokes at all - every shape is a fill - and the parser read
// only strokes, so such a file opened as one black layer. The server splits it into a layer per
// color on open; a file that never declared xmlns:inkscape gets the prefix lxml invents, "ns1", and
// reading the literal "inkscape:label" found none of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { parseDrawing } from "../src/shared/lib/drawing/parse";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

/** As the server writes it after splitting: inkscape's namespace under a prefix nobody expects. */
const SPLIT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 432 288">
  <defs><style>.cls-1{fill:#1a5d80}.cls-2{fill:#ea2a4d}</style></defs>
  <g xmlns:ns1="http://www.inkscape.org/namespaces/inkscape" ns1:groupmode="layer" ns1:label="Blue" stroke="#1a5d80" id="nds-layer-1">
    <path class="cls-1" d="M 10 10 L 100 10 L 100 100 Z"/>
  </g>
  <g xmlns:ns1="http://www.inkscape.org/namespaces/inkscape" ns1:groupmode="layer" ns1:label="Red" stroke="#ea2a4d" id="nds-layer-2">
    <path class="cls-2" d="M 110 10 L 200 10 L 200 100 Z"/>
  </g>
</svg>`;

/** The same drawing before the split: one group, colors by class, no strokes anywhere. */
const FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 432 288">
  <defs><style>.cls-1{fill:#1a5d80}</style></defs>
  <g id="Layer_1" data-name="Layer 1">
    <path class="cls-1" d="M 10 10 L 100 10 L 100 100 Z"/>
    <path fill="#1a5d80" d="M 110 10 L 200 10 L 200 100 Z"/>
  </g>
</svg>`;

test("a layer's label is read whatever prefix the file gave the namespace", () => {
  const { layers } = parseDrawing(SPLIT);
  assert.deepEqual(layers.map((l) => l.name), ["Blue", "Red"]);
});

test("and its color comes off the group", () => {
  const { layers } = parseDrawing(SPLIT);
  assert.deepEqual(layers.map((l) => l.color), ["#1a5d80", "#ea2a4d"]);
});

test("a layer painted by fill alone is that color, not black", () => {
  const { layers } = parseDrawing(FLAT);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].color, "#1a5d80"); // #262626 was the fallback that made every one black
});

test("a fill set by class counts the same as one set by attribute", () => {
  // Both paths are the same blue, said two different ways: one color, not two.
  const { layers, shapes } = parseDrawing(FLAT);
  assert.equal(shapes.length, 2);
  assert.equal(layers[0].color, "#1a5d80");
});
