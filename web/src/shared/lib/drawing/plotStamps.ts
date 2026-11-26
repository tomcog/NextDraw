// What Plot adds to a print as the last step before plotting: the color blocks and the signature.
//
// They are no part of the drawing. Plot keeps where they go in its own block (the anchors below) and
// the geometry is made here, in the page, and sent with each preview, estimate and plot request as
// paths at their own size; the server puts them where the anchors say and grows the page for anything
// that lands outside it (server.py, add_plot_extras). So they can never go stale: the blocks are made
// afresh from the layers and inks of the version being plotted, and the signature carries the year
// the print is made.
//
// They are always the same size on paper whatever size the artwork prints at, which is why they are
// made here at their own size and placed rather than drawn into the drawing's coordinates.
import { pathData } from "./path";
import { registrationLayers, registrationShapes, registrationSize, type BlockLayer } from "./registration";
import { signatureShapes, signatureSize } from "./signature";
import { drawnNodes } from "./shapes";
import type { StrokeFont } from "./font";
import type { Anchor, BlocksStamp, PenColor, SignatureStamp } from "../types";

/**
 * Where the blocks go unless it's changed: in the bottom margin, lined up with the live area's left
 * edge. The MARGINS, not the artboard and not the artwork (Tom, 2026-11-25): they are the guides the
 * print was composed against, so a signature set against them sits where the eye expects it whatever
 * the lines happen to reach - and inside the cut, which the artboard's own edge is not. A drawing
 * with no margins falls back to the artboard, since then they are the same box.
 */
export const DEFAULT_BLOCKS: { x: Anchor; y: Anchor } = {
  x: { mm: 0, edge: "left", side: "inside", from: "margins" },
  y: { mm: 12.7, edge: "bottom", side: "outside", from: "margins" },
};

/** And the signature: the same, lined up with the live area's right edge. */
export const DEFAULT_SIGNATURE: { x: Anchor; y: Anchor } = {
  x: { mm: 0, edge: "right", side: "inside", from: "margins" },
  y: { mm: 12.7, edge: "bottom", side: "outside", from: "margins" },
};

/**
 * The same marks as the card can say them, since 2026-11-25: measured from the margins, lined up
 * with the left or right margin across, and above or below the BOTTOM margin down. A drawing saved
 * before that may carry the artwork or the artboard, a mark hanging off the side, or one against the
 * top; it comes in at the nearest place that is still offered rather than sitting somewhere no field
 * can describe. Only what is out of range moves: everything else is left exactly as it was.
 */
export const againstMargins = <T extends { x: Anchor; y: Anchor }>(marks: T | null | undefined): T | null =>
  marks ? {
    ...marks,
    x: { ...marks.x, from: "margins", side: "inside" },
    y: { ...marks.y, from: "margins", edge: "bottom" },
  } : null;

/** The signature at its own size, its top-left at 0,0: the initials and the year, as paths. */
export function signatureStamp(year: number, font: StrokeFont): SignatureStamp {
  const shapes = signatureShapes(year, font, "", { x: 0, y: 0 });
  const { w, h } = signatureSize(year, font);
  return { w, h, d: shapes.map((s) => pathData(drawnNodes(s))).filter(Boolean) };
}

/**
 * A block for each layer that goes down in this print, in plotting order, as a row whose top-left is
 * 0,0 - each one named by the layer it belongs to, so the server puts it on that layer and it plots
 * in that pen. A hidden layer gets none and leaves no gap; so do the layers of a signature or marks
 * a drawing carries from before Plot made them.
 */
export function blocksStamp(layers: BlockLayer[], palette: PenColor[]): BlocksStamp | null {
  const shown = registrationLayers(layers, palette).filter((l) => !l.hidden);
  if (!shown.length) return null;
  const { w, h } = registrationSize(shown);
  // registrationShapes takes the row's BOTTOM left; here the row's top-left is the origin.
  const shapes = registrationShapes(shown, { x: 0, y: h });
  return { w, h, items: shapes.map((s) => ({ layer: s.layerId, d: pathData(drawnNodes(s)) })) };
}
