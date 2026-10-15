// The artist's signature: TC, and the year under it, as paths a pen draws once - a group of its own,
// to move and size like any shape. Taken from the drawing it was made in (Robot Drawing Machine,
// *REFERENCE/tc-2026.svg). The initials are that drawing's own lines; the year is set again each time
// from Hershey Sans 1, the plotter font it was set in, drawn as smooth curves through the font's
// points as that drawing has it - which is what lets it say whatever year it is.
import type { StrokeFont } from "../../shared/lib/drawing/font";
import { flattenRun, parsePath, type Node } from "../../shared/lib/drawing/path";
import type { Point } from "../../shared/lib/drawing/parametric";
import { drawnRuns, newGroupId, newShapeId, pointsBox, type Shape } from "../../shared/lib/drawing/shapes";

/** The font the year is set in. */
export const SIGNATURE_FONT = "HersheySans1";
/** What the signature's layer is labelled, after its pen: "Black - Signature". */
export const SIGNATURE_LABEL = "Signature";

const MM = 1 / 25.4;

// The initials, in the drawing's millimetres: the C, a circle open on the right, and the T's two
// strokes, as they were drawn and then scaled into place there (its matrix, applied here).
const TC_SCALE = 0.23890239;
const TC_AT = { x: -191.88661, y: 15.314941 };
const TC_C = "m 904.50849,69.90494 a 17.2183,17.2183 0 1 1 0,-6.1952";
const TC_T: [Point, Point][] = [
  [{ x: 887.36279, y: 61.943138 }, { x: 887.36279, y: 79.004143 }],
  [{ x: 875.98877, y: 61.943138 }, { x: 898.73682, y: 61.943138 }],
];

// Where the year sits and how big, measured against the 2026 in that drawing: millimetres per font
// unit, and where the font's origin falls. Its digits are Hershey Sans 1's to within 0.3% in each
// one's proportions; these numbers put them where that drawing has them.
const YEAR_SCALE = 0.0031482;
const YEAR_AT = { x: 15.7195, y: 38.6297 };

/**
 * The signature as shapes, in inches, its box's top-left at `at`: the initials and the year, every
 * path in one group named Signature, on `layerId`. Nothing is drawn for a digit the font lacks.
 */
export function signatureShapes(year: number, font: StrokeFont, layerId: string, at: Point): Shape[] {
  const runs: { points: Node[]; smooth: boolean }[] = [];
  const tc = (p: Point) => ({ x: (p.x * TC_SCALE + TC_AT.x) * MM, y: (p.y * TC_SCALE + TC_AT.y) * MM });
  // The C: an arc, walked out into the points it's drawn through.
  for (const run of parsePath(TC_C)) runs.push({ points: flattenRun(run).map(tc), smooth: false });
  for (const [a, b] of TC_T) runs.push({ points: [tc(a), tc(b)], smooth: false });
  // The year, a digit at a time: the glyph's own points, y up in the font and down on the page.
  let pen = 0;
  for (const ch of String(year)) {
    const glyph = font.glyphs.get(ch) ?? font.missing;
    for (const run of parsePath(glyph.d)) {
      runs.push({
        points: run.map((n) => ({ x: (YEAR_AT.x + (n.x + pen) * YEAR_SCALE) * MM, y: (YEAR_AT.y - n.y * YEAR_SCALE) * MM })),
        smooth: true,
      });
    }
    pen += glyph.advance;
  }
  const group = newGroupId();
  const made = runs.filter((r) => r.points.length > 1).map(({ points, smooth }): Shape => {
    const s: Shape = { id: newShapeId(), layerId, kind: "path", points, x: 0, y: 0, x2: 0, y2: 0, group, groupName: SIGNATURE_LABEL, ...(smooth ? { smooth } : {}) };
    const b = pointsBox(drawnRuns(s).flat());
    return { ...s, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1 };
  });
  // Moved so the whole of it starts at `at`.
  const all = pointsBox(made.flatMap((s) => [{ x: s.x, y: s.y }, { x: s.x2, y: s.y2 }]));
  const dx = at.x - all.x0;
  const dy = at.y - all.y0;
  return made.map((s) => ({
    ...s,
    points: s.points!.map((n) => ({ x: n.x + dx, y: n.y + dy })),
    x: s.x + dx, y: s.y + dy, x2: s.x2 + dx, y2: s.y2 + dy,
  }));
}

/** How big the signature is, in inches: for placing it before it's made. */
export function signatureSize(year: number, font: StrokeFont): { w: number; h: number } {
  const shapes = signatureShapes(year, font, "", { x: 0, y: 0 });
  const b = pointsBox(shapes.flatMap((s) => [{ x: s.x, y: s.y }, { x: s.x2, y: s.y2 }]));
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
}
