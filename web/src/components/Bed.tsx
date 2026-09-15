import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./Bed.module.css";
import { MM, UNITS } from "../lib/constants";
import { fmtIn } from "../lib/format";
import { maxPlacement, type Footprint } from "../lib/geometry";
import type { Preview } from "../lib/preview";
import type { Carriage, Placement, PlotterModel, Settings } from "../lib/types";

export type Zoom = "plotter" | "paper" | "drawing";

type Box = [number, number, number, number]; // x0, y0, x1, y1 in drawing units

interface Props {
  zoom: Zoom;
  model: PlotterModel | undefined;
  settings: Settings;
  preview: Preview | null;
  footprint: Footprint | null;
  fitsOnBed: boolean;
  fitsOnPaper: boolean;
  placement: Placement;
  onPlacementChange: (p: Placement, persist?: boolean) => void;
  carriage: Carriage | undefined;
  showPenUp: boolean;
  hasFile: boolean;
  draggingFile: boolean;
  canDrag: boolean;
  onOpenBrowser: () => void;
  layerLooks: Record<string, { color: string | null; skipped: boolean; hidden: boolean }> | null; // by layer id; null draws the pen path
}

interface Drag {
  pointerId: number;
  start: DOMPoint;
  startPlacement: Placement;
  ctm: DOMMatrix;
  viewBox: string;
}

// The plotter's drawing area at true scale, with the paper, the drawing where it will plot,
// dimension lines, home and the carriage. The drawing can be dragged to position it.
export function Bed(props: Props) {
  const { model, settings: s, preview, footprint: fp, placement, carriage, showPenUp } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const artRef = useRef<SVGGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // The preview is a parsed SVG node from the NextDraw software; mount it imperatively.
  useLayoutEffect(() => {
    const host = artRef.current;
    if (!host) return;
    host.replaceChildren();
    if (preview) {
      const node = preview.node;
      node.setAttribute("x", "0");
      node.setAttribute("y", "0");
      node.setAttribute("width", String(preview.widthIn * UNITS));
      node.setAttribute("height", String(preview.heightIn * UNITS));
      node.setAttribute("overflow", "hidden");
      host.appendChild(node);
    }
  }, [preview]);

  // Color each artwork layer. Runs after the preview is mounted, and again when colors change.
  const { layerLooks } = props;
  useLayoutEffect(() => {
    if (!preview) return;
    const colored = Boolean(layerLooks && preview.layers > 0);
    preview.node.classList.toggle("pv-colored", colored);
    preview.node.querySelectorAll<SVGGElement>(".pv-layer").forEach((g) => {
      const look = colored ? layerLooks![g.id] : undefined;
      if (look?.color) g.style.setProperty("--layer-color", look.color);
      else g.style.removeProperty("--layer-color");
      g.dataset.skipped = String(Boolean(look?.skipped));
      g.dataset.hidden = String(Boolean(look?.hidden));
    });
  }, [preview, layerLooks]);

  if (!model) return <div className={styles.wrap} />;

  const [tx, ty] = model.travel_in;
  const W = tx * UNITS;
  const H = ty * UNITS;
  const hasPaper = s.paper_w > 0 && s.paper_h > 0;

  const travelBox: Box = [0, 0, W, H];
  const paperBox: Box | null = hasPaper
    ? [s.paper_x * MM, s.paper_y * MM, (s.paper_x + s.paper_w) * MM, (s.paper_y + s.paper_h) * MM]
    : null;
  const drawingBox: Box | null = fp ? [fp.x * UNITS, fp.y * UNITS, (fp.x + fp.w) * UNITS, (fp.y + fp.h) * UNITS] : null;

  // What to frame: the whole plotter (plus the paper and drawing, if they stick out), the paper,
  // or the drawing. The dimension lines measure the same thing (the travel area in the plotter view).
  const zoomBox = props.zoom === "paper" ? paperBox : props.zoom === "drawing" ? drawingBox : null;
  const frame: Box = zoomBox ?? [travelBox, paperBox, drawingBox]
    .filter((b): b is Box => Boolean(b))
    .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const dimBox = zoomBox ?? travelBox;

  const frameW = frame[2] - frame[0];
  const frameH = frame[3] - frame[1];
  const span = Math.max(frameW, frameH);
  const pad = span * 0.075;
  const font = span * 0.024; // sizes the home dot, carriage marker and paper shadow
  // Axis labels: about 15px on screen at a typical preview width (the preview scales with the window).
  const labelFont = span * 0.0156;

  // Keep the plotter's proportions whatever is framed, so the preview never changes height.
  const travelPad = Math.max(W, H) * 0.075;
  // A slim left margin (just room for the side dimension line) gives the preview more width.
  const leftPad = pad * 0.8;
  const aspect = (W + travelPad * 1.1) / (H + travelPad * 1.1);
  const vb = [frame[0] - leftPad, frame[1] - pad, frameW + leftPad + pad * 0.4, frameH + pad * 1.1];
  if (vb[2] / vb[3] < aspect) {
    vb[2] = vb[3] * aspect; // widen to the right, keeping the left edge where it is
  } else {
    const height = vb[2] / aspect;
    vb[1] -= (height - vb[3]) / 2;
    vb[3] = height;
  }
  const viewBox = drag?.viewBox ?? vb.join(" ");

  const dy = frame[1] - pad * 0.45;
  const dx = frame[0] - pad * 0.35;
  const tick = pad * 0.14;
  const [dimX0, dimY0, dimX1, dimY1] = dimBox;
  const dimMidX = (dimX0 + dimX1) / 2;
  const dimMidY = (dimY0 + dimY1) / 2;

  const snap = (mm: number) => {
    const step = s.units === "in" ? 25.4 / 20 : 1; // 0.05 in or 1 mm
    return Math.round(mm / step) * step;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!props.canDrag || !preview || !svgRef.current) return;
    if (!(e.target as Element).closest("[data-drag]")) return;
    e.preventDefault();
    const ctm = svgRef.current.getScreenCTM()!.inverse();
    svgRef.current.setPointerCapture(e.pointerId);
    setDrag({
      pointerId: e.pointerId,
      start: new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm),
      startPlacement: placement,
      ctm,
      viewBox,
    });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(drag.ctm);
    const max = maxPlacement(fp, model);
    props.onPlacementChange({
      x: Math.min(max.x, snap(drag.startPlacement.x + (pt.x - drag.start.x) / MM)),
      y: Math.min(max.y, snap(drag.startPlacement.y + (pt.y - drag.start.y) / MM)),
    }, false);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag(null);
    props.onPlacementChange(placement, true);
  };

  const place = fp ? `translate(${fp.x * UNITS} ${fp.y * UNITS})` : "";
  const artTransform = fp && preview?.widthIn
    ? fp.rotated ? `${place} translate(0 ${preview.widthIn * UNITS}) rotate(-90)` : place
    : undefined;

  return (
    <div className={styles.wrap} data-loaded={props.hasFile} data-dragging-file={props.draggingFile}>
      <svg
        ref={svgRef}
        className={styles.bed}
        viewBox={viewBox}
        role="img"
        aria-label={`Drawing area of the ${model.name}: ${fmtIn(tx)} by ${fmtIn(ty)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect className={styles.travel} x={0} y={0} width={W} height={H} />
        <g className={styles.grid}>
          {Array.from({ length: Math.max(0, Math.ceil(tx) - 1) }, (_, i) => (
            <line key={`x${i}`} x1={(i + 1) * UNITS} y1={1} x2={(i + 1) * UNITS} y2={H - 1} />
          ))}
          {Array.from({ length: Math.max(0, Math.ceil(ty) - 1) }, (_, i) => (
            <line key={`y${i}`} x1={1} y1={(i + 1) * UNITS} x2={W - 1} y2={(i + 1) * UNITS} />
          ))}
        </g>

        {hasPaper && (
          <>
            <rect className={styles.paperShadow} x={s.paper_x * MM + font * 0.18} y={s.paper_y * MM + font * 0.18} width={s.paper_w * MM} height={s.paper_h * MM} />
            <rect className={styles.paper} x={s.paper_x * MM} y={s.paper_y * MM} width={s.paper_w * MM} height={s.paper_h * MM} />
          </>
        )}

        <g className={styles.dim}>
          <line x1={dimX0} y1={dy} x2={dimX1} y2={dy} />
          <line x1={dimX0} y1={dy - tick} x2={dimX0} y2={dy + tick} />
          <line x1={dimX1} y1={dy - tick} x2={dimX1} y2={dy + tick} />
          <text className={styles.axisLabel} x={dimMidX} y={dy - tick * 1.3} textAnchor="middle" fontSize={labelFont}>
            {fmtIn((dimX1 - dimX0) / UNITS)}
          </text>
          <line x1={dx} y1={dimY0} x2={dx} y2={dimY1} />
          <line x1={dx - tick} y1={dimY0} x2={dx + tick} y2={dimY0} />
          <line x1={dx - tick} y1={dimY1} x2={dx + tick} y2={dimY1} />
          <text className={styles.axisLabel} x={dx - tick * 1.3} y={dimMidY} textAnchor="middle" fontSize={labelFont} transform={`rotate(-90 ${dx - tick * 1.3} ${dimMidY})`}>
            {fmtIn((dimY1 - dimY0) / UNITS)}
          </text>
        </g>

        <g className={styles.placed} data-drag="" data-dragging={Boolean(drag)} style={fp ? undefined : { display: "none" }}>
          {fp && <rect className={styles.dragTarget} x={fp.x * UNITS} y={fp.y * UNITS} width={fp.w * UNITS} height={fp.h * UNITS} />}
          <g ref={artRef} transform={artTransform} className={showPenUp ? undefined : "hide-pen-up"} />
          {fp && (
            <rect
              className={styles.sheetEdge}
              data-over={!(props.fitsOnBed && props.fitsOnPaper)}
              x={fp.x * UNITS}
              y={fp.y * UNITS}
              width={fp.w * UNITS}
              height={fp.h * UNITS}
            />
          )}
        </g>

        <circle className={styles.home} cx={0} cy={0} r={font * 0.28} />

        {carriage?.known && (
          <g className={styles.carriage} data-pen-down={carriage.pen_up === false}>
            <line x1={carriage.x * MM - font} y1={carriage.y * MM} x2={carriage.x * MM + font} y2={carriage.y * MM} />
            <line x1={carriage.x * MM} y1={carriage.y * MM - font} x2={carriage.x * MM} y2={carriage.y * MM + font} />
            <circle cx={carriage.x * MM} cy={carriage.y * MM} r={font * 0.55} />
          </g>
        )}
      </svg>

      <button type="button" className={styles.dropzone} onClick={props.onOpenBrowser}>
        <strong>Drop an SVG here</strong>
        <span>or click to open a drawing</span>
      </button>
    </div>
  );
}
