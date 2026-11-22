import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./Knockout.module.css";

// The Knockout layer on screen, the same in Studio and Image: the lines it cuts hidden under it as
// they will be in the file (an SVG mask, so moving it costs nothing), and its own shapes drawn as a
// tinted outline that's never ink.

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The mask that hides what the knockout cuts: white everywhere, black inside its shapes - each read
 * the even-odd way, so the hole of an "o" shows - and `gap` past their edges. Put
 * `mask="url(#id)"` on the group holding the lines. In the caller's own units (`paths`, `gap`).
 */
export function KnockoutMask({ id, paths, gap, transform }: { id: string; paths: string[]; gap: number; transform?: string }) {
  return (
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x={-1000} y={-1000} width={3000} height={3000}>
        <rect x={-1000} y={-1000} width={3000} height={3000} fill="white" />
        <g transform={transform}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="black" fillRule="evenodd" stroke="black" strokeWidth={gap * 2} strokeLinejoin="round" />
          ))}
        </g>
      </mask>
    </defs>
  );
}

/** The knockout's shapes as a guide: a light tint and a dashed edge, never mistaken for ink. */
export function KnockoutShapes({ paths, transform }: { paths: string[]; transform?: string }) {
  return (
    <g className={styles.shapes} transform={transform}>
      {paths.map((d, i) => <path key={i} d={d} fillRule="evenodd" />)}
    </g>
  );
}

/** How a box drawn at `from` is carried to `to`: for the mask and the shapes while they're dragged. */
export const boxTransform = (from: Box, to: Box) => {
  const k = (to.x1 - to.x0) / Math.max(from.x1 - from.x0, 1e-9);
  return `translate(${to.x0} ${to.y0}) scale(${k}) translate(${-from.x0} ${-from.y0})`;
};

type Grip = "nw" | "ne" | "se" | "sw" | "move";
const CURSOR: Record<Grip, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", move: "grab" };

/**
 * The knockout's frame, to move and size it on a stage that has no shape tools of its own (Image):
 * picked up anywhere inside and dragged, or by a corner to scale it about the opposite one, keeping
 * its shape. `onDraft` follows the drag; `onPlace` is told the new box once, when it's let go, so
 * the change is one undo step.
 */
export function KnockoutFrame({ box, paths, active, onActivate, draft, onDraft, onPlace, r }: {
  box: Box;
  /** Its shapes, to pick it up by while it isn't the layer being worked on. */
  paths: string[];
  /** Its layer is the one being worked on: the frame and its corners show, and it's grabbed anywhere in its box. */
  active: boolean;
  /** Picked up: make it the layer being worked on. */
  onActivate: () => void;
  draft: Box | null;
  onDraft: (box: Box | null) => void;
  onPlace: (box: Box) => void;
  /** The grips' radius, in the caller's units. */
  r: number;
}) {
  const drag = useRef<{ id: number; grip: Grip; ctm: DOMMatrix; x: number; y: number } | null>(null);
  const shown = draft ?? box;
  const at = (e: ReactPointerEvent, ctm: DOMMatrix) => new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
  const down = (grip: Grip) => (e: ReactPointerEvent<SVGGraphicsElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ctm = e.currentTarget.getScreenCTM()?.inverse();
    if (!ctm) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e, ctm);
    drag.current = { id: e.pointerId, grip, ctm, x: p.x, y: p.y };
    if (!active) onActivate();
    onDraft(box);
  };
  const boxFor = (e: ReactPointerEvent): Box | null => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return null;
    const p = at(e, d.ctm);
    if (d.grip === "move") {
      const dx = p.x - d.x, dy = p.y - d.y;
      return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
    }
    // The opposite corner stays; the size follows the pointer's distance from it, the shape kept.
    const fx = d.grip.includes("w") ? box.x1 : box.x0;
    const fy = d.grip.includes("n") ? box.y1 : box.y0;
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const k = Math.max(0.02, Math.max(Math.abs(p.x - fx) / Math.max(w, 1e-9), Math.abs(p.y - fy) / Math.max(h, 1e-9)));
    const nx = d.grip.includes("w") ? fx - w * k : fx, ny = d.grip.includes("n") ? fy - h * k : fy;
    return { x0: nx, y0: ny, x1: nx + w * k, y1: ny + h * k };
  };
  const move = (e: ReactPointerEvent) => {
    const next = boxFor(e);
    if (next) onDraft(next);
  };
  const up = (e: ReactPointerEvent) => {
    const next = boxFor(e);
    if (!next) return;
    drag.current = null;
    onDraft(null);
    if (next.x0 !== box.x0 || next.y0 !== box.y0 || next.x1 !== box.x1 || next.y1 !== box.y1) onPlace(next);
  };
  const corners: { id: Grip; x: number; y: number }[] = [
    { id: "nw", x: shown.x0, y: shown.y0 }, { id: "ne", x: shown.x1, y: shown.y0 },
    { id: "se", x: shown.x1, y: shown.y1 }, { id: "sw", x: shown.x0, y: shown.y1 },
  ];
  return (
    <g onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {active || draft ? (
        <>
          <rect
            className={styles.frame}
            data-dragging={draft ? "true" : undefined}
            x={shown.x0} y={shown.y0} width={shown.x1 - shown.x0} height={shown.y1 - shown.y0}
            onPointerDown={down("move")}
          />
          <g className={styles.grips}>
            {corners.map((c) => (
              <circle key={c.id} cx={c.x} cy={c.y} r={r} style={{ cursor: CURSOR[c.id] }} onPointerDown={down(c.id)} />
            ))}
          </g>
        </>
      ) : (
        // Not the layer being worked on: picked up by its letters themselves, not the box round them,
        // so the picture between and around them is still the picture's to drag.
        <g className={styles.pick}>
          {paths.map((d, i) => <path key={i} d={d} fillRule="evenodd" onPointerDown={down("move")} />)}
        </g>
      )}
    </g>
  );
}
