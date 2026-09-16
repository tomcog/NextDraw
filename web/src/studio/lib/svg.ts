import { boxOf, type Page, type Shape } from "./shapes";

// The drawing Studio writes out. Two things matter to Plot at the other end:
//
// - the document is sized in inches with a matching viewBox, so `normalize_size` on the server has
//   nothing to correct and the drawing arrives at the size it was drawn at;
// - the shapes sit in an Inkscape layer with a label, because that's what `read_layers` looks for,
//   and a layer named after one of a tool's pens takes that pen's color in Plot (see docs/studio.md);
// - an <nds:plot> block naming the paper the drawing was made for, so opening it in Plot doesn't land
//   an 11 x 8.5 drawing on whatever paper Plot happened to be set to last.
//
// Shapes are stroked and never filled: the plotter draws lines, and a fill would be ignored on paper
// while making the preview lie about what's going to happen.

const SVG_NS = "http://www.w3.org/2000/svg";
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const PLOT_NS = "https://github.com/tomcog/NextDraw";

/** Thin enough to read as a line at any zoom; the plotter draws the path, not the stroke. */
const STROKE_IN = 0.008;

const num = (n: number) => Number(n.toFixed(4)).toString();

function shapeMarkup(s: Shape): string {
  const b = boxOf(s);
  if (s.kind === "line") {
    return `<line x1="${num(s.x)}" y1="${num(s.y)}" x2="${num(s.x2)}" y2="${num(s.y2)}"/>`;
  }
  if (s.kind === "ellipse") {
    const rx = (b.x1 - b.x0) / 2;
    const ry = (b.y1 - b.y0) / 2;
    return `<ellipse cx="${num(b.x0 + rx)}" cy="${num(b.y0 + ry)}" rx="${num(rx)}" ry="${num(ry)}"/>`;
  }
  return `<rect x="${num(b.x0)}" y="${num(b.y0)}" width="${num(b.x1 - b.x0)}" height="${num(b.y1 - b.y0)}"/>`;
}

/** What Plot reads out of a drawing: the paper it was made for, at home, at full size. */
function plotBlock(page: Page, paperSizeId: string): string {
  const settings = {
    placement: { x: 0, y: 0 },
    scale: 100,
    rotation: 0,
    paper: {
      paper_w: Number((page.w * 25.4).toFixed(2)),
      paper_h: Number((page.h * 25.4).toFixed(2)),
      paper_x: 0,
      paper_y: 0,
      paper_size: paperSizeId || "custom",
    },
  };
  return `  <metadata id="nextdraw-plot"><nds:plot>${escapeText(JSON.stringify(settings))}</nds:plot></metadata>`;
}

export function buildSvg(shapes: Shape[], page: Page, layerName: string, paperSizeId: string): string {
  const body = shapes.map((s) => `      ${shapeMarkup(s)}`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" xmlns:nds="${PLOT_NS}"
     width="${num(page.w)}in" height="${num(page.h)}in"
     viewBox="0 0 ${num(page.w)} ${num(page.h)}">
${plotBlock(page, paperSizeId)}
  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(layerName)}" id="studio-layer-1"
     fill="none" stroke="#000000" stroke-width="${STROKE_IN}">
${body}
  </g>
</svg>
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
