// Scribble: strokes that wander and curl at random, overlapping, building ink where the picture is
// darker - scribbling by hand.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { SCRIBBLE_DEFAULTS } from "../photoDefaults";
import { layerOf, simplified, toneSampler } from "../photoSample";

export function scribble(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const longest = Math.max(2, photo.scribbleLengthMm ?? SCRIBBLE_DEFAULTS.lengthMm) / 25.4;
  const shortest = Math.min(longest, Math.max(0, photo.scribbleMinMm ?? SCRIBBLE_DEFAULTS.minMm) / 25.4);
  const wiggle = Math.min(100, Math.max(0, photo.scribbleWiggle ?? SCRIBBLE_DEFAULTS.wiggle)) / 100;
  // Straight runs this long between corners: the stroke wanders as before, but its pen keeps a straight
  // line and takes the turn it has gathered all at once at the corner. 0, every step turns: smooth.
  const segment = Math.max(0, photo.scribbleSegmentMm ?? SCRIBBLE_DEFAULTS.segmentMm) / 25.4;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const n = (v: number) => Number(v.toFixed(4));
  // Random, from the seed and the layer: the same scribble every time it's worked out.
  let state = (photo.scribbleSeed ?? SCRIBBLE_DEFAULTS.seed) * 0x9e3779b1;
  for (const ch of layerOf(photo)) state = Math.imul(state ^ ch.charCodeAt(0), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  // The ink grid: each cell's ink wanted and laid, in spacings' worth of line across it.
  const cell = Math.max(spacing * 2, 1 / 25.4);
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const MOST = 3; // -ln(1 - 0.95): past that, random lines add little the eye sees
  const want = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = toneAt(Math.min(w, (c + 0.5) * cell), Math.min(h, (r + 0.5) * cell));
      want[r * cols + c] = t > 0 ? Math.min(MOST, -Math.log(1 - Math.min(0.999, t))) : 0;
    }
  }
  const laid = new Float32Array(cols * rows);
  const cellAt = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const need = (x: number, y: number) => (x < 0 || x > w || y < 0 || y > h ? -1 : want[cellAt(x, y)] - laid[cellAt(x, y)]);
  // A step of line `step` long, in spacings' worth across its cell.
  const step = Math.max(spacing, 0.4 / 25.4);
  const inkPerStep = (step * spacing) / (cell * cell);

  // How tightly it curls: about 30 mm across just above 0, 1 mm at 100 - and at 0, not at all: straight
  // lines, which don't lean toward the ink either. The turn wanders at random about
  // nothing, steadied each step, so it bends one way for a while and then the other.
  const curl = wiggle > 0 ? 1 / (30 / 25.4 * (1 / 30) ** wiggle) : 0;
  const steady = 0.85;
  const jolt = curl * Math.sqrt(1 - steady * steady);
  const look = Math.max(spacing * 3, 1.5 / 25.4);
  const slack = spacing * 4; // how far a stroke may run through what has enough before it stops

  const drawn: number[][][] = [];
  let misses = 0;
  const tries = 4000;
  for (let guard = 0; misses < tries && guard < 400000; guard++) {
    const sx = random() * w;
    const sy = random() * h;
    const wanted = need(sx, sy);
    if (wanted <= 0.05 || random() * MOST > wanted) {
      misses++;
      continue;
    }
    const missed = misses;
    misses = 0;
    let x = sx;
    let y = sy;
    let heading = random() * Math.PI * 2;
    let turn = gauss() * curl;
    let going = heading; // the way the pen is drawing: the wander's heading, caught up at each corner
    let run = 0; // drawn since the last corner
    const pts: number[][] = [[x, y]];
    const inked: number[] = []; // the cell each step laid its ink in, to take back if it's left out
    let length = 0;
    let idle = 0;
    while (length < longest) {
      // Lean toward the side that wants more ink, a little ahead.
      const toLeft = need(x + Math.cos(heading - 0.6) * look, y + Math.sin(heading - 0.6) * look);
      const toRight = need(x + Math.cos(heading + 0.6) * look, y + Math.sin(heading + 0.6) * look);
      turn = turn * steady + gauss() * jolt + Math.sign(toRight - toLeft) * Math.min(1, Math.abs(toRight - toLeft)) * curl * 0.5;
      heading += turn * step;
      if (run >= segment) [going, run] = [heading, 0];
      run += step;
      const nx = x + Math.cos(going) * step;
      const ny = y + Math.sin(going) * step;
      const here = need(nx, ny);
      if (here < -0.5) break; // off the box, or outside the picture
      idle = here > 0 ? 0 : idle + step;
      if (idle > slack) break;
      const at = cellAt(nx, ny);
      laid[at] += inkPerStep;
      inked.push(at);
      x = nx;
      y = ny;
      pts.push([x, y]);
      length += step;
    }
    // Trailing steps through what had enough are taken back off.
    while (idle > 0 && pts.length > 1) {
      pts.pop();
      idle -= step;
    }
    // Too short once trimmed: left out, its ink given back, and counted as a miss so a spot only
    // that short a stroke fits doesn't keep the tries going.
    if (shortest > 0 && (pts.length - 1) * step < shortest) {
      for (const at of inked) laid[at] -= inkPerStep;
      misses = missed + 1;
      continue;
    }
    // A straight stroke needs only its ends.
    if (length >= spacing * 2 && pts.length > 2) drawn.push(curl ? pts : [pts[0], pts[pts.length - 1]]);
  }

  // Drawn nearest first, each from whichever end is nearer the pen, so it doesn't cross the page between them.
  const parts: string[] = [];
  const left = new Set(drawn.map((_, i) => i));
  let px = 0;
  let py = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (const i of left) {
      const a = drawn[i][0];
      const b = drawn[i][drawn[i].length - 1];
      const da = (a[0] - px) ** 2 + (a[1] - py) ** 2;
      const db = (b[0] - px) ** 2 + (b[1] - py) ** 2;
      if (da < bestD) [best, bestD, flip] = [i, da, false];
      if (db < bestD) [best, bestD, flip] = [i, db, true];
    }
    left.delete(best);
    const run = flip ? [...drawn[best]].reverse() : drawn[best];
    const kept = simplified(run, 0.02 / 25.4);
    parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
    [px, py] = run[run.length - 1];
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Sketch lines ----------

/**
 * Tone as DrawingBotV3's Sketch Lines (its open-source core, AbstractSketchPFM and PFMSketchLinesBasic):
 * the picture read as a grid of pixels, 0 black to 255 white, each a Pixel size across. A squiggle
 * starts at the darkest pixel of the darkest 10-pixel tile. From where the pen is, it tries Angle
 * Tests straight lines (a random length from Line Min to Line Max, at angles spread round Drawing
 * Delta Angle from a random start between the Start Angles) and takes the darkest - the point along
 * any of them where the line so far is darkest on average. That line is drawn, the pixels under it
 * lightened by between Erase Min and Erase Max (more where it's already lighter, curved by Tone), and
 * the pen goes on from its end. Past Squiggle Min Length lines, the squiggle ends when its next line
 * would be lighter than where it started by more than Squiggle Max Deviation, or than the picture's
 * average; at Squiggle Max Length it ends regardless. It all stops once the picture has been
 * lightened Line Density of the way to white, or Line Max Limit lines are drawn. Shading, once that far
 * through, tries just two angles, Shading Delta Angle apart. Edges (ours, not DrawingBot's) darkens
 * where the tone changes sharply first, so lines gather along them. Not lifting the pen, one unbroken line:
 * each squiggle joined to the next. Random, but the same for the same seed and layer.
 */
