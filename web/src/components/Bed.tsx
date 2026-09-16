import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import styles from "./Bed.module.css";
import { BedCanvas, type Box, type Zoom } from "./BedCanvas";
import { MM, UNITS } from "../lib/constants";
import { maxPlacement, type Footprint } from "../lib/geometry";
import type { Preview } from "../lib/preview";
import { showProgress, type PlotPaths } from "../lib/progressPaths";
import type { Carriage, Placement, PlotterModel, Settings } from "../lib/types";

export type { Zoom };

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
  toolbarLeft?: ReactNode; // the same line, at its left end
  layerLooks: Record<string, { color: string | null; skipped: boolean; hidden: boolean }> | null;
  layerOrder?: string[]; // ids bottom-first: the order they plot, and so the order they stack
  inkOpacity?: number; // how solid the tool's ink is; strokes multiply, so crossings darken
  layerInkOpacity?: Record<string, number | undefined>; // layers drawn with the second tool
  inkBuilds?: boolean; // more of the same ink darkens (a brush); gel ink saturates and adds nothing
  layerInkBuilds?: Record<string, boolean | undefined>;
  inkBuild?: number; // 0-1: how much a second pass of a building ink adds
  inkSim?: boolean; // off: flat color, no blending - much cheaper on a drawing of many thousands of paths
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
  // Ink that builds up gets two passes: the ink itself, drawn solid, and a copy over it that only
  // multiplies. Where two strokes cross, the copy multiplies twice, so the crossing darkens while a
  // single pass doesn't - which is how the build slider can run from nothing to full without the
  // density moving. The copy dims one pass a little too, so the base color is lightened to cancel
  // exactly that. Ink that doesn't build, and no build at all, need neither: solid color, one pass.
  const { inkOpacity, layerInkOpacity, inkBuilds, layerInkBuilds, inkBuild, inkSim, layerLooks } = props;
  useLayoutEffect(() => {
    if (!preview) return;
    const node = preview.node;
    node.classList.toggle("pv-flat", inkSim === false);
    const build = Math.min(1, Math.max(0, inkBuild ?? 1));
    node.style.setProperty("--ink-build-alpha", String(build));
    node.style.setProperty("--ink-opacity", String(inkOpacity && inkOpacity > 0 ? inkOpacity : 1));
    node.dataset.builds = String(inkBuilds !== false);

    // A stroke of this color over one of its own, at this build: what the crossing comes out as.
    const dim = (hex: string, at: number) => {
      const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return parts.map((c) => (1 - at) + at * c);
    };
    const lighten = (hex: string, by: number[]) => {
      const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const out = parts.map((c, i) => Math.round(Math.min(1, c / by[i]) * 255));
      return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };

    node.querySelectorAll<SVGGElement>(".pv-layer").forEach((g) => {
      const o = layerInkOpacity?.[g.id];
      if (o && o > 0) g.style.setProperty("--ink-opacity", String(o));
      else g.style.removeProperty("--ink-opacity");
      const builds = layerInkBuilds?.[g.id];
      const buildsHere = builds === undefined ? inkBuilds !== false : builds;
      g.dataset.builds = String(buildsHere);

      // The second pass, made once and kept in step with the build and the layer's color.
      const wanted = buildsHere && build > 0 && inkSim !== false;
      const existing = g.querySelector<SVGGElement>(":scope > .pv-build");
      if (!wanted) {
        existing?.remove();
        const color = layerLooks?.[g.id]?.color;
        if (color) g.style.setProperty("--layer-color", color);
        return;
      }
      if (!existing) {
        const copy = document.createElementNS("http://www.w3.org/2000/svg", "g");
        copy.setAttribute("class", "pv-build");
        for (const child of [...g.children]) copy.appendChild(child.cloneNode(true));
        copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
        g.appendChild(copy);
      }
      const color = layerLooks?.[g.id]?.color;
      if (color) {
        const factor = dim(color, build);
        g.style.setProperty("--layer-color", lighten(color, factor)); // the base, pre-dimmed
        g.querySelector<SVGGElement>(":scope > .pv-build")?.style.setProperty("--layer-color", color);
      }
    });
  }, [preview, inkOpacity, layerInkOpacity, inkBuilds, layerInkBuilds, inkBuild, inkSim, layerLooks]);

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
  // The color itself is set by the ink effect above, which may lighten it to pay for a build pass.
  useLayoutEffect(() => {
    if (!preview) return;
    const colored = Boolean(layerLooks && preview.layers > 0);
    preview.node.classList.toggle("pv-colored", colored);
    preview.node.querySelectorAll<SVGGElement>(".pv-layer").forEach((g) => {
      const look = colored ? layerLooks![g.id] : undefined;
      if (!look?.color) g.style.removeProperty("--layer-color");
      g.dataset.skipped = String(Boolean(look?.skipped));
      g.dataset.hidden = String(Boolean(look?.hidden));
    });
  }, [preview, layerLooks]);

  // The frame, the paper, the grid, the dimension lines and home are BedCanvas's - shared with
  // Studio so the two previews cannot drift apart. What's left here is Plot's own: the drawing where
  // it will plot, the carriage, the plot in progress and dragging the drawing into place.
  const drawingBox: Box | null = fp
    ? [fp.x * UNITS, fp.y * UNITS, (fp.x + fp.w) * UNITS, (fp.y + fp.h) * UNITS]
    : null;

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
      // Freeze the view for the length of the drag, so the frame doesn't chase the drawing while
      // it's being moved. BedCanvas is showing it, so read it back off the element.
      viewBox: svgRef.current.getAttribute("viewBox") ?? "",
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
    <BedCanvas
      zoom={props.zoom}
      model={model}
      settings={s}
      drawingBox={drawingBox}
      viewBoxOverride={drag?.viewBox}
      svgRef={svgRef}
      wrapClassName={styles.bedWrap}
      wrapData={{ "data-loaded": props.hasFile, "data-dragging-file": props.draggingFile }}
      toolbar={props.toolbar}
      toolbarLeft={props.toolbarLeft}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      overlay={
        <button type="button" className={styles.dropzone} onClick={props.onOpenBrowser}>
          <strong>Drop an SVG here</strong>
          <span>or click to open a drawing</span>
        </button>
      }
    >
      {({ mark: carriageSize }) => (<>
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

      {carriage?.known && (
        <g className={styles.carriage} data-pen-down={carriage.pen_up === false}>
          <line x1={carriage.x * MM - carriageSize} y1={carriage.y * MM} x2={carriage.x * MM + carriageSize} y2={carriage.y * MM} />
          <line x1={carriage.x * MM} y1={carriage.y * MM - carriageSize} x2={carriage.x * MM} y2={carriage.y * MM + carriageSize} />
          <circle cx={carriage.x * MM} cy={carriage.y * MM} r={carriageSize * 0.55} />
        </g>
      )}
      </>)}
    </BedCanvas>
  );
}
