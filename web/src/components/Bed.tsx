import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import styles from "./Bed.module.css";
import { MM, UNITS } from "../lib/constants";
import { fmtIn } from "../lib/format";
import { maxPlacement, type Footprint } from "../lib/geometry";
import type { Preview } from "../lib/preview";
import { showProgress, type PlotPaths } from "../lib/progressPaths";
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
  hairlines?: boolean; // every path as a thin line, ignoring the pen's width: the Layers card's Plot mode
  hasFile: boolean;
  draggingFile: boolean;
  canDrag: boolean;
  onOpenBrowser: () => void;
  toolbar?: ReactNode; // sits on the width dimension line, at its right end
  layerLooks: Record<string, { color: string | null; skipped: boolean; hidden: boolean }> | null;
  layerOrder?: string[]; // ids bottom-first: the order they plot, and so the order they stack
  inkOpacity?: number; // how solid the tool's ink is; strokes multiply, so crossings darken
  layerInkOpacity?: Record<string, number | undefined>; // layers drawn with the second tool
  penWidthMm?: number; // draw lines at the pen's real width; undefined keeps a hairline
  plotPaths?: PlotPaths | null; // show the plot in progress, drawn and left to draw, instead of the preview
  plotFraction?: number; // how much of it is drawn, 0-1
  layerPenWidths?: Record<string, number | undefined>; // per layer id, when layers use different tools // by layer id; null draws the pen path
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
  const progressRef = useRef<SVGGElement>(null);
  const { plotPaths, plotFraction = 0 } = props;

  useLayoutEffect(() => {
    const host = progressRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!plotPaths) return;
    const { node, widthIn, heightIn } = plotPaths.preview;
    node.setAttribute("x", "0");
    node.setAttribute("y", "0");
    node.setAttribute("width", String(widthIn * UNITS));
    node.setAttribute("height", String(heightIn * UNITS));
    node.setAttribute("overflow", "visible");
    host.appendChild(node);
  }, [plotPaths]);
  useLayoutEffect(() => {
    plotPaths?.preview.node.classList.toggle("pv-hairline", Boolean(props.hairlines));
  }, [plotPaths, props.hairlines]);

  useLayoutEffect(() => {
    if (plotPaths) showProgress(plotPaths, plotFraction);
  }, [plotPaths, plotFraction]);
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

  // True line width: the pen's width converted to the preview drawing's own units.
  const { penWidthMm, layerPenWidths, hairlines } = props;
  useLayoutEffect(() => {
    if (!preview) return;
    const node = preview.node;
    const layerWidths = Object.values(layerPenWidths ?? {}).filter((w): w is number => Boolean(w && w > 0));
    const on = !hairlines && (Boolean(penWidthMm && penWidthMm > 0) || layerWidths.length > 0);
    node.classList.toggle("pv-hairline", Boolean(hairlines));
    node.classList.toggle("pv-true-width", on);
    if (!on) return;
    const box = node.viewBox?.baseVal;
    const unitsPerInch = box && box.width > 0 ? box.width / preview.widthIn : UNITS;
    const width = penWidthMm && penWidthMm > 0 ? penWidthMm : layerWidths[0];
    node.style.setProperty("--pen-art", String((width / 25.4) * unitsPerInch));
    node.style.setProperty("--pen-in", String(width / 25.4));
    // Layers drawn with a different tool get their own width.
    node.querySelectorAll<SVGGElement>(".pv-layer").forEach((g) => {
      const w = layerPenWidths?.[g.id];
      if (w && w > 0) g.style.setProperty("--pen-art", String((w / 25.4) * unitsPerInch));
      else g.style.removeProperty("--pen-art");
    });
  }, [preview, penWidthMm, layerPenWidths, hairlines]);

  // How solid the ink is. The strokes multiply where they cross, so overlaps darken the way ink
  // does on paper, whatever transparency the file itself was exported with.
  const { inkOpacity, layerInkOpacity } = props;
  useLayoutEffect(() => {
    if (!preview) return;
    const node = preview.node;
    node.style.setProperty("--ink-opacity", String(inkOpacity && inkOpacity > 0 ? inkOpacity : 1));
    node.querySelectorAll<SVGGElement>(".pv-layer").forEach((g) => {
      const o = layerInkOpacity?.[g.id];
      if (o && o > 0) g.style.setProperty("--ink-opacity", String(o));
      else g.style.removeProperty("--ink-opacity");
    });
  }, [preview, inkOpacity, layerInkOpacity]);

  // Stack the artwork layers the way they'll be plotted: the first layer at the bottom, later ones
  // over it. Reordering the Layers card moves them here too, so the preview shows what opaque ink
  // will actually cover.
  const { layerOrder } = props;
  useLayoutEffect(() => {
    if (!preview || !layerOrder?.length) return;
    const groups = new Map([...preview.node.querySelectorAll<SVGGElement>(".pv-layer")].map((g) => [g.id, g]));
    for (const id of layerOrder) {
      const g = groups.get(id);
      if (g) g.parentNode?.appendChild(g); // last appended draws on top
    }
  }, [preview, layerOrder]);

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
  const font = span * 0.024; // sizes the home dot, carriage marker and paper shadow

  // Margins around what's framed, in pads (7.5% of its longer side): a slim left one with just room
  // for the side dimension line, and a top one with just room for the width line and its label.
  const LEFT = 0.8;
  const TOP = 0.7;
  const fit = (box: Box) => {
    const pad = Math.max(box[2] - box[0], box[3] - box[1]) * 0.075;
    return {
      pad,
      vb: [box[0] - pad * LEFT, box[1] - pad * TOP, box[2] - box[0] + pad * (LEFT + 0.4), box[3] - box[1] + pad * (TOP + 0.1)],
    };
  };
  // The plotter view. Every zoom keeps its proportions, so the preview never changes height, and the
  // dimension lines, their labels and the toolbar keep its positions on screen, so nothing shifts.
  const base = fit(travelBox);
  const aspect = base.vb[2] / base.vb[3];
  const { vb } = fit(frame);
  if (vb[2] / vb[3] < aspect) {
    vb[2] = vb[3] * aspect; // widen to the right, keeping the left edge where it is
  } else {
    const height = vb[2] / aspect;
    vb[1] -= (height - vb[3]) / 2;
    vb[3] = height;
  }
  const viewBox = drag?.viewBox ?? vb.join(" ");

  // Where the dimension lines sit in the plotter view, carried into this view at the same screen spot.
  const [vx, vy, vw] = viewBox.split(" ").map(Number);
  const k = vw / base.vb[2]; // this view's units per plotter-view unit
  const baseDy = -base.pad * 0.3;
  const baseDx = -base.pad * 0.35;
  const dy = vy + (baseDy - base.vb[1]) * k;
  const dx = vx + (baseDx - base.vb[0]) * k;
  const tick = base.pad * 0.14 * k;
  // Axis labels: about 15px on screen at a typical preview width (the preview scales with the window).
  const labelFont = Math.max(W, H) * 0.0156 * k;
  const [dimX0, dimY0, dimX1, dimY1] = dimBox;
  const dimMidX = (dimX0 + dimX1) / 2;
  const dimMidY = (dimY0 + dimY1) / 2;
  // The toolbar is HTML over the SVG, placed in percentages of the plotter view so it never moves.
  const toolbarStyle = {
    "--toolbar-top": `${((baseDy - base.vb[1]) / base.vb[3]) * 100}%`,
    "--toolbar-right": `${((base.vb[0] + base.vb[2] - W) / base.vb[2]) * 100}%`,
  } as CSSProperties;

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
    <div className={styles.wrap} style={{ "--bed-aspect": aspect } as CSSProperties} data-loaded={props.hasFile} data-dragging-file={props.draggingFile}>
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
            <rect className={styles.paper} style={{ fill: s.paper_color || "#ffffff" }} x={s.paper_x * MM} y={s.paper_y * MM} width={s.paper_w * MM} height={s.paper_h * MM} />
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
          <g ref={artRef} transform={artTransform} className={showPenUp ? undefined : "hide-pen-up"} style={plotPaths ? { display: "none" } : undefined} />
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

        <g
          ref={progressRef}
          className="pv-progress"
          transform={plotPaths ? `translate(${plotPaths.xMm * MM} ${plotPaths.yMm * MM})` : undefined}
          style={plotPaths ? undefined : { display: "none" }}
        />

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

      {props.toolbar && (
        <div className={styles.toolbar} style={toolbarStyle}>
          {props.toolbar}
        </div>
      )}
    </div>
  );
}
