// Setting a text shape: where each glyph goes on the page, in the drawing's inches.
//
// The box is the deal: its height is the size the text is set at (one em), and its width follows
// from the words - so dragging a corner sizes the text, and typing more makes the box longer. A
// glyph's own coordinates run up from the baseline, so each one is drawn flipped.

import { setText, lineStep, type StrokeFont } from "./font";
import type { Point } from "./parametric";
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

/**
 * A placed glyph broken into the runs of points the pen actually travels: one run per stroke, curves
 * walked at `step` inches, which is what baking text needs. The fonts use absolute moves, lines and
 * cubics; a Z closes the run it ends.
 */
export function flattenPath(d: string, step = 0.01): Point[][] {
  const parts = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!parts) return [];
  const runs: Point[][] = [];
  let run: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let command = "";
  const nums: number[] = [];
  const cubic = (c1: Point, c2: Point, to: Point) => {
    // Enough steps that the widest curve here is walked in pieces about `step` long.
    const rough = Math.hypot(c1.x - at.x, c1.y - at.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(to.x - c2.x, to.y - c2.y);
    const steps = Math.max(2, Math.min(120, Math.ceil(rough / step)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      run.push({
        x: u * u * u * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
        y: u * u * u * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
      });
    }
    at = to;
  };
  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  const take = () => {
    if (command === "M") {
      flush();
      at = { x: nums[0], y: nums[1] };
      start = at;
      run = [at];
    } else if (command === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        at = { x: nums[i], y: nums[i + 1] };
        run.push(at);
      }
    } else if (command === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        cubic({ x: nums[i], y: nums[i + 1] }, { x: nums[i + 2], y: nums[i + 3] }, { x: nums[i + 4], y: nums[i + 5] });
      }
    } else if (command === "Z") {
      run.push(start);
      flush();
      run = [start];
      at = start;
    }
    nums.length = 0;
  };
  for (const part of parts) {
    if (/[A-Za-z]/.test(part)) {
      if (command) take();
      command = part.toUpperCase();
      if (command === "Z") take();
      continue;
    }
    nums.push(Number(part));
    // A move or a line repeated without its letter is more of the same command; a pair after a
    // move is a line, as SVG says.
    if (command === "M" && nums.length === 2) {
      take();
      command = "L";
    }
    if (command === "L" && nums.length === 2) take();
    if (command === "C" && nums.length === 6) take();
  }
  if (command) take();
  flush();
  return runs;
}

/** What each text shape's numbers come to, with the defaults filled in. */
const settingsOf = (shape: Shape) => ({
  tracking: shape.tracking ?? 0, // percent of the size
  leading: shape.leading ?? 1, // multiples of the font's own line step
});

/**
 * The size one em is set at, in inches. The box's height holds the first line in full, plus however
 * many gaps follow it - so more lines, or more space between them, means smaller letters in the
 * same box.
 */
function emOf(shape: Shape, font: StrokeFont, lines: number) {
  const b = boxOf(shape);
  const height = b.y1 - b.y0;
  const perLine = lineStep(font) / font.unitsPerEm; // ems from one baseline to the next
  const { leading } = settingsOf(shape);
  const tall = perLine * (1 + (lines - 1) * leading);
  return height > 0 && tall > 0 ? height / tall : 0;
}

/** Every glyph of a text shape, placed and sized, ready to draw. */
export function textRuns(shape: Shape, font: StrokeFont | undefined): TextRun[] {
  if (!font || shape.kind !== "text") return [];
  const { tracking, leading } = settingsOf(shape);
  const set = setText(shape.text ?? "", font, (tracking / 100) * font.unitsPerEm);
  const b = boxOf(shape);
  const em = emOf(shape, font, set.lines);
  if (!em) return [];
  const k = em / font.unitsPerEm;
  const step = lineStep(font) * k * leading;
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
  const { tracking } = settingsOf(shape);
  const set = setText(shape.text ?? "", font, (tracking / 100) * font.unitsPerEm);
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


