// Single-stroke fonts. A plotter draws a letter as a few lines, not as an outline it fills in, so
// text here is set in an SVG font whose glyphs are open paths: the pen follows them once.
//
// The fonts are served by the app (fonts/ in the repository, see the licence notices in each file).
// A glyph's coordinates are in font units with y running up from the baseline, which is why drawing
// one flips the y axis.

export interface Glyph {
  /** The glyph's own path, in font units. */
  d: string;
  /** How far along the line the next letter starts, in font units. */
  advance: number;
}

export interface StrokeFont {
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  glyphs: Map<string, Glyph>;
  /** What a character the font hasn't got is drawn as; often nothing at all. */
  missing: Glyph;
}

const num = (el: Element | null, name: string, fallback: number) => {
  const v = Number(el?.getAttribute(name));
  return Number.isFinite(v) && v !== 0 ? v : fallback;
};

const glyphOf = (el: Element, fallbackAdvance: number): Glyph => ({
  d: el.getAttribute("d") ?? "",
  advance: Number(el.getAttribute("horiz-adv-x")) || fallbackAdvance,
});

/** Read an SVG font into the glyphs and the numbers needed to set a line of them. */
export function parseFont(name: string, text: string): StrokeFont {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const face = doc.querySelector("font-face");
  const font = doc.querySelector("font");
  const unitsPerEm = num(face, "units-per-em", 1000);
  const defaultAdvance = num(font, "horiz-adv-x", unitsPerEm / 2);
  const glyphs = new Map<string, Glyph>();
  for (const el of Array.from(doc.querySelectorAll("glyph"))) {
    const char = el.getAttribute("unicode");
    if (char) glyphs.set(char, glyphOf(el, defaultAdvance));
  }
  const missingEl = doc.querySelector("missing-glyph");
  return {
    name,
    unitsPerEm,
    ascent: num(face, "ascent", unitsPerEm * 0.8),
    descent: num(face, "descent", -unitsPerEm * 0.2),
    glyphs,
    missing: missingEl ? glyphOf(missingEl, defaultAdvance) : { d: "", advance: defaultAdvance },
  };
}

/** The fonts the app ships, by name. */
export async function fontNames(): Promise<string[]> {
  const res = await fetch("/api/fonts");
  if (!res.ok) throw new Error("Couldn't read the list of fonts.");
  return (await res.json()).fonts ?? [];
}

export async function loadFont(name: string): Promise<StrokeFont> {
  const res = await fetch(`/fonts/${encodeURIComponent(name)}.svg`);
  if (!res.ok) throw new Error(`Couldn't load the font ${name}.`);
  return parseFont(name, await res.text());
}

export interface SetGlyph {
  d: string;
  /** Where the glyph starts along the line, in font units. */
  x: number;
  /** Which line it is on, counting down from the first. */
  line: number;
}

export interface SetText {
  glyphs: SetGlyph[];
  /** The longest line, in font units. */
  width: number;
  lines: number;
}

/**
 * Set a string in a font: where each glyph goes, in font units, with the first baseline at y = 0.
 * `tracking` is extra room after each letter, in font units.
 */
export function setText(text: string, font: StrokeFont, tracking = 0): SetText {
  const glyphs: SetGlyph[] = [];
  let width = 0;
  let x = 0;
  let line = 0;
  for (const char of text) {
    if (char === "\n") {
      width = Math.max(width, x);
      x = 0;
      line += 1;
      continue;
    }
    const glyph = font.glyphs.get(char) ?? font.missing;
    if (glyph.d) glyphs.push({ d: glyph.d, x, line });
    x += glyph.advance + tracking;
  }
  // The last letter's tracking is room after the end of the line, which is not part of its width.
  return { glyphs, width: Math.max(0, Math.max(width, x) - tracking), lines: line + 1 };
}

/** How far apart the baselines sit, in font units: the whole em, ascender to descender. */
export const lineStep = (font: StrokeFont) => font.ascent - font.descent;
