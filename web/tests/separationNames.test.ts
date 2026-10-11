import { test } from "node:test";
import assert from "node:assert/strict";
import { inkNamed, stemWithoutPlate } from "../src/shared/lib/drawing/photo";

const pens = [{ name: "Pink", color: "#f4a" }, { name: "Light Blue", color: "#9cf" }, { name: "Black", color: "#111" }];

test("separations: the ink is found in the name however it's written", () => {
  const plate = (name: string) => inkNamed(name, pens)?.plate;
  assert.equal(plate("Portrait_Cyan.png"), "c");
  assert.equal(plate("portrait-magenta-channel.tif"), "m");
  assert.equal(plate("PortraitYellow.jpg"), "y");
  assert.equal(plate("portraitblack.png"), "k");
  assert.equal(plate("IMG_0042 K.png"), "k");
  assert.equal(plate("portrait (c).png"), "c");
  assert.equal(plate("sunset_orange.png"), "o");
  assert.equal(plate("sunset GREEN 2.png"), "g");
  assert.equal(plate("sunset_red.png"), "r");
  assert.equal(plate("sunset-purple.png"), "v");
  // Not a red hidden in another word, nor a key in a keyboard.
  assert.equal(inkNamed("colored keyboard.png", pens), undefined);
  // A pen of the palette, by its own name.
  assert.equal(inkNamed("sky_light_blue.png", pens)?.pen?.name, "Light Blue");
  assert.equal(inkNamed("cheeks-pink.png", pens)?.pen?.name, "Pink");
  assert.equal(inkNamed("portrait.png", pens), undefined);
});

test("separations: the drawing is named for the files without their ink", () => {
  assert.equal(stemWithoutPlate("Portrait_Cyan.png"), "Portrait");
  assert.equal(stemWithoutPlate("portrait-magenta-channel.tif"), "portrait");
  assert.equal(stemWithoutPlate("PortraitYellow.jpg"), "Portrait");
});

test("separations: any color by its name is drawn in that color", () => {
  const color = (name: string) => inkNamed(name, pens)?.color;
  assert.deepEqual(color("Portrait_Peach.png"), { name: "peach", color: "#ffcba4" });
  assert.equal(color("portrait-cranberry.png")?.name, "cranberry");
  assert.equal(color("PortraitFederalBlue.png")?.name, "federal blue");
  assert.equal(color("sunset fluorescent pink.png")?.name, "fluorescent pink");
  // Riso's aqua, not the web's.
  assert.equal(color("ink-3-aqua.png")?.color, "#5ec8e5");
  // A plate's name is still a plate, and a pen's name its pen.
  assert.equal(inkNamed("portrait_red.png", pens)?.plate, "r");
  assert.equal(inkNamed("cheeks-pink.png", pens)?.pen?.name, "Pink");
  assert.equal(inkNamed("IMG_0042.png", pens), undefined);
});
