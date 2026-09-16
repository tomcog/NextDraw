import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { boxOf, clampToPage, isDegenerate, newShapeId, type Page, type Shape, type ShapeKind } from "../lib/shapes";
import { fmtIn } from "../../lib/format";
import styles from "./Canvas.module.css";

interface Props {
  page: Page;
  shapes: Shape[];
  tool: ShapeKind;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (shape: Shape) => void;
}

// The page at true proportions, with a one-inch grid. Drag on it to draw the chosen shape. It keeps
// the page's own proportions and is sized to them (--canvas-aspect), so the drawing gets as large as
// the space allows - the same way Plot's preview fills its column.
export function Canvas({ page, shapes, tool, selected, onSelect, onAdd }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const drawing = useRef<number | null>(null);

  const pad = Math.max(page.w, page.h) * 0.06;
  const vb = [-pad, -pad, page.w + pad * 2, page.h + pad * 2];
  const viewBox = vb.join(" ");
  const dot = vb[2] * 0.008; // the home marker's radius, in page units - real geometry, so it scales

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

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = pointAt(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not a live pointer (synthetic events); drawing still works while the pointer is over the page
    }
    drawing.current = e.pointerId;
    onSelect(null);
    setDraft(clampToPage({ id: newShapeId(), kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }, page));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing.current !== e.pointerId || !draft) return;
    const p = pointAt(e);
    if (!p) return;
    setDraft(clampToPage({ ...draft, x2: p.x, y2: p.y }, page));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing.current !== e.pointerId) return;
    drawing.current = null;
    if (draft && !isDegenerate(draft)) onAdd(draft);
    setDraft(null);
  };

  const render = (s: Shape, key: string, kind: "shape" | "draft") => {
    const b = boxOf(s);
    const common = {
      key,
      className: kind === "draft" ? styles.draft : styles.shape,
      "data-selected": kind === "shape" && s.id === selected ? "true" : undefined,
      onPointerDown:
        kind === "shape"
          ? (e: ReactPointerEvent) => {
              e.stopPropagation();
              onSelect(s.id);
            }
          : undefined,
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

  return (
    <div className={styles.wrap} style={{ "--canvas-aspect": vb[2] / vb[3] } as CSSProperties}>
      <svg
        ref={svgRef}
        className={styles.canvas}
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
        {shapes.map((s) => render(s, s.id, "shape"))}
        {draft && render(draft, "draft", "draft")}
        {/* Home, where the plotter starts, in the corner Plot puts it. */}
        <circle className={styles.home} cx={0} cy={0} r={dot} />
      </svg>

      {shapes.length === 0 && !draft && (
        <div className={styles.hint} aria-hidden="true">
          <strong>Drag on the page to draw</strong>
          <span>Then save it and open it in Plot</span>
        </div>
      )}
    </div>
  );
}
