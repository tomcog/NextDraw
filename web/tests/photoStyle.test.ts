// Every effect survives being saved and read back - what happens on switching apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoData, photoFromData, type Photo } from "../src/shared/lib/drawing/photo";
import { EFFECTS } from "../src/photo/components/EffectToolbar";

const base = { src: "data:image/jpeg;base64,", width: 1, height: 1, brightness: 0, contrast: 0, angle: 45, spacingMm: 1, levels: 4 } as Photo;

test("each effect is read back as itself", () => {
  for (const { key } of EFFECTS) {
    const style = key === "hatch" ? undefined : key;
    assert.equal(photoFromData(photoData({ ...base, style } as Photo))?.style, style, key);
  }
});
