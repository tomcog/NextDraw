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
