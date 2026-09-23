import { lightness } from "../../shared/lib/color";
import type { PenColor, Preset } from "../../shared/lib/types";
import { newFillId, type Fill } from "./hatch";
import { newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";

// A calibration sheet: every pen of a drawing tool, hatched at a few densities, on the paper it will
// be used on. Photographed back in, it tells Studio what each pen really looks like there - at full
// strength and with paper showing through - which a palette's colours, picked off a screen, can't.
// It is an ordinary drawing, one layer per pen, so it saves, plots and reopens like any other.

/**
 * How much of the paper each patch covers with ink, as a share: solid, then half, a quarter and an
 * eighth. The lines are the pen's own width, spaced so that share of the patch is under them.
 */
export const CALIBRATION_COVERS = [1, 0.5, 0.25, 0.125];

const MARGIN = 0.5; // in, clear of the paper's edge
const MARK = 0.25; // the corner marks, solid squares a photo is lined up by
const PATCH_LARGEST = 0.45; // a patch as big as the page allows, down to the smallest
const PATCH_SMALLEST = 0.3;
const PATCH_GAP = 0.08; // between the patches of one pen
const COLUMN_GAP = 0.3; // between one pen's patches and the next pen's, across
const LABEL = 0.1; // the pen's name, under its patches
const LABEL_GAP = 0.04;
const ROW_GAP = 0.18;
const HEADING = 0.15; // the sheet's title, between the top marks
const COVER_LABEL = 0.08; // "100" over each patch of the top row

/** A patch's name says which pen and how much ink, so the sheet can be read back by its shapes. */
export const patchName = (pen: string, cover: number) => `${pen} ${Math.round(cover * 1000) / 10}%`;

const coverText = (cover: number) => `${Math.round(cover * 1000) / 10}`.replace(/\.5$/, "");

export interface CalibrationSheet {
  layers: Layer[];
  shapes: Shape[];
  fills: Fill[];
}

/**
 * The sheet for one drawing tool on one page, or why it can't be made. Text is made unfitted - a box
 * as tall as its size and no wider - for the caller to fit to the font it has loaded.
 */
export function calibrationSheet(tool: Preset, page: Page, font: string): CalibrationSheet | { error: string } {
  const pens: PenColor[] = tool.palette ?? [];
  if (!pens.length) return { error: `${tool.name} has no colours yet. Add its pens to the palette first.` };

  const widthMm = tool.settings.pen_width ?? 0.5;
  const angle = tool.hatch?.angle ?? 45;
  // Solid is the spacing this tool was measured solid at, where it has one: a felt tip bleeds, and
  // lines a pen-width apart can leave gaps a slightly closer spacing doesn't.
  const spacingFor = (cover: number) => (cover === 1 ? tool.hatch?.spacing_mm ?? widthMm : widthMm / cover);

  // The largest patch that gets every pen onto the page.
  const across = page.w - 2 * MARGIN;
  const down = page.h - 2 * MARGIN - MARK - HEADING - 2 * COVER_LABEL - MARK;
  let fit: { patch: number; cellW: number; pitch: number; columns: number; rows: number } | null = null;
  for (let patch = PATCH_LARGEST; patch >= PATCH_SMALLEST - 1e-9; patch -= 0.05) {
    const cellW = CALIBRATION_COVERS.length * patch + (CALIBRATION_COVERS.length - 1) * PATCH_GAP;
    const pitch = patch + LABEL_GAP + LABEL + ROW_GAP;
    const columns = Math.floor((across + COLUMN_GAP) / (cellW + COLUMN_GAP));
    const rows = Math.floor((down + ROW_GAP) / pitch);
    if (columns > 0 && columns * rows >= pens.length) {
      fit = { patch, cellW, pitch, columns, rows };
      break;
    }
  }
  if (!fit) {
    return { error: `${pens.length} pens don’t fit on ${trim(page.w)} × ${trim(page.h)} in paper. Choose a larger paper size.` };
  }

  // A layer per pen, lightest at the bottom. The darkest also carries the marks and the words:
  // they're for reading the sheet, and the darkest pen is the one that reads best.
  const byLightness = [...pens].sort((a, b) => (lightness(b.color) ?? 0) - (lightness(a.color) ?? 0));
  const layers: Layer[] = byLightness.map((pen) => ({ id: newLayerId(), name: pen.name, color: pen.color }));
  const layerOf = new Map(byLightness.map((pen, i) => [pen.name, layers[i].id]));
  const key = layers[layers.length - 1].id;

  const shapes: Shape[] = [];
  const fills: Fill[] = [];
  const solid = (layerId: string, x: number, y: number, size: number, name: string, cover: number) => {
    const shape: Shape = { id: newShapeId(), kind: "rect", layerId, name, x, y, x2: x + size, y2: y + size, outline: false };
    shapes.push(shape);
    fills.push({ id: newFillId(), shapeId: shape.id, angle, spacingMm: spacingFor(cover), scale: 100, custom: true });
  };
  const words = (text: string, x: number, y: number, size: number, name?: string) => {
    shapes.push({ id: newShapeId(), kind: "text", layerId: key, text, font, x, y, x2: x, y2: y + size, ...(name ? { name } : {}) });
  };

  // The corner marks, at the corners of everything drawn.
  const left = MARGIN;
  const right = page.w - MARGIN - MARK;
  const top = MARGIN;
  const bottom = page.h - MARGIN - MARK;
  for (const [x, y, where] of [[left, top, "top left"], [right, top, "top right"], [left, bottom, "bottom left"], [right, bottom, "bottom right"]] as const) {
    solid(key, x, y, MARK, `Corner mark ${where}`, 1);
  }
  words(`${tool.name} calibration  ${trim(widthMm)} mm`, left + MARK + 0.2, top + (MARK - HEADING) / 2, HEADING, "Sheet title");

  // The pens, in the palette's order, down each column and then across; the grid centred between
  // the marks.
  const used = fit.columns * fit.cellW + (fit.columns - 1) * COLUMN_GAP;
  const x0 = MARGIN + (across - used) / 2;
  const y0 = top + MARK + 2 * COVER_LABEL + 0.1;
  const rowsUsed = Math.ceil(pens.length / fit.columns);
  pens.forEach((pen, i) => {
    const column = Math.floor(i / rowsUsed);
    const row = i % rowsUsed;
    const x = x0 + column * (fit.cellW + COLUMN_GAP);
    const y = y0 + row * fit.pitch;
    CALIBRATION_COVERS.forEach((cover, k) => {
      const px = x + k * (fit.patch + PATCH_GAP);
      solid(layerOf.get(pen.name)!, px, y, fit.patch, patchName(pen.name, cover), cover);
      if (row === 0) words(coverText(cover), px, y - COVER_LABEL - 0.06, COVER_LABEL);
    });
    words(pen.name, x, y + fit.patch + LABEL_GAP, LABEL, `${pen.name} label`);
  });

  return { layers, shapes, fills };
}

const trim = (n: number) => `${Math.round(n * 100) / 100}`;
