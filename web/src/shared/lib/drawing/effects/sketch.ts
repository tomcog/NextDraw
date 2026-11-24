// Sketch lines: DrawingBotV3's, line for line - short straight lines chained into squiggles, each
// aimed at the darkest part left and lightening it as it goes.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { layerOf, simplified, sketchLinesOf, toneSampler } from "../photoSample";

export function sketchLines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sk = sketchLinesOf(photo);
  const [minLen, maxLen] = sk.lineMin <= sk.lineMax ? [sk.lineMin, sk.lineMax] : [sk.lineMax, sk.lineMin];
  const [sqMin, sqMax] = sk.squiggleMin <= sk.squiggleMax ? [sk.squiggleMin, sk.squiggleMax] : [sk.squiggleMax, sk.squiggleMin];
  const [eraseMin, eraseMax] = sk.eraseMin <= sk.eraseMax ? [sk.eraseMin, sk.eraseMax] : [sk.eraseMax, sk.eraseMin];
  const density = sk.lineDensity / 100;
  const deviation = sk.squiggleDeviation / 100;
  const tone = sk.tone / 100;
  const DESIRED = 253.5;

  // The pixels: a Pixel size each, a few million at most.
  let px = Math.max(0.05, photo.spacingMm) / 25.4;
  if ((w / px) * (h / px) > 3e6) px = Math.sqrt((w * h) / 3e6);
  const cols = Math.max(1, Math.round(w / px));
  const rows = Math.max(1, Math.round(h / px));
  const sx = w / cols;
  const sy = h / rows;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const lum = new Float64Array(cols * rows);
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = toneAt((c + 0.5) * sx, (r + 0.5) * sy);
      const v = t > 0 ? Math.round(255 * (1 - Math.min(1, t))) : 255;
      lum[r * cols + c] = v;
      sum += v;
    }
  }
  // Edges: where the tone changes sharply - by Sobel, over the pixels smoothed a little so grain
  // doesn't count - darkened, both sides of the edge, so the lines gather and run along them.
  if (sk.edges > 0) {
    const soft = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let s = 0;
      let k = 0;
      for (let y = Math.max(0, r - 1); y <= Math.min(rows - 1, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(cols - 1, c + 1); x++) { s += lum[y * cols + x]; k++; }
      soft[r * cols + c] = s / k;
    }
    const at = (x: number, y: number) => soft[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
    const strength = sk.edges / 100;
    sum = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const gx = at(c + 1, r - 1) + 2 * at(c + 1, r) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c - 1, r) - at(c - 1, r + 1);
      const gy = at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1) - at(c - 1, r - 1) - 2 * at(c, r - 1) - at(c + 1, r - 1);
      // A step from black to white is 1020; half that counts as a full edge.
      const edge = Math.min(1, Math.hypot(gx, gy) / 510);
      const i = r * cols + c;
      lum[i] = Math.max(0, Math.round(lum[i] - strength * 255 * edge));
      sum += lum[i];
    }
  }
  const total = cols * rows;
  const initial = sum / total;
  if (density <= 0 || initial >= DESIRED) return { passes: [], strokes: 0 };

  // Tiles keeping their darkness, to find the darkest part fast.
  const tw = Math.max(10, Math.floor(cols / 200));
  const th = Math.max(10, Math.floor(rows / 200));
  const tCols = Math.ceil(cols / tw);
  const tRows = Math.ceil(rows / th);
  const tileSum = new Float64Array(tCols * tRows);
  const tileCount = new Int32Array(tCols * tRows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = Math.floor(r / th) * tCols + Math.floor(c / tw);
    tileSum[t] += lum[r * cols + c];
    tileCount[t]++;
  }
  const setLum = (i: number, v: number) => {
    const c = i % cols;
    const r = (i - c) / cols;
    const d = v - lum[i];
    lum[i] = v;
    sum += d;
    tileSum[Math.floor(r / th) * tCols + Math.floor(c / tw)] += d;
  };
  const darkest = (): [number, number] => {
    let best = -1;
    let bestV = Infinity;
    for (let t = 0; t < tileSum.length; t++) {
      if (!tileCount[t]) continue;
      const v = Math.floor(tileSum[t] / tileCount[t]);
      if (best === -1 || v < bestV) [best, bestV] = [t, v];
    }
    const tx = (best % tCols) * tw;
    const ty = Math.floor(best / tCols) * th;
    let bx = tx;
    let by = ty;
    let bl = Infinity;
    for (let x = tx; x < Math.min(cols, tx + tw); x++) for (let y = ty; y < Math.min(rows, ty + th); y++) {
      if (lum[y * cols + x] < bl) [bx, by, bl] = [x, y, lum[y * cols + x]];
    }
    return [bx, by];
  };

  // Random, from the seed and the layer.
  let state = (sk.seed + 1) * 0x9e3779b1;
  for (const ch of layerOf(photo)) state = Math.imul(state ^ ch.charCodeAt(0), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomInt = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));

  // Each pixel of a line, Bresenham's way, from its start.
  const plotLine = (x0: number, y0: number, x1: number, y1: number, each: (x: number, y: number) => void) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      each(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += stepX; }
      if (e2 <= dx) { err += dx; y0 += stepY; }
    }
  };
  // The ring of pixels a radius out, for unlimited tests all round.
  const circle = (r: number) => {
    const out: [number, number][] = [];
    let x = -r;
    let y = 0;
    let err = 2 - 2 * r;
    do {
      out.push([-x, y], [-y, -x], [x, -y], [y, x]);
      const rr = err;
      if (rr <= y) err += ++y * 2 + 1;
      if (rr > x || err > y) err += ++x * 2 + 1;
    } while (x < 0);
    return out;
  };

  // The darkest line from a point: where it ends, and how light it is on average; -1, none.
  const findDarkestLine = (x0: number, y0: number, length: number, startAngle: number, delta: number, shadingNow: boolean): [number, number, number] => {
    let best = -1;
    let bx = x0;
    let by = y0;
    const tests = sk.unlimitedTests ? -1 : sk.angleTests;
    const ends: [number, number][] = [];
    const ring = delta === 360 && !shadingNow ? circle(length) : null;
    if (ring && (tests === -1 || ring.length <= tests)) {
      for (const [ex, ey] of ring) ends.push([x0 + ex, y0 + ey]);
    } else {
      const n = shadingNow ? 2 : Math.max(1, tests === -1 ? Math.ceil(2 * Math.PI * length) : tests);
      const step = shadingNow ? delta : delta / n;
      for (let d = 0; d < n; d++) {
        const a = ((step * d + startAngle) * Math.PI) / 180;
        ends.push([Math.trunc(Math.cos(a) * length) + x0, Math.trunc(Math.sin(a) * length) + y0]);
      }
    }
    for (const [ex, ey] of ends) {
      // Straight across or down is a touch lighter, as DrawingBot has it, against grid-like marks in solid black.
      let s = x0 === ex || y0 === ey ? 1 : 0;
      let count = 0;
      let lx = x0;
      let ly = y0;
      plotLine(x0, y0, ex, ey, (x, y) => {
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
          // Off the picture: the line so far, if nothing's been found yet.
          if (best === -1 && count > minLen) [bx, by, best] = [lx, ly, s / count];
          return;
        }
        s += lum[y * cols + x];
        count++;
        [lx, ly] = [x, y];
        const avg = s / count;
        if ((best === -1 || avg < best) && count > minLen) [bx, by, best] = [x, y, avg];
      });
    }
    return [bx, by, best];
  };

  // A line drawn: the pixels under it lightened, more where it starts lighter.
  const erase = (x0: number, y0: number, x1: number, y1: number) => {
    const start = x0 >= 0 && y0 >= 0 && x0 < cols && y0 < rows ? lum[y0 * cols + x0] : 255;
    const xp = start / 255;
    const yp = xp ** 3 * tone + xp * (1 - tone);
    const amount = Math.trunc(eraseMin + yp * (eraseMax - eraseMin));
    plotLine(x0, y0, x1, y1, (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = y * cols + x;
      setLum(i, Math.min(255, lum[i] + amount));
    });
  };

  let lines = 0;
  let lumProgress = 0;
  const done = () => {
    const avg = sum / total;
    const lineProgress = sk.lineLimit === -1 ? 0 : lines / Math.max(1, sk.lineLimit);
    lumProgress = avg >= DESIRED ? 1 : (avg - initial) / ((DESIRED - initial) * density);
    return Math.max(lineProgress, lumProgress) >= 1;
  };

  const squiggles: number[][][] = [];
  let pts: number[][] | null = null; // not lifting, the one line
  let cur: [number, number] = [0, 0];
  let fails = 0;
  let count = 0;
  const MOST_LINES = 2e6;
  outer: while (!done() && lines < MOST_LINES) {
    const last = cur;
    cur = darkest();
    let run: number[][];
    if (!sk.liftPen && pts) {
      // DrawingBot joins only when both x and y have changed.
      if (count > 0 && last[0] !== cur[0] && last[1] !== cur[1]) {
        erase(last[0], last[1], cur[0], cur[1]);
        lines++;
      }
      pts.push(cur);
      run = pts;
    } else {
      run = [cur];
      if (!sk.liftPen) pts = run;
    }
    const startDark = lum[cur[1] * cols + cur[0]];
    const allowable = sk.liftPen ? startDark + Math.max(1, DESIRED * deviation) : DESIRED;
    let failed = false;
    for (let s = 0; !sk.liftPen || s < sqMax; s++) {
      const shadingNow = sk.shading && sk.shadingThreshold / 100 < lumProgress;
      const delta = shadingNow ? sk.shadingDeltaAngle : sk.deltaAngle;
      const startAngle = sk.startAngleMin + random() * (sk.startAngleMax - sk.startAngleMin);
      const length = randomInt(minLen, maxLen);
      const [dx, dy, avg] = findDarkestLine(cur[0], cur[1], length, startAngle, delta, shadingNow);
      if (avg === -1) { failed = true; break; }
      if (sk.liftPen && s >= sqMin && (avg > allowable || avg > sum / total)) break;
      if (!sk.liftPen && avg > allowable) { failed = true; break; }
      erase(cur[0], cur[1], dx, dy);
      lines++;
      cur = [dx, dy];
      run.push(cur);
      if (done() || lines >= MOST_LINES) {
        if (sk.liftPen && run.length > 1) squiggles.push(run);
        break outer;
      }
    }
    count++;
    if (sk.liftPen && run.length > 1) squiggles.push(run);
    if (failed) {
      // Nowhere to go from here: it's taken as drawn.
      setLum(cur[1] * cols + cur[0], 255);
      if (++fails >= 1000) break;
    } else fails = 0;
  }
  if (pts && pts.length > 1) squiggles.push(pts);

  // Pixel centres to the box, in inches; squiggles drawn nearest first, each from its nearer end.
  const n = (v: number) => Number(v.toFixed(4));
  const toBox = (run: number[][]) => run.map(([x, y]) => [(x + 0.5) * sx, (y + 0.5) * sy]);
  const parts: string[] = [];
  const left = new Set(squiggles.map((_, i) => i));
  let qx = 0;
  let qy = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (const i of left) {
      const a = squiggles[i][0];
      const b = squiggles[i][squiggles[i].length - 1];
      const da = (a[0] - qx) ** 2 + (a[1] - qy) ** 2;
      const db = (b[0] - qx) ** 2 + (b[1] - qy) ** 2;
      if (da < bestD) [best, bestD, flip] = [i, da, false];
      if (db < bestD) [best, bestD, flip] = [i, db, true];
    }
    left.delete(best);
    const run = flip ? [...squiggles[best]].reverse() : squiggles[best];
    [qx, qy] = run[run.length - 1];
    const kept = simplified(toBox(run), 0.01 / 25.4);
    parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Streamlines ----------

/**
 * Tone as streamlines, after Jobard and Lefer: lines that flow along the picture's own shapes - round
 * a cheek, down a fold - rather than straight across it, closer together where it's darker. Each line
 * runs on until it comes within half its spacing of another, then stops; the next starts its spacing
 * away from one already drawn, so they lie evenly, the way an engraver's do. Where the picture has no
 * shape to follow - sky, a flat wall - they settle to the layer's angle. A second pass runs across the
 * first for the deepest darks; a third, on the diagonal between them, for the darkest third.
 */
