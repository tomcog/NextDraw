// The palette editor's HSL fields: whole numbers that step by one and land on the colour they say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToHsl, hslToHex } from "../src/shared/lib/color";

test("hex to HSL and back again", () => {
  assert.deepEqual(hexToHsl("#ff0000"), [0, 100, 50]);
  assert.deepEqual(hexToHsl("#808080"), [0, 0, 50]);
  assert.equal(hslToHex(0, 100, 50), "#ff0000");
  assert.equal(hslToHex(240, 100, 50), "#0000ff");
  assert.equal(hslToHex(0, 0, 100), "#ffffff");
  // A palette's colours come back within a step of themselves.
  for (const hex of ["#2457b5", "#f6f1e1", "#8b5a3c", "#9ccc45", "#1e1e1e"]) {
    const [h, s, l] = hexToHsl(hex)!;
    const back = hslToHex(h, s, l);
    const diff = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)));
    assert.ok(Math.max(...diff) <= 3, `${hex} -> ${back}`);
  }
});

test("a step of one lightness changes the colour", () => {
  const [h, s, l] = hexToHsl("#2457b5")!;
  assert.notEqual(hslToHex(h, s, l + 1), hslToHex(h, s, l));
});

test("a layer's name is its pen and, after it, a label of its own", async () => {
  const { joinLayerName, splitLayerName } = await import("../src/shared/lib/ink");
  const palette = [{ name: "Black", color: "#000000" }, { name: "Sky Blue", color: "#6cc2ea" }, { name: "Blue", color: "#2457b5" }];
  assert.deepEqual(splitLayerName("Black - Crop marks", palette), { pen: "Black", label: "Crop marks" });
  assert.deepEqual(splitLayerName("Black", palette), { pen: "Black", label: "" });
  assert.deepEqual(splitLayerName("Black 2", palette), { pen: "Black", label: "" });
  assert.deepEqual(splitLayerName("Sky Blue - Water", palette), { pen: "Sky Blue", label: "Water" });
  assert.deepEqual(splitLayerName("Lime - register", palette), { pen: "Lime", label: "register" });
  assert.deepEqual(splitLayerName("Signature", palette), { pen: null, label: "Signature" });
  assert.equal(joinLayerName("Black", "Crop marks"), "Black - Crop marks");
  assert.equal(joinLayerName("Black", "  "), "Black");
});
