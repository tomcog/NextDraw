import { Segment, SegmentedControl } from "@tomcoggia/ui";
import { Columns2, Image, Layers, Spline } from "lucide-react";
import type { ReactNode } from "react";
import type { Box, Zoom } from "../../shared/components/BedCanvas";
import { InkGroup, InkLayer } from "../../shared/components/Ink";
import { NextDrawCanvas } from "../../shared/components/NextDrawCanvas";
import type { View } from "../../shared/components/PreviewToolbar";
import { DEFAULT_SETTINGS, UNITS } from "../../shared/lib/constants";
import { photoMarks, photoOrigin, type Photo } from "../../shared/lib/drawing/photo";
import type { Page } from "../../shared/lib/drawing/shapes";
import { usePhotoRead } from "../../shared/lib/drawing/usePhotoRead";
import type { PlotterModel } from "../../shared/lib/types";
import styles from "./ConvertStage.module.css";

/**
 * What the stage shows: the picture alone, as it was opened; the lines alone, the drawing with nothing
 * of the photo; the lines over a faded copy of the picture; or the two side by side.
 */
export type ConvertView = "picture" | "lines" | "over" | "side";

/** The tool's ink, as Studio and Plot preview it. */
export interface Ink {
  penWidthMm: number;
  opacity: number;
  build: number;
  builds: boolean;
  opaque: boolean;
}

interface Props {
  /** The layer of the photo being set: its picture. */
  photo: Photo;
  /** Every layer of the photo, bottom first, each in its own pen: all of them are the lines. */
  parts: { photo: Photo; color: string }[];
  /** The photo's box on the page, in inches from the page's corner: its lines are worked out at its size. */
  box: { x0: number; y0: number; x1: number; y1: number };
  page: Page;
  paperColor: string;
  model: PlotterModel | undefined;
  ink: Ink;
  /** The shared views: the lines as Outline or as Preview's ink. */
  view: View;
  onView: (view: View) => void;
  /** Photo's own views: the picture, the lines, both, side by side. */
  show: ConvertView;
  onShow: (show: ConvertView) => void;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  loupe: boolean;
  onLoupe: (on: boolean) => void;
  history: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  disabled?: boolean;
}

/**
 * Image conversion: one photo on the paper, on the shared NextDraw canvas - the bed, the bar, the
 * zooms and the loupe that Studio and Plot show a drawing on. Photo's own views go first in the bar, before
 * the shared ones; side by side, a second canvas follows the first's zoom.
 */
export function ConvertStage({ photo, parts, box, page, paperColor, model, ink, view, onView, show, onShow, zoom, onZoom, loupe, onLoupe, history, disabled }: Props) {
  const read = usePhotoRead(photo.src);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // The page is the paper, at the plotter's home corner - where Studio and Plot put it.
  const settings = { ...DEFAULT_SETTINGS, paper_w: page.w * 25.4, paper_h: page.h * 25.4, paper_x: 0, paper_y: 0, paper_color: paperColor };
  // The "drawing" zoom frames the photo.
  const drawingBox: Box = [box.x0 * UNITS, box.y0 * UNITS, box.x1 * UNITS, box.y1 * UNITS];

  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const picture = (faded?: boolean) => (
    <svg x={box.x0} y={box.y0} width={w} height={h} viewBox={`${c0 * photo.width} ${c1 * photo.height} ${(c2 - c0) * photo.width} ${(c3 - c1) * photo.height}`} preserveAspectRatio="none" opacity={faded ? 0.3 : 1}>
      <image href={photo.src} width={photo.width} height={photo.height} preserveAspectRatio="none" />
    </svg>
  );
  const at = photoOrigin(photo, box.x0, box.y0);
  // The lines as ink, drawn the way Studio draws a drawing's layers: Outline or Preview.
  const lines = (
    <InkGroup sim={view === "preview"} penIn={ink.penWidthMm / 25.4} build={ink.build}>
      <g transform={`translate(${at.x} ${at.y})`}>
        {read && parts.map((part, k) => (
          <InkLayer key={k} color={part.color} sim={view === "preview"} opacity={ink.opacity} build={ink.build} builds={ink.builds} opaque={ink.opaque}>
            {photoMarks(part.photo, w, h)?.passes.map((d, i) => (d ? <path key={i} d={d} fill="none" /> : null))}
          </InkLayer>
        ))}
      </g>
    </InkGroup>
  );

  // Photo's own views, first in the bar, ahead of the shared Outline and Preview.
  const extras = (
    <SegmentedControl size="sm" variant="dark" aria-label="What the stage shows">
      <Segment selected={show === "picture"} onClick={() => onShow("picture")} icon={<Image />} aria-label="Picture" title="Picture: the image as it was opened, with no effect" />
      <Segment selected={show === "lines"} onClick={() => onShow("lines")} icon={<Spline />} aria-label="Lines" title="Lines: the drawing the effect makes, with nothing of the photo" />
      <Segment selected={show === "over"} onClick={() => onShow("over")} icon={<Layers />} aria-label="Lines over picture" title="Lines over picture: the drawing on top of a faded copy of the photo" />
      <Segment selected={show === "side"} onClick={() => onShow("side")} icon={<Columns2 />} aria-label="Side by side" title="Side by side: the picture on the left, the drawing on the right" />
    </SegmentedControl>
  );
  const bar = { view, onView, zoom, onZoom, canDrawing: true, history, disabled, loupe, onLoupe, extras };

  const pane = (body: ReactNode, first: boolean) => (
    <figure className={styles.pane}>
      <NextDrawCanvas bar={first ? bar : undefined} zoom={zoom} loupe={loupe} model={model} settings={settings} drawingBox={drawingBox}>
        {/* Everything here is in the page's inches; the bed counts in UNITS per inch. */}
        <g transform={`scale(${UNITS})`}>{body}</g>
      </NextDrawCanvas>
    </figure>
  );

  return (
    <div className={styles.panes} data-view={show}>
      {show === "picture" && pane(picture(), true)}
      {show === "lines" && pane(lines, true)}
      {show === "over" && pane(<>{picture(true)}{lines}</>, true)}
      {show === "side" && (
        <>
          {pane(picture(), true)}
          {pane(lines, false)}
        </>
      )}
      {!read && <p className={styles.reading}>Reading the photo…</p>}
    </div>
  );
}
