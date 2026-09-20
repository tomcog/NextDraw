// Repeats: one shape drawn many times from a few numbers, like the curves in parametric.ts. The
// shape itself stays the one you drew and the one you edit; the copies are worked out from it, so
// changing the shape - or its fill, or its angle - changes every copy at once.

import { centerOf, type Shape } from "./shapes";

export type RepeatKind = "grid" | "ring";

/** Copies in rows and columns, each `stepX`/`stepY` inches on from the last. */
export interface GridRepeat {
  kind: "grid";
  across: number;
  down: number;
  stepX: number;
  stepY: number;
}

/** Copies round a circle `radius` inches across, with the shape itself at its top. */
export interface RingRepeat {
  kind: "ring";
  count: number;
  radius: number;
  /** Turn each copy to face out of the ring, rather than leaving them all the same way up. */
  facing: boolean;
}

export type Repeat = GridRepeat | RingRepeat;

export const REPEAT_LABEL: Record<RepeatKind, string> = { grid: "Grid", ring: "Ring" };

/** One copy's place: how far it is moved, and how far it is turned about its own middle. */
export interface Placement {
  dx: number;
  dy: number;
  deg: number;
}

/** A repeat to start from, sized to the shape so the first copies land clear of the original. */
export function defaultRepeat(kind: RepeatKind, s: Shape): Repeat {
  const w = Math.abs(s.x2 - s.x) || 1;
  const h = Math.abs(s.y2 - s.y) || 1;
  if (kind === "grid") {
    return { kind: "grid", across: 3, down: 2, stepX: Number((w * 1.2).toFixed(3)), stepY: Number((h * 1.2).toFixed(3)) };
  }
  return { kind: "ring", count: 6, radius: Number((Math.max(w, h) * 1.5).toFixed(3)), facing: true };
}

export const REPEAT_FIELDS: Record<RepeatKind, { key: string; label: string; min: number; max: number; step: number }[]> = {
  grid: [
    { key: "across", label: "Across", min: 1, max: 100, step: 1 },
    { key: "down", label: "Down", min: 1, max: 100, step: 1 },
    { key: "stepX", label: "Step across (in)", min: 0, max: 50, step: 0.1 },
    { key: "stepY", label: "Step down (in)", min: 0, max: 50, step: 0.1 },
  ],
  ring: [
    { key: "count", label: "Copies", min: 1, max: 200, step: 1 },
    { key: "radius", label: "Radius (in)", min: 0, max: 50, step: 0.1 },
  ],
};

/**
 * Where each copy of a shape goes, the original included - so a shape with no repeat is one copy
 * that hasn't moved, and everything that draws a shape can draw the list without a special case.
 */
export function placements(s: Shape): Placement[] {
  const r = s.repeat;
  const none: Placement[] = [{ dx: 0, dy: 0, deg: 0 }];
  if (!r) return none;
  if (r.kind === "grid") {
    const across = Math.max(1, Math.round(r.across));
    const down = Math.max(1, Math.round(r.down));
    const out: Placement[] = [];
    for (let row = 0; row < down; row++) {
      for (let col = 0; col < across; col++) out.push({ dx: col * r.stepX, dy: row * r.stepY, deg: 0 });
    }
    return out.length ? out : none;
  }
  const count = Math.max(1, Math.round(r.count));
  // The ring hangs below the shape, so the shape itself is the copy at twelve o'clock and stays
  // exactly where it was drawn. Everything else goes round from there.
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i / count) * 2 * Math.PI;
    return {
      dx: r.radius * Math.cos(a),
      dy: r.radius * Math.sin(a) + r.radius,
      deg: r.facing ? (i / count) * 360 : 0,
    };
  });
}

/** One copy's move and turn, as an SVG transform - nothing at all for a copy that stays put. */
export function placementAttr(s: Shape, p: Placement): string | undefined {
  if (!p.dx && !p.dy && !p.deg) return undefined;
  const n = (v: number) => Number(v.toFixed(4));
  const c = centerOf(s);
  const move = p.dx || p.dy ? `translate(${n(p.dx)} ${n(p.dy)})` : "";
  const turn = p.deg ? `rotate(${n(p.deg)} ${n(c.x)} ${n(c.y)})` : "";
  return [move, turn].filter(Boolean).join(" ");
}

/** A repeat read back from a saved drawing: only numbers are kept, so check them on the way in. */
export function repeatFromData(raw: unknown): Repeat | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const n = (key: string, fallback: number) => (Number.isFinite(Number(d[key])) ? Number(d[key]) : fallback);
  if (d.kind === "grid") {
    return { kind: "grid", across: n("across", 1), down: n("down", 1), stepX: n("stepX", 1), stepY: n("stepY", 1) };
  }
  if (d.kind === "ring") {
    return { kind: "ring", count: n("count", 6), radius: n("radius", 1), facing: d.facing !== false };
  }
  return null;
}
