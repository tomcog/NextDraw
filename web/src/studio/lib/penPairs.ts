import { hexToHsl, lightness } from "../../shared/lib/color";
import type { PenColor, Preset } from "../../shared/lib/types";
import { newFillId, type Fill } from "./hatch";
import { newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";

// A pen pairs sheet: two of a tool's pens hatched over each other, the lighter first and the darker
// across it - what overlaid hatching really makes on paper, where print gets its in-between colours
// from. The patches are dense, so most of each one is ink over ink and it reads as an area of colour
// rather than two sets of lines. Not every pair - twenty pens make 190 - but the ones a photo would
// reach for: in-between colours, skin, foliage, sky and water, shadows. Like the calibration sheet it's an ordinary drawing, a
// layer per pen, lightest at the bottom, which is the order Plot draws in and so the only order a
// photo will ever come out in.

/** How much of the paper each pen covers in a patch, as a share: both solid, one solid and the other
 *  at half either way round, and both at half. Solid is the spacing the tool was measured solid at. */
export const PAIR_COVERS: [number, number][] = [[1, 1], [1, 0.5], [0.5, 1], [0.5, 0.5]];

/** The pairs chosen for photographs, by tool, either way round - the lighter pen goes down first. */
export const PHOTO_PAIRS: Record<string, [string, string][]> = {
  EnerGel: [
    ["Yellow", "Sky Blue"], ["Yellow", "Turquoise"], ["Yellow", "Green"], ["Yellow", "Red"],
    ["Yellow", "Pink"], ["Sky Blue", "Pink"], ["Pink", "Blue"], ["Yellow", "Coral pink"],
    ["Orange", "Brown"], ["Coral pink", "Sepia"], ["Lime Green", "Forest Green"], ["Sky Blue", "Navy Blue"],
    ["Turquoise", "Blue"], ["Yellow", "Sepia"], ["Orange", "Gray"], ["Red", "Burgundy"],
  ],
};
const PAIRS = 16;

const MARGIN = 0.5; // in, clear of the paper's edge
const MARK = 0.25; // the corner marks, solid squares a photo is lined up by
const PATCH_LARGEST = 0.6;
const PATCH_SMALLEST = 0.45; // no smaller: "50+25" over each patch has to fit its width
const PATCH_GAP = 0.08;
const COLUMN_GAP = 0.45;
// The words, sized to be read off the paper across a desk, and spaced out: a gel line is wide for
// letters this size, and set close they run together.
const LABEL = 0.18; // the pair's pens, on two lines left of its patches
const COVER_LABEL = 0.13; // "100" over "+50" above each patch of the top row
const HEADING = 0.22;
const TRACKING = 15; // percent of the size, between letters
const LEADING = 1.3; // a two-line name's lines apart, as a multiple of the font's own
const PER_LETTER = 0.75; // ems a letter takes, spacing included - generous, so names never reach the patches
const PAPER_CLEAR = 0.3; // bare paper either side of every row's patches, to measure against
const ROW_GAP = 0.2;

const pct = (cover: number) => `${Math.round(cover * 1000) / 10}`;
/** A patch's name says both pens and how much of each, so the sheet can be read back by its shapes. */
export const pairName = (under: string, underCover: number, over: string, overCover: number) =>
  `${under} ${pct(underCover)}% + ${over} ${pct(overCover)}% pair`;

/**
 * The pairs to plot: a spread across how far apart two pens are in colour and in lightness, and
 * where on the colour wheel they sit, each pen in at most two. Greys and blacks count as apart from
 * everything in colour. The lighter pen of each pair comes first - it's the one that goes down first.
 */
export function choosePairs(pens: PenColor[], count = PAIRS): [PenColor, PenColor][] {
  const look = new Map(pens.map((p) => {
    const [h, s] = hexToHsl(p.color) ?? [0, 0, 0];
    return [p.name, { h, s, l: lightness(p.color) ?? 0 }];
  }));
  const all: { pair: [PenColor, PenColor]; f: number[] }[] = [];
  for (let i = 0; i < pens.length; i++) {
    for (let j = i + 1; j < pens.length; j++) {
      const [a, b] = look.get(pens[i].name)!.l >= look.get(pens[j].name)!.l ? [pens[i], pens[j]] : [pens[j], pens[i]];
      const la = look.get(a.name)!;
      const lb = look.get(b.name)!;
      const grey = la.s < 15 || lb.s < 15;
      const gap = grey ? 0.5 : Math.min(Math.abs(la.h - lb.h), 360 - Math.abs(la.h - lb.h)) / 180;
      const mid = Math.atan2(Math.sin((la.h * Math.PI) / 180) + Math.sin((lb.h * Math.PI) / 180), Math.cos((la.h * Math.PI) / 180) + Math.cos((lb.h * Math.PI) / 180));
      all.push({ pair: [a, b], f: [2 * gap, 2 * ((la.l - lb.l) / 100), 0.5 * Math.cos(mid), 0.5 * Math.sin(mid)] });
    }
  }
  if (!all.length) return [];
  const most = Math.max(2, Math.ceil((2 * count) / pens.length));
  const uses = new Map<string, number>();
  const chosen: typeof all = [];
  const take = (c: (typeof all)[number]) => {
    chosen.push(c);
    for (const p of c.pair) uses.set(p.name, (uses.get(p.name) ?? 0) + 1);
  };
  // Start from the two pens furthest apart in colour, then each time the pair least like any chosen.
  take(all.reduce((best, c) => (c.f[0] > best.f[0] ? c : best)));
  while (chosen.length < Math.min(count, all.length)) {
    let best: (typeof all)[number] | null = null;
    let far = -1;
    for (const c of all) {
      if (chosen.includes(c) || c.pair.some((p) => (uses.get(p.name) ?? 0) >= most)) continue;
      const near = Math.min(...chosen.map((d) => Math.hypot(...c.f.map((v, i) => v - d.f[i]))));
      if (near > far) {
        far = near;
        best = c;
      }
    }
    if (!best) break;
    take(best);
  }
  return chosen.map((c) => c.pair);
}

export interface PairsSheet {
  layers: Layer[];
  shapes: Shape[];
  fills: Fill[];
  pairs: [PenColor, PenColor][];
}

/**
 * The pairs sheet for one drawing tool on one page, or why it can't be made. Text is made unfitted,
 * for the caller to fit to the font it has loaded, as for the calibration sheet.
 */
export function pairsSheet(tool: Preset, page: Page, font: string): PairsSheet | { error: string } {
  const palette: PenColor[] = tool.palette ?? [];
  if (palette.length < 2) return { error: `${tool.name} needs at least two colours in its palette for a pairs sheet.` };
  const widthMm = tool.settings.pen_width ?? 0.5;
  const angle = tool.hatch?.angle ?? 45;
  const named = PHOTO_PAIRS[tool.name]
    ?.map(([a, b]) => [palette.find((p) => p.name === a), palette.find((p) => p.name === b)])
    .filter((pair): pair is [PenColor, PenColor] => Boolean(pair[0] && pair[1]))
    .map(([a, b]) => ((lightness(a.color) ?? 0) >= (lightness(b.color) ?? 0) ? [a, b] : [b, a]) as [PenColor, PenColor]);
  const pairs = named?.length ? named : choosePairs(palette);

  // Each pair's names sit left of its patches, as wide as the longest of them needs.
  const longest = Math.max(...pairs.flatMap(([under, over]) => [under.name.length, over.name.length + 2]));
  const labelW = longest * PER_LETTER * LABEL;
  const across = page.w - 2 * MARGIN;
  const headings = COVER_LABEL * (1 + LEADING);
  const down = page.h - 2 * MARGIN - MARK - headings - 0.1 - MARK - 0.1;
  let fit: { patch: number; cellW: number; pitch: number; columns: number } | null = null;
  for (let patch = PATCH_LARGEST; patch >= PATCH_SMALLEST - 1e-9; patch -= 0.05) {
    const cellW = labelW + PAPER_CLEAR + PAIR_COVERS.length * patch + (PAIR_COVERS.length - 1) * PATCH_GAP;
    const pitch = patch + ROW_GAP;
    const columns = Math.floor((across + COLUMN_GAP) / (cellW + COLUMN_GAP));
    const rows = Math.floor((down + ROW_GAP) / pitch);
    if (columns > 0 && columns * rows >= pairs.length) {
      fit = { patch, cellW, pitch, columns };
      break;
    }
  }
  if (!fit) return { error: `${pairs.length} pairs don’t fit on ${trim(page.w)} × ${trim(page.h)} in paper. Choose a larger paper size.` };

  // A layer per pen on the sheet, lightest at the bottom; the darkest carries the marks and words.
  const used = palette.filter((p) => pairs.some((pair) => pair.includes(p)));
  const byLightness = [...used].sort((a, b) => (lightness(b.color) ?? 0) - (lightness(a.color) ?? 0));
  const layers: Layer[] = byLightness.map((pen) => ({ id: newLayerId(), name: pen.name, color: pen.color }));
  const layerOf = new Map(byLightness.map((pen, i) => [pen.name, layers[i].id]));
  const key = layers[layers.length - 1].id;

  const shapes: Shape[] = [];
  const fills: Fill[] = [];
  const hatch = (pen: string, x: number, y: number, size: number, name: string, cover: number, at: number) => {
    const shape: Shape = { id: newShapeId(), kind: "rect", layerId: layerOf.get(pen) ?? key, name, x, y, x2: x + size, y2: y + size, outline: false };
    shapes.push(shape);
    fills.push({ id: newFillId(), shapeId: shape.id, angle: at, spacingMm: cover === 1 ? tool.hatch?.spacing_mm ?? widthMm : widthMm / cover, scale: 100, custom: true });
  };
  const words = (text: string, x: number, y: number, size: number, name?: string) => {
    // The box holds every line at this size, with room between them for the letters that hang down.
    const lines = text.split("\n").length;
    const tall = size * (1 + (lines - 1) * LEADING);
    shapes.push({ id: newShapeId(), kind: "text", layerId: key, text, font, tracking: TRACKING, ...(lines > 1 ? { leading: LEADING } : {}), x, y, x2: x, y2: y + tall, ...(name ? { name } : {}) });
  };

  const left = MARGIN;
  const right = page.w - MARGIN - MARK;
  const top = MARGIN;
  const bottom = page.h - MARGIN - MARK;
  const keyPen = byLightness[byLightness.length - 1].name;
  for (const [x, y, where] of [[left, top, "top left"], [right, top, "top right"], [left, bottom, "bottom left"], [right, bottom, "bottom right"]] as const) {
    hatch(keyPen, x, y, MARK, `Corner mark ${where}`, 1, angle);
  }
  words(`${tool.name} pen pairs  ${trim(widthMm)} mm`, left + MARK + 0.2, top + (MARK - HEADING) / 2, HEADING, "Sheet title");

  const width = fit.columns * fit.cellW + (fit.columns - 1) * COLUMN_GAP;
  const x0 = MARGIN + (across - width) / 2;
  const y0 = top + MARK + headings + 0.1;
  const rowsUsed = Math.ceil(pairs.length / fit.columns);
  pairs.forEach(([under, over], i) => {
    const column = Math.floor(i / rowsUsed);
    const row = i % rowsUsed;
    const x = x0 + column * (fit.cellW + COLUMN_GAP);
    const y = y0 + row * fit.pitch;
    const patches = x + labelW + PAPER_CLEAR;
    PAIR_COVERS.forEach(([cu, co], k) => {
      const px = patches + k * (fit.patch + PATCH_GAP);
      const name = pairName(under.name, cu, over.name, co);
      hatch(under.name, px, y, fit.patch, `${name} (${under.name})`, cu, angle);
      hatch(over.name, px, y, fit.patch, `${name} (${over.name})`, co, angle + 90); // across the first
      if (row === 0) words(`${pct(cu)}\n+${pct(co)}`, px, y - headings - 0.06, COVER_LABEL);
    });
    words(`${under.name}\n+ ${over.name}`, x, y + (fit.patch - LABEL * (1 + LEADING)) / 2, LABEL, `${under.name} + ${over.name} label`);
  });

  return { layers, shapes, fills, pairs };
}

const trim = (n: number) => `${Math.round(n * 100) / 100}`;
