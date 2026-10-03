import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Columns2, Contrast, Layers, Maximize, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { photoMarks, photoMask, type Photo } from "../lib/photo";
import { usePhotoRead } from "../lib/usePhotoRead";
import styles from "./ConvertStage.module.css";

/**
 * How the picture and its lines are laid out to compare them: side by side; the lines over a faded
 * copy of the picture; or what the style sees in the picture - the mask it traces - beside the lines.
 */
export type ConvertView = "side" | "over" | "mask";

interface Props {
  /** The layer of the photo being set: its picture, and what it sees in the mask view. */
  photo: Photo;
  /** Every layer of the photo, bottom first, each in its own pen: all of them are the lines. */
  parts: { photo: Photo; color: string }[];
  /** The photo's box on the page, in inches: its lines are worked out at this size, as on the page. */
  w: number;
  h: number;
  view: ConvertView;
  onView: (view: ConvertView) => void;
  history: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  /** What sits at the right-hand end of the bar: the way to Setup, as over the drawing. */
  toolbar?: ReactNode;
  disabled?: boolean;
}

/** How far in the view can go: far enough to see a pixel of the picture against a line. */
const MOST_ZOOM = 40;

/**
 * Image conversion: one photo on its own, the picture and the lines made from it, to work out how
 * best to turn one into the other. Every pane shows the same part of it at the same size - scroll to
 * zoom where the pointer is, drag to move, double-click to see all of it again - so a line can be
 * held against the picture it came from.
 */
export function ConvertStage({ photo, parts, w, h, view, onView, history, toolbar, disabled }: Props) {
  const read = usePhotoRead(photo.src);
  const mask = read && view === "mask" ? photoMask(photo, w, h) : null;
  // The mask as a picture: what the style finds dark on white, a grid point to a pixel.
  const maskUrl = useMemo(() => {
    if (!mask) return null;
    const canvas = document.createElement("canvas");
    canvas.width = mask.w;
    canvas.height = mask.h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(mask.w, mask.h);
    for (let i = 0; i < mask.seen.length; i++) {
      const v = 255 - mask.seen[i];
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [mask]);

  // What part of the box is in view, shared by every pane: its middle, and how far in.
  const [at, setAt] = useState({ cx: w / 2, cy: h / 2, zoom: 1 });
  const fit = () => setAt({ cx: w / 2, cy: h / 2, zoom: 1 });
  // A new box - another photo, or this one resized - starts from all of it.
  useEffect(fit, [w, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const margin = 1.04;
  const vw = (w * margin) / at.zoom;
  const vh = (h * margin) / at.zoom;
  const viewBox = `${at.cx - vw / 2} ${at.cy - vh / 2} ${vw} ${vh}`;

  const zoomBy = (factor: number, about?: { x: number; y: number }) => setAt((a) => {
    const zoom = Math.min(MOST_ZOOM, Math.max(1, a.zoom * factor));
    const k = a.zoom / zoom;
    // Zooming about a point keeps that point where it is on screen.
    const p = about ?? { x: a.cx, y: a.cy };
    return zoom === 1 ? { cx: w / 2, cy: h / 2, zoom } : { cx: p.x + (a.cx - p.x) * k, cy: p.y + (a.cy - p.y) * k, zoom };
  });

  // The wheel zooms rather than scrolling the page, so it's listened for directly: React's own
  // wheel listener can't stop the page scrolling.
  const panes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panes.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const svg = (e.target as Element).closest("svg[data-pane]") as SVGSVGElement | null;
      if (!svg) return;
      e.preventDefault();
      const m = svg.getScreenCTM();
      const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : undefined;
      zoomBy(Math.exp(-e.deltaY * 0.0015), p ? { x: p.x, y: p.y } : undefined);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Dragging moves the view: by as many inches as the pointer has gone, at the scale the pane is drawn.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; scale: number } | null>(null);
  const paneProps = {
    "data-pane": true,
    viewBox,
    preserveAspectRatio: "xMidYMid meet",
    className: styles.canvas,
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      const scale = e.currentTarget.getScreenCTM()?.a ?? 1;
      drag.current = { x: e.clientX, y: e.clientY, cx: at.cx, cy: at.cy, scale };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d) return;
      setAt((a) => ({ ...a, cx: d.cx - (e.clientX - d.x) / d.scale, cy: d.cy - (e.clientY - d.y) / d.scale }));
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onDoubleClick: fit,
  };

  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const paper = <rect className={styles.paper} width={w} height={h} />;
  const picture = (faded?: boolean) => (
    <svg width={w} height={h} viewBox={`${c0 * photo.width} ${c1 * photo.height} ${(c2 - c0) * photo.width} ${(c3 - c1) * photo.height}`} preserveAspectRatio="none" opacity={faded ? 0.3 : 1}>
      <image href={photo.src} width={photo.width} height={photo.height} preserveAspectRatio="none" />
    </svg>
  );
  const lines = (
    <g className={styles.lines}>
      {read && parts.map((part, k) => (
        <g key={k} stroke={part.color}>
          {photoMarks(part.photo, w, h)?.passes.map((d, i) => (d ? <path key={i} d={d} /> : null))}
        </g>
      ))}
    </g>
  );
  const pane = (label: string, body: ReactNode) => (
    <figure className={styles.pane}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <svg {...paneProps}>
        {paper}
        {body}
      </svg>
    </figure>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.bars}>
        {/* Undo and redo on a bar of their own, as over the drawing. */}
        <Toolbar tone="white" aria-label="History">
          <SegmentedControl size="sm" variant="dark" actions aria-label="History">
            <Segment icon={<Undo2 />} title="Undo the last change" aria-label="Undo" disabled={disabled || !history.canUndo} onClick={history.onUndo} />
            <Segment icon={<Redo2 />} title="Redo the change just undone" aria-label="Redo" disabled={disabled || !history.canRedo} onClick={history.onRedo} />
          </SegmentedControl>
        </Toolbar>
        <Toolbar tone="white" aria-label="Conversion view">
          <SegmentedControl size="sm" variant="dark" aria-label="How the picture and its lines are compared">
            <Segment selected={view === "side"} onClick={() => onView("side")} icon={<Columns2 />} aria-label="Side by side" title="Side by side: the picture, and the lines made from it" />
            <Segment selected={view === "over"} onClick={() => onView("over")} icon={<Layers />} aria-label="Overlay" title="Overlay: the lines over a faded copy of the picture, to see where they stray from it" />
            <Segment selected={view === "mask"} onClick={() => onView("mask")} icon={<Contrast />} aria-label="Mask" title="Mask: what the style sees in the picture - what it traces, dark - beside the lines it makes" />
          </SegmentedControl>
          <SegmentedControl size="sm" variant="dark" actions aria-label="Zoom">
            <Segment icon={<ZoomOut />} title="Zoom out" aria-label="Zoom out" disabled={at.zoom <= 1} onClick={() => zoomBy(1 / 2)} />
            <Segment icon={<Maximize />} title="All of it (or double-click a pane)" aria-label="All of it" disabled={at.zoom === 1} onClick={fit} />
            <Segment icon={<ZoomIn />} title="Zoom in (or scroll over a pane)" aria-label="Zoom in" disabled={at.zoom >= MOST_ZOOM} onClick={() => zoomBy(2)} />
          </SegmentedControl>
        </Toolbar>
        </span>
        {toolbar}
      </div>
      <div ref={panes} className={styles.panes} data-view={view}>
        {view === "side" && (
          <>
            {pane("Picture", picture())}
            {pane("Lines", lines)}
          </>
        )}
        {view === "over" && pane("Lines over the picture", <>{picture(true)}{lines}</>)}
        {view === "mask" && (
          <>
            {pane("What the style sees", maskUrl ? <image href={maskUrl} width={w} height={h} preserveAspectRatio="none" className={styles.mask} /> : null)}
            {pane("Lines", lines)}
          </>
        )}
        {!read && <p className={styles.reading}>Reading the photo…</p>}
      </div>
    </div>
  );
}
