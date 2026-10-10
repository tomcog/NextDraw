import { test } from "node:test";
import assert from "node:assert/strict";
import { photoMarks, platePasses, presetAngle, readTones, solveSeparation, type Photo } from "../src/shared/lib/drawing/photo";

// A made-up photo, read without a browser: white on the left darkening to black on the right.
const W = 200;
const H = 100;
async function gradient(src: string) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round(255 * (1 - x / (W - 1)));
    data.set([v, v, v, 255], (y * W + x) * 4);
  }
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ blob: async () => null });
  g.createImageBitmap = async () => ({ width: W, height: H, close() {} });
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones(src);
}

const photo = (more: Partial<Photo>): Photo => ({
  src: "data:gradient", width: W, height: H, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.3, levels: 4,
  style: "squiggle", rowMm: 5, waveMm: 2, ...more,
});

test("squiggle: SquiggleDraw's rows - its number of lines to the photo's height - each smooth and unbroken through white", async () => {
  await gradient("data:gradient");
  const w = 4;
  const h = 2;
  // 100 pixels scaled up 3 times, 20 lines: a row every 15 of the sketch's pixels, 20 rows.
  const marks = photoMarks(photo({ squiggleDraw: { lines: 20 } }), w, h)!;
  assert.equal(marks.strokes, 20);
  const d = marks.passes[0];
  assert.ok(!d.includes("L"), "curves only");
  // Every row runs the full width: from the left edge to the right.
  for (const run of d.split("M").filter(Boolean)) {
    const xs = run.split(/[C ]/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 0);
    assert.ok(Math.min(...xs) < 0.01 && Math.max(...xs) > w - 0.01);
  }
});

test("squiggle: connected ends make one line, more strength taller waves, and past the white point is flat", async () => {
  await gradient("data:gradient");
  const joined = photoMarks(photo({ squiggleJoin: true, squiggleDraw: { lines: 20 } }), 4, 2)!;
  assert.equal(joined.strokes, 1);
  const ys = (d: string) => d.split(/[MC ]/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1);
  const spread = (d: string) => Math.max(...ys(d)) - Math.min(...ys(d));
  const one = (more: object) => photoMarks(photo({ squiggleDraw: { lines: 10, ...more } }), 4, 2)!.passes[0].split("M")[3];
  assert.ok(spread(one({ strength: 20 })) > spread(one({ strength: 5 })));
  assert.ok(spread(one({ strength: 0 })) < 1e-6, "no strength, no swing");
  // The photo darkens left to right; a white point of 0 counts it all as white.
  assert.ok(spread(one({ white: 0 })) < 1e-6, "all past the white point: flat");
});

test("squiggle, the Inkscape way: a row per grid row, `freq` waves a cell, at most a quarter of 256 over the divisor in mm", async () => {
  await gradient("data:gradient");
  const ink = (more: object, extra: Partial<Photo> = {}) => photoMarks(photo({ squiggleVersion: "inkscape", squiggleInkscape: { rows: 10, cols: 12, ...more }, ...extra }), 4, 2)!;
  const plain = ink({});
  assert.equal(plain.strokes, 10);
  // Each row: 11 cells of 2 waves, each wave two curves.
  for (const run of plain.passes[0].split("M").filter(Boolean)) assert.equal(run.split("C").length - 1, 11 * 2 * 2);
  assert.equal(ink({ path: "join" }).strokes, 1);
  assert.equal(ink({ path: "bidi" }).strokes, 10);
  // Amplitude 1 at black: 256 / 128 = 2 mm, the extension's quadratic control half of it either way, so
  // the curve reaches a quarter, 0.5 mm. Written as cubics, the controls are two-thirds of the way: 2/3 mm.
  const ys = (d: string) => d.split(/[MC ]/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1);
  const row = (d: string) => d.split("M")[5];
  const spread = (d: string) => Math.max(...ys(d)) - Math.min(...ys(d));
  const one = spread(row(ink({ amp: 1 }).passes[0])) * 25.4;
  assert.ok(one > 0.5 && one <= 4 / 3 + 0.01, `amplitude 1: controls spread ${one.toFixed(3)} mm`);
  assert.ok(spread(row(ink({ amp: 3 }).passes[0])) > spread(row(ink({ amp: 1 }).passes[0])));
  // Lifting leaves the white left edge bare - cell by cell, so cells finer than the white strip.
  const firstX = (d: string) => Math.min(...d.split("M").filter(Boolean).map((r) => Number(r.split(/[C ]/).filter(Boolean)[0])));
  assert.ok(firstX(ink({ cols: 100 }).passes[0]) < 0.01);
  assert.ok(firstX(ink({ cols: 100 }, { squiggleLift: true }).passes[0]) > 0.01);
});

test("squiggle: no angle or row spacing throws, even where a run is a single point", async () => {
  await gradient("data:gradient");
  for (let angle = -180; angle <= 180; angle += 5) for (const lines of [10, 60, 200]) {
    for (const band of [undefined, [0, 0.5], [0.5, 1]] as const) {
      const m = photoMarks(photo({ angle, squiggleDraw: { lines }, squiggleJoin: angle % 10 === 0, ...(band ? { band: [band[0], band[1]] as [number, number] } : {}) }), 3, 2)!;
      assert.ok(!/NaN|Infinity/.test(m.passes[0]));
      if (angle % 15 === 0) {
        const k = photoMarks(photo({ angle, squiggleVersion: "inkscape", squiggleInkscape: { rows: Math.round(lines / 4), path: angle % 30 === 0 ? "join" : "uni" }, ...(band ? { band: [band[0], band[1]] as [number, number] } : {}) }), 3, 2)!;
        assert.ok(!/NaN|Infinity/.test(k.passes[0]));
      }
    }
  }
});

test("hatching: six passes, the fifth and sixth on the diagonals, each stroke two points", async () => {
  await gradient("data:gradient");
  const marks = photoMarks(photo({ style: undefined, levels: 6, angle: 0, spacingMm: 1 }), 4, 2)!;
  assert.equal(marks.passes.length, 6);
  for (const [k, d] of marks.passes.entries()) {
    assert.ok(d.length > 0, `pass ${k + 1} draws`);
    const [x0, y0, x1, y1] = d.split("L")[0].slice(1).split(" ").concat(d.split("L")[1].split("M")[0].split(" ")).map(Number);
    const deg = (((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI) % 180 + 180) % 180;
    assert.ok(Math.abs(deg - [0, 90, 0, 90, 45, 135][k]) < 1, `pass ${k + 1} at ${deg}°`);
  }
  for (const run of marks.passes.join("").split("M").filter(Boolean)) assert.equal(run.split("L").length, 2);
});

test("hatching: smoothing turns a speckled patch into fewer, longer strokes", async () => {
  // Mid grey with a fine random speckle: unsmoothed, every speck crosses a threshold and breaks a line.
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(110 + (rand() - 0.5) * 120);
    data.set([v, v, v, 255], i * 4);
  }
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
  await readTones("data:speckle");
  const at = (hatchSmoothMm?: number) => photoMarks(photo({ src: "data:speckle", style: undefined, angle: 0, spacingMm: 0.5, levels: 4, hatchSmoothMm }), 4, 2)!.strokes;
  const raw = at();
  const smooth = at(1);
  assert.ok(smooth < raw / 2, `${raw} strokes unsmoothed, ${smooth} smoothed`);
});

test("squiggle: lifting leaves white as paper, and still draws the darks", async () => {
  await gradient("data:gradient");
  const xs = (d: string) => d.split("M").filter(Boolean).map((run) => Number(run.split(/[C ]/).filter(Boolean)[0]));
  const flat = photoMarks(photo({ angle: 0, squiggleDraw: { lines: 20 } }), 4, 2)!;
  const lifted = photoMarks(photo({ angle: 0, squiggleLift: true, squiggleDraw: { lines: 20 } }), 4, 2)!;
  // The left edge is white: unbroken rows start there; lifted ones start once there's tone.
  assert.ok(Math.min(...xs(flat.passes[0])) < 0.01);
  assert.ok(Math.min(...xs(lifted.passes[0])) > 0.01);
  assert.equal(lifted.strokes, flat.strokes); // one run per row still, each from the first tone to the edge
});

test("angle presets: classic is print's, cardinal the square, golden spread 137.5° apart", () => {
  const six = (p: "classic" | "cardinal" | "golden") => [0, 1, 2, 3, 4, 5].map((i) => presetAngle(p, i));
  assert.deepEqual(six("classic"), [45, 15, 75, 0, 30, 60]);
  assert.deepEqual(six("cardinal"), [0, 90, 45, 135, 22.5, 112.5]);
  assert.deepEqual(six("golden"), [0, 137.5, 95, 52.5, 10, 147.5]);
  assert.deepEqual((["c", "m", "y", "k"] as const).map((p) => presetAngle("classic", 0, p)), [15, 75, 0, 45]);
});

test("plate sets: an orange is drawn in the orange pen, not built from yellow and magenta", async () => {
  // Plain colour pictures, read without a browser.
  const solid = async (src: string, rgb: [number, number, number]) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([...rgb, 255], i * 4);
    (globalThis as Record<string, unknown>).document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) };
    await readTones(src);
  };
  // Pens near each plate's aim: cyan, magenta, yellow, black, orange, green.
  const pens = ["#00a3e0", "#d6007a", "#ffe500", "#1a1a1a", "#ff7a00", "#00a650"];
  const marks = (src: string, plates: string[], plate: string) =>
    photoMarks(photo({ src, style: undefined, angle: 0, spacingMm: 0.5, levels: 4, plate: plate as Photo["plate"], plates, ink: plates[0] }), 4, 2)!.passes.filter(Boolean).length;
  await solid("data:orange", [255, 122, 0]);
  const cmyk = pens.slice(0, 4);
  assert.ok(marks("data:orange", cmyk, "y") >= 2 && marks("data:orange", cmyk, "m") >= 1, "CMYK builds orange from yellow and magenta");
  const six = pens;
  const orange = marks("data:orange", six, "o");
  const yellow = marks("data:orange", six, "y");
  const magenta = marks("data:orange", six, "m");
  assert.ok(orange >= 3, `orange plate ${orange} passes`);
  assert.ok(yellow + magenta <= 1, `yellow ${yellow} and magenta ${magenta} passes beside it`);
  await solid("data:green", [0, 166, 80]);
  assert.ok(marks("data:green", six, "g") >= 3 && marks("data:green", six, "c") + marks("data:green", six, "y") <= 1, "green drawn in the green pen");
});

test("plate sets: drawn as hatching, more plates come nearer the photo, and orange is drawn in orange", () => {
  // As the hatching draws it: full-strength lines covering part of the paper, so many passes of a pen.
  const pens = ["#00a3e0", "#d6007a", "#ffe500", "#1a1a1a", "#ff6a13", "#00a650", "#e4002b", "#5b2c8f"];
  const orange = platePasses([240, 110, 30], pens);
  assert.ok(orange[4] >= 4, `orange pen ${orange[4]} passes`);
  assert.ok(orange[0] === 0 && orange[7] === 0, "no cyan or violet in an orange");
  const violet = platePasses([95, 45, 145], pens);
  assert.ok(violet[7] >= 3, `violet pen ${violet[7]} passes`);
  // White paper is left alone; black is mostly the black pen.
  assert.deepEqual(platePasses([255, 255, 255], pens), [0, 0, 0, 0, 0, 0, 0, 0]);
  const black = platePasses([20, 20, 20], pens);
  assert.ok(black[3] >= 4, `black pen ${black[3]} passes`);
});

test("plate sets: a smooth run of skin tones stays smooth in eight plates - no blotches", () => {
  // A strip of skin tones, light to dark, separated as a photo would be.
  const w = 120;
  const rgb = new Uint8ClampedArray(w * 3);
  for (let x = 0; x < w; x++) rgb.set([240 - x * 1.05, 195 - x * 1.05, 170 - x * 0.95], x * 3);
  const plates = ["#21a4de", "#f03295", "#f3e42b", "#434444", "#fe824e", "#4cc25f", "#fe6b7e", "#8443c5"];
  const maps = solveSeparation({ rgb, w, h: 1, plates, brightness: 0, contrast: 0, blackShare: 0.5, levels: 4, penMm: 0.28, spacingMm: 0.5 });
  let worst = 0;
  for (let x = 1; x < w; x++) {
    const jump = maps.reduce((sum, m) => sum + Math.abs(Math.floor(m[x] * 5) - Math.floor(m[x - 1] * 5)), 0);
    worst = Math.max(worst, jump);
  }
  assert.ok(worst <= 2, `neighbours differ by up to ${worst} passes`);
});

test("plate sets: a drawing with six plates opens with all six", async () => {
  const { parseDrawing } = await import("../src/shared/lib/drawing/parse");
  void parseDrawing; // parsing needs a browser DOM; the plate list it rebuilds is checked through platesOf below
  const { platesOf } = await import("../src/shared/lib/drawing/photo");
  assert.deepEqual(platesOf(["a", "b", "c", "d", "e", "f"]), ["c", "m", "y", "k", "o", "g"]);
  assert.deepEqual(platesOf(["a", "b", "c", "d"]), ["c", "m", "y", "k"]);
});

test("hatching: a smoothed plate waits for its own separation, rather than drawing nothing", async () => {
  const { setSeparationRunner, solveSeparation, onSeparation } = await import("../src/shared/lib/drawing/photo");
  await gradient("data:gradient");
  setSeparationRunner(async (ask) => solveSeparation(ask));
  const plates = ["#21a4de", "#f03295", "#f3e42b", "#231f20"];
  const p = photo({ style: undefined, plate: "k", plates, ink: plates[3], hatchSmoothMm: 1, spacingMm: 0.5, levels: 4, penMm: 0.28 });
  assert.equal(photoMarks(p, 4, 2), null, "not yet: its separation is being worked out");
  await new Promise((r) => onSeparation(() => r(null)));
  assert.ok(photoMarks(p, 4, 2)!.strokes > 0, "drawn once it's ready");
  setSeparationRunner(null as never);
});
