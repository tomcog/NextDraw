import { Segment, SegmentedControl } from "@tomcoggia/ui";
import { Columns2, Image, Spline } from "lucide-react";
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Box, Zoom } from "../../shared/components/BedCanvas";
import { InkGroup, InkLayer } from "../../shared/components/Ink";
import { boxTransform, KnockoutFrame, KnockoutMask, KnockoutShapes } from "../../shared/components/Knockout";
import { knockoutGapIn } from "../../shared/lib/drawing/knockout";
import { NextDrawCanvas } from "../../shared/components/NextDrawCanvas";
import type { View } from "../../shared/components/PreviewToolbar";
import { DEFAULT_SETTINGS, UNITS } from "../../shared/lib/constants";
import { channelAdjusted, flattenedPicture, photoMarks, photoOrigin, pictureOf, type Photo } from "../../shared/lib/drawing/photo";
import type { Page } from "../../shared/lib/drawing/shapes";
import { vignetteKey, vignetteOn, vignetteStrength, type Vignette } from "../../shared/lib/drawing/vignette";
import { usePhotoRead } from "../../shared/lib/drawing/usePhotoRead";
import type { PlotterModel } from "../../shared/lib/types";
import styles from "./ConvertStage.module.css";

/**
 * What the stage shows: the picture alone, as it was opened; the lines alone, the drawing with nothing
 * of the photo; or the two side by side. (Lines over a faded picture was one of these until Tom took
 * it out, 2026-11-23: side by side says the same thing without the drawing fighting the photo.)
 */
export type ConvertView = "picture" | "lines" | "side";

/** A hex color as sRGB 0 to 1. */
const rgbOf = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
};

const vignetteImages = new Map<string, string>();

/**
 * A vignette as a picture to lay over the image's: black, or white for a lightening one, as opaque as
 * the vignette is strong there - which over the image is just what the lines read. Small: it's soft.
 */
function vignetteImage(v: Vignette, w: number, h: number): string {
  const long = 320;
  const gw = Math.max(2, Math.round((long * w) / Math.max(w, h)));
  const gh = Math.max(2, Math.round((long * h) / Math.max(w, h)));
  const key = `${vignetteKey(v)}|${gw}x${gh}`;
  const known = vignetteImages.get(key);
  if (known) return known;
  const strength = vignetteStrength(v, gw, gh);
  const tone = v.amount > 0 ? 0 : 255;
  const rgba = new Uint8ClampedArray(gw * gh * 4);
  for (let i = 0; i < strength.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = tone;
    rgba[i * 4 + 3] = Math.round(strength[i] * 255);
  }
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, gw, gh), 0, 0);
  const url = canvas.toDataURL("image/png");
  if (vignetteImages.size > 8) vignetteImages.delete(vignetteImages.keys().next().value!);
  vignetteImages.set(key, url);
  return url;
}

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
  /** The photo's box on the artboard, in inches from the page's corner: its lines are worked out at its size. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The artboard: the drawing's own size, which is the artboard the picture sits on (2026-11-23). */
  artboard: Page;
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
  /** The drawing's other layers - an effect baked before, paths drawn in Studio - bottom first, each its
   *  paths' data in inches on the artboard and its ink: drawn under the image's lines. */
  others?: { color: string; d: string[] }[];
  /** The image dragged on the stage this far, in inches: picked up anywhere on it. */
  onMove?: (dx: number, dy: number) => void;
  /** The Knockout layer, if it's showing: its outlines as path data in inches on the artboard, and the box
   *  round them. Every line under it is hidden, as it's left out of the file. `onPlace`, when it can be
   *  moved: the box it's been dragged or sized to, once, when it's let go. */
  knockout?: { paths: string[]; box: { x0: number; y0: number; x1: number; y1: number }; onPlace?: (box: { x0: number; y0: number; x1: number; y1: number }) => void;
    /** Its layer is the one being set: its frame and corners show. Otherwise, in Preview, only the paper
     *  showing through is shown - though it's still picked up by its letters. */
    active?: boolean;
    /** Picked up, or let go for the picture. */
    onActive?: (active: boolean) => void };
  /** Cropping: the part of the whole picture kept - left, top, right, bottom, as fractions - set by dragging. */
  cropping?: { part: Part; onPart: (part: Part) => void };
}

type Part = [number, number, number, number];

/**
 * Image conversion: one photo on the paper, on the shared NextDraw canvas - the bed, the bar, the
 * zooms and the loupe that Studio and Plot show a drawing on. Photo's own views go first in the bar, before
 * the shared ones; side by side, a second canvas follows the first's zoom.
 */
export function ConvertStage({ photo, parts, box, artboard, paperColor, model, ink, view, onView, show, onShow, zoom, onZoom, loupe, onLoupe, cropping, others = [], onMove, knockout }: Props) {
  const read = usePhotoRead(photo.src);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // The artboard is the paper, at the plotter's home corner - where Studio and Plot put it.
  const settings = { ...DEFAULT_SETTINGS, paper_w: artboard.w * 25.4, paper_h: artboard.h * 25.4, paper_x: 0, paper_y: 0, paper_color: paperColor };
  // The "drawing" zoom frames the photo.
  const drawingBox: Box = [box.x0 * UNITS, box.y0 * UNITS, box.x1 * UNITS, box.y1 * UNITS];

  // The picture as the lines see it: brightness and contrast applied as the photo is read for them
  // (each channel stretched about middle grey by the contrast, then lifted by the brightness).
  const adjustId = `adjust-${useId().replace(/[^\w-]/g, "")}`;
  // Where the whole picture lies on the artboard: the part of it that shows fills the box.
  const [v0, v1, v2, v3] = photo.crop ?? [0, 0, 1, 1];
  const fullW = w / (v2 - v0), fullH = h / (v3 - v1);
  const full = { x0: box.x0 - v0 * fullW, y0: box.y0 - v1 * fullH, x1: box.x0 - v0 * fullW + fullW, y1: box.y0 - v1 * fullH + fullH };
  // `whole`: all of the picture, where it lies - what's cropped from, shown while cropping.
  const plate = (shown: Photo, id: string, tint?: string, whole = false) => {
    // A separation's own brightness and contrast, then the whole image's, as its lines see them.
    const p = channelAdjusted(shown);
    const [c0, c1, c2, c3] = whole ? [0, 0, 1, 1] : p.crop ?? [0, 0, 1, 1];
    const at = whole ? full : box;
    const c = Math.max(-99, Math.min(99, p.contrast)) / 100;
    const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
    const shift = 0.5 - 0.5 * gain + p.brightness / 200;
    // Flattened, the picture shown is the flattened one - what the lines are reading - rather than
    // the image it was made from (Tom, 2026-11-23). Its saturation and its vignette are already in
    // those pixels, so neither is applied again here; brightness and contrast still are, since
    // flattening happens before them. Not for a profile's ink, whose picture is its own share of the
    // photo; and the image as it was opened until it has been read, rather than nothing.
    const flat = !p.profile ? flattenedPicture(p) : undefined;
    const saturate = flat ? 1 : 1 + (p.saturation ?? 0) / 100;
    // The vignette goes on before brightness and contrast, as it does for the lines.
    const vignette = !flat && vignetteOn(p.vignette) ? p.vignette : null;
    const adjusted = p.brightness !== 0 || p.contrast !== 0 || saturate !== 1;
    const ink = tint ? rgbOf(tint) : null;
    // A profile's ink is its share of the photo, worked out a moment after it's asked for.
    const href = flat ?? pictureOf(shown);
    if (!href) return null;
    return (
      <svg x={at.x0} y={at.y0} width={at.x1 - at.x0} height={at.y1 - at.y0} viewBox={`${c0 * p.width} ${c1 * p.height} ${(c2 - c0) * p.width} ${(c3 - c1) * p.height}`} preserveAspectRatio="none">
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
        <g filter={adjusted || ink ? `url(#${id})` : undefined}>
          <image href={href} width={p.width} height={p.height} preserveAspectRatio="none" />
          {vignette && (
            <image href={vignetteImage(vignette, (c2 - c0) * p.width, (c3 - c1) * p.height)} x={c0 * p.width} y={c1 * p.height} width={(c2 - c0) * p.width} height={(c3 - c1) * p.height} preserveAspectRatio="none" />
          )}
        </g>
      </svg>
    );
  };
  // Separations are seen together, as they'll print: each plate in its layer's ink, multiplied over
  // the paper and the others, as inks laid on paper are. A hidden layer drops out, as from the lines.
  // A pass over a plate draws from the same picture: each plate once. A profile's inks share the
  // photo's picture, and are told apart by which ink they are.
  const plateOf = (p: Photo) => `${p.src.length}|${p.src.slice(-48)}|${p.profile ?? ""}|${p.profileInk ?? ""}|${p.profileIntent ?? ""}|${p.profileBpc ? "b" : ""}`;
  const plates = photo.separation
    ? parts.filter((part, i) => part.photo.separation && parts.findIndex((o) => plateOf(o.photo) === plateOf(part.photo)) === i)
    : [];
  // While the image is dragged, how far it's gone so far: the picture and its lines follow, in every pane.
  const [by, setBy] = useState<{ x: number; y: number } | null>(null);
  const moved = by ? `translate(${by.x} ${by.y})` : undefined;
  const picture = (whole = false) => (
    <g transform={whole ? undefined : moved}>
      {photo.separation
        ? plates.map((part, i) => (
            <g key={i} style={{ mixBlendMode: "multiply" }}>{plate(part.photo, `${adjustId}-${i}`, part.color, whole)}</g>
          ))
        : plate(photo, adjustId, undefined, whole)}
    </g>
  );
  const at = photoOrigin(photo, box.x0, box.y0);
  // The knockout, while its frame is dragged: where it's going, which the mask and its guide follow.
  const [knockoutDraft, setKnockoutDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const knockoutAt = knockout && knockoutDraft ? boxTransform(knockout.box, knockoutDraft) : undefined;
  const knockoutId = `knockout-${useId().replace(/[^\w-]/g, "")}`;
  const knockoutGuide = (mark: number) => knockout && (
    <>
      {(view !== "preview" || knockout.active || knockoutDraft) && <KnockoutShapes paths={knockout.paths} transform={knockoutAt} />}
      {knockout.onPlace && (
        <KnockoutFrame
          box={knockout.box}
          paths={knockout.paths}
          active={Boolean(knockout.active)}
          onActivate={() => knockout.onActive?.(true)}
          draft={knockoutDraft}
          onDraft={setKnockoutDraft}
          onPlace={knockout.onPlace}
          r={(mark * 0.28) / UNITS}
        />
      )}
    </>
  );
  // The lines as ink, drawn the way Studio draws a drawing's layers: Outline or Preview.
  const lines = (
    <g mask={knockout ? `url(#${knockoutId})` : undefined}>
    {knockout && <KnockoutMask id={knockoutId} paths={knockout.paths} gap={knockoutGapIn()} transform={knockoutAt} />}
    <InkGroup sim={view === "preview"} penIn={ink.penWidthMm / 25.4} build={ink.build}>
      {/* What's under the image on the artboard: earlier effects baked into layers, and the rest. */}
      {others.map((o, k) => (
        <InkLayer key={`o${k}`} color={o.color} sim={view === "preview"} opacity={ink.opacity} build={ink.build} builds={ink.builds} opaque={ink.opaque}>
          {o.d.map((d, i) => <path key={i} d={d} fill="none" />)}
        </InkLayer>
      ))}
      <g transform={`${moved ?? ""} translate(${at.x} ${at.y})`}>
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
    </g>
  );

  // Photo's own views, first in the bar, ahead of the shared Outline and Preview.
  const extras = (
    <SegmentedControl size="sm" variant="dark" aria-label="What the stage shows">
      <Segment selected={show === "picture"} onClick={() => onShow("picture")} icon={<Image />} aria-label="Picture" title={photo.separation ? "Picture: the separations together, each in its ink, with no effect" : "Picture: the image as it was opened, with no effect"} />
      <Segment selected={show === "lines"} onClick={() => onShow("lines")} icon={<Spline />} aria-label="Lines" title="Lines: the drawing the effect makes, with nothing of the image" />
      <Segment selected={show === "side"} onClick={() => onShow("side")} icon={<Columns2 />} aria-label="Side by side" title="Side by side: the picture on the left, the drawing on the right" />
    </SegmentedControl>
  );
  const bar = { view, onView, zoom, onZoom, ground: "artboard" as const, canDrawing: true, loupe, onLoupe, extras };

  // The image to pick up and drag. Pressing the picture lets go of the knockout, as picking any
  // other layer does.
  const leaveKnockout = knockout?.active ? () => knockout.onActive?.(false) : undefined;
  const grab = onMove ? <PictureGrab box={box} by={by} onBy={setBy} onMove={onMove} onPress={leaveKnockout} /> : null;

  const pane = (body: ReactNode | ((mark: number) => ReactNode), first: boolean) => (
    <figure className={styles.pane}>
      <NextDrawCanvas bar={first ? bar : undefined} zoom={zoom} loupe={loupe} model={model} settings={settings} drawingBox={drawingBox} artboard={artboard} ground="artboard">
        {/* Everything here is in the page's inches; the bed counts in UNITS per inch. */}
        {({ mark }) => <g transform={`scale(${UNITS})`}>{typeof body === "function" ? body(mark) : body}</g>}
      </NextDrawCanvas>
    </figure>
  );

  // Cropping: the whole picture, in one pane, with the part kept to drag.
  if (cropping) {
    return (
      <div className={styles.panes} data-view="picture">
        {pane((mark) => (
          <>
            {picture(true)}
            <CropFrame full={full} part={cropping.part} onPart={cropping.onPart} r={(mark * 0.28) / UNITS} />
          </>
        ), true)}
        {!read && <p className={styles.reading}>Reading the image…</p>}
      </div>
    );
  }

  return (
    <div className={styles.panes} data-view={show}>
      {show === "picture" && pane((mark) => <>{picture()}{grab}{knockoutGuide(mark)}</>, true)}
      {show === "lines" && pane((mark) => <>{lines}{grab}{knockoutGuide(mark)}</>, true)}
      {show === "side" && (
        <>
          {pane((mark) => <>{picture()}{grab}{knockoutGuide(mark)}</>, true)}
          {pane((mark) => <>{lines}{grab}{knockoutGuide(mark)}</>, false)}
        </>
      )}
      {!read && <p className={styles.reading}>Reading the image…</p>}
    </div>
  );
}

/**
 * The image's grip: its box, invisible, to pick it up by and drag. The way gone is shown as it's dragged
 * and the image moved there when it's let go - one change.
 */
function PictureGrab({ box, by, onBy, onMove, onPress }: {
  onPress?: () => void;
  box: { x0: number; y0: number; x1: number; y1: number };
  by: { x: number; y: number } | null;
  onBy: (by: { x: number; y: number } | null) => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const from = useRef<{ id: number; ctm: DOMMatrix; x: number; y: number } | null>(null);
  const at = (e: ReactPointerEvent, ctm: DOMMatrix) => new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
  const down = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onPress?.();
    const ctm = e.currentTarget.getScreenCTM()?.inverse();
    if (!ctm) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e, ctm);
    from.current = { id: e.pointerId, ctm, x: p.x, y: p.y };
    onBy({ x: 0, y: 0 });
  };
  const move = (e: ReactPointerEvent) => {
    const f = from.current;
    if (!f || e.pointerId !== f.id) return;
    const p = at(e, f.ctm);
    onBy({ x: p.x - f.x, y: p.y - f.y });
  };
  const up = (e: ReactPointerEvent) => {
    const f = from.current;
    if (!f || e.pointerId !== f.id) return;
    const p = at(e, f.ctm);
    from.current = null;
    onBy(null);
    if (p.x !== f.x || p.y !== f.y) onMove(p.x - f.x, p.y - f.y);
  };
  // Drawn where the image is now, so it stays under the pointer as it's dragged.
  return (
    <rect
      className={styles.grab}
      data-dragging={by ? "true" : undefined}
      x={box.x0 + (by?.x ?? 0)}
      y={box.y0 + (by?.y ?? 0)}
      width={box.x1 - box.x0}
      height={box.y1 - box.y0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

type Grip = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";
const GRIP_CURSOR: Record<Grip, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move",
};
/** The least a crop keeps, as a share of the picture each way. */
const LEAST = 0.02;

/**
 * The part of a picture kept by a crop, on the artboard: what's cut away dimmed, what's kept outlined, and
 * a grip on each corner and side to drag - Studio's grips - and the part itself to drag about.
 */
function CropFrame({ full, part, onPart, r }: { full: { x0: number; y0: number; x1: number; y1: number }; part: Part; onPart: (part: Part) => void; r: number }) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<{ grip: Grip; from: { x: number; y: number }; was: Part } | null>(null);
  const fw = full.x1 - full.x0, fh = full.y1 - full.y0;
  // Where the pointer is, as fractions of the whole picture.
  const at = (e: React.PointerEvent) => {
    const ctm = ref.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: (p.x - full.x0) / fw, y: (p.y - full.y0) / fh };
  };
  const down = (grip: Grip) => (e: React.PointerEvent) => {
    const from = at(e);
    if (!from) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { grip, from, was: part };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = d && at(e);
    if (!d || !p) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let [l, t, rr, b] = d.was;
    if (d.grip === "move") {
      const dx = clamp(p.x - d.from.x, -l, 1 - rr), dy = clamp(p.y - d.from.y, -t, 1 - b);
      onPart([l + dx, t + dy, rr + dx, b + dy]);
      return;
    }
    if (d.grip.includes("w")) l = clamp(p.x, 0, rr - LEAST);
    if (d.grip.includes("e")) rr = clamp(p.x, l + LEAST, 1);
    if (d.grip.includes("n")) t = clamp(p.y, 0, b - LEAST);
    if (d.grip.includes("s")) b = clamp(p.y, t + LEAST, 1);
    onPart([l, t, rr, b]);
  };
  const up = () => { drag.current = null; };
  const [x0, y0, x1, y1] = [full.x0 + part[0] * fw, full.y0 + part[1] * fh, full.x0 + part[2] * fw, full.y0 + part[3] * fh];
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const grips: { id: Grip; x: number; y: number }[] = [
    { id: "nw", x: x0, y: y0 }, { id: "n", x: mx, y: y0 }, { id: "ne", x: x1, y: y0 }, { id: "e", x: x1, y: my },
    { id: "se", x: x1, y: y1 }, { id: "s", x: mx, y: y1 }, { id: "sw", x: x0, y: y1 }, { id: "w", x: x0, y: my },
  ];
  return (
    <g ref={ref} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <path
        className={styles.cropShade}
        fillRule="evenodd"
        d={`M${full.x0} ${full.y0}H${full.x1}V${full.y1}H${full.x0}Z M${x0} ${y0}H${x1}V${y1}H${x0}Z`}
      />
      <rect className={styles.cropKept} x={x0} y={y0} width={x1 - x0} height={y1 - y0} style={{ cursor: GRIP_CURSOR.move }} onPointerDown={down("move")} />
      <g className={styles.cropGrips}>
        {grips.map((g) => (
          <circle key={g.id} cx={g.x} cy={g.y} r={r} style={{ cursor: GRIP_CURSOR[g.id] }} onPointerDown={down(g.id)} />
        ))}
      </g>
    </g>
  );
}
