// A picture comes in at the size its file says it is, and the Scale field measures from that size:
// the resolution read from each kind of file, where it goes on the page, and its size as a percent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DPI, fileDpi, photoScale, placeAtOwnSize, type Photo } from "../src/shared/lib/drawing/photo";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u16 = (n: number) => [n >> 8, n & 255];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const file = (data: Uint8Array, name: string) => new File([data], name);

// A big-endian TIFF header with one directory: XResolution (a rational at offset 38, after the
// directory's two entries and its link to the next) and its unit.
const tiffHeader = (dpi: number, unit = 2) => bytes(
  "MM", u16(42), u32(8),
  u16(2),
  u16(282), u16(5), u32(1), u32(38),
  u16(296), u16(3), u32(1), u16(unit), u16(0),
  u32(0),
  u32(dpi), u32(1),
);

test("a JPEG's JFIF resolution, in inches or centimetres", async () => {
  const jfif = (units: number, x: number) => bytes([0xff, 0xd8, 0xff, 0xe0], u16(16), "JFIF\0", [1, 1, units], u16(x), u16(x), [0, 0], [0xff, 0xda]);
  assert.equal(await fileDpi(file(jfif(1, 300), "a.jpg")), 300);
  assert.ok(Math.abs((await fileDpi(file(jfif(2, 118), "a.jpg")))! - 299.72) < 1e-9);
  assert.equal(await fileDpi(file(jfif(0, 1), "a.jpg")), null); // only an aspect ratio: no size
});

test("a JPEG with only Exif", async () => {
  const exif = tiffHeader(240);
  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe1], u16(2 + 6 + exif.length), "Exif\0\0", [...exif], [0xff, 0xda]);
  assert.equal(await fileDpi(file(jpeg, "a.jpg")), 240);
});

test("a PNG's pHYs, in pixels to the metre", async () => {
  const png = bytes([0x89], "PNG\r\n\x1a\n", u32(9), "pHYs", u32(11811), u32(11811), [1], u32(0));
  assert.ok(Math.abs((await fileDpi(file(png, "a.png")))! - 299.9994) < 1e-3);
});

test("a TIFF's XResolution", async () => {
  assert.equal(await fileDpi(file(tiffHeader(150), "a.tif")), 150);
  assert.equal(await fileDpi(file(tiffHeader(150, 1), "a.tif")), null); // no unit: no size
});

test("a Photoshop file's ResolutionInfo", async () => {
  const resource = bytes("8BIM", u16(0x03ed), [0, 0], u32(16), u32(360 * 65536), u16(1), u16(1), u32(360 * 65536), u16(1), u16(1));
  const psd = bytes("8BPS", u16(1), [0, 0, 0, 0, 0, 0], u16(3), u32(10), u32(10), u16(8), u16(3), u32(0), u32(resource.length), [...resource]);
  assert.equal(await fileDpi(file(psd, "a.psd")), 360);
});

test("a file that doesn't say", async () => {
  assert.equal(await fileDpi(file(bytes("GIF89a", [0, 0, 0, 0]), "a.gif")), null);
});

test("it comes in at its own size, in the middle of the page, whether or not it fits", () => {
  const page = { w: 11, h: 8.5 };
  assert.deepEqual(placeAtOwnSize({ width: 600, height: 300, ppi: 300 }, page), { x: 4.5, y: 3.75, x2: 6.5, y2: 4.75 });
  const big = placeAtOwnSize({ width: 3000, height: 1500, ppi: 100 }, page);
  assert.deepEqual([big.x2 - big.x, big.y2 - big.y], [30, 15]); // larger than the paper, and left so
  const unsaid = placeAtOwnSize({ width: DEFAULT_DPI * 2, height: DEFAULT_DPI }, page);
  assert.deepEqual([unsaid.x2 - unsaid.x, unsaid.y2 - unsaid.y], [2, 1]);
});

test("its scale is its drawn size over its file's, the part cropped away left out", () => {
  const photo = { width: 600, height: 300, ppi: 300 } as Photo;
  assert.equal(photoScale({ x: 0, x2: 2, photo }), 100);
  assert.equal(photoScale({ x: 1, x2: 4, photo }), 150);
  // Half of it showing, drawn 1 in wide: the part that shows is 1 in at its own size.
  assert.equal(photoScale({ x: 0, x2: 1, photo: { ...photo, crop: [0.25, 0, 0.75, 1] } }), 100);
  // From before its size was kept: as it is now is 100%.
  assert.equal(photoScale({ x: 0, x2: 5, photo: { width: 600, height: 300 } as Photo }), 100);
});
