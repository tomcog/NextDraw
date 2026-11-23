// The artboard as a drawing keeps it: its own size apart from the paper, and its margins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { drawingSizes, parseDrawing } from "../src/shared/lib/drawing/parse";
import { marginsAll } from "../src/shared/lib/geometry";
import type { Layer, Page, Shape } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
// Reading a photo back looks an id up with CSS.escape, which linkedom has no need of.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (t: string) => t.replace(/[^\w-]/g, (c) => `\\${c}`) };

const artboard: Page = { w: 8, h: 10 };
const layers: Layer[] = [{ id: "a", name: "Black", color: "#231f20" }];
const shapes: Shape[] = [{ id: "r", kind: "rect", x: 2, y: 2, x2: 6, y2: 8, layerId: "a" }];
const save = (page: Page, opts: Parameters<typeof buildSvg>[4]) => buildSvg(shapes, [], layers, page, opts);
const bare = { paperSizeId: "custom", toolName: "EnerGel" };

test("artboard: margins are kept with the drawing and come back as they went", () => {
  const margins = { top: 1, right: 1.5, bottom: 2, left: 1.5 };
  const back = parseDrawing(save(artboard, { ...bare, margins }));
  assert.deepEqual(back.margins, margins);
  assert.deepEqual(back.artboard, artboard, "the artboard is the drawing's own size");
});

test("artboard: a drawing with no margins is written as it always was", () => {
  const without = save(artboard, bare);
  assert.ok(!without.includes("margins"), "nothing is written for a drawing that has none");
  assert.deepEqual(parseDrawing(without).margins, marginsAll(0));
  // And zeros are no different from none: still nothing written.
  assert.ok(!save(artboard, { ...bare, margins: marginsAll(0) }).includes("margins"));
});

test("artboard: the artboard is the drawing's own size, the paper the sheet it sits on", () => {
  // Plot records the sheet in its own block; the SVG's size stays the drawing's.
  const svg = save(artboard, bare).replace(
    /<nds:plot>[^<]*<\/nds:plot>/,
    () => `<nds:plot>${JSON.stringify({ tool: "EnerGel", paper: { paper_w: 457.2, paper_h: 609.6 } })}</nds:plot>`,
  );
  const back = parseDrawing(svg);
  assert.deepEqual(back.artboard, artboard, "8 x 10 artboard");
  assert.ok(back.paper && Math.abs(back.paper.w - 18) < 0.01 && Math.abs(back.paper.h - 24) < 0.01, `18 x 24 paper, got ${JSON.stringify(back.paper)}`);
  // Since 2026-11-23 the page IS the artboard: the paper no longer stands in for it.
  assert.deepEqual(back.page, artboard, "the page is the artboard, not the sheet");
});

test("artboard: a sheet of its own survives a round trip, and the artboard is not resized to it", () => {
  const paper: Page = { w: 18, h: 24 };
  const once = save(artboard, { ...bare, paper });
  // Written at the artboard...
  assert.ok(once.includes('width="8in"') && once.includes('height="10in"'), "the SVG is the artboard's size");
  const back = parseDrawing(once);
  assert.deepEqual(back.artboard, artboard);
  assert.ok(back.paper && Math.abs(back.paper.w - 18) < 0.01 && Math.abs(back.paper.h - 24) < 0.01, "the sheet came back");
  // ...and writing it again from what was read keeps both, which is what a Plot-side edit does.
  const again = parseDrawing(save(back.artboard, { ...bare, paper: back.paper! }));
  assert.deepEqual(again.artboard, artboard, "the artboard is still the artboard");
  assert.ok(again.paper && Math.abs(again.paper.w - 18) < 0.01, "the sheet is still the sheet");
});

test("artboard: with no sheet chosen, the drawing is for a sheet its own size", () => {
  const back = parseDrawing(save(artboard, bare));
  assert.deepEqual(back.artboard, artboard);
  assert.ok(back.paper && Math.abs(back.paper.w - 8) < 0.01 && Math.abs(back.paper.h - 10) < 0.01, "the artboard is written as the paper too");
});

test("artboard: a drawing with no plot block has an artboard and no paper", () => {
  const svg = save(artboard, bare).replace(/<metadata id="nextdraw-plot">.*?<\/metadata>/s, "");
  const back = parseDrawing(svg);
  assert.deepEqual(back.artboard, artboard);
  assert.equal(back.paper, null);
  assert.deepEqual(back.page, artboard, "with no paper recorded, the page falls back to the drawing's size");
});

test("artboard: margins a file gets wrong are read as far as they can be", () => {
  const svg = save(artboard, bare).replace(/"on":/, '"margins":{"top":1,"right":"wide","bottom":-3,"left":0.5},"on":');
  // A side that isn't a number, or is negative, falls back rather than taking the drawing with it.
  assert.deepEqual(parseDrawing(svg).margins, { top: 1, right: 0, bottom: 0, left: 0.5 });
});

test("artboard: a drawing made before margins belonged to it takes them from its picture", () => {
  // Margins used to be each photo's own, recorded as what it was last fitted inside.
  const pic: Shape = {
    id: "pic", kind: "photo", x: 1, y: 1, x2: 7, y2: 9, layerId: "a",
    photo: {
      src: "data:image/png;base64,", width: 4, height: 3, brightness: 0, contrast: 0,
      angle: 45, spacingMm: 1, levels: 4, fit: "fit", margin: 0.5, marginBottom: 1.25,
    } as Shape["photo"],
  };
  const back = parseDrawing(buildSvg([pic], [], layers, artboard, bare));
  assert.deepEqual(back.margins, { top: 0.5, right: 0.5, bottom: 1.25, left: 0.5 },
    "the picture's margin on three sides, its deeper foot on the fourth");
});

test("artboard: margins the drawing kept win over the picture's old ones", () => {
  const pic: Shape = {
    id: "pic", kind: "photo", x: 1, y: 1, x2: 7, y2: 9, layerId: "a",
    photo: {
      src: "data:image/png;base64,", width: 4, height: 3, brightness: 0, contrast: 0,
      angle: 45, spacingMm: 1, levels: 4, fit: "fit", margin: 0.5,
    } as Shape["photo"],
  };
  const margins = { top: 2, right: 2, bottom: 3, left: 2 };
  assert.deepEqual(parseDrawing(buildSvg([pic], [], layers, artboard, { ...bare, margins })).margins, margins);
});

test("sizes: the light read agrees with the full one, shapes or no shapes", () => {
  const margins = { top: 1, right: 1.5, bottom: 2, left: 1.5 };
  const paper: Page = { w: 18, h: 24 };
  const svg = save(artboard, { ...bare, margins, paper });
  const full = parseDrawing(svg);
  const light = drawingSizes(svg);
  assert.deepEqual(light.artboard, full.artboard, "same artboard");
  assert.deepEqual(light.margins, full.margins, "same margins");
  assert.ok(light.paper && full.paper && Math.abs(light.paper.w - full.paper.w) < 1e-9, "same paper");
});

test("sizes: a drawing with neither block read lightly is its own size, flush, no sheet", () => {
  const bareSvg = save(artboard, bare)
    .replace(/<metadata id="nextdraw-plot">.*?<\/metadata>/s, "")
    .replace(/<metadata id="nextdraw-studio">.*?<\/metadata>/s, "");
  const light = drawingSizes(bareSvg);
  assert.deepEqual(light.artboard, artboard);
  assert.equal(light.paper, null);
  assert.deepEqual(light.margins, marginsAll(0));
});
