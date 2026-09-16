import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  boxOf, clampToPage, dragHandle, handlesOf, isDegenerate, moveBy, newShapeId,
  CURSOR, type Handle, type Page, type Shape, type ShapeKind,
} from "../lib/shapes";
import { hatchLines, type Fill } from "../lib/hatch";
import { fmtIn } from "../../lib/format";
import styles from "./Canvas.module.css";

/** Select picks shapes up; the rest draw. Without the distinction a shape covering the page would
 *  be a hole you couldn't draw in, and a drag over one would be ambiguous. */
export type Tool = ShapeKind | "select";

interface Props {
  page: Page;
  shapes: Shape[];
  fills: Fill[];
  tool: Tool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (shape: Shape) => void;
  onUpdate: (shape: Shape) => void;
  /** A move or reshape is about to start. One call per gesture, before anything changes, so undo
   *  steps back over the whole drag rather than over each of the hundreds of updates it makes. */
  onEditStart: () => void;
}

// One drag at a time, and what it means depends on where it started: on the page it draws a new
// shape, on a shape it moves that shape, on a selected shape's handle it reshapes it. A shape being
// moved or reshaped is updated as the pointer goes, so the page and the size in the list stay
// truthful mid-drag rather than catching up at the end.
type Drag =
  | { mode: "new"; shape: Shape }
  | { mode: "move"; id: string; from: { x: number; y: number }; origin: Shape }
  | { mode: "handle"; id: string; handle: Handle; origin: Shape };

// The page at true proportions, with a one-inch grid. It keeps the page's own proportions and is
// sized to them (--canvas-aspect), so the drawing gets as large as the space allows - the same way
// Plot's preview fills its column.
export function Canvas({ page, shapes, fills, tool, selected, onSelect, onAdd, onUpdate, onEditStart }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pointer = useRef<number | null>(null);

  const pad = Math.max(page.w, page.h) * 0.06;
  const vb = [-pad, -pad, page.w + pad * 2, page.h + pad * 2];
  const viewBox = vb.join(" ");
  const dot = vb[2] * 0.008; // handle and home-marker radius in page units - real geometry, so it scales

  // Where a pointer is on the page, in inches from its top-left corner.
  const pointAt = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: vb[0] + ((e.clientX - r.left) / r.width) * vb[2],
      y: vb[1] + ((e.clientY - r.top) / r.height) * vb[3],
    };
  };

  const begin = (e: ReactPointerEvent, next: Drag) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // not a live pointer (synthetic events); the drag still works while the pointer is over the page
    }
    pointer.current = e.pointerId;
    setDrag(next);
  };

  // Started on the page itself: draw a new shape, or in select mode just clear the selection.
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = pointAt(e);
    if (!p) return;
    onSelect(null);
    if (tool === "select") return;
    begin(e, {
      mode: "new",
      shape: clampToPage({ id: newShapeId(), kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }, page),
    });
  };

  // Started on a shape: pick it and move it. A press that doesn't move is just a selection. Only in
  // select mode - while a drawing tool is chosen the shapes let the drag through to the page.
  const onShapeDown = (e: ReactPointerEvent, shape: Shape) => {
    if (e.button !== 0 || tool !== "select") return;
    e.stopPropagation();
    const p = pointAt(e);
    if (!p) return;
    onSelect(shape.id);
    onEditStart();
    begin(e, { mode: "move", id: shape.id, from: p, origin: shape });
  };

  // Started on a handle: reshape.
  const onHandleDown = (e: ReactPointerEvent, shape: Shape, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onEditStart();
    begin(e, { mode: "handle", id: shape.id, handle, origin: shape });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || pointer.current !== e.pointerId) return;
    const p = pointAt(e);
    if (!p) return;
    if (drag.mode === "new") {
      setDrag({ ...drag, shape: clampToPage({ ...drag.shape, x2: p.x, y2: p.y }, page) });
    } else if (drag.mode === "move") {
      onUpdate(moveBy(drag.origin, p.x - drag.from.x, p.y - drag.from.y, page));
    } else {
      onUpdate(clampToPage(dragHandle(drag.origin, drag.handle, p.x, p.y), page));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    if (drag?.mode === "new" && !isDegenerate(drag.shape)) onAdd(drag.shape);
    setDrag(null);
  };

  const render = (s: Shape, key: string, kind: "shape" | "draft") => {
    const b = boxOf(s);
    // A shape whose outline isn't plotted is still shown, as a guide: you have to be able to see and
    // grab the thing the hatching is coming from. It's drawn thin and dashed so it can't be mistaken
    // for a line the pen will make.
    const guide = kind === "shape" && fills.some((f) => f.shapeId === s.id && !f.outline);
    const common = {
      key,
      className: kind === "draft" ? styles.draft : styles.shape,
      "data-guide": guide ? "true" : undefined,
      "data-selected": kind === "shape" && s.id === selected ? "true" : undefined,
      onPointerDown: kind === "shape" ? (e: ReactPointerEvent) => onShapeDown(e, s) : undefined,
    };
    if (s.kind === "line") return <line {...common} x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />;
    if (s.kind === "ellipse") {
      return (
        <ellipse
          {...common}
          cx={(b.x0 + b.x1) / 2}
          cy={(b.y0 + b.y1) / 2}
          rx={(b.x1 - b.x0) / 2}
          ry={(b.y1 - b.y0) / 2}
        />
      );
    }
    return <rect {...common} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />;
  };

  const lines = (count: number, axis: "x" | "y") =>
    Array.from({ length: Math.max(0, Math.ceil(count) - 1) }, (_, i) =>
      axis === "x" ? (
        <line key={`x${i}`} x1={i + 1} y1={0} x2={i + 1} y2={page.h} />
      ) : (
        <line key={`y${i}`} x1={0} y1={i + 1} x2={page.w} y2={i + 1} />
      ),
    );

  const chosen = shapes.find((s) => s.id === selected) ?? null;
  const showHandles = chosen && drag?.mode !== "new" && drag?.mode !== "move";

  return (
    <div className={styles.wrap} style={{ "--canvas-aspect": vb[2] / vb[3] } as CSSProperties}>
      <svg
        ref={svgRef}
        className={styles.canvas}
        data-drag={drag?.mode}
        data-tool={tool}
        viewBox={viewBox}
        role="img"
        aria-label={`Drawing page, ${fmtIn(page.w)} by ${fmtIn(page.h)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect className={styles.page} x={0} y={0} width={page.w} height={page.h} />
        <g className={styles.grid}>
          {lines(page.w, "x")}
          {lines(page.h, "y")}
        </g>
        <rect className={styles.pageEdge} x={0} y={0} width={page.w} height={page.h} />

        {/* Hatch lines, drawn from the fill's parameters rather than stored, so they follow the shape
            as it's moved or resized. They aren't clickable: the shape underneath is what you grab. */}
        <g className={styles.fills}>
          {fills.map((fill) => {
            const shape = shapes.find((s) => s.id === fill.shapeId);
            if (!shape) return null;
            return (
              <g key={fill.shapeId}>
                {hatchLines(shape, fill).map((l, i) => (
                  <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
                ))}
              </g>
            );
          })}
        </g>

        {shapes.map((s) => render(s, s.id, "shape"))}
        {drag?.mode === "new" && render(drag.shape, "draft", "draft")}

        {/* The chosen shape's corners, to drag it into shape. Out of the way while it's being moved,
            so the handles aren't chasing the pointer at the same time as the shape is. */}
        {showHandles && (
          <g className={styles.handles}>
            {handlesOf(chosen).map((h) => (
              <circle
                key={h.id}
                cx={h.x}
                cy={h.y}
                r={dot}
                style={{ cursor: CURSOR[h.id] }}
                onPointerDown={(e) => onHandleDown(e, chosen, h.id)}
              />
            ))}
          </g>
        )}

        {/* Home, where the plotter starts, in the corner Plot puts it. */}
        <circle className={styles.home} cx={0} cy={0} r={dot} />
      </svg>

      {shapes.length === 0 && !drag && (
        <div className={styles.hint} aria-hidden="true">
          <strong>Drag on the page to draw</strong>
          <span>Then save it and open it in Plot</span>
        </div>
      )}
    </div>
  );
}
