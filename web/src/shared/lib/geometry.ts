import type { Placement, PlotterModel, Settings } from "./types";
import type { Preview } from "./preview";

export interface Footprint {
  rotated: boolean;
  x: number; // inches from home
  y: number;
  w: number;
  h: number;
  // How much page there is before the artboard's own corner: room for whatever Plot adds that lands
  // outside it - the trim marks, the color blocks, the signature (server.py, add_plot_extras). The
  // plot starts that far before where the artboard goes. 0 for a print with none of them.
  pad: { x: number; y: number }; // inches
  // The box around the lines, in inches from home; the page when they couldn't be measured. Only the
  // lines have to stay past home and on the paper: the page's empty margin may run off either.
  ink: { x0: number; y0: number; x1: number; y1: number };
}

// The drawing's footprint on the plotter, in inches from home.
export function footprint(preview: Preview | null, _settings: Settings, placement: Placement, padMm = { x: 0, y: 0 }): Footprint | null {
  if (!preview) return null;
  // Drawings plot as drawn (turned only by the rotate buttons, which the server applies to the SVG),
  // so the footprint is never turned here. The server always sends auto_rotate off.
  const rotated = false;
  // The placement is where the ARTBOARD goes; the page starts before it by whatever Plot added
  // outside the artboard.
  const pad = { x: padMm.x / 25.4, y: padMm.y / 25.4 };
  const x = placement.x / 25.4 - pad.x, y = placement.y / 25.4 - pad.y, w = preview.widthIn, h = preview.heightIn;
  const f = preview.ink ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { rotated, x, y, w, h, pad, ink: { x0: x + f.x0 * w, y0: y + f.y0 * h, x1: x + f.x1 * w, y1: y + f.y1 * h } };
}

const TOL = 0.003;

/**
 * The footprint as it would be a quarter turn clockwise, at the same corner: the page's width and
 * height swap and the lines' box turns with them - what the server does to the document when it
 * plots at a rotation (rotate_document). Plot asks it one question: would a piece that doesn't fit
 * the sheet as it lies fit turned? (Tom, 2026-11-23, docs/plot.md.)
 *
 * The pad is swapped rather than turned, which is exact while the marks reach the same distance on
 * both axes - they do - and near enough for a fit test either way.
 */
export function turnedFootprint(fp: Footprint): Footprint {
  // A point (ix, iy) inside the page lands at (pageH - iy, ix) when the page turns clockwise.
  const ix0 = fp.ink.x0 - fp.x, iy0 = fp.ink.y0 - fp.y;
  const ix1 = fp.ink.x1 - fp.x, iy1 = fp.ink.y1 - fp.y;
  return {
    ...fp,
    rotated: !fp.rotated,
    w: fp.h,
    h: fp.w,
    pad: { x: fp.pad.y, y: fp.pad.x },
    ink: { x0: fp.x + (fp.h - iy1), y0: fp.y + ix0, x1: fp.x + (fp.h - iy0), y1: fp.y + ix1 },
  };
}

export function fitsOnBed(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return true;
  // The lines alone, as on the paper: the page's empty margin may run past the rails on any side.
  return fp.ink.x0 >= -TOL && fp.ink.y0 >= -TOL
    && fp.ink.x1 <= model.travel_in[0] + TOL && fp.ink.y1 <= model.travel_in[1] + TOL;
}

export function fitsOnPaper(fp: Footprint | null, s: Settings) {
  if (!fp || !s.paper_w || !s.paper_h) return true;
  const tol = 0.5 / 25.4;
  const px = s.paper_x / 25.4, py = s.paper_y / 25.4, pw = s.paper_w / 25.4, ph = s.paper_h / 25.4;
  const { x0, y0, x1, y1 } = fp.ink;
  return x0 >= px - tol && y0 >= py - tol && x1 <= px + pw + tol && y1 <= py + ph + tol;
}

// Smallest start position, in mm: the drawing's page may start before home by as much empty margin
// as there is above and left of its lines.
export function minPlacement(fp: Footprint | null) {
  if (!fp) return { x: 0, y: 0 };
  // In the placement's own terms, so that room counts: an artboard with marks can go no closer to
  // home than their reach, less whatever empty margin the page has beyond them.
  return { x: (fp.pad.x - (fp.ink.x0 - fp.x)) * 25.4, y: (fp.pad.y - (fp.ink.y0 - fp.y)) * 25.4 };
}


// Largest start position that keeps the drawing within the plotter's reach, in mm.
export function maxPlacement(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return { x: Infinity, y: Infinity };
  return {
    // As far as the lines' far edges can go, not the page's: as fitsOnBed judges it.
    x: Math.max(0, (model.travel_in[0] - (fp.ink.x1 - fp.x) + fp.pad.x) * 25.4),
    y: Math.max(0, (model.travel_in[1] - (fp.ink.y1 - fp.y) + fp.pad.y) * 25.4),
  };
}

/**
 * Where Fit to paper puts the drawing in the room the margin leaves, across and down: 0 against the
 * left (top) margin, 0.5 centred, 1 against the right (bottom). A drawing of another proportion than
 * the paper fills it one way only; this says where the spare room goes the other way.
 */
export interface FitAlign {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}
export const FIT_CENTERED: FitAlign = { x: 0.5, y: 0.5 };

/** The margin on each side of the paper, for Fit and Fill: the same all round unless some sides are given extra. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const MARGIN_SIDES = ["top", "bottom", "left", "right"] as const;
export type MarginSide = (typeof MARGIN_SIDES)[number];
/**
 * The one side that gets the Paper card's extra margin, read from where the drawing is aligned: the
 * side opposite it, so the drawing sits against one margin and the deeper one is across from it.
 * Aligned into a corner, the paper decides which: landscape, opposite the left or right (a drawing
 * turned onto its side has its foot there); portrait, opposite the top or bottom. Centred both
 * ways, the bottom.
 */
export function extraMarginSide(align: FitAlign, landscape: boolean): MarginSide {
  const across: MarginSide | null = align.x === 0 ? "right" : align.x === 1 ? "left" : null;
  const down: MarginSide | null = align.y === 0 ? "bottom" : align.y === 1 ? "top" : null;
  return (landscape ? across ?? down : down ?? across) ?? "bottom";
}
/** The same margin on every side. */
export const marginsAll = (m: number): Margins => ({ top: m, right: m, bottom: m, left: m });
/** Every side's margin times k: millimetres to inches, say. */
export const marginsTimes = (m: Margins, k: number): Margins => ({ top: m.top * k, right: m.right * k, bottom: m.bottom * k, left: m.left * k });
