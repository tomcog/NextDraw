// The pen a photo is converted for when no preset is chosen - "None" in the Pen card. Nothing about
// it is measured: its colors are print's, the ones CMYK and its extra plates aim for, so a split
// lands on them exactly, with blue, white and grays besides; its line and spacing are the ones the
// app falls back on anyway. Any layer's color can then be changed to whatever the pen in hand is,
// from a color picker.

import { lightness } from "../../shared/lib/color";
import { PLATE_AIMS } from "../../shared/lib/drawing/photo";
import type { Preset } from "../../shared/lib/types";

export const GENERAL_PEN: Preset = {
  name: "General colors",
  settings: { pen_width: 0.5 },
  hatch: { spacing_mm: 1.5 },
  // Print's colors, and the neutrals a picture split around the paper wants - black and white on
  // gray, with grays between. Darkest first, lightest at the bottom of the list.
  palette: [
    ...Object.values(PLATE_AIMS).map(({ name, color }) => ({ name, color })),
    { name: "Blue", color: "#1f4fbf" },
    { name: "Dark gray", color: "#4d4d4d" },
    { name: "Gray", color: "#808080" },
    { name: "Light gray", color: "#b3b3b3" },
    { name: "White", color: "#ffffff" },
  ].sort((a, b) => (lightness(a.color) ?? 0) - (lightness(b.color) ?? 0)),
};
