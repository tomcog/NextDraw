// Squiggle: SquiggleDraw's look, waves that swing wider where the picture is darker - the sketch's
// own, and the Inkscape extension's, which differ enough to be worth both.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { processingBlurred, smoothedTones, squiggleDrawOf, squiggleInkscapeOf, toneSampler } from "../photoSample";

export function squiggleInkscape(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sq = squiggleInkscapeOf(photo);
  const rows = Math.round(sq.rows);
  const cols = Math.round(sq.cols);
  const freq = Math.round(sq.freq);
  const divisor = [128, 64, 32, 16, 8, 4][Math.round(sq.amp) - 1];
  const sqMax = 256 / divisor;
  const MM = 1 / 25.4;
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(smoothedTones(photo.src, tones, 2), photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));

  // The grid in the rows' own frame: along them L, across them A - the box itself at no angle.
  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const A = Math.abs(w * dy) + Math.abs(h * dx);
  const cx = w / 2;
  const cy = h / 2;
  type P = { x: number; y: number };
  // A point by how far along (0 to L) and across (0 to A) the frame it is.
  const at = (t: number, o: number): P => ({ x: cx + (t - L / 2) * dx - (o - A / 2) * dy, y: cy + (t - L / 2) * dy + (o - A / 2) * dx });
  const inside = (p: P) => p.x >= -1e-9 && p.x <= w + 1e-9 && p.y >= -1e-9 && p.y <= h + 1e-9;
  const n = (v: number) => Number(v.toFixed(4));
  const brightness = (p: P) => {
    if (!inside(p)) return 255;
    const tone = toneAt(p.x, p.y);
    if (tone < 0) return 255;
    return 255 * (1 - (sq.invert ? 1 - tone : tone));
  };

  // The photo shrunk to the grid, each cell the average of its brightness, as whole numbers.
  const grid = new Float32Array(rows * cols);
  const SUB = 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) sum += brightness(at(((c + (j + 0.5) / SUB) * L) / cols, ((r + (i + 0.5) / SUB) * A) / rows));
    grid[r * cols + c] = Math.round(sum / (SUB * SUB));
  }
  // Then scaled up to a pixel a millimetre, plus one, by Lanczos, and read at a whole pixel.
  const Wpx = Math.round(L / MM) + 1;
  const Hpx = Math.round(A / MM) + 1;
  const lanczos = (x: number) => (x === 0 ? 1 : Math.abs(x) >= 3 ? 0 : (3 * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / 3)) / (Math.PI * Math.PI * x * x));
  const weights = (px: number, size: number, cells: number) => {
    const s = ((px + 0.5) * cells) / size - 0.5;
    const out: [number, number][] = [];
    let total = 0;
    for (let k = Math.floor(s) - 2; k <= Math.floor(s) + 3; k++) {
      if (k < 0 || k >= cells) continue;
      const wt = lanczos(s - k);
      out.push([k, wt]);
      total += wt;
    }
    return out.map(([k, wt]) => [k, wt / total] as [number, number]);
  };
  const read = (px: number, py: number) => {
    let v = 0;
    for (const [r, wr] of weights(py, Hpx, rows)) for (const [c, wc] of weights(px, Wpx, cols)) v += grid[r * cols + c] * wr * wc;
    return Math.min(255, Math.max(0, Math.round(v)));
  };

  // Whether this layer draws at a point along a row: its tone (and, lifting, not white). Asked of each
  // half-wave's middle, so a run stops at the half-wave where the tone does - asked of a whole cell,
  // a run reaching white ran on to the cell's end and spilled into it.
  const xinc = L / (cols - 1);
  const rowH = A / rows;
  const drawsAt = (t: number, oMid: number) => {
    const p = at(t, oMid);
    if (!inside(p)) return false;
    const tone = toneAt(p.x, p.y);
    return tone >= 0 && !(photo.squiggleLift && fromWhite && tone < 0.03);
  };

  // Each run: its cubics' points, from the row's middle at a cell's edge to another.
  type Run = { start: P; segs: [P, P, P][]; fromStart: boolean; toEnd: boolean; row: number };
  const lines: { start: P; segs: [P, P, P][] }[] = [];
  let open: Run | null = null;
  const quad = (p0: P, q: P, p1: P): [P, P, P] => [
    { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
    p1,
  ];
  const back = sq.path !== "uni";
  for (let r = 0; r < rows; r++) {
    const oMid = rowH * (r + 1) - rowH / 2;
    const reversed = back && r % 2 !== 0;
    const order = Array.from({ length: cols - 1 }, (_, i) => (reversed ? cols - 2 - i : i));
    const runs: Run[] = [];
    let run: Run | null = null;
    for (const [i, x] of order.entries()) {
      let amp = sqMax - read(Math.floor(x * (L / MM / cols)), Math.floor(r * (A / MM / rows))) / divisor;
      if (reversed) amp *= -1;
      const sign = reversed ? -1 : 1;
      const t0 = (reversed ? x + 1 : x) * xinc;
      // `freq` waves to the cell, each a hump out and its reflection back: a quadratic, then the
      // extension's smooth 't'. Each half drawn only where the tone is, so runs end with it.
      const half = (sign * xinc) / 2 / freq;
      for (let k = 0; k < 2 * freq; k++) {
        const s = t0 + half * k;
        if (!drawsAt(s + half / 2, oMid)) {
          if (run) runs.push(run);
          run = null;
          continue;
        }
        if (!run) run = { start: at(s, oMid), segs: [], fromStart: i === 0 && k === 0, toEnd: false, row: r };
        const swing = (k % 2 === 0 ? amp : -amp) / 2;
        run.segs.push(quad(at(s, oMid), at(s + half / 2, oMid + swing * MM), at(s + half, oMid)));
      }
      if (i === order.length - 1 && run) run.toEnd = true;
    }
    if (run) runs.push(run);
    for (const runNow of runs) {
      if (open && sq.path === "join" && runNow.fromStart && open.toEnd && open.row === r - 1) {
        // The turn, as the extension's: out half a cell past the edge the last row ended at, and round, down a row.
        const end = open.segs[open.segs.length - 1][2];
        const tOut = back && (r - 1) % 2 !== 0 ? -xinc / 2 : L + xinc / 2;
        const ctrl = at(tOut, oMid - rowH);
        const mid = at(tOut, oMid - rowH / 2);
        const ctrl2 = at(tOut, oMid);
        open.segs.push(quad(end, ctrl, mid), quad(mid, ctrl2, runNow.start), ...runNow.segs);
        open.toEnd = runNow.toEnd;
        open.row = r;
        continue;
      }
      if (open) lines.push(open);
      open = runNow;
    }
  }
  if (open) lines.push(open);

  const parts = lines
    .filter((l) => l.segs.length)
    .map((l) => `M${n(l.start.x)} ${n(l.start.y)}` + l.segs.map(([a, b, c]) => `C${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(c.x)} ${n(c.y)}`).join(""));
  return { passes: [parts.join("")], strokes: parts.length };
}

/**
 * Tone as squiggles: Gregg Wygonik's SquiggleDraw (public domain), its sums as the Processing sketch
 * has them, with its controls and their numbers - see SQUIGGLE_DRAW. It works on the photo as the
 * sketch sees it: grey, blurred by 2 pixels and scaled up by the resolution scale, its rows
 * `lines` to the photo's height. Along each row the phase moves on by the darkness over the
 * frequency at every `detail` step, so darker is tighter, and the swing is the darkness times the
 * strength over the lines. A point goes at each crest, trough and crossing of the middle, and the
 * points are joined as a Catmull-Rom curve - Processing's curveVertex - with a point a tenth of a
 * step past each end to aim the ends straight. Connect ends turns each row round into the next,
 * out past the edge by a third of a row, as the sketch does.
 *
 * Over the sketch: rows at `squiggleAngle`; with `squiggleLift`, a layer of a photo lifts off where
 * it has nothing to draw - white, another band's tone, another pen's colour (the sketch never lifts;
 * without it every layer's rows run edge to edge, flat there); and `squiggleSmooth` lengthens
 * or shortens the curve's handles, 1 being Processing's.
 */

/**
 * Tone as squiggles: Gregg Wygonik's SquiggleDraw (public domain), its sums as the Processing sketch
 * has them, with its controls and their numbers - see SQUIGGLE_DRAW. It works on the photo as the
 * sketch sees it: grey, blurred by 2 pixels and scaled up by the resolution scale, its rows
 * `lines` to the photo's height. Along each row the phase moves on by the darkness over the
 * frequency at every `detail` step, so darker is tighter, and the swing is the darkness times the
 * strength over the lines. A point goes at each crest, trough and crossing of the middle, and the
 * points are joined as a Catmull-Rom curve - Processing's curveVertex - with a point a tenth of a
 * step past each end to aim the ends straight. Connect ends turns each row round into the next,
 * out past the edge by a third of a row, as the sketch does.
 *
 * Over the sketch: rows at `squiggleAngle`; with `squiggleLift`, a layer of a photo lifts off where
 * it has nothing to draw - white, another band's tone, another pen's colour (the sketch never lifts;
 * without it every layer's rows run edge to edge, flat there); and `squiggleSmooth` lengthens
 * or shortens the curve's handles, 1 being Processing's.
 */
export function squiggle(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sd = squiggleDrawOf(photo);
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // The sketch's own picture: blurred as Processing's filter(BLUR, 2) does, then scaled up.
  const blurred = processingBlurred(photo.src, tones);
  const W2 = Math.max(1, Math.round(tones.w * (c2 - c0) * sd.scale));
  const H2 = Math.max(1, Math.round(tones.h * (c3 - c1) * sd.scale));
  const unit = h / H2; // inches to one of the sketch's pixels
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(blurred, photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));
  const ystep = Math.round(sd.lines);
  const ymult = sd.strength;
  const xstep = 31 - Math.round(sd.detail);
  const xsmooth = 257 - sd.frequency;
  const strokeWidth = Math.max(1, Math.round(sd.lineWidth));
  const minB = sd.black;
  const maxB = sd.white;
  // At least ten waves across the picture, and none tighter than the line is wide.
  const minPhaseIncr = (10 * 2 * Math.PI) / (W2 / xstep);
  const maxPhaseIncr = (2 * Math.PI * xstep) / strokeWidth;
  const HALF_PI = Math.PI / 2;
  const scaledYstep = Math.max(1, Math.floor(H2 / ystep));
  const row = scaledYstep * unit;

  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  type P = { x: number; y: number };
  const inBox = (p: P): P => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) });
  // Where a point of the box is read from: the sketch reads its scaled-up picture's pixel x at the
  // photo's x / scale, pixels counted from their corners - the reading here counts the last pixel as
  // the far edge, so the point is moved out to match. Off by a pixel in three hundred, the phase,
  // added up along a row, drifted.
  const [tw, th] = [tones.w, tones.h];
  const onPixels = (p: P): P => ({
    x: (((c0 + (p.x / w) * (c2 - c0)) * tw) / Math.max(1, tw - 1) - c0) * (w / (c2 - c0)),
    y: (((c1 + (p.y / h) * (c3 - c1)) * th) / Math.max(1, th - 1) - c1) * (h / (c3 - c1)),
  });

  // The stretch of a row inside the box, as distances along it from the middle; null if it misses.
  const span = (o: number): [number, number] | null => {
    let lo = -Infinity;
    let hi = Infinity;
    const clip = (start: number, along: number, max: number) => {
      if (Math.abs(along) < 1e-9) {
        if (start < 0 || start > max) lo = Infinity;
        return;
      }
      const a = (0 - start) / along;
      const b = (max - start) / along;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    };
    clip(cx - dy * o, dx, w);
    clip(cy + dx * o, dy, h);
    return hi - lo > unit * xstep ? [lo, hi] : null;
  };

  // Each run of line: its points, and whether it reaches its row's start and end.
  type Run = { points: P[]; fromStart: boolean; toEnd: boolean };
  const rows: Run[][] = [];
  // Rows from the top edge, a row apart, as the sketch's y = 0, scaledYstep… - turned, as far as they reach.
  const first = -Math.ceil((reach - h / 2) / row);
  for (let k = first; -h / 2 + k * row <= reach; k++) {
    const o = -h / 2 + k * row;
    if (k * scaledYstep >= H2 && Math.abs(dx) > 0.999) break; // the sketch's last row is above the bottom edge
    const s0 = span(o);
    if (!s0) continue;
    const [lo, hi] = s0;
    const length = (hi - lo) / unit; // the row, in the sketch's pixels
    const at = (x: number, swing: number): P => {
      const t = lo + x * unit;
      return { x: cx - dy * o + dx * t - dy * swing * unit, y: cy + dx * o + dy * t + dx * swing * unit };
    };
    // How dark the sketch finds a point: 0 to 255 trimmed to the black and white points; -1 where this layer draws nothing.
    const zAt = (x: number) => {
      const base = onPixels(at(x, 0));
      const tone = toneAt(Math.min(w, Math.max(0, base.x)), Math.min(h, Math.max(0, base.y)));
      if (tone < 0) return -1;
      if (photo.squiggleLift && fromWhite && tone < 0.03) return -1;
      const dark = sd.invert ? 1 - tone : tone;
      // Processing's whole-number blur and scale-up round down: its white reads 254, its 177 176.
      const b = Math.max(minB, Math.floor(255 * (1 - dark) - 0.5));
      return Math.max(maxB - b, 0);
    };

    // The sketch's vertices, each with whether this layer draws there.
    const verts: { x: number; y: number; on: boolean }[] = [];
    let phase = 0;
    let lastPhase = 0;
    let lastAmpl = 0;
    let lastX = 1;
    let x = 1;
    let finalStep = false;
    while (!finalStep) {
      x += xstep;
      finalStep = x + xstep >= length;
      const zRaw = zAt(x);
      const on = zRaw >= 0;
      const z = on ? zRaw : 0;
      const r = (z / ystep) * ymult;
      let df = z / xsmooth;
      if (df < minPhaseIncr) df = minPhaseIncr;
      if (df > maxPhaseIncr) df = maxPhaseIncr;
      phase += df;
      const deltaX = x - lastX;
      const deltaAmpl = r - lastAmpl;
      const deltaPhase = phase - lastPhase;
      if (!finalStep && deltaPhase > HALF_PI) {
        const vertexCount = Math.floor(deltaPhase / HALF_PI);
        const integerPart = (vertexCount * HALF_PI) / deltaPhase;
        const xPerVertex = (deltaX * integerPart) / vertexCount;
        const amplPerVertex = (integerPart * deltaAmpl) / vertexCount;
        for (let i = 0; i < vertexCount; i++) {
          lastX += xPerVertex;
          lastPhase += HALF_PI;
          lastAmpl += amplPerVertex;
          verts.push({ x: lastX, y: Math.round(Math.sin(lastPhase)) * lastAmpl, on });
        }
      }
    }

    // Runs of the vertices this layer draws, each starting and ending on the row's middle - at the
    // row's own ends where they reach them, as the sketch's do, and elsewhere where the tone itself
    // starts and stops, found a step at a time. Vertices are a quarter wave apart, which in pale
    // tones is far: ended at the next one, a run spilled that far into white as a flat tail.
    const runs: Run[] = [];
    let run: Run | null = null;
    // Where the tone starts after `from`, or stops before `to`, a step at a time - the row's own end where it's drawn to.
    const startOn = (from: number, to: number) => { for (let x = from; x < to; x += xstep) if (zAt(x) >= 0) return x; return to; };
    const stopOn = (from: number, to: number) => { for (let x = to; x > from; x -= xstep) if (zAt(x) >= 0) return x; return from; };
    for (let i = 0; i <= verts.length; i++) {
      const v = verts[i];
      if (v?.on) {
        if (!run) {
          const from = startOn(i === 0 ? 0 : verts[i - 1].x, v.x);
          run = { points: [inBox(at(from, 0))], fromStart: from === 0, toEnd: false };
        }
        run.points.push(inBox(at(v.x, v.y)));
        continue;
      }
      if (run) {
        const last = verts[i - 1].x;
        const to = stopOn(last, i === verts.length ? length : v.x);
        run.toEnd = to === length;
        run.points.push(inBox(at(to, 0)));
        runs.push(run);
        run = null;
      }
    }
    if (!verts.length && zAt(length / 2) >= 0) runs.push({ points: [inBox(at(0, 0)), inBox(at(length, 0))], fromStart: true, toEnd: true });
    // Every other row runs back the way the last came: the same curve, drawn from its other end.
    if (rows.length % 2 === 1) {
      runs.reverse();
      for (const r of runs) {
        r.points.reverse();
        [r.fromStart, r.toEnd] = [r.toEnd, r.fromStart];
      }
    }
    rows.push(runs);
  }

  // Each line: its points with an aiming point before and after - a tenth of a step past a row's
  // end, along it; at a break, the end itself. Connected, a row that reaches its end turns round
  // into the next where that starts at its edge, through a point out past the edge by a third of a row.
  const lines: P[][] = [];
  const past = (a: P, b: P, by: number): P => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: b.x + ((b.x - a.x) / len) * by, y: b.y + ((b.y - a.y) / len) * by };
  };
  const tenth = 0.1 * xstep * unit;
  const lead = (r: Run) => (r.fromStart ? [past(r.points[1], r.points[0], tenth)] : [r.points[0]]);
  const tail = (r: Run) => (r.toEnd ? [past(r.points[r.points.length - 2], r.points[r.points.length - 1], tenth)] : [r.points[r.points.length - 1]]);
  let open: P[] | null = null;
  let openRun: Run | null = null;
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].length; i++) {
      const runNow = rows[r][i];
      if (open && openRun && photo.squiggleJoin && i === 0 && runNow.fromStart && openRun.toEnd && rows[r - 1]?.[rows[r - 1].length - 1] === openRun) {
        const end = open[open.length - 1];
        const start = runNow.points[0];
        const [a, b] = [openRun.points[openRun.points.length - 2], end];
        const out = past(a, b, tenth + row / 3);
        open.push({ x: out.x + (start.x - end.x) / 2, y: out.y + (start.y - end.y) / 2 }, ...runNow.points);
        openRun = runNow;
        continue;
      }
      if (open && openRun) lines.push([...open, ...tail(openRun)]);
      open = [...lead(runNow), ...runNow.points];
      openRun = runNow;
    }
  }
  if (open && openRun) lines.push([...open, ...tail(openRun)]);

  // Each line as Processing's curveVertex draws it: a Catmull-Rom spline through all but its first
  // and last points, which only aim it - written as cubics, the handles scaled by the smoothness.
  const k = Math.min(2, Math.max(0, photo.squiggleSmooth ?? 1)) / 6;
  const parts: string[] = [];
  for (const pts of lines) {
    if (pts.length < 4) continue;
    let d = `M${n(pts[1].x)} ${n(pts[1].y)}`;
    for (let i = 1; i < pts.length - 2; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      d += `C${n(p1.x + (p2.x - p0.x) * k)} ${n(p1.y + (p2.y - p0.y) * k)} ${n(p2.x - (p3.x - p1.x) * k)} ${n(p2.y - (p3.y - p1.y) * k)} ${n(p2.x)} ${n(p2.y)}`;
    }
    parts.push(d);
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Outlines ----------
