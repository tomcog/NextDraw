// Streamlines: lines that flow along the picture's shapes, evenly apart and closer where it is
// darker, like an engraving.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { STREAM_DEFAULTS } from "../photoDefaults";
import { flowField, simplified, toneSampler } from "../photoSample";

export function streamlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const widest = Math.max(spacing, (photo.streamWidestMm ?? STREAM_DEFAULTS.widestMm) / 25.4);
  const passCount = Math.min(3, Math.max(1, Math.round(photo.streamPasses ?? STREAM_DEFAULTS.passes)));
  // One look at the photo every half a spacing along a line: close enough that a neighbour can't slip
  // between two of them unseen.
  const step = spacing / 2;
  const shortest = Math.max(1 / 25.4, spacing * 4);
  // A band draws where the photo's tone is its own, at the whole photo's darkness, so bands together
  // draw what one layer would.
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const field = flowField(tones, photo, w, h);
  const n = (v: number) => Number(v.toFixed(4));

  // Every point drawn so far, filed by where it is, so the nearest are quick to find. Each grid square
  // keeps its last point; each point the one filed there before it.
  const cell = Math.max(spacing * 2, 0.4 / 25.4);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const head = new Int32Array(cols * rows).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const lineOf: number[] = [];
  const indexOf: number[] = [];
  const next: number[] = [];
  const cellOf = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const file = (x: number, y: number, line: number, index: number) => {
    const c = cellOf(x, y);
    xs.push(x);
    ys.push(y);
    lineOf.push(line);
    indexOf.push(index);
    next.push(head[c]);
    head[c] = xs.length - 1;
  };
  // Whether anything already drawn is nearer than `r` - leaving out this line's own points close along it.
  const crowded = (x: number, y: number, r: number, line = -1, index = 0, ownGap = 0) => {
    const r2 = r * r;
    const cx0 = Math.max(0, Math.floor((x - r) / cell));
    const cx1 = Math.min(cols - 1, Math.floor((x + r) / cell));
    const cy0 = Math.max(0, Math.floor((y - r) / cell));
    const cy1 = Math.min(rows - 1, Math.floor((y + r) / cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let i = head[cy * cols + cx]; i >= 0; i = next[i]) {
          if (lineOf[i] === line && Math.abs(indexOf[i] - index) <= ownGap) continue;
          const ddx = xs[i] - x;
          const ddy = ys[i] - y;
          if (ddx * ddx + ddy * ddy < r2) return true;
        }
      }
    }
    return false;
  };

  const passes: string[] = [];
  let strokes = 0;
  let lineCount = 0;
  for (let k = 0; k < passCount; k++) {
    // Each pass keeps its spacing from its own lines only: the second runs across the first.
    head.fill(-1);
    xs.length = ys.length = lineOf.length = indexOf.length = next.length = 0;
    // Each pass draws its share of the darkness: with two, the first fills in to the middle tones and
    // the second, across it, from there to black; with three, a third each, the last on the diagonal. The spacing is the closest spacing over that share,
    // so the ink laid down follows the tone; past the widest, it's paper.
    const sepAt = (x: number, y: number) => {
      const t = toneAt(x, y);
      if (t < 0) return Infinity;
      const share = Math.min(1, Math.max(0, t * passCount - k));
      const sep = share > 0 ? spacing / share : Infinity;
      return sep <= widest ? sep : Infinity;
    };
    // How far each pass is turned from the flow: along it, across it, then between the two.
    const turnDeg = [0, 90, 45][k];
    const tc = Math.cos((turnDeg * Math.PI) / 180);
    const ts = Math.sin((turnDeg * Math.PI) / 180);
    const turned = ([ux, uy]: [number, number] | number[]): [number, number] => (turnDeg ? [ux * tc - uy * ts, ux * ts + uy * tc] : [ux, uy]);
    const dirAt = (x: number, y: number, fx: number, fy: number): [number, number] => {
      const [ux, uy] = turned(field(x, y));
      return ux * fx + uy * fy < 0 ? [-ux, -uy] : [ux, uy];
    };
    // A line from a seed, both ways, stopping at the edge, in paper, or near another line. Its points
    // are filed as it goes, so it can't run back into itself; if it comes out too short to keep, they
    // are taken out again - the last filed in each square, so the list stays whole.
    const grow = (sx: number, sy: number): number[][] | null => {
      const line = lineCount;
      const start = turned(field(sx, sy));
      const halves: number[][][] = [];
      let length = 0;
      file(sx, sy, line, 0);
      const filed: number[] = [xs.length - 1];
      for (const sign of [1, -1]) {
        const half: number[][] = [];
        let x = sx;
        let y = sy;
        let fx = start[0] * sign;
        let fy = start[1] * sign;
        for (let i = 1; i < 20000; i++) {
          const [ax, ay] = dirAt(x, y, fx, fy);
          const [bx, by] = dirAt(x + (ax * step) / 2, y + (ay * step) / 2, ax, ay);
          const nx = x + bx * step;
          const ny = y + by * step;
          if (nx < 0 || nx > w || ny < 0 || ny > h) break;
          const sep = sepAt(nx, ny);
          if (!Number.isFinite(sep)) break;
          const index = i * sign;
          if (crowded(nx, ny, sep / 2, line, index, Math.ceil((sep * 1.5) / step))) break;
          file(nx, ny, line, index);
          filed.push(xs.length - 1);
          half.push([nx, ny]);
          length += step;
          x = nx;
          y = ny;
          fx = bx;
          fy = by;
        }
        halves.push(half);
      }
      if (length < shortest) {
        for (let j = filed.length - 1; j >= 0; j--) {
          const i = filed[j];
          head[cellOf(xs[i], ys[i])] = next[i];
        }
        xs.length = ys.length = lineOf.length = indexOf.length = next.length = filed[0];
        return null;
      }
      lineCount++;
      return [...halves[1].reverse(), [sx, sy], ...halves[0]];
    };
    // A seed is good where there's something to draw and nothing already within its spacing.
    const seedable = (x: number, y: number) => {
      if (x < 0 || x > w || y < 0 || y > h) return false;
      const sep = sepAt(x, y);
      return Number.isFinite(sep) && !crowded(x, y, sep);
    };

    const drawn: number[][][] = [];
    // Each line kept seeds its neighbours, a spacing away either side, and they theirs, until the
    // area fills; then the search across the photo finds the next area that hasn't been reached.
    const spread = (first: number[][]) => {
      const queue = [first];
      drawn.push(first);
      for (let q = 0; q < queue.length; q++) {
        const pts = queue[q];
        for (let i = 0; i < pts.length; i += 2) {
          const [x, y] = pts[i];
          const [a, b] = pts[Math.min(pts.length - 1, i + 1)];
          const [c, d] = pts[Math.max(0, i - 1)];
          const len = Math.hypot(a - c, b - d) || 1;
          const nx = -(b - d) / len;
          const ny = (a - c) / len;
          const sep = sepAt(x, y);
          if (!Number.isFinite(sep)) continue;
          for (const side of [1, -1]) {
            const qx = x + nx * sep * side;
            const qy = y + ny * sep * side;
            if (!seedable(qx, qy)) continue;
            const grown = grow(qx, qy);
            if (grown) {
              drawn.push(grown);
              queue.push(grown);
            }
          }
        }
      }
    };
    const scan = spacing * 2;
    for (let y = scan / 2; y < h; y += scan) {
      for (let x = scan / 2; x < w; x += scan) {
        if (!seedable(x, y)) continue;
        const grown = grow(x, y);
        if (grown) spread(grown);
      }
    }

    // Drawn in the order they were made - each beside the last - and each turned to start at whichever
    // end is nearer where the pen is, so it doesn't cross the page between them.
    const parts: string[] = [];
    let px = 0;
    let py = 0;
    for (const pts of drawn) {
      const [ax, ay] = pts[0];
      const [bx, by] = pts[pts.length - 1];
      const run = (bx - px) ** 2 + (by - py) ** 2 < (ax - px) ** 2 + (ay - py) ** 2 ? [...pts].reverse() : pts;
      const kept = simplified(run, 0.01 / 25.4);
      parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
      [px, py] = run[run.length - 1];
      strokes++;
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}
