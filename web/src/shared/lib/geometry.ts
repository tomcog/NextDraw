import type { Placement, PlotterModel, Settings } from "./types";
import type { Preview } from "./preview";

export interface Footprint {
  rotated: boolean;
  x: number; // inches from home
  y: number;
  w: number;
  h: number;
}

// The drawing's footprint on the plotter, in inches from home.
export function footprint(preview: Preview | null, _settings: Settings, placement: Placement): Footprint | null {
  if (!preview) return null;
  // Drawings plot as drawn (turned only by the rotate buttons, which the server applies to the SVG),
  // so the footprint is never turned here. The server always sends auto_rotate off.
  const rotated = false;
  return {
    rotated,
    x: placement.x / 25.4,
    y: placement.y / 25.4,
    w: rotated ? preview.heightIn : preview.widthIn,
    h: rotated ? preview.widthIn : preview.heightIn,
  };
}

const TOL = 0.003;

export function fitsOnBed(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return true;
  return fp.x >= -TOL && fp.y >= -TOL
    && fp.x + fp.w <= model.travel_in[0] + TOL && fp.y + fp.h <= model.travel_in[1] + TOL;
}

export function fitsOnPaper(fp: Footprint | null, s: Settings) {
  if (!fp || !s.paper_w || !s.paper_h) return true;
  const tol = 0.5 / 25.4;
  const px = s.paper_x / 25.4, py = s.paper_y / 25.4, pw = s.paper_w / 25.4, ph = s.paper_h / 25.4;
  return fp.x >= px - tol && fp.y >= py - tol && fp.x + fp.w <= px + pw + tol && fp.y + fp.h <= py + ph + tol;
}

// Largest start position that keeps the drawing within the plotter's reach, in mm.
export function maxPlacement(fp: Footprint | null, model: PlotterModel | undefined) {
  if (!model || !fp) return { x: Infinity, y: Infinity };
  return {
    x: Math.max(0, (model.travel_in[0] - fp.w) * 25.4),
    y: Math.max(0, (model.travel_in[1] - fp.h) * 25.4),
  };
}
