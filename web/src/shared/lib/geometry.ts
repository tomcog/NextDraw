import type { Placement, PlotterModel, Settings } from "./types";
import type { Preview } from "./preview";

export interface Footprint {
  rotated: boolean;
  x: number; // inches from home
  y: number;
  w: number;
  h: number;
  // The box around the lines, in inches from home; the page when they couldn't be measured. Only the
  // lines have to stay past home and on the paper: the page's empty margin may run off either.
  ink: { x0: number; y0: number; x1: number; y1: number };
}

// The drawing's footprint on the plotter, in inches from home.
export function footprint(preview: Preview | null, _settings: Settings, placement: Placement): Footprint | null {
  if (!preview) return null;
  // Drawings plot as drawn (turned only by the rotate buttons, which the server applies to the SVG),
  // so the footprint is never turned here. The server always sends auto_rotate off.
  const rotated = false;
  const x = placement.x / 25.4, y = placement.y / 25.4, w = preview.widthIn, h = preview.heightIn;
  const f = preview.ink ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { rotated, x, y, w, h, ink: { x0: x + f.x0 * w, y0: y + f.y0 * h, x1: x + f.x1 * w, y1: y + f.y1 * h } };
}

const TOL = 0.003;

export function fitsOnBed(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return true;
  return fp.ink.x0 >= -TOL && fp.ink.y0 >= -TOL
    && fp.x + fp.w <= model.travel_in[0] + TOL && fp.y + fp.h <= model.travel_in[1] + TOL;
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
  return { x: -(fp.ink.x0 - fp.x) * 25.4, y: -(fp.ink.y0 - fp.y) * 25.4 };
}

// Largest start position that keeps the drawing within the plotter's reach, in mm.
export function maxPlacement(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return { x: Infinity, y: Infinity };
  return {
    x: Math.max(0, (model.travel_in[0] - fp.w) * 25.4),
    y: Math.max(0, (model.travel_in[1] - fp.h) * 25.4),
  };
}
