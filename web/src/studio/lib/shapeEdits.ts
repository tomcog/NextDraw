// What is done to one shape, or a few, as a whole: flattened to points, its copies baked, several
// joined into one and taken apart again, a path simplified - and the marks a shape makes, worked out
// for whoever needs them. Plain geometry: each returns the shapes that take the old ones' place, and
// App.tsx records, sets and picks.

import { fillRuns, newFillId, type Fill } from "../../shared/lib/drawing/hatch";
import type { StrokeFont } from "../../shared/lib/drawing/font";
import { curveStrokes, type Point } from "../../shared/lib/drawing/parametric";
import { flattenPath, flattenRun, mapNode, parsePath, simplifyRun, type Node } from "../../shared/lib/drawing/path";
import { placements } from "../../shared/lib/drawing/repeat";
import { centerOf, drawnNodes, drawnRuns, newShapeId, outlinePoints, pathRuns, pointsBox, turnPoint, type Shape } from "../../shared/lib/drawing/shapes";
import { textRuns } from "../../shared/lib/drawing/text";

/**
 * The fills of a shape that has been replaced by others, handed to each of them, so the drawing looks
 * the same afterwards. The first keeps the fill's own id when it kept the shape's.
 */
export function handOutFills(fills: Fill[], id: string, made: Shape[]): Fill[] {
  return fills.flatMap((f) => (f.shapeId === id
    ? made.map((s) => ({ ...f, id: s.id === id ? f.id : newFillId(), shapeId: s.id }))
    : [f]));
}

/**
 * Flatten a shape: give up the numbers behind what it is, and keep what they drew. A curve becomes
 * a path with every point draggable, a word becomes the strokes of its font, a rectangle becomes
 * its four corners. What the shape IS becomes points; where its marks LAND is left alone, so the
 * turn and the copies stay settings and the copies go on following the points that can now be
 * dragged. Nothing is flattened for the sake of another app - the file always carries the marks
 * themselves - so this is only ever about being able to edit a thing by hand. The first of what it
 * becomes keeps the shape's id; nothing at all when there is nothing to keep.
 */
export function flattened(shape: Shape, font: StrokeFont | undefined): Shape[] {
  const made: Shape[] = [];
  if (shape.kind === "text") {
    // Every stroke of every letter becomes its own path: the words are given up, the marks stay.
    for (const glyph of textRuns(shape, font)) {
      // The letter's own curves, kept as curves: a flattened word is the strokes of its font, not
      // the font walked out into segments.
      for (const points of parsePath(glyph.d)) {
        if (points.length < 2) continue;
        const b = pointsBox(flattenRun(points));
        made.push({
          ...shape, id: made.length ? newShapeId() : shape.id,
          kind: "path", points, text: undefined, font: undefined, tracking: undefined,
          leading: undefined,
          x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
        });
      }
    }
  } else if (shape.curve) {
    // A polygon, a star and curve stitching are corners joined by straight lines: flattened, they stay
    // straight. A curve through a hexagon's six corners is a circle.
    const straight = shape.curve.kind === "polygon" || shape.curve.kind === "star" || shape.curve.kind === "parabolic";
    for (const points of curveStrokes(shape)) {
      if (points.length < 2) continue;
      const b = pointsBox(points);
      made.push({
        ...shape, id: made.length ? newShapeId() : shape.id,
        // The curve's numbers are given up, but not its shape: the points of a curved one are kept
        // as a curve through them, so simplifying down to a handful still draws what was drawn.
        kind: "path", points, curve: undefined, smooth: straight ? undefined : true,
        x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
      });
    }
  } else {
    // A rectangle, an ellipse, a line or a path: left as its own points, so each one can be
    // pulled about point by point afterwards. A smoothed path gives up the curve here - what is
    // left is the points the pen was going to be walked through anyway.
    const runs = (shape.kind === "path" ? drawnRuns(shape) : [outlinePoints(shape)])
      .filter((run) => run.length > 1);
    if (!runs.length) return [];
    const b = pointsBox(runs.flat());
    made.push({
      ...shape, id: shape.id,
      kind: "path", smooth: undefined,
      ...(runs.length > 1 ? { runs, points: undefined } : { runs: undefined, points: runs[0] }),
      x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    });
  }
  return made;
}

/**
 * Bake a shape's copies: each one becomes a shape of its own, keeping the numbers behind it. A
 * ring of eight spirographs becomes eight spirographs, each still a spirograph to edit, rather
 * than eight paths - baking says where the marks land, not what they are made of. The turn a ring
 * gave a copy becomes that copy's own turn, and the shape's own turn stays the setting it was, so
 * all this changes is how many shapes there are and where they sit. The first keeps the shape's id.
 */
export function bakedCopies(shape: Shape): Shape[] {
  if (!shape.repeat) return [shape];
  // Turning about the middle and then moving is the same as moving and then turning about the
  // middle where it landed, which is why each copy can be its own shape at its own angle.
  const shift = (run: Node[], dx: number, dy: number) =>
    run.map((n) => mapNode(n, (p) => ({ x: p.x + dx, y: p.y + dy })));
  return placements(shape).map((place, i) => {
    const turn = (shape.rotation ?? 0) + place.deg;
    return {
      ...shape,
      id: i ? newShapeId() : shape.id,
      repeat: undefined,
      rotation: turn || undefined,
      x: shape.x + place.dx, y: shape.y + place.dy,
      x2: shape.x2 + place.dx, y2: shape.y2 + place.dy,
      ...(shape.runs
        ? { runs: shape.runs.map((run) => shift(run, place.dx, place.dy)) }
        : shape.points
          ? { points: shift(shape.points, place.dx, place.dy) }
          : {}),
    };
  });
}

/**
 * Every run of marks a shape makes, in inches on the page: its copies, its turn and all. With its
 * fills, everything the pen draws for it - its own outline left out when it is only there to be
 * filled - rather than the shape's own line alone.
 */
export function markRuns(shape: Shape, font: StrokeFont | undefined, fills?: Fill[]): Point[][] {
  const centre = centerOf(shape);
  const runs: Point[][] = [];
  for (const place of placements(shape)) {
    const put = (p: Point) => {
      const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
      return { x: turned.x + place.dx, y: turned.y + place.dy };
    };
    const own = shape.kind === "text"
      ? textRuns(shape, font).flatMap((g) => flattenPath(g.d))
      : shape.curve ? curveStrokes(shape)
      : shape.kind === "path" ? drawnRuns(shape)
      : [outlinePoints(shape)];
    if (!fills || shape.outline !== false) {
      for (const run of own) {
        if (run.length > 1) runs.push(run.map(put));
      }
    }
    if (fills) {
      for (const fill of fills.filter((f) => f.shapeId === shape.id)) {
        for (const run of fillRuns(shape, fill)) {
          if (run.length > 1) runs.push(run.map(put));
        }
      }
    }
  }
  return runs;
}

/** Every run a shape makes, as nodes: like markRuns, but a curve stays a curve rather than being
 * walked out - what joining wants, so a joined shape is no less exact than its parts. */
export function markNodes(shape: Shape, font: StrokeFont | undefined): Node[][] {
  const centre = centerOf(shape);
  const out: Node[][] = [];
  for (const place of placements(shape)) {
    const put = (p: Point): Point => {
      const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
      return { x: turned.x + place.dx, y: turned.y + place.dy };
    };
    const own: Node[][] = shape.kind === "text"
      ? textRuns(shape, font).flatMap((g) => parsePath(g.d))
      : shape.curve ? curveStrokes(shape)
      : shape.kind === "path" ? drawnNodes(shape)
      : [outlinePoints(shape)];
    // A loop, not push(...runs): a path of many thousands of subpaths is too many arguments for a call.
    if (shape.outline !== false) for (const run of own) out.push(run.map((n) => mapNode(n, put)));
  }
  return out;
}

/**
 * Several shapes joined into one: every mark of every one of them becomes a run of a single path,
 * which then moves, scales and turns as one thing. It is the first of them, under its id. Photos are
 * left out - a photo is its lines made from a picture, not an outline to join - and fewer than two
 * shapes to join is nothing to do.
 */
export function joined(shapes: Shape[], fonts: Record<string, StrokeFont>): Shape | null {
  const picked = shapes.filter((s) => s.kind !== "photo");
  if (picked.length < 2) return null;
  const runs = picked.flatMap((s) => markNodes(s, fonts[s.font ?? ""]));
  if (!runs.length) return null;
  const b = pointsBox(runs.flatMap((run) => flattenRun(run)));
  return {
    ...picked[0], kind: "path", runs, points: undefined,
    curve: undefined, repeat: undefined, rotation: undefined, scale: undefined, group: undefined, groupName: undefined,
    text: undefined, font: undefined, tracking: undefined, leading: undefined,
    x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
  };
}

/**
 * A path with the points it doesn't need dropped, to within `tolerance` inches. A drawing that has
 * been through another program arrives with its curves walked into thousands of points; this leaves
 * the ones that carry the shape, so they can be dragged - and the plotter has less to read. Nothing
 * when it can't do with fewer.
 */
export function simplified(shape: Shape, tolerance: number): Shape | null {
  const runs = pathRuns(shape);
  if (!runs.length) return null;
  // Simplified from the points the path draws - its curves walked out - so a curved path is
  // thinned by what is on the page, not by its handles.
  const simpler = runs.map((run) => simplifyRun(flattenRun(run), tolerance)).filter((run) => run.length > 1);
  if (!simpler.length || simpler.reduce((n, r) => n + r.length, 0) >= runs.reduce((n, r) => n + r.length, 0)) return null;
  // Simplifying is for keeping the shape while dropping the points, so what comes out is drawn as
  // a curve through them: straight lines between a tenth as many points would be a different
  // drawing. The Smooth button turns that off again for a path that really is straight.
  return { ...shape, smooth: true, ...(shape.runs ? { runs: simpler } : { points: simpler[0] }) };
}

/** A joined shape taken apart again: each run a shape of its own, the first keeping its id. */
export function splitApart(shape: Shape): Shape[] {
  const runs = pathRuns(shape);
  if (runs.length < 2) return [shape];
  return runs.map((run, i) => {
    const b = pointsBox(run);
    return {
      ...shape, id: i ? newShapeId() : shape.id, kind: "path" as const,
      runs: undefined, points: run, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    };
  });
}

/** The Simplifier's settings, each in inches; 0 leaves that step out. */
export interface Simplify {
  /** Points closer than this to the last one kept are dropped. */
  mergeShort: number;
  /** Points within this of the line their neighbours make are dropped (Douglas-Peucker). */
  straighten: number;
  /** A run that starts within this of where the one before it ended carries on from it, pen down. */
  joinEnds: number;
  /** A run whose longest side is under this is taken out. */
  dropTiny: number;
  /** One stroke out of every this many is taken out, on each layer; 0 leaves them all. */
  pruneEvery?: number;
  /** How they're picked: across the page in step, one at random from each block of N, or freely. */
  pruneMode?: PruneMode;
  /** The shuffle for "blocks" and "random", so the same one can be shown again. */
  pruneSeed?: number;
}

export type PruneMode = "even" | "blocks" | "random";

/** A repeatable run of numbers from 0 to 1 out of a seed (mulberry32), so a shuffle can be shown again. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a point falls along a Hilbert curve over a 1024-square grid: near on the page is near in the order. */
function hilbert(x: number, y: number): number {
  let d = 0;
  for (let n = 512; n > 0; n >>= 1) {
    const rx = (x & n) > 0 ? 1 : 0;
    const ry = (y & n) > 0 ? 1 : 0;
    d += n * n * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = 1023 - x; y = 1023 - y; }
      [x, y] = [y, x];
    }
  }
  return d;
}

interface Stroke { key: string; mid: Point; angle: number; length: number }

/**
 * A layer's strokes as rows to prune, in order across the page. Strokes running the same way - within a
 * few degrees - are a family, like a hatching's lines, and a family's strokes are sorted by how far
 * across the lines they sit; those at the same place are one row, however many pieces the row is in.
 * What isn't in a family of at least three rows - an outline, a loop, a speck - is a row each, ordered
 * along a Hilbert curve so that neighbours on the page are neighbours in the order.
 */
function strokeRows(strokes: Stroke[]): string[][] {
  const rows: string[][] = [];
  // The families are found from strokes long enough for their way to be sure - over half a millimetre.
  const lines = strokes.filter((s) => s.length > 0.02).sort((a, b) => a.angle - b.angle);
  const families: Stroke[][] = [];
  for (const s of lines) {
    const last = families[families.length - 1];
    if (last && s.angle - last[last.length - 1].angle <= 4) last.push(s);
    else families.push([s]);
  }
  // Nearly 0° and nearly 180° are the same way.
  if (families.length > 1 && families[0][0].angle + 180 - families[families.length - 1].slice(-1)[0].angle <= 4) {
    families[0].push(...families.pop()!);
  }
  // A shorter piece - a bit of a row between two tones - joins the family it runs nearest to, within
  // 15°: its own way is too rough to start one. A loop or a dot, running no way at all, stays loose.
  const loose: Stroke[] = [];
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
  for (const s of strokes) {
    if (s.length > 0.02) continue;
    const near = s.length > 0.002 ? families.find((f) => apart(f[0].angle, s.angle) <= 15) : undefined;
    if (near) near.push(s);
    else loose.push(s);
  }
  for (const family of families) {
    // The family's way, from its long strokes alone: the short ones joined it for their place, not their way.
    const sure = family.filter((s) => s.length > 0.02);
    const mean = sure.reduce((sum, s) => sum + (s.angle > sure[0].angle + 90 ? s.angle - 180 : s.angle), 0) / sure.length;
    const t = (mean * Math.PI) / 180;
    // Across the lines, counted from the left or the top, so the first row is the one seen first.
    const flip = -Math.sin(t) < -1e-9 ? -1 : 1;
    const across = (p: Point) => flip * (-p.x * Math.sin(t) + p.y * Math.cos(t));
    const sorted = family.map((s) => ({ s, at: across(s.mid) })).sort((a, b) => a.at - b.at);
    // Pieces of one row sit at nearly the same place across, rows a spacing apart: two kinds of gap, the
    // small wobble within a row and the step to the next. The widest jump between gap sizes is where
    // one kind ends and the other starts; with no clear jump, every gap is a step to a new row. Steps
    // to the next row are many - a fifth of the gaps at least - so a jump with only a few gaps above it
    // is rows left empty where the picture is white, not the break.
    const gaps = sorted.slice(1).map((o, i) => o.at - sorted[i].at).filter((g) => g > 1e-5).sort((a, b) => a - b);
    let same = 1e-5;
    let jump = 2; // a jump smaller than double isn't a break between kinds
    for (let i = 0; i + 1 < gaps.length && gaps.length - (i + 1) >= gaps.length / 5; i++) {
      const ratio = gaps[i + 1] / gaps[i];
      if (ratio > jump) { jump = ratio; same = Math.sqrt(gaps[i] * gaps[i + 1]); }
    }
    const famRows: string[][] = [];
    sorted.forEach((o, i) => {
      if (i && o.at - sorted[i - 1].at <= same) famRows[famRows.length - 1].push(o.s.key);
      else famRows.push([o.s.key]);
    });
    if (famRows.length >= 3) rows.push(...famRows);
    else loose.push(...family);
  }
  if (loose.length) {
    const box = pointsBox(loose.map((s) => s.mid));
    const size = Math.max(box.x1 - box.x0, box.y1 - box.y0) || 1;
    const cell = (v: number, o: number) => Math.min(1023, Math.floor(((v - o) / size) * 1023));
    loose
      .map((s) => ({ key: s.key, h: hilbert(cell(s.mid.x, box.x0), cell(s.mid.y, box.y0)) }))
      .sort((a, b) => a.h - b.h)
      .forEach(({ key }) => rows.push([key]));
  }
  return rows;
}

/**
 * The strokes Prune takes out, as "shape id:run index", one in every N on each layer on its own.
 * "even" takes the Nth row, the 2Nth and so on, across the page (see strokeRows), so a hatching loses
 * every other line rather than every other piece of line. "blocks" takes one row at random out of each
 * N, so the share is the same everywhere but the rhythm loosens. "random" picks one in N strokes freely.
 */
function prunedStrokes(shapes: Shape[], onLayer: (s: Shape) => boolean, every: number, mode: PruneMode, seed: number): Set<string> {
  const out = new Set<string>();
  if (every < 2) return out;
  const byLayer = new Map<string, Stroke[]>();
  for (const s of shapes) {
    if (s.kind !== "path" || !onLayer(s)) continue;
    const list = byLayer.get(s.layerId) ?? [];
    pathRuns(s).forEach((run, i) => {
      const a = run[0], z = run[run.length - 1];
      const length = Math.hypot(z.x - a.x, z.y - a.y);
      const angle = ((Math.atan2(z.y - a.y, z.x - a.x) * 180) / Math.PI + 360) % 180;
      // Placed by the middle of its two ends: on the row's line even when the stroke waves along it.
      list.push({ key: `${s.id}:${i}`, mid: { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, angle, length });
    });
    byLayer.set(s.layerId, list);
  }
  for (const strokes of byLayer.values()) {
    const random = seeded(seed);
    if (mode === "random") {
      strokes.map((st) => ({ key: st.key, r: random() })).sort((a, b) => a.r - b.r)
        .slice(0, Math.round(strokes.length / every)).forEach(({ key }) => out.add(key));
      continue;
    }
    const rows = strokeRows(strokes);
    for (let start = 0; start < rows.length; start += every) {
      const block = rows.slice(start, start + every);
      let pick: number;
      if (mode === "even") pick = every - 1;
      // A short block at the end loses a row only as often as its share would.
      else if (block.length < every) pick = random() < block.length / every ? Math.floor(random() * block.length) : -1;
      else pick = Math.floor(random() * every);
      block[pick]?.forEach((key) => out.add(key));
    }
  }
  return out;
}

/** How many points a shape's paths hold: what the Simplifier counts, before and after. */
export const pointCount = (shapes: Shape[]) =>
  shapes.reduce((n, s) => (s.kind === "path" ? n + pathRuns(s).reduce((m, r) => m + r.length, 0) : n), 0);

const near = (a: Point, b: Point, d: number) => Math.hypot(a.x - b.x, a.y - b.y) < d;

/** A straight-line run with each point closer than `d` to the last one kept left out; the ends stay. */
function mergeShort(run: Node[], d: number): Node[] {
  if (d <= 0 || run.length < 3) return run;
  const out = [run[0]];
  for (let i = 1; i < run.length - 1; i++) if (!near(run[i], out[out.length - 1], d)) out.push(run[i]);
  const last = run[run.length - 1];
  // The end is where the line goes to, so it stays; the point before it goes if it's too close.
  if (out.length > 1 && near(out[out.length - 1], last, d)) out.pop();
  out.push(last);
  return out;
}

/**
 * The Simplifier, over a drawing: every path on these layers with points it doesn't need taken out,
 * its runs joined where one starts where the last ended, and the specks dropped. Only runs of straight
 * lines are thinned - a run with curve handles already draws with few points - and only paths: a
 * photo, a word or a curve is drawn from its numbers, not its points. Runs are never turned round, so a
 * pen that may only be pulled still draws each one the way it went. A path with nothing left goes.
 */
export function simplifyDrawing(shapes: Shape[], onLayer: (s: Shape) => boolean, opts: Simplify): { shapes: Shape[]; gone: string[] } {
  const gone: string[] = [];
  // Pruned first, so the rest work on what's left and the count is of both together.
  const pruned = prunedStrokes(shapes, onLayer, opts.pruneEvery ?? 0, opts.pruneMode ?? "even", opts.pruneSeed ?? 0);
  const out = shapes.flatMap((s) => {
    if (s.kind !== "path" || !onLayer(s)) return [s];
    const straight = (r: Node[]) => r.every((n) => !n.in && !n.out);
    let runs = pathRuns(s).filter((_, i) => !pruned.has(`${s.id}:${i}`)).map((r) => (straight(r) ? simplifyRun(mergeShort(r, opts.mergeShort), opts.straighten) as Node[] : r));
    if (opts.joinEnds > 0 && runs.length > 1) {
      const joined: Node[][] = [runs[0]];
      for (const r of runs.slice(1)) {
        const prev = joined[joined.length - 1];
        if (near(prev[prev.length - 1], r[0], opts.joinEnds)) joined[joined.length - 1] = [...prev, ...r.slice(1)];
        else joined.push(r);
      }
      runs = joined;
    }
    if (opts.dropTiny > 0) runs = runs.filter((r) => { const b = pointsBox(r); return Math.max(b.x1 - b.x0, b.y1 - b.y0) >= opts.dropTiny; });
    runs = runs.filter((r) => r.length > 1);
    if (!runs.length) {
      gone.push(s.id);
      return [];
    }
    // The box follows the points that are left - unless the path is turned: it turns about the box's
    // middle, and a box that moved would move the drawing.
    const b = pointsBox(runs.flat());
    const box = s.rotation ? {} : { x: b.x0, y: b.y0, x2: b.x1, y2: b.y1 };
    return [{ ...s, ...(s.runs ? { runs } : { points: runs[0] }), ...box }];
  });
  return { shapes: out, gone };
}
