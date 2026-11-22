// Knock out: a filled shape laid over the drawing cuts every other line away inside it, so the paper
// shows through - the hole in an "O" kept, the cut reaching the gap past the outline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { knockOutDrawing, knockOutRun, knockoutArea } from "../src/shared/lib/drawing/knockout";
import type { Shape } from "../src/shared/lib/drawing/shapes";
import type { Fill } from "../src/shared/lib/drawing/hatch";

const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6, `${what} ${a} ≠ ${b}`);
const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
];
// An "O": a 2-inch square with a 1-inch hole, as one path of two runs.
const letterO: Shape = { id: "o", kind: "path", layerId: "mask", x: 1, y: 1, x2: 3, y2: 3, runs: [square(1, 1, 3, 3), square(1.5, 1.5, 2.5, 2.5)] };

test("a line across the letter is cut at its edges, and the hole in it keeps its line", () => {
  const area = knockoutArea([letterO], {}, 0)!;
  const runs = knockOutRun([{ x: 0, y: 2 }, { x: 4, y: 2 }], area)!;
  assert.equal(runs.length, 3);
  close(runs[0][0].x, 0); close(runs[0][1].x, 1, "stops at the left edge");
  close(runs[1][0].x, 1.5, "the hole"); close(runs[1][1].x, 2.5);
  close(runs[2][0].x, 3, "starts again at the right edge"); close(runs[2][1].x, 4);
});

test("the gap reaches past the outline on both sides", () => {
  const area = knockoutArea([letterO], {}, 0.1)!;
  const runs = knockOutRun([{ x: 0, y: 2 }, { x: 4, y: 2 }], area)!;
  close(runs[0][1].x, 0.9);
  close(runs[1][0].x, 1.6); close(runs[1][1].x, 2.4);
  close(runs[2][0].x, 3.1);
});

test("a line that misses it is left exactly as it was, curves and all", () => {
  const area = knockoutArea([letterO], {}, 0.05)!;
  assert.equal(knockOutRun([{ x: 0, y: 5, out: { x: 1, y: 4 } }, { x: 4, y: 5, in: { x: 3, y: 4 } }], area), null);
  // Near enough to be in its box, but not to touch it.
  assert.equal(knockOutRun([{ x: 0, y: 0.9 }, { x: 4, y: 0.9 }], area), null);
});

test("a stretch far away keeps its curve while the rest is cut", () => {
  const area = knockoutArea([letterO], {}, 0)!;
  const runs = knockOutRun([{ x: -3, y: 2, out: { x: -2, y: 0 } }, { x: -1, y: 2, in: { x: -1.5, y: 2 } }, { x: 4, y: 2 }], area)!;
  assert.ok(runs[0][0].out, "the far curve still has its handle");
  close(runs[0][runs[0].length - 1].x, 1);
});

test("a loop round the letter, cut once, stays one run starting where it was cut", () => {
  const area = knockoutArea([{ ...letterO, runs: [square(1.8, 0, 2.2, 1.2)] }], {}, 0)!;
  const loop = square(0.5, 0.5, 3.5, 3.5);
  const runs = knockOutRun(loop, area)!;
  assert.equal(runs.length, 1, "joined round the loop's start");
});

test("every other layer is cut; shapes it doesn't reach stay untouched", () => {
  const black: Shape = { id: "b", kind: "line", layerId: "black", x: 0, y: 2, x2: 4, y2: 2 };
  const red: Shape = { id: "r", kind: "line", layerId: "red", x: 2, y: 0, x2: 2, y2: 4 };
  const far: Shape = { id: "f", kind: "line", layerId: "red", x: 5, y: 0, x2: 5, y2: 4 };
  const area = knockoutArea([letterO], {}, 0)!;
  const out = knockOutDrawing([black, red, far], [], area, {});
  assert.equal(out.cut, 2);
  assert.equal(out.shapes.find((s) => s.id === "f"), far);
  const redCut = out.shapes.find((s) => s.id === "r")!;
  assert.equal(redCut.layerId, "red");
  assert.equal(redCut.runs?.length, 3);
});

test("a hatched shape under it: the hatching is cut too, and its fill kept as lines", () => {
  const box: Shape = { id: "h", kind: "rect", layerId: "black", x: 0, y: 0, x2: 4, y2: 4 };
  const fill: Fill = { id: "fill", shapeId: "h", angle: 0, spacingMm: 5, scale: 100 };
  const area = knockoutArea([letterO], {}, 0)!;
  const out = knockOutDrawing([box], [fill], area, {});
  assert.equal(out.fills.length, 0, "the fill is now lines");
  const lines = out.shapes.flatMap((s) => s.runs ?? []);
  // Nothing kept lies inside the letter but outside its hole.
  for (const run of lines) for (let i = 1; i < run.length; i++) {
    const mx = (run[i - 1].x + run[i].x) / 2, my = (run[i - 1].y + run[i].y) / 2;
    const inLetter = mx > 1 + 1e-6 && mx < 3 - 1e-6 && my > 1 + 1e-6 && my < 3 - 1e-6;
    const inHole = mx > 1.5 && mx < 2.5 && my > 1.5 && my < 2.5;
    assert.ok(!inLetter || inHole, `kept a stretch inside the letter at ${mx},${my}`);
  }
});

test("letters that overlap knock out as one", () => {
  const a: Shape = { id: "a", kind: "path", layerId: "mask", x: 0, y: 0, x2: 2, y2: 2, points: square(1, 1, 2, 2) };
  const b: Shape = { id: "b2", kind: "path", layerId: "mask", x: 0, y: 0, x2: 2, y2: 2, points: square(1.5, 1, 2.5, 2) };
  const area = knockoutArea([a, b], {}, 0)!;
  const runs = knockOutRun([{ x: 0, y: 1.5 }, { x: 3, y: 1.5 }], area)!;
  assert.equal(runs.length, 2);
  close(runs[0][1].x, 1); close(runs[1][0].x, 2.5);
});

test("nothing closed to cut with", () => {
  const line: Shape = { id: "l", kind: "line", layerId: "mask", x: 0, y: 0, x2: 1, y2: 1 };
  assert.equal(knockoutArea([line], {}, 0), null);
});

// ---- The Knockout layer, kept live in the drawing ----
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/shared/lib/drawing/svg";
import { parseDrawing } from "../src/shared/lib/drawing/parse";
import { withKnockout, knockoutPlaced } from "../src/shared/lib/drawing/knockout";
import type { Layer } from "../src/shared/lib/drawing/shapes";
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const saveOpts = { paperSizeId: "letter", toolName: "Test" };
const page = { w: 11, h: 8.5 };
const pageLayers: Layer[] = [
  { id: "black", name: "Black", color: "#1d1d1f" },
  { id: "ko", name: "Knockout", color: "#8a8f98" },
];
const across: Shape = { id: "across", kind: "path", layerId: "black", x: 0, y: 2, x2: 4, y2: 2, points: [{ x: 0, y: 2 }, { x: 4, y: 2 }] };
const away: Shape = { id: "away", kind: "line", layerId: "black", x: 5, y: 5, x2: 6, y2: 6 };
const mask: Shape = { ...letterO, layerId: "ko" };

const layerBody = (svg: string, label: string) => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return Array.from(doc.querySelectorAll("g")).find((g) => g.getAttribute("inkscape:label") === label);
};

test("saved: the knockout's layer is never plotted, and the lines under it are written cut", () => {
  const svg = buildSvg([across, away, mask], [], pageLayers, page, saveOpts);
  assert.ok(layerBody(svg, "%Knockout"), "the knockout is on a % layer");
  assert.ok(!layerBody(svg, "Knockout"));
  const black = layerBody(svg, "Black")!;
  const cut = black.querySelector('[id="studio-knocked-across"] path')!.getAttribute("d")!;
  assert.equal((cut.match(/M/g) ?? []).length, 3, "three pieces left: either side, and the hole");
  assert.ok(black.querySelector('[id="away"]'), "what it doesn't touch is written as it is");
  assert.ok(layerBody(svg, "%knocked out")!.querySelector('[id="across"]'), "the whole line is kept, unplotted");
});

test("opened again: the knockout and the line it cut come back whole and editable", () => {
  const opened = parseDrawing(buildSvg([across, away, mask], [], pageLayers, page, saveOpts));
  assert.deepEqual(opened.layers.map((l) => l.name), ["Black", "Knockout"]);
  const ko = opened.layers.find((l) => l.name === "Knockout")!;
  const black = opened.layers.find((l) => l.name === "Black")!;
  const line = opened.shapes.find((s) => s.id === "across")!;
  assert.equal(line.layerId, black.id);
  assert.notEqual(line.outline, false);
  assert.equal(line.points?.length ?? line.runs?.[0].length, 2, "the line, uncut");
  assert.equal(opened.shapes.filter((s) => s.layerId === ko.id).length, 1);
  assert.equal(opened.shapes.length, 3, "nothing doubled");
  // And saved again, it's the same file.
  const again = parseDrawing(buildSvg(opened.shapes, opened.fills, opened.layers, opened.page, saveOpts));
  assert.equal(again.shapes.length, 3);
});

test("hidden, the knockout cuts nothing, and stays hidden", () => {
  const hidden = pageLayers.map((l) => (l.id === "ko" ? { ...l, hidden: true } : l));
  const svg = buildSvg([across, mask], [], hidden, page, saveOpts);
  assert.ok(!svg.includes("studio-knocked-"));
  assert.equal(parseDrawing(svg).layers.find((l) => l.name === "Knockout")?.hidden, true);
});

test("a hatched shape under it: its fill lines are cut, and the fill comes back as a fill", () => {
  const box: Shape = { id: "h", kind: "rect", layerId: "black", x: 0, y: 0, x2: 4, y2: 4 };
  const fill: Fill = { id: "fill1", shapeId: "h", angle: 0, spacingMm: 5, scale: 100 };
  const svg = buildSvg([box, mask], [fill], pageLayers, page, saveOpts);
  assert.ok(svg.includes('id="studio-knocked-fill-fill1"'));
  assert.ok(!svg.includes('id="studio-fill-fill1"'), "not a fill group Plot would make again whole");
  const opened = parseDrawing(svg);
  assert.equal(opened.fills.length, 1);
  assert.equal(opened.shapes.filter((s) => s.kind === "rect").length, 1);
});

test("loading a knockout: closed shapes only, centered and half as wide as what it's laid over; loading again replaces it", () => {
  const file = { shapes: [letterO, { id: "l", kind: "line", layerId: "", x: 0, y: 0, x2: 1, y2: 1 } as Shape], unsupported: 0 };
  const loaded = withKnockout([across], [pageLayers[0]], file, "Scout", { x0: 0, y0: 0, x1: 8, y1: 10 });
  assert.ok(!("error" in loaded));
  if ("error" in loaded) return;
  assert.equal(loaded.layers.length, 2);
  const mine = loaded.shapes.filter((s) => s.layerId === loaded.layerId);
  assert.equal(mine.length, 1, "the line is left out");
  close(mine[0].x, 2); close(mine[0].x2, 6); close(mine[0].y, 3); close(mine[0].y2, 7);
  const again = withKnockout(loaded.shapes, loaded.layers, file, "Scout", { x0: 0, y0: 0, x1: 8, y1: 10 });
  if ("error" in again) return assert.fail();
  assert.equal(again.shapes.filter((s) => s.layerId === again.layerId).length, 1);
  assert.equal(again.layers.length, 2);
  const moved = knockoutPlaced(again.shapes, again.layerId, { x0: 0, y0: 0, x1: 2, y1: 2 });
  const m = moved.find((s) => s.layerId === again.layerId)!;
  close(m.x, 0); close(m.x2, 2);
  assert.ok("error" in withKnockout([], [], { shapes: [], unsupported: 2 }, "x", { x0: 0, y0: 0, x1: 1, y1: 1 }));
});
