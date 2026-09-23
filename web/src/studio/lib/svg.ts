import { fillRuns, type Fill } from "./hatch";
import { curveStrokes, pointsAttr, type Point } from "./parametric";
import { textRuns, type StrokeFont } from "./text";
import { placementAttr, placements } from "./repeat";
import { hasCurves, pathData } from "./path";
import { boxOf, drawnNodes, drawnRuns, pathRuns, turnAttr, type Layer, type Page, type Shape } from "./shapes";
import { photoData, photoMarks, photoOrigin } from "./photo";

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
const trim = (n: number) => Number(n.toFixed(4));

/** Every copy of a shape, each in its own turn of the page. One copy for a shape that isn't repeated. */
function allCopies(s: Shape, one: (copy: number) => string): string {
  return placements(s)
    .map((p, i) => {
      const at = placementAttr(s, p);
      const body = one(i);
      return at ? `<g transform="${escapeAttr(at)}">${body}</g>` : body;
    })
    .join("\n      ");
}

function shapeMarkup(s: Shape, fonts: Record<string, StrokeFont> = {}): string {
  const b = boxOf(s);
  // A turned shape is written as its own geometry inside one turn, which every SVG reader applies -
  // and Studio reads the angle back from the design block rather than from the transform.
  const turn = turnAttr(s);
  if (turn) return `<g transform="${escapeAttr(turn)}">${shapeMarkup({ ...s, rotation: 0 }, fonts)}</g>`;
  // Copies carry the shape's id with a number after it, which is how reading the drawing back knows
  // they are copies rather than shapes of their own.
  if (s.repeat) return allCopies(s, (i) => shapeMarkup({ ...s, repeat: undefined, id: i ? `${s.id}-r${i + 1}` : s.id }, fonts));
  if (s.kind === "photo" && s.photo) {
    // The hatching, one path per pass of lines, in the photo's own corner moved to where it sits.
    // In a group named after the photo, so reading the drawing back leaves the lines to be made
    // again from the photo rather than listing tens of thousands of them as shapes.
    const marks = photoMarks(s.photo, b.x1 - b.x0, b.y1 - b.y0);
    const paths = (marks?.passes ?? []).filter(Boolean).map((d) => `<path d="${escapeAttr(d)}"/>`).join("");
    const at = photoOrigin(s.photo, b.x0, b.y0);
    return `<g id="${PHOTO_GROUP_PREFIX}${escapeAttr(s.id)}" transform="translate(${num(at.x)} ${num(at.y)})">${paths}</g>`;
  }
  if (s.kind === "path") {
    // A path that curves is written as the curves themselves - the same `C`s, to the same numbers,
    // that it was read from, or the handles a smoothed path is drawn by - so a drawing that came in
    // goes out unchanged, and one of Studio's own goes out as the curve it is rather than the lines
    // it would be walked out into. Plot walks it out itself when it needs points: to regenerate a
    // fill, it reads path data the way Studio does (flatten_path_data in server.py).
    if (hasCurves(drawnNodes(s))) return `<path id="${escapeAttr(s.id)}" d="${escapeAttr(pathData(drawnNodes(s)))}"/>`;
    const runs = drawnRuns(s);
    if (runs.length === 1) return `<polyline id="${escapeAttr(s.id)}" points="${pointsAttr(runs[0])}"/>`;
    // Several runs in one element: a path with a move at the start of each, which is what makes the
    // whole of it one shape again when the drawing is opened.
    const d = runs
      .map((run) => `M ${run.map((p) => `${trim(p.x)} ${trim(p.y)}`).join(" L ")}`)
      .join(" ");
    return `<path id="${escapeAttr(s.id)}" d="${escapeAttr(d)}"/>`;
  }
  if (s.kind === "text") {
    // One path per letter, drawn where it is set. The words themselves are in the design block, so
    // reopening the drawing gives back something that can still be typed into.
    const runs = textRuns(s, fonts[s.font ?? ""]);
    return runs
      .map((r, i) => `<path id="${escapeAttr(s.id)}${i ? `-g${i + 1}` : ""}" d="${escapeAttr(r.d)}"/>`)
      .join("\n      ");
  }
  if (s.kind === "curve") {
    // Drawn out as the lines the pen makes, so Plot needs to know nothing about the numbers behind
    // them; they travel in the design block below and Studio redraws the curve from those.
    return curveStrokes(s)
      .map((run, i) => `<polyline id="${escapeAttr(s.id)}${i ? `-${i + 1}` : ""}" points="${pointsAttr(run)}"/>`)
      .join("\n      ");
  }
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

// A photo's lines go in a group named after the photo, for the same reason as a fill's below.
export const PHOTO_GROUP_PREFIX = "studio-photo-";

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
      const runs = fillRuns(shape, fill);
      if (!runs.length) return "";
      // A run of two points is a line, which says plainly what the pen does; anything longer is a
      // polyline, as a wave or a ring of a concentric fill has to be.
      const body = runs
        .map((run) => (run.length === 2
          ? `        <line x1="${num(run[0].x)}" y1="${num(run[0].y)}" x2="${num(run[1].x)}" y2="${num(run[1].y)}"/>`
          : `        <polyline points="${run.map((p) => `${num(p.x)},${num(p.y)}`).join(" ")}"/>`))
        .join("\n");
      const turn = turnAttr(shape);
      const group = (n: number) =>
        `      <g id="${FILL_GROUP_PREFIX}${escapeAttr(fill.id)}${n ? `-r${n + 1}` : ""}"${turn ? ` transform="${escapeAttr(turn)}"` : ""}>\n${body}\n      </g>`;
      return allCopies(shape, group);
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * A few runs of points as a file of their own, in inches, sized to what they cover: what goes on the
 * system clipboard when a shape is copied, so it can be pasted into a drawing program. No layers, no
 * design block, nothing of Studio's - just the lines, at the size they were drawn.
 */
export function svgForMarks(runs: Point[][], strokeIn = STROKE_IN): string {
  const points = runs.flat();
  if (points.length < 2) return "";
  const x0 = Math.min(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const x1 = Math.max(...points.map((p) => p.x));
  const y1 = Math.max(...points.map((p) => p.y));
  // A hairline still has width; half of it sits outside the line, so the box grows by that much or
  // the outermost stroke is cut in half by the edge of the file.
  const pad = strokeIn / 2;
  const w = x1 - x0 + strokeIn;
  const h = y1 - y0 + strokeIn;
  const body = runs
    .map((run) => `  <polyline points="${run.map((p) => `${trim(p.x - x0 + pad)},${trim(p.y - y0 + pad)}`).join(" ")}"/>`)
    .join("\n");
  return [
    `<svg xmlns="${SVG_NS}" width="${num(w)}in" height="${num(h)}in" viewBox="0 0 ${num(w)} ${num(h)}">`,
    `  <g fill="none" stroke="#000000" stroke-width="${num(strokeIn)}" stroke-linecap="round" stroke-linejoin="round">`,
    body,
    "  </g>",
    "</svg>",
  ].join("\n");
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
function designBlock(fills: Fill[], shapes: Shape[], layers: Layer[]): string {
  // Which layer each shape belongs to, by NAME. The SVG layer it sits in says this already, except
  // for the ones on %sources - that layer has to keep the name NextDraw skips, so it can't be the
  // pen's. Names, not Studio's internal ids: the ids mean nothing once the file is reopened, and
  // matching them up by position gets it wrong the moment shapes and layers are in different orders.
  const nameOf = new Map(layers.map((l) => [l.id, l.name]));
  const curves = shapes.filter((s) => s.curve);
  const photos = shapes.filter((s) => s.kind === "photo" && s.photo);
  const texts = shapes.filter((s) => s.kind === "text");
  const turned = shapes.filter((s) => s.rotation);
  const repeated = shapes.filter((s) => s.repeat);
  const smoothed = shapes.filter((s) => s.smooth && s.kind === "path");
  const named = shapes.filter((s) => s.name?.trim());
  const data = {
    on: Object.fromEntries(shapes.map((s) => [s.id, nameOf.get(s.layerId) ?? ""])),
    // How far each turned shape is turned. The file already draws it turned; this is what lets it be
    // picked up again as a square box with an angle, rather than as geometry nobody can resize.
    ...(turned.length ? { turned: Object.fromEntries(turned.map((s) => [s.id, s.rotation])) } : {}),
    // How each repeated shape repeats. The copies are all in the file for Plot to draw; this is what
    // lets Studio pick them up again as one shape drawn many times.
    ...(repeated.length ? { repeats: Object.fromEntries(repeated.map((s) => [s.id, s.repeat])) } : {}),
    // What shapes have been called. Only the ones given a name: the rest are named after what they
    // are, and that is worked out again every time the drawing is opened.
    ...(named.length
      ? { names: Object.fromEntries(named.map((s) => [s.id, s.name?.trim()])) }
      : {}),
    // The points a smoothed path was drawn through. The file holds the curve itself, as the lines
    // the pen makes; these are what lets it be picked up again as a few points to drag rather than
    // as the hundreds they were walked out into.
    ...(smoothed.length
      ? { smoothed: Object.fromEntries(smoothed.map((s) => [
          s.id,
          pathRuns(s).map((run) => run.map((pt) => [trim(pt.x), trim(pt.y)])),
        ])) }
      : {}),
    // What each text says and which font sets it: the letters are in the file as paths already, and
    // this is what lets them be typed into again.
    ...(texts.length
      ? { texts: Object.fromEntries(texts.map((s) => [s.id, {
          text: s.text ?? "", font: s.font ?? "", box: [s.x, s.y, s.x2, s.y2],
          ...(s.tracking ? { tracking: s.tracking } : {}),
          ...(s.leading && s.leading !== 1 ? { leading: s.leading } : {}),
        }])) }
      : {}),
    // The numbers behind each parametric shape, and the box it was drawn in, so reopening the
    // drawing gets the curve back rather than a heap of line segments.
    ...(curves.length
      ? { curves: curves.map((s) => ({ shape: s.id, box: [s.x, s.y, s.x2, s.y2], ...s.curve })) }
      : {}),
    // Each photo, its working copy included, and the numbers that turn it into lines. The lines are in
    // the file for Plot; this is what lets Studio make them again - for another pen, at another size.
    ...(photos.length
      ? { photos: photos.map((s) => ({ shape: s.id, box: [s.x, s.y, s.x2, s.y2], ...photoData(s.photo!) })) }
      : {}),
    fills: fills.map((f) => ({
      id: f.id,
      shape: f.shapeId,
      angle: f.angle,
      spacing_mm: f.spacingMm,
      scale: f.scale,
      ...(f.kind && f.kind !== "hatch" ? { kind: f.kind } : {}),
      ...(f.waveMm !== undefined ? { wave_mm: f.waveMm } : {}),
      ...(f.swingMm !== undefined ? { swing_mm: f.swingMm } : {}),
      ...(f.dashMm !== undefined ? { dash_mm: f.dashMm } : {}),
      ...(f.gapMm !== undefined ? { gap_mm: f.gapMm } : {}),
      ...(f.connected ? { connected: true } : {}),
      ...(f.custom ? { custom: true } : {}),
    })),
  };
  return `  <metadata id="nextdraw-studio"><nds:design>${escapeText(JSON.stringify(data))}</nds:design></metadata>`;
}

export interface SaveOptions {
  paperSizeId: string;
  /** The fonts in use, so text can be written out as the paths the pen will draw. */
  fonts?: Record<string, StrokeFont>;
  /** The drawing tool, so Plot opens the drawing with the same one chosen. */
  toolName: string;
}

export function buildSvg(
  shapes: Shape[],
  fills: Fill[],
  layers: Layer[],
  page: Page,
  opts: SaveOptions,
): string {
  // One SVG layer per Studio layer, in the order they're stacked. A layer is one pen, so everything
  // on it - outlines and hatching alike - carries that one colour.
  const body = layers
    .map((layer, i) => {
      const mine = shapes.filter((sh) => sh.layerId === layer.id);
      const drawn = mine.filter((sh) => sh.outline !== false);
      const myFills = fills.filter((f) => mine.some((sh) => sh.id === f.shapeId));
      const inner = [
        drawn.map((sh) => `      ${shapeMarkup(sh, opts.fonts)}`).join("\n"),
        fillMarkup(shapes, myFills),
      ].filter(Boolean).join("\n");
      if (!inner) return "";
      return `  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(layer.name)}" id="studio-layer-${i + 1}"
     fill="none" stroke="${escapeAttr(layer.color)}" stroke-width="${STROKE_IN}">
${inner}
  </g>
`;
    })
    .filter(Boolean)
    .join("");

  const sources = shapes.filter((sh) => sh.outline === false);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" xmlns:nds="${PLOT_NS}"
     width="${num(page.w)}in" height="${num(page.h)}in"
     viewBox="0 0 ${num(page.w)} ${num(page.h)}">
${plotBlock(page, opts)}
${designBlock(fills, shapes, layers)}
${body}${sourceLayer(sources, opts.fonts ?? {})}</svg>
`;
}

/** The unplotted layer holding shapes that are filled but not outlined. Left out when it's empty. */
function sourceLayer(sources: Shape[], fonts: Record<string, StrokeFont>): string {
  if (!sources.length) return "";
  const body = sources.map((s) => `      ${shapeMarkup(s, fonts)}`).join("\n");
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
