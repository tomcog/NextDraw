// Flattening, baking, joining, splitting and simplifying shapes, in studio/lib/shapeEdits.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnBox } from "../src/shared/lib/drawing/whole";
import { insertPoint, removePoint } from "../src/shared/lib/drawing/shapes";
import type { Fill } from "../src/shared/lib/drawing/hatch";
import { bakedCopies, flattened, handOutFills, joined, markRuns, pointCount, simplified, simplifyDrawing, splitApart } from "../src/studio/lib/shapeEdits";
import { pathRuns, type Shape } from "../src/shared/lib/drawing/shapes";
import { mergeLines } from "../src/studio/lib/mergeLines";

const shape = (over: Partial<Shape>): Shape => ({ id: "s", kind: "rect", x: 1, y: 1, x2: 3, y2: 2, layerId: "l", ...over });
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6, `${what} ${a} ≠ ${b}`);
const sameBox = (a: ReturnType<typeof drawnBox>, b: typeof a) => {
  close(a.x0, b.x0, "x0"); close(a.y0, b.y0, "y0"); close(a.x1, b.x1, "x1"); close(a.y1, b.y1, "y1");
};

test("flattening a rectangle leaves its corners as a path, under its own id, drawing the same", () => {
  const rect = shape({ rotation: 20, repeat: { kind: "line", count: 2, step: 3, angle: 0 } });
  const [path, ...rest] = flattened(rect, undefined);
  assert.equal(rest.length, 0);
  assert.equal(path.id, "s");
  assert.equal(path.kind, "path");
  assert.equal(path.points?.length, 5); // closed on its first corner
  // The turn and the copies are settings it keeps, so what lands on paper is the same.
  assert.equal(path.rotation, 20);
  assert.deepEqual(path.repeat, rect.repeat);
  sameBox(drawnBox([path]), drawnBox([rect]));
});

test("flattening a curve leaves its strokes as smoothed paths, the first under its id", () => {
  const spiral = shape({ kind: "curve", x: 0, y: 0, x2: 2, y2: 2, curve: { kind: "spiral", turns: 4, inner: 5 } });
  const made = flattened(spiral, undefined);
  assert.ok(made.length >= 1);
  assert.equal(made[0].id, "s");
  assert.ok(made.every((s) => s.kind === "path" && s.smooth && !s.curve));
});

test("flattening a polygon, a star or curve stitching keeps them straight: a hexagon stays six corners", () => {
  for (const curve of [{ kind: "polygon", sides: 6 }, { kind: "star", points: 5, inner: 40 }, { kind: "parabolic", strings: 12, corners: ["tl", "br", "tr", "bl"] }] as const) {
    const made = flattened(shape({ kind: "curve", x: 0, y: 0, x2: 2, y2: 2, curve: curve as never }), undefined);
    assert.ok(made.length >= 1, curve.kind);
    assert.ok(made.every((s) => s.kind === "path" && !s.smooth && !s.curve), `${curve.kind} smoothed`);
  }
  const hexagon = flattened(shape({ kind: "curve", x: 0, y: 0, x2: 2, y2: 2, curve: { kind: "polygon", sides: 6 } }), undefined)[0];
  assert.equal(pathRuns(hexagon)[0].length, 7, "six corners and back to the first");
});

test("baking a row makes each copy a shape where it was drawn, the first keeping the id", () => {
  const row = shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } });
  const made = bakedCopies(row);
  assert.equal(made.length, 3);
  assert.equal(made[0].id, "s");
  assert.ok(made.every((s) => !s.repeat));
  assert.deepEqual(made.map((s) => s.x), [1, 3, 5]);
  sameBox(drawnBox(made), drawnBox([row]));
});

test("baking a ring that faces out gives each copy its own turn", () => {
  const ring = shape({ repeat: { kind: "ring", count: 4, radius: 1, facing: true } });
  assert.deepEqual(bakedCopies(ring).map((s) => s.rotation ?? 0), [0, 90, 180, 270]);
  sameBox(drawnBox(bakedCopies(ring)), drawnBox([ring]));
});

test("a replaced shape's fills go to everything that replaced it", () => {
  const fills = [{ id: "f", shapeId: "s", angle: 0, spacingMm: 1, scale: 100 }, { id: "g", shapeId: "other", angle: 0, spacingMm: 1, scale: 100 }] as Fill[];
  const made = bakedCopies(shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } }));
  const out = handOutFills(fills, "s", made);
  assert.deepEqual(out.filter((f) => f.shapeId !== "other").map((f) => f.shapeId), made.map((s) => s.id));
  assert.equal(out.find((f) => f.shapeId === "s")!.id, "f");
  assert.ok(out.some((f) => f.id === "g"));
});

test("joining makes one path of every mark, and taking it apart gives them back", () => {
  const a = shape({ id: "a" });
  const b = shape({ id: "b", kind: "ellipse", x: 5, y: 3, x2: 7, y2: 4 });
  const one = joined([a, b], {})!;
  assert.equal(one.id, "a");
  assert.equal(one.kind, "path");
  assert.equal(pathRuns(one).length, 2);
  sameBox(drawnBox([one]), drawnBox([a, b]));
  const apart = splitApart(one);
  assert.equal(apart.length, 2);
  assert.equal(apart[0].id, "a");
  sameBox(drawnBox([apart[0]]), drawnBox([a]));
});

test("joining leaves photos out, and needs two shapes to join", () => {
  const photo = shape({ id: "p", kind: "photo" });
  assert.equal(joined([shape({}), photo], {}), null);
  assert.equal(joined([shape({})], {}), null);
});

test("a shape's marks take in its copies and, when asked, its fill", () => {
  const row = shape({ repeat: { kind: "line", count: 3, step: 2, angle: 0 } });
  assert.equal(markRuns(row, undefined).length, 3);
  const fills = [{ id: "f", shapeId: "s", angle: 0, spacingMm: 2.54, scale: 100 }] as Fill[];
  const withFill = markRuns(row, undefined, fills);
  assert.ok(withFill.length > 3);
  // A shape only there to be filled draws its fill and not its outline.
  assert.equal(markRuns({ ...row, outline: false }, undefined, fills).length, withFill.length - 3);
});

test("simplifying drops the points a path doesn't need, and leaves alone one that needs them all", () => {
  const straight = shape({ kind: "path", x: 0, y: 0, x2: 1, y2: 0, points: Array.from({ length: 11 }, (_, i) => ({ x: i / 10, y: 0 })) });
  const simpler = simplified(straight, 0.001)!;
  assert.equal(simpler.points?.length, 2);
  assert.equal(simpler.smooth, true);
  assert.equal(simplified({ ...straight, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 0.001), null);
});

test("the Simplifier thins straight runs, joins ends that meet, drops specks, and leaves the rest", () => {
  const off = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0 };
  // A straight line walked in 101 points, then a second run starting where it ended, then a speck.
  const line = Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: 0 }));
  const on = { x: 1.001, y: 0 };
  const path = shape({ kind: "path", runs: [line, [on, { x: 1, y: 1 }], [{ x: 3, y: 3 }, { x: 3.001, y: 3 }]] });
  const words = shape({ id: "t", kind: "text", text: "hi" });
  assert.equal(pointCount([path, words]), 105);

  // All off: nothing changes.
  assert.deepEqual(pathRuns(simplifyDrawing([path], () => true, off).shapes[0]), pathRuns(path));

  const { shapes, gone } = simplifyDrawing([path, words], () => true, { mergeShort: 0.004, straighten: 0.002, joinEnds: 0.01, dropTiny: 0.01 });
  assert.deepEqual(gone, []);
  const runs = pathRuns(shapes[0]);
  // The line is its two ends, carried on into the run that starts where it stopped; the speck is gone.
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(shapes[1], words); // a word is drawn from its letters, not its points

  // A path with nothing but specks goes altogether; another layer's paths are left alone.
  const speck = shape({ id: "p", kind: "path", points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }] });
  const other = shape({ id: "q", kind: "path", layerId: "m", points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }] });
  const r = simplifyDrawing([speck, other], (s) => s.layerId === "l", { ...off, dropTiny: 0.01 });
  assert.deepEqual(r.gone, ["p"]);
  assert.deepEqual(r.shapes, [other]);
});

test("Prune takes out one stroke in N on each layer: evenly across the page, or picked at random", () => {
  const off = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0 };
  const stroke = (i: number) => [{ x: i, y: 0 }, { x: i, y: 1 }];
  // Six upright lines on layer l, in two paths, and three on layer m.
  const a = shape({ id: "a", kind: "path", runs: [0, 1, 2, 3].map(stroke) });
  const b = shape({ id: "b", kind: "path", runs: [4, 5].map(stroke) });
  const c = shape({ id: "c", kind: "path", layerId: "m", runs: [6, 7, 8].map(stroke) });
  const xs = (list: Shape[]) => list.flatMap((s) => pathRuns(s).map((r) => r[0].x));

  // Evenly: every 2nd line across the page, each layer counted on its own.
  assert.deepEqual(xs(simplifyDrawing([a, b, c], () => true, { ...off, pruneEvery: 2 }).shapes), [0, 2, 4, 6, 8]);
  assert.deepEqual(xs(simplifyDrawing([a, b, c], () => true, { ...off, pruneEvery: 3 }).shapes), [0, 1, 3, 4, 6, 7]);
  // Random: the same share goes, and the same seed picks the same strokes again.
  const random = { ...off, pruneEvery: 2, pruneMode: "random" as const, pruneSeed: 7 };
  const one = xs(simplifyDrawing([a, b, c], () => true, random).shapes);
  assert.equal(one.filter((x) => x < 6).length, 3);
  assert.deepEqual(xs(simplifyDrawing([a, b, c], () => true, random).shapes), one);
});

test("Prune evenly takes whole rows of a hatching, however the rows are broken up and listed", () => {
  const off = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0 };
  // Eight level rows a tenth apart, each in two pieces, listed back and forth and out of order.
  const piece = (row: number, half: number) => (half ? [{ x: 2, y: row / 10 }, { x: 1, y: row / 10 }] : [{ x: 0, y: row / 10 }, { x: 0.9, y: row / 10 }]);
  const order = [3, 0, 6, 1, 7, 2, 5, 4];
  const hatch = shape({ id: "h", kind: "path", runs: order.flatMap((r) => [piece(r, 0), piece(r, 1)]) });
  const rowsLeft = (opts: object) => [...new Set(pathRuns(simplifyDrawing([hatch], () => true, { ...off, ...opts }).shapes[0]).map((r) => Math.round(r[0].y * 10)))].sort();
  // Every other row goes, both its pieces, whatever order the file has them in.
  assert.deepEqual(rowsLeft({ pruneEvery: 2 }), [0, 2, 4, 6]);
  // Shuffled: one row of each pair goes, never both, so half are left and no two pairs lose more.
  for (const seed of [1, 2, 3, 4, 5]) {
    const left = rowsLeft({ pruneEvery: 2, pruneMode: "blocks", pruneSeed: seed });
    assert.equal(left.length, 4);
    for (let pair = 0; pair < 8; pair += 2) assert.equal(left.filter((r) => r === pair || r === pair + 1).length, 1);
  }
});

test("Prune evenly isn't thrown by rows left empty where the picture is white", () => {
  const off = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0 };
  // Rows 0 to 19, a fiftieth apart, with 6, 7 and 13 missing: their gaps are three and two spacings.
  const rows = Array.from({ length: 20 }, (_, r) => r).filter((r) => ![6, 7, 13].includes(r));
  const hatch = shape({ id: "h", kind: "path", runs: rows.map((r) => [{ x: 0, y: r / 50 }, { x: 1, y: r / 50 }]) });
  const left = pathRuns(simplifyDrawing([hatch], () => true, { ...off, pruneEvery: 2 }).shapes[0]).map((r) => Math.round(r[0].y * 50));
  // Every other row that's there goes - counted among the rows drawn, not the empty ones.
  assert.deepEqual(left, rows.filter((_, i) => i % 2 === 0));
});

test("Merge joins overlapping dashes into strokes all one way round, only where it's asked to", () => {
  // A row of dashes that overrun one another, one drawn right to left, and a row on another layer.
  const dash = (x0: number, x1: number, y: number) => [{ x: x0, y }, { x: x1, y }];
  const row = shape({ id: "r", kind: "path", runs: [dash(0, 0.6, 1), dash(1, 0.5, 1), dash(0.9, 1.5, 1), dash(0, 1, 2), dash(0.8, 2, 2)] });
  const other = shape({ id: "o", kind: "path", layerId: "m", runs: [dash(0, 0.6, 1), dash(0.5, 1, 1)] });
  const merged = mergeLines([row, other], [], (s) => s.layerId === "l")!;
  const runs = pathRuns(merged.shapes.find((s) => s.layerId === "l")!);
  // Each row is one stroke, left to right - the second row too, not turned back.
  assert.deepEqual(runs.map((r) => [r[0].x, r[1].x, r[0].y]).map((v) => v.map((n) => Math.round(n * 1000) / 1000)), [[0, 1.5, 1], [0, 2, 2]]);
  // The other layer was left out of it.
  assert.equal(merged.shapes.find((s) => s.layerId === "m"), other);
});


test("points: a double-click adds a point on the nearest segment; Delete takes one out", () => {
  const square = { id: "s", layerId: "a", kind: "path" as const, x: 0, y: 0, x2: 1, y2: 1,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }] };
  const more = insertPoint(square, 0.5, -0.05);
  assert.equal(more.points!.length, 6);
  assert.deepEqual(more.points![1], { x: 0.5, y: 0 });
  const less = removePoint(more, 1);
  assert.deepEqual(less.points, square.points);
  // A closed outline's first point is its last too: taking it out keeps the outline closed.
  const shut = removePoint(square, 0);
  assert.equal(shut.points!.length, 4);
  assert.deepEqual(shut.points![0], shut.points![3]);
  // Never too short to draw.
  assert.equal(removePoint(shut, 1), shut);
});

test("the Simplifier's redundant points only: curved runs too, smooth paths left as they are", () => {
  const none = { mergeShort: 0, straighten: 0, joinEnds: 0, dropTiny: 0, redundant: true };
  const curved = shape({ id: "c", kind: "path", points: [{ x: 0, y: 0, out: { x: 0, y: 1 } }, { x: 1, y: 1, in: { x: 1, y: 2 } }, { x: 2, y: 1 }, { x: 3, y: 1 }] });
  const smooth = shape({ id: "m", kind: "path", smooth: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] });
  const [c, m] = simplifyDrawing([curved, smooth], () => true, none).shapes;
  assert.deepEqual(pathRuns(c), [[curved.points![0], curved.points![1], curved.points![3]]]);
  assert.deepEqual(pathRuns(m), pathRuns(smooth));
});
