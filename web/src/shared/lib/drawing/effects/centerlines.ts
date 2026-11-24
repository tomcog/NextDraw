// Centerlines: each dark stroke of a line drawing drawn once, down its middle, so a ring is one
// circle. Edges - lines where the tone changes sharply - are the same machinery on a traced edge.

import type { Node } from "../path";
import type { Photo, PhotoMarks, Tones } from "../photoTypes";
import type { Point } from "../parametric";
import { CENTER_DEFAULTS, EDGE_DEFAULTS, FIT_CELLS } from "../photoDefaults";
import { centerModeOf, centerOn, circleNodes, circleOf, distances, edgesOn, joinRuns, joinTips, mixedLine, prune, shortTravel, straightened, thin, traceRuns, turnsOver } from "../photoSample";
import { fitNodes, pathData } from "../path";

export function edges(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const traced = edgesOn(tones, photo, w, h);
  const marks = centerlines(tones, { ...photo, centerShortestMm: photo.edgeShortestMm ?? EDGE_DEFAULTS.shortestMm, centerMode: photo.centerMode ?? "mixed" }, w, h, traced);
  return { ...marks, widthMm: undefined };
}

/**
 * Line art as centerlines: each dark stroke of the picture drawn once, down its middle, however wide
 * it is - a ring is one circle rather than the two edges of a filled band. The picture is made black
 * and white at `centerFrom`, worn down to lines one point wide, and those are walked into strokes:
 * whiskers off, lines carried straight on through where others cross them, smoothed into curves, and
 * a loop that is a circle drawn as an exact one. Split into bands or colours, each layer traces its
 * own part the same way.
 */

/**
 * Line art as centerlines: each dark stroke of the picture drawn once, down its middle, however wide
 * it is - a ring is one circle rather than the two edges of a filled band. The picture is made black
 * and white at `centerFrom`, worn down to lines one point wide, and those are walked into strokes:
 * whiskers off, lines carried straight on through where others cross them, smoothed into curves, and
 * a loop that is a circle drawn as an exact one. Split into bands or colours, each layer traces its
 * own part the same way.
 */
export function centerlines(tones: Tones, photo: Photo, w: number, h: number, traced = centerOn(tones, photo, w, h)): PhotoMarks {
  const { gw, gh, cell, cellY, on } = traced;
  const dist = distances(on, gw, gh);
  thin(on, gw, gh);
  const shortest = Math.max(0, photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm) / 25.4 / cell;
  prune(on, gw, gh, dist, Math.max(2, shortest));

  // How wide the picture's lines are: twice the distance to the edge, along their middles.
  const widths: number[] = [];
  for (let i = 0; i < on.length; i++) if (on[i]) widths.push(dist[i] * 2);
  widths.sort((a, b) => a - b);
  const widthMm = widths.length ? widths[Math.floor(widths.length / 2)] * cell * 25.4 : undefined;

  const tips = new Set<number>();
  const runs = joinRuns(joinTips(traceRuns(on, gw, gh), gw, dist, tips), gw);
  const toPoint = (i: number): Point => ({ x: (i % gw) * cell, y: Math.floor(i / gw) * cellY });
  // Curves, straight lines within a tolerance (inches here), or mixed - and, curving, sharp where a
  // line turns more than cornerDeg.
  const mode = centerModeOf(photo);
  const within = Math.max(0.05, photo.centerStraightMm ?? CENTER_DEFAULTS.straightMm) / 25.4;
  const long = Math.max(0.1, photo.centerLongMm ?? CENTER_DEFAULTS.longMm) / 25.4;
  const cornerDeg = mode !== "straight" && photo.centerCornerDeg && photo.centerCornerDeg > 0 ? photo.centerCornerDeg : 0;
  // Turns are read about a millimetre either way, so a pixel's step isn't a corner.
  const reach = Math.max(2, Math.round(1 / 25.4 / cell));
  const strokes: Node[][] = [];
  let circles = 0;
  for (const run of runs) {
    let pts = run.pts.map(toPoint);
    // A tip stays where it is and stays sharp - and so, set to, does a turn sharper than cornerDeg.
    const corners: number[] = [];
    run.pts.forEach((g, i) => { if (tips.has(g)) corners.push(i); });
    if (cornerDeg) for (const i of turnsOver(pts, run.closed, reach, cornerDeg)) if (!corners.includes(i)) corners.push(i);
    corners.sort((a, b) => a - b);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(2, shortest) * cell) continue;
    // Pixel steps smoothed out: each point moved to the average of its neighbours, a few either
    // way. A loop wraps round; an open line keeps its ends where they are, so lines still meet.
    const k = 2;
    const n = pts.length;
    pts = pts.map((p, i) => {
      if (!run.closed && (i < 1 || i > n - 2)) return p;
      if (corners.includes(i)) return p;
      let sx = p.x, sy = p.y, c = 1;
      // Out either way as far as `k`, stopping short of a tip: the straight run into it is a long
      // step, and averaging across it would pull the line out of true.
      for (const way of [-1, 1]) {
        for (let d = 1; d <= k; d++) {
          const j = run.closed ? (i + way * d + n) % n : Math.min(n - 1, Math.max(0, i + way * d));
          if (corners.includes(j)) break;
          sx += pts[j].x;
          sy += pts[j].y;
          c++;
        }
      }
      return { x: sx / c, y: sy / c };
    });
    if (run.closed) {
      const ring = circleOf(pts, cell * 1.2);
      if (ring) {
        // Clockwise on the page (y down) when the area it goes round is positive.
        let area = 0;
        for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y;
        strokes.push(circleNodes(ring, Math.atan2(pts[0].y - ring.cy, pts[0].x - ring.cx), area > 0));
        circles++;
        continue;
      }
      pts.push({ ...pts[0] });
    }
    const fitTol = Math.max(cell, cellY) * FIT_CELLS;
    strokes.push(mode === "straight" ? straightened(pts, within, corners)
      : mode === "mixed" ? mixedLine(pts, within, long, corners, fitTol)
        : fitNodes(pts, fitTol, corners));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length, widthMm, circles };
}
