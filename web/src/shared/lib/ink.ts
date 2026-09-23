import type { Ink, PenColor } from "./types";

// How a tool's ink is shown in the preview, shared by Plot and Studio so a drawing looks the same in
// both. The rules themselves live in index.css (`.pv-colored .pv-layer`, `.pv-build`, `.pv-flat`),
// which both apps load; this is the arithmetic those rules need handed to them.
//
// Two kinds of ink, because two kinds of pen:
//
// - Ink that BUILDS (a brush): every stroke is translucent in itself, so it darkens whatever it
//   crosses, its own colour included. Drawn as two passes - the ink, solid, and a copy over it that
//   only multiplies. Where two strokes cross, the copy multiplies twice, so the crossing darkens
//   while a single pass doesn't. That's what lets the build amount run from nothing to full without
//   the overall density moving.
// - Ink that DOESN'T build (a gel pen): more of the same ink adds nothing. One pass, flattened, then
//   blended into what's under it with `darken` - so this ink over itself leaves it exactly as it was
//   however many passes go down, while a different colour still takes whichever is darker.
//
// The catch with the two-pass version: the copy dims the single pass a little too. So the base
// colour is lightened by exactly the amount the copy will dim it, and a lone stroke comes out at the
// colour asked for rather than slightly dark.

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** A stroke of this colour over one of its own, at this build: what the crossing comes out as. */
const dim = (hex: string, at: number) => channels(hex).map((c) => 1 - at + at * c);

const lighten = (hex: string, by: number[]) => {
  const out = channels(hex).map((c, i) => Math.round(Math.min(1, c / by[i]) * 255));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

export interface InkLayer {
  /** What to set --layer-color to on the layer itself. */
  base: string;
  /** What to set it to on the build copy, or null when the layer doesn't get one. */
  buildPass: string | null;
}

/**
 * How to paint one layer.
 *
 * `color` is the pen's colour, `build` how much a crossing darkens (0-1), `builds` whether this tool's
 * ink builds at all, and `sim` whether ink simulation is on. With it off there is one flat pass in
 * the pen's own colour, which is both what you want for judging placement and much cheaper on a
 * drawing of many thousands of strokes.
 */
export function inkLayer(color: string, build: number, builds: boolean, sim: boolean): InkLayer {
  const amount = Math.min(1, Math.max(0, build));
  if (!sim || !builds || amount <= 0) return { base: color, buildPass: null };
  return { base: lighten(color, dim(color, amount)), buildPass: color };
}

/**
 * The colour to show a layer in, for an ink that names a pen.
 *
 * The pen is looked up by name in the tool the layer is being drawn with, so editing a colour in the
 * palette reaches every layer using that pen. Swapping tools carries the choice across by name - a
 * layer plotted in Sky Blue stays Sky Blue when the tool changes, in the new tool's own Sky Blue -
 * and when the new tool has no pen by that name, the one it was picked from still answers, so the
 * layer keeps a colour that belongs to a real pen rather than falling back to the drawing's own.
 *
 * `null` when nothing can answer: the tool is gone from presets.json and the ink carries no fallback.
 */
export function inkHex(
  ink: Ink | undefined,
  palette: PenColor[],
  paletteOf: (tool: string) => PenColor[],
): string | null {
  if (!ink) return null;
  if (typeof ink === "string") return ink; // a colour picked by hand, and every file written before pens
  const named = (pens: PenColor[]) =>
    pens.find((p) => p.name.trim().toLowerCase() === ink.pen.trim().toLowerCase())?.color ?? null;
  return named(palette) ?? named(paletteOf(ink.tool)) ?? ink.hex ?? null;
}

/** Whether an ink is this pen of this tool, for showing which one is ticked in the palette menu. */
export const isPen = (ink: Ink | undefined, tool: string, pen: string) =>
  typeof ink === "object" && ink !== null
  && ink.tool === tool
  && ink.pen.trim().toLowerCase() === pen.trim().toLowerCase();

/**
 * The name of the pen a layer is being plotted in, for saying so beside the layer's own name.
 *
 * A colour picked with the colour picker has no name and answers null, as does a hex from an older
 * file that matches nothing in the palette - there is no pen to name, and inventing one would be
 * worse than saying nothing.
 */
export function penNameOf(ink: Ink | undefined, palette: PenColor[]): string | null {
  if (!ink) return null;
  if (typeof ink === "string") return penNameAt(ink, palette);
  const here = palette.find((p) => p.name.trim().toLowerCase() === ink.pen.trim().toLowerCase());
  return here?.name ?? ink.pen; // the pen as this tool spells it, or as it was picked
}

/**
 * Whether a layer is one of this tool's pens: a pen in its palette by the layer's name, in the
 * layer's colour. Both, because each alone can mislead - "Brown" in another maker's brown names a pen
 * this tool has but isn't drawn in it, and "Mono" in this tool's black is drawable but doesn't say
 * which pen to load. Names are matched as a person reads them, not minding capitals or stray spaces.
 * A tool with no palette answers null: it draws in whatever is clipped into it, so nothing is off it.
 * Both apps strike the layer's dot through when this is false.
 */
export function isPalettePen(name: string, color: string | null, palette: PenColor[]): boolean | null {
  if (!palette.length) return null;
  if (!color) return false;
  // A second layer in the same pen is numbered to tell them apart ("Yellow 2"): still that pen.
  const wanted = [name.trim().toLowerCase(), name.trim().toLowerCase().replace(/ \d+$/, "")];
  return palette.some((p) => wanted.includes(p.name.trim().toLowerCase()) && p.color.toLowerCase() === color.toLowerCase());
}

/** The pen of this palette that draws this colour, by name. Null when no pen of it does. */
export const penNameAt = (color: string | null, palette: PenColor[]) =>
  (color ? palette.find((p) => p.color.toLowerCase() === color.toLowerCase())?.name ?? null : null);
