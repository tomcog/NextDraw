import { lightness } from "../../lib/color";
import { hatchLines, type Fill } from "./hatch";
import { boxOf, type Page, type Shape } from "./shapes";

// The drawing Studio writes out. Two things matter to Plot at the other end:
//
// - the document is sized in inches with a matching viewBox, so `normalize_size` on the server has
//   nothing to correct and the drawing arrives at the size it was drawn at;
// - each pen becomes an Inkscape layer named after it, because that's what `read_layers` looks for
//   and a layer named after one of a tool's pens takes that pen's color in Plot: the name is the
//   contract between the two apps, and it survives Studio regenerating the geometry underneath it;
// - an <nds:plot> block naming the paper the drawing was made for, so opening it in Plot doesn't land
//   an 11 x 8.5 drawing on whatever paper Plot happened to be set to last.
//
// Shapes are stroked and never filled: the plotter draws lines, and a fill would be ignored on paper
// while making the preview lie about what's going to happen. A hatch fill is written twice over -
// once as the lines the pen will actually draw, and once as the parameters that made them, in an
// <nds:design> block. Plot rewrites its own <nds:plot> block on save and leaves that one alone, so
// the numbers survive a trip through it and the fill can be regenerated for a different pen.

const SVG_NS = "http://www.w3.org/2000/svg";
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const PLOT_NS = "https://github.com/tomcog/NextDraw";

/** Thin enough to read as a line at any zoom; the plotter draws the path, not the stroke. */
const STROKE_IN = 0.008;

const num = (n: number) => Number(n.toFixed(4)).toString();

function shapeMarkup(s: Shape): string {
  const b = boxOf(s);
  if (s.kind === "line") {
    return `<line id="${escapeAttr(s.id)}" x1="${num(s.x)}" y1="${num(s.y)}" x2="${num(s.x2)}" y2="${num(s.y2)}"/>`;
  }
  if (s.kind === "ellipse") {
    const rx = (b.x1 - b.x0) / 2;
    const ry = (b.y1 - b.y0) / 2;
    return `<ellipse id="${escapeAttr(s.id)}" cx="${num(b.x0 + rx)}" cy="${num(b.y0 + ry)}" rx="${num(rx)}" ry="${num(ry)}"/>`;
  }
  return `<rect id="${escapeAttr(s.id)}" x="${num(b.x0)}" y="${num(b.y0)}" width="${num(b.x1 - b.x0)}" height="${num(b.y1 - b.y0)}"/>`;
}

// Fill lines go in a group named after the shape they fill, so reading the drawing back can tell
// them apart from shapes that were drawn by hand and regenerate them instead of listing them.
export const FILL_GROUP_PREFIX = "studio-fill-";

// A shape whose outline isn't wanted still has to be in the file, because its fill is regenerated
// from it. It goes on a layer whose name starts with "%", which NextDraw skips: Plot hides those
// from the preview, never plots them, and leaves them out of the drawing's bounds (tested - see
// docs/studio.md). So the shape survives to be edited without ever reaching the paper.
export const SOURCE_LAYER = "%sources";

function fillMarkup(shapes: Shape[], fills: Fill[]): string {
  return fills
    .map((fill) => {
      const shape = shapes.find((s) => s.id === fill.shapeId);
      if (!shape) return "";
      const lines = hatchLines(shape, fill);
      if (!lines.length) return "";
      const body = lines
        .map((l) => `        <line x1="${num(l.x1)}" y1="${num(l.y1)}" x2="${num(l.x2)}" y2="${num(l.y2)}"/>`)
        .join("\n");
      return `      <g id="${FILL_GROUP_PREFIX}${escapeAttr(fill.id)}">\n${body}\n      </g>`;
    })
    .filter(Boolean)
    .join("\n");
}

/** What Plot reads out of a drawing: the paper it was made for, at home, at full size. */
function plotBlock(page: Page, opts: SaveOptions): string {
  const settings = {
    placement: { x: 0, y: 0 },
    scale: 100,
    rotation: 0,
    tool: opts.toolName,
    paper: {
      paper_w: Number((page.w * 25.4).toFixed(2)),
      paper_h: Number((page.h * 25.4).toFixed(2)),
      paper_x: 0,
      paper_y: 0,
      paper_size: opts.paperSizeId || "custom",
    },
  };
  return `  <metadata id="nextdraw-plot"><nds:plot>${escapeText(JSON.stringify(settings))}</nds:plot></metadata>`;
}

/**
 * Studio's own parameters. Plot never reads or rewrites this, so it round-trips untouched.
 *
 * Pens are recorded here as well as being the layer names, because a shape whose outline isn't drawn
 * sits on %sources, and that layer can't be named after a pen - it has to keep the name NextDraw
 * skips. The layer still wins when there is one; this is what covers the shapes that have no layer
 * of their own to be named by.
 */
function designBlock(fills: Fill[], shapes: Shape[], defaultPen: string): string {
  const data = {
    pens: Object.fromEntries(shapes.map((s) => [s.id, s.pen || defaultPen])),
    fills: fills.map((f) => ({
      id: f.id,
      shape: f.shapeId,
      angle: f.angle,
      spacing_mm: f.spacingMm,
      scale: f.scale,
    })),
  };
  return `  <metadata id="nextdraw-studio"><nds:design>${escapeText(JSON.stringify(data))}</nds:design></metadata>`;
}

export interface SaveOptions {
  paperSizeId: string;
  /** The drawing tool, so Plot opens the drawing with the same one chosen. */
  toolName: string;
  /** The pen every shape falls back to when it hasn't been given one. */
  defaultPen: string;
  /** A pen's color by name, for the stroke on its layer. */
  colorOf: (pen: string) => string;
}

export function buildSvg(shapes: Shape[], fills: Fill[], page: Page, opts: SaveOptions): string {
  const penOf = (s: Shape) => s.pen || opts.defaultPen;
  const drawn = shapes.filter((s) => s.outline !== false);
  const sources = shapes.filter((s) => s.outline === false);

  // One layer per pen, lightest first: Plot stacks darker colors over lighter ones, and a drawing
  // that arrives in that order needs no sorting when it gets there.
  const pens = [...new Set([...drawn.map(penOf), ...fills.map((f) => {
    const shape = shapes.find((s) => s.id === f.shapeId);
    return shape ? penOf(shape) : opts.defaultPen;
  })])].sort((a, b) => (lightness(opts.colorOf(b)) ?? 0) - (lightness(opts.colorOf(a)) ?? 0));

  const layers = pens.map((pen, i) => {
    const mine = drawn.filter((s) => penOf(s) === pen);
    const myFills = fills.filter((f) => {
      const shape = shapes.find((s) => s.id === f.shapeId);
      return shape ? penOf(shape) === pen : false;
    });
    const body = [
      mine.map((s) => `      ${shapeMarkup(s)}`).join("\n"),
      fillMarkup(shapes, myFills),
    ].filter(Boolean).join("\n");
    if (!body) return "";
    return `  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(pen)}" id="studio-layer-${i + 1}"
     fill="none" stroke="${escapeAttr(opts.colorOf(pen))}" stroke-width="${STROKE_IN}">
${body}
  </g>
`;
  }).filter(Boolean).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" xmlns:nds="${PLOT_NS}"
     width="${num(page.w)}in" height="${num(page.h)}in"
     viewBox="0 0 ${num(page.w)} ${num(page.h)}">
${plotBlock(page, opts)}
${designBlock(fills, shapes, opts.defaultPen)}
${layers}${sourceLayer(sources)}</svg>
`;
}

/** The unplotted layer holding shapes that are filled but not outlined. Left out when it's empty. */
function sourceLayer(sources: Shape[]): string {
  if (!sources.length) return "";
  const body = sources.map((s) => `      ${shapeMarkup(s)}`).join("\n");
  return `  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(SOURCE_LAYER)}" id="studio-sources"
     fill="none" stroke="#000000" stroke-width="${STROKE_IN}">
${body}
  </g>
`;
}

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

/** A file name that's safe to write and obviously a drawing. */
export function cleanFileName(raw: string): string {
  const base = raw.trim().replace(/\.svg$/i, "").replace(/[/\\:]/g, "-").slice(0, 60).trim();
  return `${base || "Untitled"}.svg`;
}
