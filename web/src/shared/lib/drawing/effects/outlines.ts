// Outlines: the picture traced as contour lines, following its edges and shapes.

import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { OUTLINE_DEFAULTS, OUTLINE_EDGE } from "../photoDefaults";
import { blurGrid, contour, fieldOf } from "../photoSample";

export function outlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const gw = Math.max(2, Math.round((OUTLINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(2, Math.round((OUTLINE_EDGE * h) / Math.max(w, h)));
  const cell = w / (gw - 1);
  const cellY = h / (gh - 1);
  const count = Math.max(1, Math.min(40, Math.round(photo.contours ?? OUTLINE_DEFAULTS.contours)));
  const { field, levels } = fieldOf(tones, photo, gw, gh, count);
  blurGrid(field, gw, gh, Math.max(0, photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm) / 25.4 / cell);
  // A contour shorter than this is a speck, not a shape.
  const shortest = 2 / 25.4;
  const n = (val: number) => Number(val.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  for (const level of levels) {
    for (const run of contour(field, gw, gh, level)) {
      let length = 0;
      for (let i = 1; i < run.length; i++) length += Math.hypot((run[i][0] - run[i - 1][0]) * cell, (run[i][1] - run[i - 1][1]) * cellY);
      if (length < shortest) continue;
      parts.push(`M${run.map(([gx, gy]) => `${n(gx * cell)} ${n(gy * cellY)}`).join("L")}`);
      strokes++;
    }
  }
  return { passes: [parts.join("")], strokes };
}

// ---------- Centerlines ----------
