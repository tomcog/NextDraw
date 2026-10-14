import { Segment, SegmentedControl } from "@tomcoggia/ui";
import { Columns2, Image, Layers, Spline } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { Box, Zoom } from "../../shared/components/BedCanvas";
import { InkGroup, InkLayer } from "../../shared/components/Ink";
import { NextDrawCanvas } from "../../shared/components/NextDrawCanvas";
import type { View } from "../../shared/components/PreviewToolbar";
import { DEFAULT_SETTINGS, UNITS } from "../../shared/lib/constants";
import { channelAdjusted, photoMarks, photoOrigin, pictureOf, type Photo } from "../../shared/lib/drawing/photo";
import type { Page } from "../../shared/lib/drawing/shapes";
import { usePhotoRead } from "../../shared/lib/drawing/usePhotoRead";
import type { PlotterModel } from "../../shared/lib/types";
import styles from "./ConvertStage.module.css";

/**
 * What the stage shows: the picture alone, as it was opened; the lines alone, the drawing with nothing
 * of the photo; the lines over a faded copy of the picture; or the two side by side.
 */
export type ConvertView = "picture" | "lines" | "over" | "side";

/** A hex color as sRGB 0 to 1. */
const rgbOf = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
};

/** The tool's ink, as Studio and Plot preview it. */
export interface Ink {
  penWidthMm: number;
  opacity: number;
  build: number;
  builds: boolean;
  /** The pen's preset says its ink covers what's under it. Only then is it drawn so. */
  opaque: boolean;
  /** No pen preset is chosen ("None"): nothing is known of the ink. */
  noPreset?: boolean;
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
}

/**
 * Image conversion: one photo on the paper, on the shared NextDraw canvas - the bed, the bar, the
 * zooms and the loupe that Studio and Plot show a drawing on. Photo's own views go first in the bar, before
 * the shared ones; side by side, a second canvas follows the first's zoom.
 */
export function ConvertStage({ photo, parts, box, page, paperColor, model, ink, view, onView, show, onShow, zoom, onZoom, loupe, onLoupe }: Props) {
  const read = usePhotoRead(photo.src);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // The page is the paper, at the plotter's home corner - where Studio and Plot put it.
  const settings = { ...DEFAULT_SETTINGS, paper_w: page.w * 25.4, paper_h: page.h * 25.4, paper_x: 0, paper_y: 0, paper_color: paperColor };
  // The "drawing" zoom frames the photo.
  const drawingBox: Box = [box.x0 * UNITS, box.y0 * UNITS, box.x1 * UNITS, box.y1 * UNITS];

  // The picture as the lines see it: brightness and contrast applied as the photo is read for them
  // (each channel stretched about middle grey by the contrast, then lifted by the brightness).
  const adjustId = `adjust-${useId().replace(/[^\w-]/g, "")}`;
  const plate = (shown: Photo, id: string, tint?: string) => {
    // A separation's own brightness and contrast, then the whole image's, as its lines see them.
    const p = channelAdjusted(shown);
    const [c0, c1, c2, c3] = p.crop ?? [0, 0, 1, 1];
    const c = Math.max(-99, Math.min(99, p.contrast)) / 100;
    const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
    const shift = 0.5 - 0.5 * gain + p.brightness / 200;
    const saturate = 1 + (p.saturation ?? 0) / 100;
    const adjusted = p.brightness !== 0 || p.contrast !== 0 || saturate !== 1;
    const ink = tint ? rgbOf(tint) : null;
    // A profile's ink is its share of the photo, worked out a moment after it's asked for.
    const href = pictureOf(shown);
    if (!href) return null;
    return (
      <svg x={box.x0} y={box.y0} width={w} height={h} viewBox={`${c0 * p.width} ${c1 * p.height} ${(c2 - c0) * p.width} ${(c3 - c1) * p.height}`} preserveAspectRatio="none">
        {(adjusted || ink) && (
          <filter id={id} colorInterpolationFilters="sRGB">
            {/* Saturation first, about each pixel's own grey, as the photo is read for the lines. */}
            {saturate !== 1 && <feColorMatrix type="saturate" values={String(saturate)} />}
            <feComponentTransfer>
              <feFuncR type="linear" slope={gain} intercept={shift} />
              <feFuncG type="linear" slope={gain} intercept={shift} />
              <feFuncB type="linear" slope={gain} intercept={shift} />
            </feComponentTransfer>
            {/* A plate in its ink: white paper where it's white, all of the ink where it's black. */}
            {ink && (
              <feComponentTransfer>
                <feFuncR type="linear" slope={1 - ink[0]} intercept={ink[0]} />
                <feFuncG type="linear" slope={1 - ink[1]} intercept={ink[1]} />
                <feFuncB type="linear" slope={1 - ink[2]} intercept={ink[2]} />
              </feComponentTransfer>
            )}
          </filter>
        )}
        <image href={href} width={p.width} height={p.height} preserveAspectRatio="none" filter={adjusted || ink ? `url(#${id})` : undefined} />
      </svg>
    );
  };
  // Separations are seen together, as they'll print: each plate in its layer's ink, multiplied over
  // the paper and the others, as inks laid on paper are. A hidden layer drops out, as from the lines.
  // A pass over a plate draws from the same picture: each plate once. A profile's inks share the
  // photo's picture, and are told apart by which ink they are.
  const plateOf = (p: Photo) => `${p.src.length}|${p.src.slice(-48)}|${p.profile ?? ""}|${p.profileInk ?? ""}|${p.profileIntent ?? ""}`;
  const plates = photo.separation
    ? parts.filter((part, i) => part.photo.separation && parts.findIndex((o) => plateOf(o.photo) === plateOf(part.photo)) === i)
    : [];
  const picture = (faded?: boolean) => (
    <g opacity={faded ? 0.3 : 1}>
      {photo.separation
        ? plates.map((part, i) => (
            <g key={i} style={{ mixBlendMode: "multiply" }}>{plate(part.photo, `${adjustId}-${i}`, part.color)}</g>
          ))
        : plate(photo, adjustId)}
    </g>
  );
  const at = photoOrigin(photo, box.x0, box.y0);
  // The lines as ink, drawn the way Studio draws a drawing's layers: Outline or Preview.
  const lines = (
    <InkGroup sim={view === "preview"} penIn={ink.penWidthMm / 25.4} build={ink.build}>
      <g transform={`translate(${at.x} ${at.y})`}>
        {read && parts.map((part, k) => (
          // Ink is see-through unless the pen's preset says it's opaque (Tom, 2026-10-11): laid on the
          // paper it multiplies, so on black paper a translucent ink is simply black. With no preset,
          // a split around the paper's layers are taken as opaque - white and grays on gray are
          // nothing else, and there's no pen to ask.
          <InkLayer key={k} color={part.color} sim={view === "preview"} opacity={ink.opacity} build={ink.build} builds={ink.builds} opaque={ink.opaque || (Boolean(ink.noPreset) && Boolean(part.photo.side))}>
            {photoMarks(part.photo, w, h)?.passes.map((d, i) => (d ? <path key={i} d={d} fill="none" /> : null))}
          </InkLayer>
        ))}
      </g>
    </InkGroup>
  );

  // Photo's own views, first in the bar, ahead of the shared Outline and Preview.
  const extras = (
    <SegmentedControl size="sm" variant="dark" aria-label="What the stage shows">
      <Segment selected={show === "picture"} onClick={() => onShow("picture")} icon={<Image />} aria-label="Picture" title={photo.separation ? "Picture: the separations together, each in its ink, with no effect" : "Picture: the image as it was opened, with no effect"} />
      <Segment selected={show === "lines"} onClick={() => onShow("lines")} icon={<Spline />} aria-label="Lines" title="Lines: the drawing the effect makes, with nothing of the image" />
      <Segment selected={show === "over"} onClick={() => onShow("over")} icon={<Layers />} aria-label="Lines over picture" title="Lines over picture: the drawing on top of a faded copy of the image" />
      <Segment selected={show === "side"} onClick={() => onShow("side")} icon={<Columns2 />} aria-label="Side by side" title="Side by side: the picture on the left, the drawing on the right" />
    </SegmentedControl>
  );
  const bar = { view, onView, zoom, onZoom, canDrawing: true, loupe, onLoupe, extras };

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
      {!read && <p className={styles.reading}>Reading the image…</p>}
    </div>
  );
}
