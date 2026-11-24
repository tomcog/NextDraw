// Silhouette: the line round a shape on white paper - its outline, and each hole in it.

import type { Node } from "../path";
import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import { FIT_CELLS, SILHOUETTE_DEFAULTS } from "../photoDefaults";
import { contour, paintField, shortTravel } from "../photoSample";
import { fitNodes, pathData } from "../path";

export function silhouette(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const { gw, gh, cell, cellY, field } = paintField(tones, photo, w, h);
  const from = Math.min(0.99, Math.max(0.01, photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from));
  const smallest = Math.max(0, photo.silhouetteSmallestMm ?? SILHOUETTE_DEFAULTS.smallestMm) / 25.4;
  const strokes: Node[][] = [];
  for (const run of contour(field, gw, gh, 1 - from)) {
    const pts = run.map(([gx, gy]) => ({ x: gx * cell, y: gy * cellY }));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(smallest, 2 * cell)) continue;
    strokes.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length };
}
