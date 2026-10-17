// Plot's Turn and Fit change the drawing by a transform on each layer. A shape whose box comes from
// the design block - a text, a curve, a photo - has to follow that transform as its lines do, or
// Studio and Image show it where it was before. A curve stands for all three here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import type { Layer, Page, Shape } from "../src/shared/lib/drawing/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
// The browser's, for the ids looked up by selector; enough for the plain ids written here.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) };

const page: Page = { w: 11, h: 8.5 };
const layers: Layer[] = [{ id: "a", name: "Black", color: "#1d1d1f" }];
const words: Shape = { id: "words", kind: "curve", curve: { kind: "polygon", sides: 6 }, x: 1, y: 1, x2: 3, y2: 2, layerId: "a" };
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} ≠ ${b}`);

// As the server writes it: the change put before whatever transform each layer had.
const withLayerTransform = (svg: string, matrix: string) =>
  svg.replace(/(<g\b[^>]*inkscape:groupmode="layer")/g, `$1 transform="${matrix}"`);

test("a curve's box follows its layer scaled and moved, as Fit leaves it", () => {
  const svg = withLayerTransform(buildSvg([words], [], layers, page, { paperSizeId: "letter", toolName: "" }), "matrix(2,0,0,2,1,0.5)");
  const [t] = parseDrawing(svg).shapes.filter((s) => s.kind === "curve");
  close(t.x, 3, "x"); close(t.y, 2.5, "y"); close(t.x2, 7, "x2"); close(t.y2, 4.5, "y2");
  assert.equal(t.rotation, undefined);
});

test("and turned a quarter right about its layer's turn, its box the same size about its new middle", () => {
  // A right turn about (2, 1.5), the curve's middle: x' = -y + 3.5, y' = x - 0.5.
  const svg = withLayerTransform(buildSvg([words], [], layers, page, { paperSizeId: "letter", toolName: "" }), "matrix(0,1,-1,0,3.5,-0.5)");
  const [t] = parseDrawing(svg).shapes.filter((s) => s.kind === "curve");
  close((t.x + t.x2) / 2, 2, "middle x"); close((t.y + t.y2) / 2, 1.5, "middle y");
  close(t.x2 - t.x, 2, "width");
  assert.equal(t.rotation, 90);
});

test("a picture sized to the page, then fitted from Plot, is placed where Plot put it - no longer sized to the page", () => {
  const pic: Shape = { id: "pic", kind: "photo", x: 0.5, y: 0.5, x2: 10.5, y2: 8, layerId: "a",
    photo: { src: "data:image/png;base64,", width: 4, height: 3, brightness: 0, contrast: 0, angle: 45, spacingMm: 1, levels: 4, fit: "fill", margin: 0.5 } as Shape["photo"] };
  const plain = parseDrawing(buildSvg([pic], [], layers, page, { paperSizeId: "letter", toolName: "" })).shapes.find((s) => s.kind === "photo");
  assert.equal(plain?.photo?.fit, "fill", "untouched, it stays sized to the page");
  const svg = withLayerTransform(buildSvg([pic], [], layers, page, { paperSizeId: "letter", toolName: "" }), "matrix(0.9,0,0,0.9,0.55,0.425)");
  const fitted = parseDrawing(svg).shapes.find((s) => s.kind === "photo");
  assert.equal(fitted?.photo?.fit, undefined);
  close(fitted!.x, 1, "x");
});
