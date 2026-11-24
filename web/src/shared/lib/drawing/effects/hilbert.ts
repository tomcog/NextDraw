// The Hilbert curve: one line that fills the page by halving squares, finer where the picture is
// darker.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { HILBERT_DEFAULTS, HILBERT_EDGE } from "../photoDefaults";
import { toneSampler } from "../photoSample";

/**
 * Tone as a Hilbert curve: one line that fills the picture by folding into itself, square within
 * square, folded finer where it's darker. A square of the curve is as wide as the spacing over the
 * darkness there - the line through it covers the paper in proportion - but never wider than
 * Coarsest, so light areas still meander gently. The tone shows in steps, each fold halving the
 * square: that stepped, mechanical halftone is the look. A picture that isn't square is a row of
 * near-square tiles, each curve ending where the next begins, so it is one line - broken only, if
 * asked, where there's nothing to draw, or where a turned curve runs off the picture and back.
 *
 * Or a Peano curve, which folds each square into nine and runs corner to opposite corner: a woven,
 * back-and-forth texture, with fewer and bigger steps of tone - each three times as dense as the
 * last - so it's at its best blended. Its corners can be rounded; its steps of tone blended, each square
 * folding or not by chance in proportion to how far its tone lies between two steps; and the whole
 * curve turned.
 */
export function hilbert(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const coarsest = Math.max(spacing, (photo.hilbertCoarsestMm ?? HILBERT_DEFAULTS.coarsestMm) / 25.4);
  const lift = Boolean(photo.hilbertLift);
  const peano = photo.hilbertCurve === "peano";
  // Each fold divides a square's side by this.
  const split = peano ? 3 : 2;
  const round = Math.min(1, Math.max(0, photo.hilbertRound ?? 0));
  const blend = Math.min(1, Math.max(0, photo.hilbertBlend ?? 0));
  const { toneAt } = toneSampler(tones, photo, w, h, true);

  // The darkness, summed across and down, so any box's average is four look-ups.
  const gw = Math.max(4, Math.round((HILBERT_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(4, Math.round((HILBERT_EDGE * h) / Math.max(w, h)));
  const sum = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let row = 0;
    for (let x = 0; x < gw; x++) {
      const t = toneAt(((x + 0.5) * w) / gw, ((y + 0.5) * h) / gh);
      row += t > 0 ? t : 0;
      sum[(y + 1) * (gw + 1) + x + 1] = sum[y * (gw + 1) + x + 1] + row;
    }
  }
  const at = (x: number, y: number) => sum[y * (gw + 1) + x];
  // The average darkness over the part of a box, in inches, that's on the picture: none if it's all
  // off it. For a box smaller than a grid square, the square it's in.
  const toneOver = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return 0;
    const a = Math.max(0, Math.min(gw - 1, Math.floor((x0 / w) * gw)));
    const b = Math.max(0, Math.min(gh - 1, Math.floor((y0 / h) * gh)));
    const c = Math.max(a + 1, Math.min(gw, Math.ceil((x1 / w) * gw)));
    const d = Math.max(b + 1, Math.min(gh, Math.ceil((y1 / h) * gh)));
    return (at(c, d) - at(a, d) - at(c, b) + at(a, b)) / ((c - a) * (d - b));
  };
  // A number from 0 to 1 that's always the same for the same square, for blending its fold.
  const chance = (x: number, y: number, side: number) => {
    let k = Math.imul(Math.round(x * 4096), 0x27d4eb2d) ^ Math.imul(Math.round(y * 4096), 0x165667b1) ^ Math.imul(Math.round(side * 65536), 0x9e3779b1);
    k = Math.imul(k ^ (k >>> 15), 0x85ebca6b);
    k = Math.imul(k ^ (k >>> 13), 0xc2b2ae35);
    return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
  };

  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let length = 0;
  let piece: number[][] = [];
  const close = () => {
    if (piece.length > 1) {
      // Points in a straight run are one segment: the curve is mostly straight runs.
      const kept = [piece[0]];
      for (let i = 1; i < piece.length - 1; i++) {
        const [ax, ay] = kept[kept.length - 1];
        const [bx, by] = piece[i];
        const [cx, cy] = piece[i + 1];
        if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-10) kept.push(piece[i]);
      }
      kept.push(piece[piece.length - 1]);
      for (let i = 1; i < kept.length; i++) length += Math.hypot(kept[i][0] - kept[i - 1][0], kept[i][1] - kept[i - 1][1]);
      let d = `M${n(kept[0][0])} ${n(kept[0][1])}`;
      if (round > 0) {
        // Rounded: each corner cut back along both its legs, by up to half the shorter, and the gap
        // bridged by a curve with the corner as its handle.
        for (let i = 1; i < kept.length - 1; i++) {
          const [ax, ay] = kept[i - 1];
          const [px, py] = kept[i];
          const [bx, by] = kept[i + 1];
          const la = Math.hypot(px - ax, py - ay);
          const lb = Math.hypot(bx - px, by - py);
          const r = (round * Math.min(la, lb)) / 2;
          d += `L${n(px + ((ax - px) * r) / la)} ${n(py + ((ay - py) * r) / la)}Q${n(px)} ${n(py)} ${n(px + ((bx - px) * r) / lb)} ${n(py + ((by - py) * r) / lb)}`;
        }
        const last = kept[kept.length - 1];
        d += `L${n(last[0])} ${n(last[1])}`;
      } else {
        for (let i = 1; i < kept.length; i++) d += `L${n(kept[i][0])} ${n(kept[i][1])}`;
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  // One square of the curve, at (x0, y0), `i` the way it travels and `j` across: folded into smaller
  // squares, in the curve's order, until it's fine enough for its tone, then a point at its middle.
  const fold = (x0: number, y0: number, ix: number, iy: number, jx: number, jy: number) => {
    const side = Math.max(Math.hypot(ix, iy), Math.hypot(jx, jy));
    const xs = [x0, x0 + ix, x0 + jx, x0 + ix + jx];
    const ys = [y0, y0 + iy, y0 + jy, y0 + iy + jy];
    const tone = toneOver(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    const wanted = tone > 0 ? spacing / tone : Infinity;
    // How many folds short of the size its tone wants this square is, on the curve's own scale: past
    // one half it folds, so each takes the nearest step. Blended, the half-way mark moves square by
    // square, by chance, so between two steps the squares take each in proportion and the bands
    // between steps soften into a mix. The finest step is within a half-step of the spacing.
    const short = Math.log(side / wanted) / Math.log(split);
    const mark = 0.5 + blend * (chance(x0 + (ix + jx) / 2, y0 + (iy + jy) / 2, side) - 0.5);
    if (side / split >= spacing / Math.sqrt(split) && (side > coarsest || short > mark)) {
      if (peano) {
        // Nine squares, column by column along `i`, up the first, down the second, up the third;
        // each turned so it starts where the last ended - mirrored along `i` in the middle row,
        // across `j` in the middle column.
        const [tix, tiy, tjx, tjy] = [ix / 3, iy / 3, jx / 3, jy / 3];
        for (let c = 0; c < 3; c++) {
          for (let k = 0; k < 3; k++) {
            const r = c === 1 ? 2 - k : k;
            const flipI = r === 1;
            const flipJ = c === 1;
            const ox = x0 + c * tix + r * tjx + (flipI ? tix : 0) + (flipJ ? tjx : 0);
            const oy = y0 + c * tiy + r * tjy + (flipI ? tiy : 0) + (flipJ ? tjy : 0);
            fold(ox, oy, flipI ? -tix : tix, flipI ? -tiy : tiy, flipJ ? -tjx : tjx, flipJ ? -tjy : tjy);
          }
        }
      } else {
        const [hix, hiy, hjx, hjy] = [ix / 2, iy / 2, jx / 2, jy / 2];
        fold(x0, y0, hjx, hjy, hix, hiy);
        fold(x0 + hjx, y0 + hjy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + hix, y0 + hjy + hiy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + ix, y0 + hjy + iy, -hjx, -hjy, -hix, -hiy);
      }
      return;
    }
    const cx = x0 + (ix + jx) / 2;
    const cy = y0 + (iy + jy) / 2;
    // Off the picture - a turned curve's corners - or, lifting, nothing to draw: the pen comes up.
    if (cx < 0 || cx > w || cy < 0 || cy > h || (lift && tone <= 0.01)) {
      close();
      return;
    }
    piece.push([cx, cy]);
  };
  // The curve turned: worked out on axes `u` and `v` at its angle, over the box that holds the
  // picture at that angle. A row of tiles along that box's long side, as many as divide it into
  // near-squares, so it's covered exactly. A Hilbert tile runs from its first corner along `i` to
  // the next tile's first corner; a Peano tile runs to its opposite corner, so every other one is
  // flipped across to start there.
  const rad = ((photo.hilbertAngle ?? 0) * Math.PI) / 180;
  const [ux, uy] = [Math.cos(rad), Math.sin(rad)];
  const [vx, vy] = [-uy, ux];
  const us = [0, w * ux, h * uy, w * ux + h * uy];
  const vs = [0, w * vx, h * vy, w * vx + h * vy];
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const lu = u1 - u0;
  const lv = v1 - v0;
  const across = lu >= lv;
  const count = Math.max(1, Math.ceil(Math.max(lu, lv) / Math.min(lu, lv) - 1e-9));
  const along = Math.max(lu, lv) / count;
  // A point on the page from its place on the turned axes.
  const page = (u: number, v: number) => [u * ux + v * vx, u * uy + v * vy];
  for (let k = 0; k < count; k++) {
    const flip = peano && k % 2 === 1;
    if (across) {
      const [ox, oy] = page(u0 + k * along, flip ? v1 : v0);
      fold(ox, oy, along * ux, along * uy, (flip ? -lv : lv) * vx, (flip ? -lv : lv) * vy);
    } else {
      const [ox, oy] = page(flip ? u1 : u0, v0 + k * along);
      fold(ox, oy, along * vx, along * vy, (flip ? -lu : lu) * ux, (flip ? -lu : lu) * uy);
    }
  }
  close();
  return { passes: [parts.join("")], strokes, lengthMm: length * 25.4 };
}

// ---------- One line ----------

/**
 * Tone as one line: the photo stippled - dots scattered thicker where it's darker, then spread evenly
 * (Secord's weighted Voronoi stippling) - and the dots joined by the shortest route that visits each
 * once (a travelling salesman's tour), so the pen goes down once and draws the whole picture. Where
 * the dots are thick the line winds tightly and reads dark; where they're sparse it runs in long
 * strokes and reads light. Lifting over long jumps, if asked, leaves white as paper.
 */
