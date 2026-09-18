import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  boxOf, clampToPage, dragHandle, handlesOf, isDegenerate, moveBy, newShapeId,
  CURSOR, type Handle, type Page, type Shape, type ShapeKind,
} from "../lib/shapes";
import { hatchLines, hatchStroke, type Fill } from "../lib/hatch";
import type { Layer } from "../lib/shapes";
import { BedCanvas, type BedCanvasHandle, type Box, type Zoom } from "../../components/BedCanvas";
import { DEFAULT_SETTINGS, UNITS } from "../../lib/constants";
import type { PlotterModel } from "../../lib/types";
import { inkLayer } from "../../lib/ink";
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
  /** The right end of the width dimension line (the zoom presets), and the left end (Simulate). */
  toolbar?: ReactNode;
  toolbarLeft?: ReactNode;
  /** The layers, which own the colours: everything on a layer draws in its one colour. */
  layers: Layer[];
  /** The layer new shapes are drawn onto. */
  activeLayer: string;
  /** The tool's line width in millimetres, drawn at true size so the weight is honest. */
  penWidthMm: number;
  /** How solid this tool's ink is (0-1), whether more of it darkens, and by how much where strokes
   *  cross. The same three numbers Plot's Drawing tool card holds, read from the same preset. */
  inkOpacity: number;
  inkBuilds: boolean;
  inkBuild: number;
  /** Simulate the ink, or draw each layer flat. Off is also much cheaper on a heavy hatch. */
  inkSim: boolean;
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
export function Canvas({ page, shapes, fills, layers, activeLayer, model, zoom, toolbar, toolbarLeft, penWidthMm, inkOpacity, inkBuilds, inkBuild, inkSim, tool, selected, onSelect, onAdd, onUpdate, onEditStart }: Props) {
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

  // One shape as an SVG element. The caller says what it's for; nothing here decides how it looks.
  // Ink is painted by the shared preview rules (see lib/ink.ts), and the interface pieces by
  // Canvas.module.css, so a mark and the thing you grab to move it are drawn separately even though
  // they're the same rectangle.
  const element = (s: Shape, key: string, props: Record<string, unknown>) => {
    const b = boxOf(s);
    const common = { key, ...props };
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

  // Everything one layer will actually put on the paper: the outlines it draws, and the hatch lines
  // its fills generate. A shape whose outline isn't plotted contributes only its hatching - the shape
  // itself is a guide, and guides are interface, drawn further down.
  const marksOn = (layer: Layer) => {
    const mine = shapes.filter((sh) => sh.layerId === layer.id);
    return (
      <>
        {mine.filter((sh) => sh.outline !== false).map((sh) => element(sh, sh.id, {}))}
        {fills
          .filter((f) => mine.some((sh) => sh.id === f.shapeId))
          .map((fill) => {
            const shape = mine.find((sh) => sh.id === fill.shapeId)!;
            return (
              <g key={fill.id}>
                {fill.connected ? (
                  <polyline fill="none" points={hatchStroke(shape, fill).map((p) => `${p.x},${p.y}`).join(" ")} />
                ) : (
                  hatchLines(shape, fill).map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)
                )}
              </g>
            );
          })}
      </>
    );
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
      toolbarLeft={toolbarLeft}
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
            {/* The ink: exactly what the pen will put on the paper, in the structure Plot's preview
                uses, painted by the same rules in index.css. That's what makes a drawing look the
                same in both apps rather than merely similar. Nothing in here is clickable - what you
                grab is below, so how a mark is painted never changes what you can do to it. */}
            <g
              className={`pv-colored pv-true-width${inkSim ? "" : " pv-flat"} ${styles.ink}`}
              style={{ "--pen-art": String(penIn), "--ink-build-alpha": String(inkBuild) } as CSSProperties}
            >
              {layers.map((layer) => {
                const { base, buildPass } = inkLayer(layer.color, inkBuild, inkBuilds, inkSim);
                const marks = marksOn(layer);
                return (
                  <g
                    key={layer.id}
                    id={layer.id}
                    className="pv-layer"
                    data-builds={String(inkBuilds && inkSim)}
                    data-hidden={layer.hidden ? "true" : undefined}
                    data-skipped={layer.name.startsWith("%") ? "true" : undefined}
                    style={{ "--layer-color": base, "--ink-opacity": String(inkOpacity) } as CSSProperties}
                  >
                    {marks}
                    {/* The second pass: the same marks again, multiplying, so a crossing darkens. */}
                    {buildPass && (
                      <g className="pv-build" style={{ "--layer-color": buildPass } as CSSProperties}>
                        {marks}
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Interface: what you can see and grab that the pen will never draw. Outside the ink
                group on purpose - the preview rules paint everything under them as ink, so a dashed
                guide or a transparent grip would come out as a stroke the plotter appears to make. */}
            <g className={styles.chrome}>
              {shown.map((sh) => {
                const guide = sh.outline === false;
                return (
                  <g key={sh.id}>
                    {/* Filled but not outlined: shown thin and dashed, so it reads as a guide rather
                        than as a line the pen will make. You still have to see what the hatch came from. */}
                    {guide && element(sh, `${sh.id}-guide`, { className: styles.guide })}
                    {/* The grip. Transparent and generous, so grabbing a shape doesn't depend on
                        hitting a stroke that may be a fraction of a millimetre wide. */}
                    {element(sh, `${sh.id}-grab`, {
                      className: styles.grab,
                      "data-selected": sh.id === selected ? "true" : undefined,
                      onPointerDown: (e: ReactPointerEvent) => onShapeDown(e, sh),
                    })}
                  </g>
                );
              })}

              {drag?.mode === "new" && element(drag.shape, "draft", { className: styles.draft })}

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
          </g>
        );
      }}
    </BedCanvas>
  );
}
