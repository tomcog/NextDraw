import { useImperativeHandle, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import styles from "./BedCanvas.module.css";
import { MM, UNITS } from "../lib/constants";
import { fmtIn } from "../lib/format";
import type { PlotterModel, Settings } from "../lib/types";

// The plotter's drawing area at true scale, with the paper on it, a one-inch grid, dimension lines
// and home - the picture both apps draw on. Plot puts the drawing it is about to plot inside it;
// Studio puts the shapes it is editing. Everything either app adds goes in `children`, in bed units.
//
// Sharing this is what keeps the two from drifting: one set of margins, one text size, one set of
// zooms, so a page looks the same whichever app is showing it.

export type Zoom = "plotter" | "paper" | "drawing";

/** x0, y0, x1, y1 in bed units (UNITS per inch), from the plotter's home corner. */
export type Box = [number, number, number, number];

export interface BedCanvasHandle {
  /** Where a client point falls, in bed units. Null before the canvas has been laid out. */
  at: (clientX: number, clientY: number) => { x: number; y: number } | null;
  svg: () => SVGSVGElement | null;
}

interface Props {
  zoom: Zoom;
  model: PlotterModel | undefined;
  settings: Settings;
  /** What the "drawing" zoom frames, and what's included when the view is zoomed out. */
  drawingBox: Box | null;
  /** Sits on the width dimension line, at its right end. */
  toolbar?: ReactNode;
  /**
   * Drawn inside the bed, in bed units. Given the frame's own measurements, so anything that has to
   * hold its size against what's being looked at - a carriage cross, a handle - scales with the zoom
   * rather than guessing.
   */
  children?: ReactNode | ((frame: { mark: number; viewBox: string }) => ReactNode);
  /** HTML over the canvas: a dropzone, a hint. */
  overlay?: ReactNode;
  handle?: Ref<BedCanvasHandle>;
  /** The caller's own class on the wrapper, so its CSS module can reach inside. */
  wrapClassName?: string;
  svgRef?: Ref<SVGSVGElement>;
  /** Replaces the computed viewBox while a drag is panning the view. */
  viewBoxOverride?: string;
  wrapData?: Record<string, string | boolean | undefined>;
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void;
}

// Margins around what's framed, in pads (7.5% of its longer side): a slim left one with just room
// for the side dimension line, and a top one with just room for the width line and its label.
const LEFT = 0.8;
const TOP = 0.7;

export function fit(box: Box) {
  const pad = Math.max(box[2] - box[0], box[3] - box[1]) * 0.075;
  return {
    pad,
    vb: [
      box[0] - pad * LEFT,
      box[1] - pad * TOP,
      box[2] - box[0] + pad * (LEFT + 0.4),
      box[3] - box[1] + pad * (TOP + 0.1),
    ],
  };
}

export function BedCanvas(props: Props) {
  const { model, settings: s, zoom, drawingBox } = props;
  const ownRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(props.handle, () => ({
    svg: () => ownRef.current,
    at: (clientX, clientY) => {
      const svg = ownRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
  }));

  if (!model) return <div className={styles.wrap} />;

  const [tx, ty] = model.travel_in;
  const W = tx * UNITS;
  const H = ty * UNITS;
  const hasPaper = s.paper_w > 0 && s.paper_h > 0;

  const travelBox: Box = [0, 0, W, H];
  const paperBox: Box | null = hasPaper
    ? [s.paper_x * MM, s.paper_y * MM, (s.paper_x + s.paper_w) * MM, (s.paper_y + s.paper_h) * MM]
    : null;

  // What to frame: the whole plotter (plus the paper and drawing, if they stick out), the paper, or
  // the drawing. The dimension lines measure the same thing.
  const zoomBox = zoom === "paper" ? paperBox : zoom === "drawing" ? drawingBox : null;
  const frame: Box = zoomBox ?? ([travelBox, paperBox, drawingBox]
    .filter((b): b is Box => Boolean(b))
    .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) as Box);
  const dimBox = zoomBox ?? travelBox;

  const span = Math.max(frame[2] - frame[0], frame[3] - frame[1]);
  const font = span * 0.024; // sizes the home dot and the paper's shadow

  // The plotter view. The dimension lines, their labels and the toolbar are measured against it, so
  // they stay the same size and sit in the same place whichever zoom is showing.
  const base = fit(travelBox);
  // Each zoom keeps its own proportions and the canvas is sized to them (--bed-aspect, below), so
  // what is framed grows to the largest it fits in the space beside the panel.
  const { vb } = fit(frame);
  const viewBox = props.viewBoxOverride ?? vb.join(" ");

  // Where the dimension lines sit in the plotter view, carried into this view at the same screen spot.
  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number);
  const k = vw / base.vb[2]; // this view's units per plotter-view unit
  const dy = vy + (-base.pad * 0.3 - base.vb[1]) * k;
  const dx = vx + (-base.pad * 0.35 - base.vb[0]) * k;
  const tick = base.pad * 0.14 * k;
  const labelFont = Math.max(W, H) * 0.0156 * k;
  const [dimX0, dimY0, dimX1, dimY1] = dimBox;
  const toolbarStyle = {
    "--toolbar-top": `${((dy - vy) / vh) * 100}%`,
    "--toolbar-right": `${((vx + vw - dimX1) / vw) * 100}%`,
  } as CSSProperties;

  const gridLines = (count: number, axis: "x" | "y") =>
    Array.from({ length: Math.max(0, Math.ceil(count) - 1) }, (_, i) =>
      axis === "x" ? (
        <line key={`x${i}`} x1={(i + 1) * UNITS} y1={1} x2={(i + 1) * UNITS} y2={H - 1} />
      ) : (
        <line key={`y${i}`} x1={1} y1={(i + 1) * UNITS} x2={W - 1} y2={(i + 1) * UNITS} />
      ),
    );

  return (
    <div
      className={props.wrapClassName ? `${styles.wrap} ${props.wrapClassName}` : styles.wrap}
      style={{ "--bed-aspect": vw / vh } as CSSProperties}
      {...props.wrapData}
    >
      <svg
        ref={(node) => {
          (ownRef as { current: SVGSVGElement | null }).current = node;
          if (typeof props.svgRef === "function") props.svgRef(node);
          else if (props.svgRef) (props.svgRef as { current: SVGSVGElement | null }).current = node;
        }}
        className={styles.bed}
        viewBox={viewBox}
        role="img"
        aria-label={`Drawing area of the ${model.name}: ${fmtIn(tx)} by ${fmtIn(ty)}`}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onPointerCancel={props.onPointerUp}
      >
        <rect className={styles.travel} x={0} y={0} width={W} height={H} />
        <g className={styles.grid}>
          {gridLines(tx, "x")}
          {gridLines(ty, "y")}
        </g>

        {hasPaper && (
          <>
            <rect
              className={styles.paperShadow}
              x={s.paper_x * MM + font * 0.18}
              y={s.paper_y * MM + font * 0.18}
              width={s.paper_w * MM}
              height={s.paper_h * MM}
            />
            <rect
              className={styles.paper}
              style={{ fill: s.paper_color || "#ffffff" }}
              x={s.paper_x * MM}
              y={s.paper_y * MM}
              width={s.paper_w * MM}
              height={s.paper_h * MM}
            />
          </>
        )}

        <g className={styles.dim}>
          <line x1={dimX0} y1={dy} x2={dimX1} y2={dy} />
          <line x1={dimX0} y1={dy - tick} x2={dimX0} y2={dy + tick} />
          <line x1={dimX1} y1={dy - tick} x2={dimX1} y2={dy + tick} />
          <text className={styles.axisLabel} x={(dimX0 + dimX1) / 2} y={dy - tick * 1.3} textAnchor="middle" fontSize={labelFont}>
            {fmtIn((dimX1 - dimX0) / UNITS)}
          </text>
          <line x1={dx} y1={dimY0} x2={dx} y2={dimY1} />
          <line x1={dx - tick} y1={dimY0} x2={dx + tick} y2={dimY0} />
          <line x1={dx - tick} y1={dimY1} x2={dx + tick} y2={dimY1} />
          <text
            className={styles.axisLabel}
            x={dx - tick * 1.3}
            y={(dimY0 + dimY1) / 2}
            textAnchor="middle"
            fontSize={labelFont}
            transform={`rotate(-90 ${dx - tick * 1.3} ${(dimY0 + dimY1) / 2})`}
          >
            {fmtIn((dimY1 - dimY0) / UNITS)}
          </text>
        </g>

        {typeof props.children === "function" ? props.children({ mark: font, viewBox }) : props.children}

        <circle className={styles.home} cx={0} cy={0} r={font * 0.28} />
      </svg>

      {props.overlay}

      {props.toolbar && (
        <div className={styles.toolbar} style={toolbarStyle}>
          {props.toolbar}
        </div>
      )}
    </div>
  );
}
