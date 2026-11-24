// One line: the whole picture as a single stroke, winding tightly where it is dark. The pen goes
// down once.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { ONE_LINE_DEFAULTS, ONE_LINE_EDGE, ONE_LINE_MOST, ONE_LINE_SPREAD } from "../photoDefaults";
import { toneSampler, tour } from "../photoSample";

export function oneLine(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const count = Math.round(Math.min(ONE_LINE_MOST, Math.max(50, photo.lineDots ?? ONE_LINE_DEFAULTS.dots)));
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  // The grid the dots are spread on: fine enough that each dot's cell is a few squares across.
  const gw = Math.max(8, Math.round((ONE_LINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(8, Math.round((ONE_LINE_EDGE * h) / Math.max(w, h)));
  const sx = w / gw;
  const sy = h / gh;
  // How many dots each square wants. The line's ink goes as the square root of how thick the dots
  // are - twice the dots, about 1.4 times the line - so squared, the ink follows the tone: that's
  // Contrast at its middle. Less spreads the dots into the lights, for detail there; more crowds
  // them into the darks, for a punchier picture.
  const power = 0.5 + 3 * Math.min(1, Math.max(0, photo.lineContrast ?? 0.5));
  const want = new Float32Array(gw * gh);
  let total = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = toneAt((x + 0.5) * sx, (y + 0.5) * sy);
      const d = t > 0 ? t ** power : 0;
      want[y * gw + x] = d;
      total += d;
    }
  }
  if (total <= 0) return { passes: [""], strokes: 0 };

  // The same scatter every time, so a changed number doesn't reshuffle the whole picture.
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // First scatter: each dot in a square picked as often as it wants dots, somewhere inside it.
  const cumulative = new Float64Array(want.length);
  let run = 0;
  for (let i = 0; i < want.length; i++) cumulative[i] = run += want[i];
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const r = random() * run;
    let lo = 0;
    let hi = want.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    px[k] = (lo % gw) + random();
    py[k] = Math.floor(lo / gw) + random();
  }

  // Then spread them evenly: each dot moved to the weighted middle of the squares nearest it (Lloyd's
  // relaxation), so they sit apart like stipple rather than clumping like grain.
  const cell = Math.max(1, Math.sqrt((gw * gh) / count));
  const bw = Math.ceil(gw / cell) + 1;
  const bh = Math.ceil(gh / cell) + 1;
  const head = new Int32Array(bw * bh);
  const next = new Int32Array(count);
  const file = () => {
    head.fill(-1);
    for (let k = 0; k < count; k++) {
      const b = Math.min(bh - 1, Math.floor(py[k] / cell)) * bw + Math.min(bw - 1, Math.floor(px[k] / cell));
      next[k] = head[b];
      head[b] = k;
    }
  };
  // The dot nearest a point: the squares round it in widening rings until no nearer can be found.
  const nearest = (x: number, y: number) => {
    const bx = Math.min(bw - 1, Math.floor(x / cell));
    const by = Math.min(bh - 1, Math.floor(y / cell));
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring < Math.max(bw, bh); ring++) {
      if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestD)) break;
      for (let cy = by - ring; cy <= by + ring; cy++) {
        if (cy < 0 || cy >= bh) continue;
        for (let cx = bx - ring; cx <= bx + ring; cx++) {
          if (cx < 0 || cx >= bw || (Math.abs(cx - bx) !== ring && Math.abs(cy - by) !== ring)) continue;
          for (let k = head[cy * bw + cx]; k >= 0; k = next[k]) {
            const d = (px[k] - x) ** 2 + (py[k] - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
    }
    return best;
  };
  const mx = new Float64Array(count);
  const my = new Float64Array(count);
  const mw = new Float64Array(count);
  // Grain: fewer spreads, and the dots keep more of their first scatter's clumps and gaps.
  const spreads = Math.round(ONE_LINE_SPREAD * (1 - Math.min(1, Math.max(0, photo.lineGrain ?? 0))));
  for (let pass = 0; pass < spreads; pass++) {
    file();
    mx.fill(0);
    my.fill(0);
    mw.fill(0);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const d = want[y * gw + x];
        if (d <= 0) continue;
        const k = nearest(x + 0.5, y + 0.5);
        mx[k] += d * (x + 0.5);
        my[k] += d * (y + 0.5);
        mw[k] += d;
      }
    }
    for (let k = 0; k < count; k++) {
      if (mw[k] > 0) {
        px[k] = mx[k] / mw[k];
        py[k] = my[k] / mw[k];
      }
    }
  }
  // Into inches on the page.
  for (let k = 0; k < count; k++) {
    px[k] *= sx;
    py[k] *= sy;
  }

  // Direction: the route is planned with the page stretched across the way the line should run, so
  // a step across costs more than a step along and the line runs in streaks that way. At full
  // strength a step across costs four times as much.
  const bias = Math.min(1, Math.max(0, photo.lineBias ?? 0));
  let order: Int32Array;
  if (bias > 0) {
    const rad = ((photo.lineAngle ?? 0) * Math.PI) / 180;
    const [c, sn] = [Math.cos(rad), Math.sin(rad)];
    const stretch = 1 + 3 * bias;
    const tx = new Float64Array(count);
    const ty = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      tx[k] = px[k] * c + py[k] * sn;
      ty[k] = (-px[k] * sn + py[k] * c) * stretch;
    }
    order = tour(tx, ty);
  } else {
    order = tour(px, py);
  }
  // The tour is a loop; the line is the loop opened at its longest jump, so that one is never drawn.
  const dist = (a: number, b: number) => Math.hypot(px[a] - px[b], py[a] - py[b]);
  let cut = 0;
  for (let i = 0; i < count; i++) if (dist(order[i], order[(i + 1) % count]) > dist(order[cut], order[(cut + 1) % count])) cut = i;
  const line = Array.from({ length: count }, (_, i) => order[(cut + 1 + i) % count]);
  // Lifting over jumps longer than asked, so white is left as paper. Absent or 0, one unbroken line.
  const lift = (photo.lineLiftMm ?? 0) / 25.4;
  // Curviness: each step a curve through the dots, its handles along the line from the dot before to
  // the dot after (Catmull-Rom), as long as asked - at 1, the usual sixth of that; past it they
  // overshoot into loops, up to 2. 0, straight.
  const curve = Math.min(2, Math.max(0, photo.lineCurve ?? 0));
  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let piece: number[] = [];
  let length = 0;
  const close = () => {
    if (piece.length > 1) {
      const at = (i: number) => piece[Math.max(0, Math.min(piece.length - 1, i))];
      let d = `M${n(px[piece[0]])} ${n(py[piece[0]])}`;
      for (let i = 1; i < piece.length; i++) {
        const [a, b, c, e] = [at(i - 2), at(i - 1), at(i), at(i + 1)];
        if (curve > 0) {
          const k = curve / 6;
          d += `C${n(px[b] + (px[c] - px[a]) * k)} ${n(py[b] + (py[c] - py[a]) * k)} ${n(px[c] - (px[e] - px[b]) * k)} ${n(py[c] - (py[e] - py[b]) * k)} ${n(px[c])} ${n(py[c])}`;
        } else {
          d += `L${n(px[c])} ${n(py[c])}`;
        }
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const jump = dist(line[i - 1], line[i]);
      if (lift > 0 && jump > lift) close();
      else length += jump;
    }
    piece.push(line[i]);
  }
  close();
  return { passes: [parts.join("")], strokes, dots: count, lengthMm: length * 25.4 };
}
