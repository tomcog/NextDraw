// Hatching: lines that cross and fill in as the picture darkens - the effect every other one is
// measured against. One of the picture effects, each in a file of its own (Tom, 2026-11-24).

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { MOST_PASSES } from "../photoDefaults";
import { onePlate, toneSampler } from "../photoSample";

export function hatch(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
  // Along each line, a look at the photo every half a line-spacing: fine enough that a line stops
  // where the tone does, coarse enough that a big sheet is still quick.
  const step = spacing / 2;
  // Anything shorter than this is a dot, not a line: the pen would only tap the paper. One and a half
  // line spacings, unless the card says otherwise.
  const shortest = photo.hatchShortestMm !== undefined ? photo.hatchShortestMm / 25.4 : spacing * 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  const passes: string[] = [];
  let strokes = 0;
  // A tone band takes the passes whose thresholds fall in its band, measured against the whole photo,
  // rather than running every pass across its own band: the bands together then draw what one layer
  // would, and the darks get the lighter bands' lines as well as their own. Run across its own band,
  // a light band was crosshatched black just under its top edge while the band above it started
  // sparse - the tones turned over at every edge between bands.
  // Split around the paper, each band is a pen of its own - black, a gray - and draws its own region
  // whole, graded across it, rather than taking a share of one ink's passes.
  const band = photo.band && !onePlate(photo) && !photo.ink && !photo.side ? photo.band : null;
  const { toneAt, fromWhite } = toneSampler(tones, band ? { ...photo, band: undefined } : photo, w, h);

  for (let k = 0; k < levels; k++) {
    const threshold = fromWhite ? (k + 1) / (levels + 1) : k / levels;
    if (band && !(threshold >= band[0] && (threshold < band[1] || band[1] >= 1))) {
      passes.push("");
      continue;
    }
    const rad = ((photo.angle + (k % 2 ? 90 : 0) + (k >= 4 ? 45 : 0)) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Lines two spacings apart in each pass; the third and fourth passes fall between the first two's,
    // and the fifth and sixth run on the diagonals.
    const gap = spacing * 2;
    const shift = k === 2 || k === 3 ? spacing : 0;
    const parts: string[] = [];
    let line = 0;
    for (let o = -reach + shift; o <= reach; o += gap, line++) {
      // Every other line runs back the way the last one came, so the pen doesn't travel home between them.
      const back = line % 2 === 1;
      let start: number | null = null;
      let end = 0;
      const close = () => {
        if (start !== null && end - start >= shortest) {
          const a = back ? end : start;
          const b = back ? start : end;
          parts.push(`M${n(cx - dy * o + dx * a)} ${n(cy + dx * o + dy * a)}L${n(cx - dy * o + dx * b)} ${n(cy + dx * o + dy * b)}`);
          strokes++;
        }
        start = null;
      };
      for (let t = -reach; t <= reach; t += step) {
        const x = cx - dy * o + dx * t;
        const y = cy + dx * o + dy * t;
        const tone = toneAt(x, y);
        if (tone >= 0 && (tone > threshold || (!fromWhite && k === 0))) {
          if (start === null) start = t;
          end = t;
        } else {
          close();
        }
      }
      close();
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}


// ---------- Paint ----------
