// A Multichannel image split another way keeps its plates to come back to as Channels: cropping or
// turning the picture does the same to them, each plate's picture made once however many layers keep it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keptPlatesAlike, partOfPart, turnedCrop, type Photo, type PhotoPart } from "../src/shared/lib/drawing/photo";

const plate = (src: string, extra: Partial<Photo> = {}): PhotoPart => ({ layerName: src, layerColor: "#000000", shapeName: src, photo: { src, width: 100, height: 50, separation: src, ...extra } });
const photo = (modes?: Photo["modes"]) => ({ src: "joined", width: 100, height: 50, brightness: 0, contrast: 0, angle: 0, spacingMm: 0.5, levels: 3, modes }) as unknown as Photo;

test("a crop cuts every kept plate, and its cut is a part of the file's", async () => {
  const made = new Map();
  let calls = 0;
  const cutTo = async (src: string) => ({ src: `${src}-cut`, width: 50, height: 25 }) as Pick<Photo, "src" | "width" | "height">;
  const part: [number, number, number, number] = [0.5, 0.5, 1, 1];
  const was = photo({ value: [], separations: [plate("cyan", { cut: [0, 0, 0.5, 1] }), plate("black")] });
  const modes = await keptPlatesAlike(was, async (src) => (calls++, cutTo(src)), (p) => ({ cut: partOfPart(p.cut, part) }), made);
  assert.deepEqual(modes!.separations!.map((p) => [p.photo.src, p.photo.width, p.photo.cut]), [
    ["cyan-cut", 50, [0.25, 0.5, 0.5, 1]],
    ["black-cut", 50, [0.5, 0.5, 1, 1]],
  ]);
  assert.deepEqual(modes!.value, [], "the other modes stay");
  // Another layer keeping the same plates: the pictures already made are used again.
  await keptPlatesAlike(was, async (src) => (calls++, cutTo(src)), (p) => ({ cut: partOfPart(p.cut, part) }), made);
  assert.equal(calls, 2);
});

test("a turn turns every kept plate, its cut and its quarter turns", async () => {
  const was = photo({ separations: [plate("cyan", { cut: [0, 0, 0.5, 1], quarterTurns: 3 })] });
  const modes = await keptPlatesAlike(was, async (src) => ({ src: `${src}-turned`, width: 50, height: 100 }), (p) => ({ cut: turnedCrop(p.cut, 1), quarterTurns: (((p.quarterTurns ?? 0) + 1) % 4) || undefined }), new Map());
  const [cyan] = modes!.separations!;
  assert.equal(cyan.photo.src, "cyan-turned");
  assert.equal(cyan.photo.height, 100);
  assert.deepEqual(cyan.photo.cut, turnedCrop([0, 0, 0.5, 1], 1));
  assert.equal(cyan.photo.quarterTurns, undefined);
});

test("a photo keeping no plates is left as it is", async () => {
  const was = photo({ value: [] });
  assert.equal(await keptPlatesAlike(was, async () => { throw new Error("not asked"); }, () => ({}), new Map()), was.modes);
  assert.equal(await keptPlatesAlike(photo(), async () => { throw new Error("not asked"); }, () => ({}), new Map()), undefined);
});
