// A photo split by a printer profile and written as a Multichannel Photoshop file: the file reads back
// as it went in, and the profile's adjustments - black point compensation, Absolute colorimetric - do
// what Photoshop's do. The profile tests use NextDraw's own seven-ink profile, where this Mac has it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inkPlanes, inksOf, parseProfile } from "../src/shared/lib/drawing/icc";
import { multichannelPsd, packBits } from "../src/photo/lib/multichannelPsd";

const ECG = `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/NextDraw Studio/Color profiles/IA ECG B1C.icc`;
const ECG_X = `${process.env.HOME}/Library/ColorSync/Profiles/IA ECG B1C X.icc`;
const read = (path: string) => {
  const buf = readFileSync(path);
  return parseProfile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
};
const ecg = () => read(ECG);
const greys = (...g: number[]) => new Uint8ClampedArray(g.flatMap((v) => [v, v, v, 255]));
const total = (inks: Float32Array[], i: number) => inks.reduce((s, ink) => s + ink[i], 0);

/** PackBits undone, as Photoshop (and server.py's unpack_bits) reads it. */
function unpack(src: Uint8Array, length: number): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (out.length < length) {
    const n = src[i++];
    if (n < 128) { for (let k = 0; k <= n; k++) out.push(src[i++]); }
    else if (n > 128) { const v = src[i++]; for (let k = 0; k < 257 - n; k++) out.push(v); }
  }
  return Uint8Array.from(out);
}

test("a row packs and unpacks to itself: runs, single bytes, and both longer than 128", () => {
  const row = Uint8Array.from([...Array(300).fill(7), 1, 2, 3, 3, 4, ...Array.from({ length: 200 }, (_, i) => i % 251), 9, 9, 9]);
  assert.deepEqual(unpack(packBits(row), row.length), row);
});

test("the file reads back: Multichannel, each channel's name, color and pixels", () => {
  const w = 5, h = 3;
  const planes = [0, 1, 2].map((c) => Uint8Array.from({ length: w * h }, (_, i) => (i * 37 + c * 80) % 256));
  const channels = [
    { name: "Cyan", color: "#00a0e0", plane: planes[0] },
    { name: "Orange", color: "#f08020", plane: planes[1] },
    { name: "Violet", color: "#6030a0", plane: planes[2] },
  ];
  const psd = multichannelPsd(w, h, channels);
  const d = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...psd.subarray(at, at + n));
  assert.equal(ascii(0, 4), "8BPS");
  assert.deepEqual([d.getUint16(12), d.getUint32(14), d.getUint32(18), d.getUint16(22), d.getUint16(24)], [3, h, w, 8, 7]);
  let at = 26;
  at += 4 + d.getUint32(at);
  const resEnd = at + 4 + d.getUint32(at);
  at += 4;
  const names: string[] = [];
  const colors: string[] = [];
  while (at < resEnd) {
    assert.equal(ascii(at, 4), "8BIM");
    const id = d.getUint16(at + 4);
    const size = d.getUint32(at + 8);
    const body = at + 12;
    if (id === 1045) {
      for (let b = body; b < body + size;) {
        const n = d.getUint32(b);
        names.push(String.fromCharCode(...Array.from({ length: n }, (_, k) => d.getUint16(b + 4 + 2 * k))));
        b += 4 + 2 * n;
      }
    }
    if (id === 1077) {
      for (let b = body + 4; b < body + size; b += 13) {
        assert.equal(d.getUint16(b), 0, "an RGB color");
        // Solidity 0: transparent ink, the channels shown mixed as they print, as Photoshop writes it.
        assert.equal(d.getUint16(b + 10), 0, "solidity");
        colors.push(`#${[2, 4, 6].map((o) => (d.getUint16(b + o) >> 8).toString(16).padStart(2, "0")).join("")}`);
      }
    }
    at = body + size + (size % 2);
  }
  assert.deepEqual(names, ["Cyan", "Orange", "Violet"]);
  assert.deepEqual(colors, ["#00a0e0", "#f08020", "#6030a0"]);
  at = resEnd;
  at += 4 + d.getUint32(at);
  assert.equal(d.getUint16(at), 1, "packed");
  at += 2;
  const lengths = Array.from({ length: 3 * h }, (_, i) => d.getUint16(at + 2 * i));
  at += 2 * 3 * h;
  planes.forEach((plane, c) => {
    const read: number[] = [];
    for (let y = 0; y < h; y++) {
      const n = lengths[c * h + y];
      read.push(...unpack(psd.subarray(at, at + n), w));
      at += n;
    }
    assert.deepEqual(Uint8Array.from(read), plane, `${channels[c].name}'s pixels`);
  });
  assert.equal(at, psd.length, "nothing after the picture");
});

test("seven inks: named and colored from the profile, white no ink", { skip: !existsSync(ECG) }, () => {
  const profile = ecg();
  assert.equal(profile.inks, 7);
  assert.equal(profile.names?.length, 7);
  const planes = inkPlanes(profile, greys(255, 0));
  assert.ok(planes.every((p) => p[0] === 255), "white takes no ink");
  assert.ok(planes.some((p) => p[1] < 128), "black takes ink");
});

test("black point compensation keeps shadows apart that Relative colorimetric clips together", { skip: !existsSync(ECG) }, () => {
  const profile = ecg();
  const px = greys(0, 8, 16);
  const clipped = inksOf(profile, px, { intent: 1 });
  const kept = inksOf(profile, px, { intent: 1, bpc: true });
  assert.ok(Math.abs(total(clipped, 0) - total(clipped, 2)) < 0.02, "without, the three are one black");
  assert.ok(total(kept, 0) - total(kept, 1) > 0.05 && total(kept, 1) - total(kept, 2) > 0.05, "with, each is its own");
  // It changes nothing for Perceptual, whose table already brings the black down.
  assert.deepEqual(inksOf(profile, px, { intent: 0, bpc: true }), inksOf(profile, px, { intent: 0 }));
});

test("Absolute colorimetric leaves a near-white to the paper, which is that color already", { skip: !existsSync(ECG) }, () => {
  const profile = ecg();
  const px = greys(245);
  assert.ok(total(inksOf(profile, px, { intent: 3 }), 0) < total(inksOf(profile, px, { intent: 1 }), 0) / 2);
});

// Pixels of a Polaroid (sRGB) and the inks Photoshop gave them converting to IA ECG B1C X, Perceptual,
// Adobe's engine, on 2026-10-14 - read from the Multichannel file it saved, 0 to 255 of each ink.
const PHOTOSHOP_X = [
  [[191, 145, 92], [48, 72, 141, 0, 66, 37, 21]],
  [[164, 121, 84], [76, 104, 152, 2, 66, 45, 29]],
  [[140, 84, 42], [75, 133, 190, 15, 127, 74, 56]],
  [[38, 88, 80], [202, 110, 147, 50, 22, 85, 38]],
  [[141, 152, 132], [107, 71, 117, 2, 18, 36, 12]],
  [[41, 51, 34], [181, 136, 192, 145, 41, 88, 28]],
  [[228, 228, 215], [21, 16, 31, 0, 6, 10, 1]],
  [[9, 79, 86], [215, 104, 125, 61, 14, 100, 57]],
];

test("IA ECG B1C X, a version 4 profile (mBA tables): the page's inks come within 2% of Photoshop's on average", { skip: !existsSync(ECG_X) }, () => {
  const profile = read(ECG_X);
  assert.equal(profile.inks, 7);
  assert.equal(profile.black, undefined, "it gives no black point, so there's nothing for black point compensation");
  const inks = inksOf(profile, new Uint8ClampedArray(PHOTOSHOP_X.flatMap(([c]) => [...c, 255])), { intent: 0 });
  const off = PHOTOSHOP_X.flatMap(([, want], i) => inks.map((ink, k) => Math.abs(ink[i] * 255 - want[k])));
  // Each ink of each pixel within 6%; over them all, within 2%.
  PHOTOSHOP_X.forEach(([, want], i) => inks.forEach((ink, k) => {
    assert.ok(Math.abs(ink[i] * 255 - want[k]) <= 15, `pixel ${i}, ${profile.names?.[k]}: ${Math.round(ink[i] * 255)} against ${want[k]}`);
  }));
  assert.ok(off.reduce((a, b) => a + b, 0) / off.length <= 5, "on average within 2%");
});
