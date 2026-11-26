import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
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

export type Zoom = "plotter" | "paper" | "drawing" | "artboard";

/** x0, y0, x1, y1 in bed units (UNITS per inch), from the plotter's home corner. */
export type Box = [number, number, number, number];

export interface BedCanvasHandle {
  /** Where a client point falls, in bed units. Null before the canvas has been laid out. */
  at: (clientX: number, clientY: number) => { x: number; y: number } | null;
  svg: () => SVGSVGElement | null;
}

export interface BedCanvasProps {
  zoom: Zoom;
  /**
   * What the view is of (2026-11-23). "bed" is the plotter with the paper on it, which is Plot's:
   * where the drawing is going. "artboard" is the drawing's own page alone - no plotter, no sheet -
   * which is Studio's and Image's: neither the bed nor the paper matters until it is time to plot,
   * and drawing them tied the view to whichever plotter happened to be picked. The ground is then
   * the artboard itself, in the paper's colour, since that is what the artwork is made on.
   */
  ground?: "bed" | "artboard";
  model: PlotterModel | undefined;
  settings: Settings;
  /** What the "drawing" zoom frames, and what's included when the view is zoomed out. */
  drawingBox: Box | null;
  /**
   * The artboard - the drawing's own size in inches, as against the sheet it sits on - drawn dashed
   * over everything else. Its x and y are inches from the paper's own corner, so a drawing that has
   * not been placed anywhere sits at the paper's origin. Absent, nothing is drawn: a drawing with no
   * artboard of its own is just the paper, as it was before the two were told apart.
   */
  artboard?: { x?: number; y?: number; w: number; h: number } | null;
  /**
   * Guides over the artboard, drawn only while the work is being made: Studio and Image in Outline,
   * never in Preview, where nothing should come between the eye and the ink (Tom, 2026-11-24).
   *
   * `artwork` is the box round what the drawing actually covers, in inches from the artboard's
   * corner. `margin` is the live area the four margins leave, in inches a side: the line the artwork
   * is meant to stay inside, and the one a number is typed for. There was a third - the artboard's
   * own edge, in red - until 2026-11-25: in Studio and Image the artboard is the largest thing on
   * screen, so its edge is the edge of the page and a line round it said nothing twice. Nothing is
   * drawn for a margin of nought, which would land on that edge.
   */
  guides?: {
    artwork?: { x0: number; y0: number; x1: number; y1: number } | null;
    margin?: { top: number; right: number; bottom: number; left: number } | null;
  } | null;
  /**
   * The artboard's box on the bed, in bed units, for a host that draws its own outline for it: Plot,
   * where the artboard is the box you take hold of to place the piece, and is drawn with the rest of
   * the drawing (Bed, 2026-11-23). It only says what the Artboard zoom frames; nothing is drawn from
   * it, and `artboard` above is left out so the artboard isn't outlined twice.
   */
  artboardBox?: Box | null;
  /** Sits on the width dimension line, at its right end. */
  toolbar?: ReactNode;
  /** The same line, at its left end. */
  toolbarLeft?: ReactNode;
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
  /** A lens that follows the pointer and shows what's under it magnified, for a close look at the lines. */
  loupe?: boolean;
}

// The loupe: how wide the lens is on screen, and how far it can magnify. The wheel steps between.
const LOUPE_PX = 220;
const LOUPE_MIN = 2;
const LOUPE_MAX = 16;
const LOUPE_STEP = 1.25; // per notch of a mouse wheel (100px of scrolling)

// Margins around what's framed, in pads (7.5% of its longer side): a left one exactly as wide as the
// side dimension line needs - it stands 0.35 off the bed and its ticks reach 0.14 further, so their
// ends sit on the canvas's left edge (Tom, 2026-10-10) - and a top one with room for the width line, its label, and the bar
// of view controls that sits centred on that line. The bar is a fixed 32 tall while this margin is
// a share of the drawing, so the two only clear each other if the line stands off the bed: at 0.3
// a 32 bar came within 4px of the top edge and touched it as soon as you zoomed in.
const LEFT = 0.35 + 0.14;
const TOP = 0.645;

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

/**
 * A measurement, centred on its dimension line the way the toolbar is: in a pill of the page's own
 * background, so the line stops either side of it and only the words show. Sized to the words, which
 * are measured once drawn - the number and the unit change, and a guessed width would either clip
 * them or leave the line broken for nothing. `upright` turns it to run up the height line.
 */
function DimLabel({ x, y, font, upright, children }: { x: number; y: number; font: number; upright?: boolean; children: string }) {
  const textRef = useRef<SVGTextElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = textRef.current?.getBBox();
    if (box) setSize({ w: box.width, h: box.height });
  }, [children, font]);
  const padX = font * 0.6;
  const padY = font * 0.25;
  const w = size.w + padX * 2;
  const h = size.h + padY * 2;
  return (
    <g transform={`translate(${x} ${y})${upright ? " rotate(-90)" : ""}`}>
      {size.w > 0 && <rect className={styles.dimPill} x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />}
      <text ref={textRef} className={styles.axisLabel} x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={font}>
        {children}
      </text>
    </g>
  );
}

export function BedCanvas(props: BedCanvasProps) {
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

  // The loupe: where the pointer is, in bed units, while it's over the canvas, and how much the lens
  // magnifies. The lens is the page itself drawn again through a <use>, bigger and clipped to a
  // circle, so it always shows exactly what the page does - ink, layers, the plot in progress -
  // without a copy of the drawing to keep in step. Hairlines stay hairlines in it, so the line work
  // is seen as it is rather than thickened, while a pen's real width grows with the magnification.
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [power, setPower] = useState(4);
  // Pinned, the lens stays where it was clicked rather than following the pointer: left over one
  // spot while the settings beside the page change, to see what they do there.
  const [pinned, setPinned] = useState(false);
  // A click that pinned the lens is the loupe's: the app beneath doesn't get its pointer-down or -up.
  const pinning = useRef(false);
  const ids = useId().replace(/[^\w-]/g, "");
  const contentId = `bed-content-${ids}`; // the bed and the paper
  const drawnId = `bed-drawn-${ids}`; // what each app puts on it
  const clipId = `bed-loupe-${ids}`;
  const loupe = Boolean(props.loupe);
  useEffect(() => {
    if (!loupe) {
      setLens(null);
      setPinned(false);
    }
  }, [loupe]);
  // The wheel sets the magnification while the loupe is out. A listener of its own, since React's
  // wheel handler is passive and couldn't stop the page scrolling instead.
  useEffect(() => {
    const svg = ownRef.current;
    if (!svg || !loupe) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // By how far the wheel turned, so a mouse's notch is one step and a trackpad's stream of small
      // movements glides rather than racing to the end. A line-mode wheel counts each line as 33px.
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      setPower((p) => Math.min(LOUPE_MAX, Math.max(LOUPE_MIN, p * LOUPE_STEP ** (-px / 100))));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [loupe, Boolean(model)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pointAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const ctm = ownRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const follow = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointAt(e);
    if (p) setLens(p);
  };
  // A click pins the lens there, or moves it there if it's pinned elsewhere; a click on the pinned
  // lens itself lets it follow the pointer again.
  const pin = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointAt(e);
    if (!p) return;
    const r = LOUPE_PX / 2 / (ownRef.current?.getScreenCTM()?.a || 1);
    const onLens = pinned && lens && Math.hypot(p.x - lens.x, p.y - lens.y) <= r;
    setPinned(!onLens);
    setLens(p);
  };

  // The width label sits in what the toolbar leaves of the dimension line rather than on the
  // line's own middle: the bar grows and shrinks as its segments show their labels, and a label
  // centred on the whole line slides under it. Measured rather than assumed - the bar is the app's
  // to fill, and this file has no business knowing how wide that makes it.
  // The room the canvas has: the stage's width and the window's height. Each zoom is fitted to it, so
  // the canvas fills it whatever is framed and never changes size or moves when the zoom does.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setRoom({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(wrap);
    return () => watch.disconnect();
  }, [Boolean(model)]); // eslint-disable-line react-hooks/exhaustive-deps

  const toolsRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState({ tools: 0, bed: 0 });
  useEffect(() => {
    const measure = () => {
      const bed = ownRef.current?.getBoundingClientRect();
      const tools = toolsRef.current?.getBoundingClientRect();
      // Where the bar ENDS, not how wide it is: it carries a margin of its own, and the label
      // wants the space beside it rather than the space beside its width.
      setWidths({ tools: bed && tools ? tools.right - bed.left : 0, bed: bed?.width ?? 0 });
    };
    measure();
    const watch = new ResizeObserver(measure);
    if (toolsRef.current) watch.observe(toolsRef.current);
    if (ownRef.current) watch.observe(ownRef.current);
    return () => watch.disconnect();
    // Again once the plotter is known: until then there's no bed and no bar to measure, and a
    // measurement taken then left the label placed as if the bar weren't there.
  }, [Boolean(model), Boolean(props.toolbarLeft)]); // eslint-disable-line react-hooks/exhaustive-deps

  const guides = props.guides;
  // The artboard, when there is one worth drawing.
  const art = props.artboard && props.artboard.w > 0 && props.artboard.h > 0 ? props.artboard : null;
  // The artboard alone: no plotter needed, and none drawn.
  const onlyArt = props.ground === "artboard";
  if (onlyArt ? !art : !model) return <div className={styles.wrap} />;

  const [tx, ty] = onlyArt && art ? [art.w, art.h] : model ? model.travel_in : [0, 0];
  const W = tx * UNITS;
  const H = ty * UNITS;
  const hasPaper = !onlyArt && s.paper_w > 0 && s.paper_h > 0;

  const travelBox: Box = [0, 0, W, H];
  // Where the artboard is drawn: on its own page it sits at the origin, since where it lands on a
  // sheet is Plot's business; on the bed it is placed from the paper's corner.
  const artRect: Box | null = art
    ? onlyArt
      ? [0, 0, art.w * UNITS, art.h * UNITS]
      : [s.paper_x * MM + (art.x ?? 0) * UNITS, s.paper_y * MM + (art.y ?? 0) * UNITS,
         s.paper_x * MM + ((art.x ?? 0) + art.w) * UNITS, s.paper_y * MM + ((art.y ?? 0) + art.h) * UNITS]
    : null;
  // What the Artboard zoom frames: the box drawn here, or the one a host that draws its own gives.
  const artBox: Box | null = artRect ?? props.artboardBox ?? null;
  const paperBox: Box | null = hasPaper
    ? [s.paper_x * MM, s.paper_y * MM, (s.paper_x + s.paper_w) * MM, (s.paper_y + s.paper_h) * MM]
    : null;
  // Paper that goes past what the plotter can reach covers the bed's own edge, so the edge is drawn
  // again over everything, dashed: where the pen stops.
  const pastReach = Boolean(paperBox && (paperBox[0] < 0 || paperBox[1] < 0 || paperBox[2] > W || paperBox[3] > H));

  // What to frame: the whole plotter (plus the paper and drawing, if they stick out), the paper, or
  // the drawing. The dimension lines measure the same thing.
  const zoomBox = zoom === "paper" ? paperBox : zoom === "drawing" ? drawingBox : zoom === "artboard" ? artBox : null;
  // The view the rest is measured against: the plotter, or the artboard where that is all there is.
  const baseBox: Box = onlyArt && artBox ? artBox : travelBox;
  const frame: Box = zoomBox ?? ([baseBox, onlyArt ? null : paperBox, drawingBox]
    .filter((b): b is Box => Boolean(b))
    .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) as Box);
  const dimBox = zoomBox ?? baseBox;

  const span = Math.max(frame[2] - frame[0], frame[3] - frame[1]);
  const font = span * 0.024; // sizes the home dot and the paper's shadow

  // The plotter view. The dimension lines, their labels and the toolbar are measured against it, so
  // they stay the same size and sit in the same place whichever zoom is showing.
  const base = fit(baseBox);
  // The canvas fills the room it has, whatever the zoom, so it holds its size and place and only what's
  // in it changes (Tom, 2026-10-10: a tall drawing zoomed to had shrunk the canvas and moved it; then,
  // it should use the height as well as the width). What's framed is as large as the room allows, and
  // the room left over - the canvas being a different shape from what's in it - goes to the RIGHT and
  // BELOW, both of it (Tom, 2026-11-24).
  //
  // So the top left of what's framed is the top left of the canvas, whatever shape either happens to
  // be. That is the corner the rulers hug and the corner home sits in, and it is the one place the
  // eye can measure from: halved across, a wide canvas pushed the drawing into the middle and left
  // the down ruler stranded a hand's width from it while the across ruler stayed against it.
  //
  // The margins fit leaves are untouched, so the dimension lines keep their room above and to the
  // left. Until the room is measured, the plotter view's.
  const { vb } = fit(frame);
  const baseAspect = base.vb[2] / base.vb[3];
  const aspect = room.w > 0 && room.h > 0 ? room.w / room.h : baseAspect;
  if (vb[2] / vb[3] < aspect) vb[2] = vb[3] * aspect;
  else vb[3] = vb[2] / aspect;
  const viewBox = props.viewBoxOverride ?? vb.join(" ");

  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number);
  // The plotter view as it would fill this room - widened or deepened to the room's shape, as every
  // view now is. Measured against the bare plotter view instead, the lines and labels grew with how
  // much wider the room was than the bed: a wide window, or a rail put away, made them huge.
  const baseW = Math.max(base.vb[2], base.vb[3] * aspect);
  const k = vw / baseW; // this view's units per plotter-view unit
  // The dimension lines hug the canvas, not what is framed in it: the same gap from the top edge and
  // from the left edge, whatever shape the canvas happens to be (Tom, 2026-11-24). They used to sit
  // a fixed distance from the FRAME, measured in the drawing's units - so a wide canvas left the
  // across line nearly touching the top while the down line drifted inward, and the two never
  // agreed. In screen pixels they can: a canvas unit is worth vw / room.w across, vh / room.h down.
  const RULER_GAP_PX = 16;
  const dy = vy + RULER_GAP_PX * (room.h > 0 ? vh / room.h : k);
  const dx = vx + RULER_GAP_PX * (room.w > 0 ? vw / room.w : k);
  const tick = base.pad * 0.14 * k;
  const labelFont = Math.max(W, H) * 0.0156 * k;
  const [dimX0, dimY0, dimX1, dimY1] = dimBox;
  const toolbarStyle = {
    "--toolbar-top": `${((dy - vy) / vh) * 100}%`,
    "--toolbar-right": `${((vx + vw - dimX1) / vw) * 100}%`,
    "--toolbar-left": `${((dimX0 - vx) / vw) * 100}%`,
  } as CSSProperties;

  // Where the page sits inside the canvas, as a share of it, for anything laid OVER the canvas in
  // HTML - a hint, a way in - to sit on the page rather than on the canvas (Tom, 2026-11-24). The
  // two were the same thing while the page was centred; now that the spare room is all to the right
  // and below, a box centred on the canvas is visibly off the page.
  const onPage = artBox ?? paperBox ?? travelBox;
  const pageStyle = {
    "--page-left": `${((onPage[0] - vx) / vw) * 100}%`,
    "--page-top": `${((onPage[1] - vy) / vh) * 100}%`,
    "--page-width": `${((onPage[2] - onPage[0]) / vw) * 100}%`,
    "--page-height": `${((onPage[3] - onPage[1]) / vh) * 100}%`,
  } as CSSProperties;

  // What the toolbar occupies, in the bed's own units, and the middle of what is left beside it.
  // Only with no room for the label there - a narrow window, a very wide bar - does it fall back to
  // the line's middle. Judged by the label's own size ("34.02 in" is about four and a half of its
  // font sizes across), not by a share of the line: a long bar left a fifth of the line or less,
  // plenty for the label, and the fallback put it under the bar.
  const toolsEnd = widths.bed > 0 ? vx + widths.tools * (vw / widths.bed) : dimX0;
  const beside = dimX1 - toolsEnd;
  const widthLabelX = beside > labelFont * 6 ? dimX1 - beside / 2 : (dimX0 + dimX1) / 2;

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
      ref={wrapRef}
      style={{ "--bed-aspect": baseAspect, ...pageStyle } as CSSProperties}
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
        aria-label={onlyArt
          ? `Artboard: ${fmtIn(tx)} by ${fmtIn(ty)}`
          : `Drawing area of the ${model?.name}: ${fmtIn(tx)} by ${fmtIn(ty)}`}
        data-loupe={loupe || undefined}
        data-pinned={(loupe && pinned) || undefined}
        // Caught on the way down, before the shapes on the page: while the loupe is out, a click is
        // for it, and mustn't also pick up or draw something underneath.
        onPointerDownCapture={(e) => {
          pinning.current = loupe;
          if (!loupe) return;
          e.stopPropagation();
          pin(e);
        }}
        onPointerUpCapture={(e) => {
          if (!pinning.current) return;
          e.stopPropagation();
          pinning.current = false;
        }}
        onPointerDown={props.onPointerDown}
        onPointerMove={(e) => {
          if (loupe && !pinned) follow(e);
          props.onPointerMove?.(e);
        }}
        onPointerUp={(e) => {
          if (!pinning.current) props.onPointerUp?.(e);
          pinning.current = false;
        }}
        onPointerCancel={(e) => {
          if (!pinning.current) props.onPointerUp?.(e);
          pinning.current = false;
        }}
        onPointerLeave={loupe && !pinned ? () => setLens(null) : undefined}
      >
        {/* Everything on the bed, as the loupe draws it again: not the dimension lines around it. */}
        <g id={contentId}>
        {onlyArt ? (
          // The artboard is the page here, so it is the ground: the paper's colour, which is what
          // the artwork is made on and what the inks are blended with, with the same lifted shadow
          // the sheet has on the bed.
          <>
            <rect className={styles.paperShadow} x={font * 0.18} y={font * 0.18} width={W} height={H} />
            <rect className={styles.paper} style={{ fill: s.paper_color || "#ffffff" }} x={0} y={0} width={W} height={H} />
          </>
        ) : (
          <rect className={styles.travel} x={0} y={0} width={W} height={H} />
        )}
        {/* The one-inch grid is the bed's: it reads the plotter's travel. The artboard's own page
          is the ground the art is made on, and is left clean. */}
        {!onlyArt && (
          <g className={styles.grid}>
            {gridLines(tx, "x")}
            {gridLines(ty, "y")}
          </g>
        )}

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
        {/* The artboard on the bed, from the paper's corner: where the piece falls on the sheet.
          Drawn after the paper and before the drawing itself, since the drawing is a layer of its
          own above this group. On its own page there is nothing to tell apart - the ground's edge
          is the artboard, and nothing is drawn for it. */}
        {!onlyArt && artRect && (
          <rect className={styles.artboard} x={artRect[0]} y={artRect[1]} width={artRect[2] - artRect[0]} height={artRect[3] - artRect[1]} />
        )}
        {/* The guides, over the artboard and under the drawing: the live area the margins leave, and
          the box round what the artwork covers. Outline only - the host decides, by passing them.
          The artboard's own edge had one too until 2026-11-25; it is the page's edge here. */}
        {guides?.margin && artBox && (() => {
          const m = guides.margin;
          if (!(m.top || m.right || m.bottom || m.left)) return null; // no margin: the trim line says it
          const w = (artBox[2] - artBox[0]) - (m.left + m.right) * UNITS;
          const h = (artBox[3] - artBox[1]) - (m.top + m.bottom) * UNITS;
          return w > 0 && h > 0 ? (
            <rect className={styles.marginGuide} x={artBox[0] + m.left * UNITS} y={artBox[1] + m.top * UNITS} width={w} height={h} />
          ) : null;
        })()}
        {guides?.artwork && artBox && (() => {
          const a = guides.artwork;
          const w = (a.x1 - a.x0) * UNITS;
          const h = (a.y1 - a.y0) * UNITS;
          return w > 0 && h > 0 ? (
            <rect className={styles.artworkGuide} x={artBox[0] + a.x0 * UNITS} y={artBox[1] + a.y0 * UNITS} width={w} height={h} />
          ) : null;
        })()}

        </g>

        <g className={styles.dim}>
          <line x1={dimX0} y1={dy} x2={dimX1} y2={dy} />
          <line x1={dimX0} y1={dy - tick} x2={dimX0} y2={dy + tick} />
          <line x1={dimX1} y1={dy - tick} x2={dimX1} y2={dy + tick} />
          <DimLabel x={widthLabelX} y={dy} font={labelFont}>{fmtIn((dimX1 - dimX0) / UNITS)}</DimLabel>
          <line x1={dx} y1={dimY0} x2={dx} y2={dimY1} />
          <line x1={dx - tick} y1={dimY0} x2={dx + tick} y2={dimY0} />
          <line x1={dx - tick} y1={dimY1} x2={dx + tick} y2={dimY1} />
          <DimLabel x={dx} y={(dimY0 + dimY1) / 2} font={labelFont} upright>{fmtIn((dimY1 - dimY0) / UNITS)}</DimLabel>
        </g>

        <g id={drawnId}>
          {typeof props.children === "function" ? props.children({ mark: font, viewBox }) : props.children}
        </g>

        {pastReach && <rect className={styles.reach} x={0} y={0} width={W} height={H} aria-hidden />}

        {/* Home is the plotter's corner: there is no such thing on the artboard's own page. */}
        {!onlyArt && <circle className={styles.home} cx={0} cy={0} r={font * 0.28} />}

        {loupe && lens && (() => {
          // The lens is a fixed size on screen whatever the zoom, so its radius is found from how many
          // screen pixels a bed unit is now.
          const perUnit = ownRef.current?.getScreenCTM()?.a || 1;
          const r = LOUPE_PX / 2 / perUnit;
          const grow = `translate(${lens.x} ${lens.y}) scale(${power}) translate(${-lens.x} ${-lens.y})`;
          return (
            <g className={styles.loupe} pointerEvents="none" aria-hidden>
              <clipPath id={clipId}>
                <circle cx={lens.x} cy={lens.y} r={r} />
              </clipPath>
              <circle className={styles.loupeBack} cx={lens.x} cy={lens.y} r={r} />
              <g clipPath={`url(#${clipId})`}>
                <g transform={grow}>
                  <use href={`#${contentId}`} />
                  <use href={`#${drawnId}`} />
                </g>
              </g>
              <circle className={styles.loupeRing} cx={lens.x} cy={lens.y} r={r} />
              <text className={styles.loupeLabel} x={lens.x} y={lens.y + r * 0.82} textAnchor="middle" fontSize={11 / perUnit}>
                {`${Math.round(power * 10) / 10}×${pinned ? " · pinned" : ""}`}
              </text>
            </g>
          );
        })()}
      </svg>

      {props.overlay}

      {props.toolbarLeft && (
        <div ref={toolsRef} className={`${styles.toolbar} ${styles.toolbarLeft}`} style={toolbarStyle}>
          {props.toolbarLeft}
        </div>
      )}

      {props.toolbar && (
        <div className={styles.toolbar} style={toolbarStyle}>
          {props.toolbar}
        </div>
      )}
    </div>
  );
}
