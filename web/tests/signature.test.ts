// The signature as Studio makes it, against the drawing it was taken from: the same size and the year
// where that drawing has it - and any other year set the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import { parseFont } from "../src/shared/lib/drawing/font";
import { flattenRun, parsePath } from "../src/shared/lib/drawing/path";
import { pointsBox } from "../src/shared/lib/drawing/shapes";
import { signatureShapes, signatureSize } from "../src/studio/lib/signature";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const FONT = parseFont("HersheySans1", readFileSync("../fonts/HersheySans1.svg", "utf8"));
const REFERENCE = `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/Robot Drawing Machine/*REFERENCE/tc-2026.svg`;
const boxOf = (shapes: { x: number; y: number; x2: number; y2: number }[]) =>
  pointsBox(shapes.flatMap((s) => [{ x: s.x, y: s.y }, { x: s.x2, y: s.y2 }]));

test("2026 comes out as the drawing it was taken from: the same size, the year where it has it", { skip: !existsSync(REFERENCE) }, () => {
  const svg = readFileSync(REFERENCE, "utf8");
  // The drawing in its own millimetres: the year as it is, the initials through their matrix.
  const year = [...svg.match(/<g\s+id="g6"[\s\S]*?<\/g>/)![0].matchAll(/<path\s+d="([^"]*)"/g)]
    .flatMap((m) => parsePath(m[1]).flatMap((run) => flattenRun(run)));
  const tcD = svg.match(/id="g2"[\s\S]*?<path[\s\S]*?d="([^"]*)"/)![1];
  const k = 0.23890239;
  const tc = [...parsePath(tcD).flatMap((run) => flattenRun(run)), { x: 875.98877, y: 61.943138 }, { x: 898.73682, y: 79.004143 }]
    .map((p) => ({ x: p.x * k - 191.88661, y: p.y * k + 15.314941 }));
  const all = pointsBox([...year, ...tc]);
  const yearBox = pointsBox(year);
  const inch = (mm: number) => mm / 25.4;

  const made = signatureShapes(2026, FONT, "layer", { x: 0, y: 0 });
  const whole = boxOf(made);
  assert.ok(Math.abs(whole.x1 - whole.x0 - inch(all.x1 - all.x0)) < 0.01, `width ${whole.x1 - whole.x0} against ${inch(all.x1 - all.x0)}`);
  assert.ok(Math.abs(whole.y1 - whole.y0 - inch(all.y1 - all.y0)) < 0.01, `height ${whole.y1 - whole.y0} against ${inch(all.y1 - all.y0)}`);
  const digits = boxOf(made.filter((s) => s.smooth));
  for (const [got, want] of [[digits.x0, yearBox.x0 - all.x0], [digits.x1, yearBox.x1 - all.x0], [digits.y0, yearBox.y0 - all.y0], [digits.y1, yearBox.y1 - all.y0]]) {
    assert.ok(Math.abs(got - inch(want)) < 0.01, `the year's box: ${got} against ${inch(want)}`);
  }
});

test("every path is one group, Signature, on its layer, placed where it's asked; any year can be set", () => {
  const made = signatureShapes(2031, FONT, "layer-s", { x: 9, y: 7 });
  assert.ok(made.length >= 7, "the C, the T's two strokes and four digits at least");
  assert.equal(new Set(made.map((s) => s.group)).size, 1);
  assert.ok(made.every((s) => s.groupName === "Signature" && s.layerId === "layer-s" && s.kind === "path"));
  const whole = boxOf(made);
  assert.ok(Math.abs(whole.x0 - 9) < 1e-9 && Math.abs(whole.y0 - 7) < 1e-9);
  const size = signatureSize(2031, FONT);
  assert.ok(Math.abs(whole.x1 - 9 - size.w) < 1e-9 && Math.abs(whole.y1 - 7 - size.h) < 1e-9);
  // The digits are the year's: a 1 and a 3 are drawn, which 2026 hasn't.
  assert.ok(made.filter((s) => s.smooth).length >= 4);
});
