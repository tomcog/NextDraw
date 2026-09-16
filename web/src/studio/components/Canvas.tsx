import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  boxOf, clampToPage, dragHandle, handlesOf, isDegenerate, moveBy, newShapeId,
  CURSOR, type Handle, type Page, type Shape, type ShapeKind,
} from "../lib/shapes";
import { hatchLines, type Fill } from "../lib/hatch";
import type { Layer } from "../lib/shapes";
import { BedCanvas, type BedCanvasHandle, type Box, type Zoom } from "../../components/BedCanvas";
import { DEFAULT_SETTINGS, UNITS } from "../../lib/constants";
import type { PlotterModel } from "../../lib/types";
import styles from "./Canvas.module.css";

/** Select picks shapes up; the rest draw. Without the distinction a shape covering the page would
 *  be a hole you couldn't draw in, and a drag over one would be ambiguous. */
export type Tool = ShapeKind | "select";

interface Props {
  page: Page;
  shapes: Shape[];
  fills: Fill[];
  /** The plotter the drawing is for, so the page is shown on the bed it will be drawn on. */
  model: PlotterModel | undefined;
  zoom: Zoom;
  toolbar?: ReactNode;
  /** The layers, which own the colours: everything on a layer draws in its one colour. */
  layers: Layer[];
  /** The layer new shapes are drawn onto. */
  activeLayer: string;
  /** The tool's line width in millimetres, drawn at true size so the weight is honest. */
  penWidthMm: number;
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
export function Canvas({ page, shapes, fills, layers, activeLayer, model, zoom, toolbar, penWidthMm, tool, selected, onSelect, onAdd, onUpdate, onEditStart }: Props) {
  const bed = useRef<BedCanvasHandle>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pointer = useRef<number | null>(null);

  // The page is the paper, sitting at the plotter's home corner - the same place Plot puts it.
  const settings = {
    ...DEFAULT_SETTINGS,
    paper_w: page.w * 25.4,
    paper_h: page.h * 25.4,
    paper_x: 0,
    paper_y: 0,
    paper_color: "#ffffff",
  };
  const drawingBox: Box | null = shapes.length
    ? (shapes.reduce<[number, number, number, number]>(
        (acc, s) => {
          const b = boxOf(s);
          return [Math.min(acc[0], b.x0), Math.min(acc[1], b.y0), Math.max(acc[2], b.x1), Math.max(acc[3], b.y1)];
        },
        [Infinity, Infinity, -Infinity, -Infinity],
      ).map((v) => v * UNITS) as Box)
    : null;

  // Where a pointer is on the page, in inches from its top-left corner.
  // The pen's real width in inches, so the line on screen is the line on paper.
  const penIn = penWidthMm / 25.4;
  const layerOf = (id: string) => layers.find((l) => l.id === id);
  const colorOf = (sh: Shape) => layerOf(sh.layerId)?.color ?? "#262626";
  const shown = shapes.filter((sh) => !layerOf(sh.layerId)?.hidden);

  const pointAt = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const at = bed.current?.at(e.clientX, e.clientY);
    return at ? { x: at.x / UNITS, y: at.y / UNITS } : null; // bed units to the page's inches
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
      shape: clampToPage({ id: newShapeId(), layerId: activeLayer, kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }, page),
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
    const guide = kind === "shape" && s.outline === false;
    const common = {
      key,
      className: kind === "draft" ? styles.draft : styles.shape,
      "data-guide": guide ? "true" : undefined,
      "data-selected": kind === "shape" && s.id === selected ? "true" : undefined,
      style: kind === "shape" && !guide
        ? ({ stroke: colorOf(s), strokeWidth: penIn } as CSSProperties)
        : undefined,
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

  const chosen = shapes.find((s) => s.id === selected) ?? null;
  const showHandles = chosen && drag?.mode !== "new" && drag?.mode !== "move";

  return (
    <BedCanvas
      zoom={zoom}
      model={model}
      settings={settings}
      drawingBox={drawingBox}
      handle={bed}
      toolbar={toolbar}
      wrapClassName={styles.wrap}
      wrapData={{ "data-tool": tool, "data-drag": drag?.mode }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      overlay={
        shapes.length === 0 && !drag ? (
          <div className={styles.hint} aria-hidden="true">
            <strong>Drag on the page to draw</strong>
            <span>Then save it and open it in Plot</span>
          </div>
        ) : undefined
      }
    >
      {({ mark }) => {
        // Everything below is in the page's inches; the bed counts in UNITS per inch.
        const handleR = (mark * 0.28) / UNITS;
        return (
          <g transform={`scale(${UNITS})`}>
            {/* Hatch lines, drawn from each fill's parameters rather than stored, so they follow the
                shape as it moves. Not clickable: the shape underneath is what you grab. */}
            <g className={styles.fills}>
              {fills.map((fill) => {
                const shape = shown.find((sh) => sh.id === fill.shapeId);
                if (!shape) return null;
                return (
                  <g
                    key={fill.id}
                    style={{ stroke: colorOf(shape), strokeWidth: penIn } as CSSProperties}
                  >
                    {hatchLines(shape, fill).map((l, i) => (
                      <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
                    ))}
                  </g>
                );
              })}
            </g>

            {shown.map((sh) => render(sh, sh.id, "shape"))}
            {drag?.mode === "new" && render(drag.shape, "draft", "draft")}

            {showHandles && (
              <g className={styles.handles}>
                {handlesOf(chosen).map((h) => (
                  <circle
                    key={h.id}
                    cx={h.x}
                    cy={h.y}
                    r={handleR}
                    style={{ cursor: CURSOR[h.id] }}
                    onPointerDown={(e) => onHandleDown(e, chosen, h.id)}
                  />
                ))}
              </g>
            )}
          </g>
        );
      }}
    </BedCanvas>
  );
}
