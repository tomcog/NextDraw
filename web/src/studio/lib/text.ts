// Setting a text shape: where each glyph goes on the page, in the drawing's inches.
//
// The box is the deal: its height is the size the text is set at (one em), and its width follows
// from the words - so dragging a corner sizes the text, and typing more makes the box longer. A
// glyph's own coordinates run up from the baseline, so each one is drawn flipped.

import { setText, lineStep, type StrokeFont } from "./font";
import { boxOf, type Shape } from "./shapes";

export type { StrokeFont };

export interface TextRun {
  /** The glyph's path in the drawing's own inches: placed, sized and the right way up. */
  d: string;
}

/**
 * A glyph's path moved onto the page. The coordinates are rewritten rather than left to a transform:
 * a transform would scale the stroke with them, and the stroke is the pen's own width, which must
 * stay what it is. The fonts use absolute moves, lines and cubics, which is all this handles.
 */
function placePath(d: string, k: number, x: number, y: number): string {
  const parts = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!parts) return "";
  const out: string[] = [];
  let command = "";
  let pending: number[] = [];
  const trimNum = (v: number) => String(Number(v.toFixed(4)));
  const flush = () => {
    for (let i = 0; i + 1 < pending.length; i += 2) {
      out.push(trimNum(x + pending[i] * k), trimNum(y - pending[i + 1] * k)); // font units run up
    }
    pending = [];
  };
  for (const part of parts) {
    if (/[A-Za-z]/.test(part)) {
      flush();
      if (!"MLCZ".includes(part.toUpperCase()) || part !== part.toUpperCase()) return ""; // not ours to move
      command = part;
      out.push(command);
      continue;
    }
    if (!command) return "";
    pending.push(Number(part));
  }
  flush();
  return out.join(" ");
}

/** The size one em is set at, in inches: the box's height, over however many lines there are. */
function emOf(shape: Shape, font: StrokeFont, lines: number) {
  const b = boxOf(shape);
  const height = b.y1 - b.y0;
  const perLine = lineStep(font) / font.unitsPerEm; // ems from one baseline to the next
  return height > 0 ? height / (perLine * lines) : 0;
}

/** Every glyph of a text shape, placed and sized, ready to draw. */
export function textRuns(shape: Shape, font: StrokeFont | undefined): TextRun[] {
  if (!font || shape.kind !== "text") return [];
  const set = setText(shape.text ?? "", font);
  const b = boxOf(shape);
  const em = emOf(shape, font, set.lines);
  if (!em) return [];
  const k = em / font.unitsPerEm;
  const step = lineStep(font) * k;
  return set.glyphs
    .map((g) => {
      // The first baseline sits an ascender below the top of the box.
      const x = b.x0 + g.x * k;
      const y = b.y0 + font.ascent * k + g.line * step;
      return { d: placePath(g.d, k, x, y) };
    })
    .filter((run) => run.d);
}

/** How wide the words come out at the box's height, in inches: what the box's width is set to. */
export function textWidth(shape: Shape, font: StrokeFont | undefined): number {
  if (!font || shape.kind !== "text") return 0;
  const set = setText(shape.text ?? "", font);
  const em = emOf(shape, font, set.lines);
  return (set.width * em) / font.unitsPerEm;
}

/**
 * The same shape with its width matched to its words. The height - the size it is set at - is left
 * alone: that is what the person dragging a corner is choosing.
 */
export function fitText(shape: Shape, font: StrokeFont | undefined): Shape {
  if (shape.kind !== "text") return shape;
  const width = textWidth(shape, font);
  if (!width) return shape;
  const b = boxOf(shape);
  return { ...shape, x: b.x0, y: b.y0, x2: b.x0 + width, y2: b.y1 };
}


