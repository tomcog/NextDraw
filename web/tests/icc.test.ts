// A printer profile applied in the page, as macOS would: Generic CMYK, which every Mac has, against
// what macOS's own converter (sips, perceptual) made of the same colors on 2026-10-13.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inksOf, labHex, parseProfile } from "../src/shared/lib/drawing/icc";

const GENERIC = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
const COLORS = [[255, 255, 255], [0, 0, 0], [255, 0, 0], [0, 0, 255], [200, 150, 100], [60, 90, 140]];
// sips --matchToWithIntent "Generic CMYK Profile.icc" perceptual, read back as 0-255 ink.
const MACOS = [[0, 0, 0, 0], [188, 180, 164, 222], [1, 213, 239, 2], [225, 173, 0, 0], [38, 97, 163, 8], [213, 156, 19, 13]];

test("Generic CMYK: the page's inks come within 2% of macOS's", { skip: !existsSync(GENERIC) }, () => {
  const buf = readFileSync(GENERIC);
  const profile = parseProfile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.equal(profile.inks, 4);
  const inks = inksOf(profile, new Uint8ClampedArray(COLORS.flatMap((c) => [...c, 255])));
  COLORS.forEach((_, i) => inks.forEach((ink, k) => {
    assert.ok(Math.abs(ink[i] * 255 - MACOS[i][k]) <= 5, `color ${i}, ink ${k}: ${Math.round(ink[i] * 255)} against ${MACOS[i][k]}`);
  }));
});

test("an ink's Lab color comes out as the hex it is", () => {
  assert.equal(labHex(100, 0, 0), "#ffffff");
  assert.equal(labHex(0, 0, 0), "#000000");
});
