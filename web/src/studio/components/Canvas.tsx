import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  angleFromCenter, boxOf, clampToPage, dragHandleTurned, handlePoints, isDegenerate, moveBy,
  newShapeId, turnAttr, turnGrip, CURSOR, type Handle, type Page, type Shape, type ShapeKind,
} from "../lib/shapes";
import { hatchLines, hatchStroke, type Fill } from "../lib/hatch";
import { curveStrokes, pointsAttr, DEFAULT_CURVE, type CurveKind } from "../lib/parametric";
import { placementAttr, placements } from "../lib/repeat";
import { textRuns, type StrokeFont } from "../lib/text";
import type { Layer } from "../lib/shapes";
import { BedCanvas, type BedCanvasHandle, type Box, type Zoom } from "../../components/BedCanvas";
import { DEFAULT_SETTINGS, UNITS } from "../../lib/constants";
import type { PlotterModel } from "../../lib/types";
import { inkLayer } from "../../lib/ink";
import styles from "./Canvas.module.css";

/** Select picks shapes up; the rest draw. Without the distinction a shape covering the page would
 *  be a hole you couldn't draw in, and a drag over one would be ambiguous. A parametric curve is
 *  its own tool per generator, since which curve it is can't be told from the drag. */
export type Tool = Exclude<ShapeKind, "curve" | "path"> | "select" | CurveKind;

/** A line of text to start from, so a new one says something rather than being an empty box. */
const NEW_TEXT = "Text";

/** The shape a tool draws, as a box with nothing in it yet. */
// A path is never drawn by hand: it is what a curve becomes when it's baked.
const shapeFor = (tool: Exclude<Tool, "select">, layerId: string, x: number, y: number, font: string): Shape => {
  if (tool === "rect" || tool === "ellipse" || tool === "line") {
    return { id: newShapeId(), layerId, kind: tool, x, y, x2: x, y2: y };
  }
  if (tool === "text") {
    return { id: newShapeId(), layerId, kind: "text", text: NEW_TEXT, font, x, y, x2: x, y2: y };
  }
  return { id: newShapeId(), layerId, kind: "curve", curve: DEFAULT_CURVE[tool], x, y, x2: x, y2: y };
};

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
  /** The single-stroke fonts that have been loaded, by name, and the one a new text is set in. */
  fonts: Record<string, StrokeFont>;
  font: string;
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
  /** Everything picked, in the order it was picked: the last of them is what the cards edit. */
  selected: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (shape: Shape) => void;
  onUpdate: (shape: Shape) => void;
  /** Several shapes at once, for dragging a whole selection - or a whole layer - together. */
  onUpdateMany: (shapes: Shape[]) => void;
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
  | { mode: "move"; from: { x: number; y: number }; origins: Shape[] }
  // Rubber band: drawn on the empty page to gather up everything it touches.
  | { mode: "marquee"; from: { x: number; y: number }; to: { x: number; y: number }; add: string[] }
  | { mode: "handle"; id: string; handle: Handle; origin: Shape }
  // Turning: the angle the pointer started at, so the shape turns by how far the pointer has gone
  // round rather than jumping to wherever it was grabbed.
  | { mode: "turn"; id: string; origin: Shape; from: number };

// The page at true proportions, with a one-inch grid. It keeps the page's own proportions and is
// sized to them (--canvas-aspect), so the drawing gets as large as the space allows - the same way
// Plot's preview fills its column.
export function Canvas({ page, shapes, fills, layers, activeLayer, model, zoom, toolbar, toolbarLeft, fonts, font, penWidthMm, inkOpacity, inkBuilds, inkBuild, inkSim, tool, selected, onSelect, onAdd, onUpdate, onUpdateMany, onEditStart }: Props) {
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

  // Started on the page itself: draw a new shape, or in select mode drag a band round what you want.
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = pointAt(e);
    if (!p) return;
    if (tool === "select") {
      // Shift keeps what's already picked, so a band can gather more onto it.
      if (!e.shiftKey) onSelect([]);
      begin(e, { mode: "marquee", from: p, to: p, add: e.shiftKey ? selected : [] });
      return;
    }
    onSelect([]);
    begin(e, {
      mode: "new",
      shape: clampToPage(shapeFor(tool, activeLayer, p.x, p.y, font), page),
    });
  };

  // Started on a shape: pick it and move it. A press that doesn't move is just a selection. Only in
  // select mode - while a drawing tool is chosen the shapes let the drag through to the page.
  const onShapeDown = (e: ReactPointerEvent, shape: Shape) => {
    if (e.button !== 0 || tool !== "select") return;
    e.stopPropagation();
    const p = pointAt(e);
    if (!p) return;
    // Shift adds a shape to the selection, or takes it out again. Otherwise: a shape already in the
    // selection keeps the whole of it, so dragging any one of them moves the lot; anything else
    // becomes the selection on its own.
    const inSelection = selected.includes(shape.id);
    const next = e.shiftKey
      ? (inSelection ? selected.filter((id) => id !== shape.id) : [...selected, shape.id])
      : (inSelection ? selected : [shape.id]);
    onSelect(next);
    if (e.shiftKey && !next.includes(shape.id)) return; // just taken out: nothing to drag
    onEditStart();
    begin(e, { mode: "move", from: p, origins: shapes.filter((s) => next.includes(s.id)) });
  };

  // Started on the turn grip: turn the shape about the middle of its box. Shift snaps to 15°, the
  // angles a drawing is usually squared up to.
  const onTurnDown = (e: ReactPointerEvent, shape: Shape) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pointAt(e);
    if (!p) return;
    onEditStart();
    begin(e, { mode: "turn", id: shape.id, origin: shape, from: angleFromCenter(shape, p.x, p.y) });
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
    } else if (drag.mode === "marquee") {
      setDrag({ ...drag, to: p });
    } else if (drag.mode === "move") {
      // The whole selection moves as one: the limit is the box round all of it, so a group slides
      // along the page's edge instead of collapsing against it.
      const dx = p.x - drag.from.x;
      const dy = p.y - drag.from.y;
      const boxes = drag.origins.map(boxOf);
      const x0 = Math.min(...boxes.map((b) => b.x0));
      const y0 = Math.min(...boxes.map((b) => b.y0));
      const x1 = Math.max(...boxes.map((b) => b.x1));
      const y1 = Math.max(...boxes.map((b) => b.y1));
      const byX = Math.max(-x0, Math.min(page.w - x1, dx));
      const byY = Math.max(-y0, Math.min(page.h - y1, dy));
      onUpdateMany(drag.origins.map((s) => moveBy(s, byX, byY, page)));
    } else if (drag.mode === "turn") {
      const by = angleFromCenter(drag.origin, p.x, p.y) - drag.from;
      const raw = (drag.origin.rotation ?? 0) + by;
      const turn = e.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw);
      onUpdate({ ...drag.origin, rotation: ((turn % 360) + 360) % 360 || undefined });
    } else {
      onUpdate(clampToPage(dragHandleTurned(drag.origin, drag.handle, p.x, p.y), page));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    if (drag?.mode === "new" && !isDegenerate(drag.shape)) onAdd(drag.shape);
    if (drag?.mode === "marquee") {
      const band = {
        x0: Math.min(drag.from.x, drag.to.x), y0: Math.min(drag.from.y, drag.to.y),
        x1: Math.max(drag.from.x, drag.to.x), y1: Math.max(drag.from.y, drag.to.y),
      };
      // Anything the band touches, so a shape doesn't have to be swallowed whole to be caught.
      const caught = shown.filter((sh) => {
        const b = boxOf(sh);
        return b.x0 <= band.x1 && b.x1 >= band.x0 && b.y0 <= band.y1 && b.y1 >= band.y0;
      });
      if (band.x1 - band.x0 > 0.02 || band.y1 - band.y0 > 0.02) {
        onSelect([...drag.add, ...caught.map((sh) => sh.id).filter((id) => !drag.add.includes(id))]);
      }
    }
    setDrag(null);
  };

  // One shape as an SVG element. The caller says what it's for; nothing here decides how it looks.
  // Ink is painted by the shared preview rules (see lib/ink.ts), and the interface pieces by
  // Canvas.module.css, so a mark and the thing you grab to move it are drawn separately even though
  // they're the same rectangle.
  const element = (s: Shape, key: string, props: Record<string, unknown>) => {
    const b = boxOf(s);
    // A turned shape is drawn turned about the middle of its box; the box itself stays square.
    const common = { ...props, ...(turnAttr(s) ? { transform: turnAttr(s) } : {}) };
    if (s.kind === "text") {
      // The glyphs, in the size the box says, with a transparent box behind them so the whole thing
      // can be picked up rather than only the strokes of the letters.
      const b = boxOf(s);
      const runs = textRuns(s, fonts[s.font ?? ""]);
      return (
        <g key={key} {...common}>
          {props.className === styles.grab && (
            <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill="transparent" stroke="none" />
          )}
          {runs.map((run, i) => <path key={i} d={run.d} fill="none" />)}
        </g>
      );
    }
    if (s.kind === "path") {
      return <polyline key={key} {...common} fill="none" points={pointsAttr(s.points ?? [])} />;
    }
    if (s.kind === "curve") {
      // Several strokes where the curve lifts the pen (a parabolic's corners), so what's on screen
      // is what goes on the paper, pen lifts and all. The caller's props go on each stroke rather
      // than on the group around them: vector-effect doesn't inherit in SVG, so a class on the group
      // would leave the interface's screen-width lines measured in inches instead.
      const runs = curveStrokes(s);
      return (
        <g key={key} transform={turnAttr(s)}>
          {runs.map((run, i) => <polyline key={i} {...props} fill="none" points={pointsAttr(run)} />)}
        </g>
      );
    }
    if (s.kind === "line") return <line key={key} {...common} x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />;
    if (s.kind === "ellipse") {
      return (
        <ellipse
          key={key}
          {...common}
          cx={(b.x0 + b.x1) / 2}
          cy={(b.y0 + b.y1) / 2}
          rx={(b.x1 - b.x0) / 2}
          ry={(b.y1 - b.y0) / 2}
        />
      );
    }
    return <rect key={key} {...common} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />;
  };

  // Everything one layer will actually put on the paper: the outlines it draws, and the hatch lines
  // its fills generate. A shape whose outline isn't plotted contributes only its hatching - the shape
  // itself is a guide, and guides are interface, drawn further down.
  const marksOn = (layer: Layer) => {
    const mine = shapes.filter((sh) => sh.layerId === layer.id);
    // A repeated shape is drawn once per copy. The copies are marks and nothing else: what you grab,
    // and what the handles belong to, is always the shape itself.
    const copies = (sh: Shape, what: (key: string) => ReactNode) =>
      placements(sh).map((p, i) => (
        <g key={`${sh.id}-copy-${i}`} transform={placementAttr(sh, p)}>{what(`${sh.id}-${i}`)}</g>
      ));
    return (
      <>
        {mine.filter((sh) => sh.outline !== false).map((sh) => copies(sh, (key) => element(sh, key, {})))}
        {fills
          .filter((f) => mine.some((sh) => sh.id === f.shapeId))
          .map((fill) => {
            const shape = mine.find((sh) => sh.id === fill.shapeId)!;
            return copies(shape, (key) => (
              // The fill turns with the shape it fills, since it is that shape's own hatching.
              <g key={`${key}-fill-${fill.id}`} transform={turnAttr(shape)}>
                {fill.connected ? (
                  <polyline fill="none" points={hatchStroke(shape, fill).map((p) => `${p.x},${p.y}`).join(" ")} />
                ) : (
                  hatchLines(shape, fill).map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)
                )}
              </g>
            ));
          })}
      </>
    );
  };

  // The cards edit the last shape picked; its handles are shown while it is the only one.
  const chosen = selected.length === 1 ? shapes.find((s) => s.id === selected[0]) ?? null : null;
  const group = selected.length > 1 ? shapes.filter((s) => selected.includes(s.id)) : [];
  const showHandles = chosen && drag?.mode !== "new" && drag?.mode !== "move";
  // Far enough off the edge that the grip never sits on a corner handle, in the page's inches.

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
                      "data-selected": selected.includes(sh.id) ? "true" : undefined,
                      onPointerDown: (e: ReactPointerEvent) => onShapeDown(e, sh),
                    })}
                  </g>
                );
              })}

              {drag?.mode === "new" && element(drag.shape, "draft", { className: styles.draft })}

              {/* The band, and the box round a group of shapes picked with it. */}
              {drag?.mode === "marquee" && (
                <rect
                  className={styles.draft}
                  x={Math.min(drag.from.x, drag.to.x)}
                  y={Math.min(drag.from.y, drag.to.y)}
                  width={Math.abs(drag.to.x - drag.from.x)}
                  height={Math.abs(drag.to.y - drag.from.y)}
                />
              )}
              {group.length > 0 && drag?.mode !== "marquee" && (() => {
                const boxes = group.map(boxOf);
                const x0 = Math.min(...boxes.map((b) => b.x0));
                const y0 = Math.min(...boxes.map((b) => b.y0));
                const x1 = Math.max(...boxes.map((b) => b.x1));
                const y1 = Math.max(...boxes.map((b) => b.y1));
                return <rect className={styles.draft} x={x0} y={y0} width={x1 - x0} height={y1 - y0} />;
              })()}

              {showHandles && (
                <g className={styles.handles}>
                  {/* The turn grip, on a stalk from the top edge so it reads as turning rather than
                      as another corner to drag. */}
                  {(() => {
                    const grip = turnGrip(chosen, handleR * 4);
                    const top = turnGrip(chosen, 0);
                    return (
                      <>
                        <line className={styles.stalk} x1={top.x} y1={top.y} x2={grip.x} y2={grip.y} />
                        <circle
                          cx={grip.x}
                          cy={grip.y}
                          r={handleR}
                          className={styles.turn}
                          style={{ cursor: "grab" }}
                          onPointerDown={(e) => onTurnDown(e, chosen)}
                        />
                      </>
                    );
                  })()}
                  {handlePoints(chosen).map((h) => (
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
