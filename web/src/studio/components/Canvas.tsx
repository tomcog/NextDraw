import { memo, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  angleFromCenter, boxAround, boxOf, clampToPage, dragHandleTurned, handlePoints, isDegenerate,
  drawnNodes, moveBy, newShapeId, scaleInto, turnAround, turnAttr, turnGrip, CURSOR,
  type Handle, type Page, type Shape, type ShapeKind,
} from "../lib/shapes";
import { fillRuns, type Fill } from "../lib/hatch";
import { photoMarks, photoOrigin } from "../lib/photo";
import { usePhotoRead } from "../lib/usePhotoRead";
import { pathData } from "../lib/path";
import { curveStrokes, pointsAttr, DEFAULT_CURVE, type CurveKind } from "../lib/parametric";
import { placementAttr, placements } from "../lib/repeat";
import { textRuns, type StrokeFont } from "../lib/text";
import type { Layer } from "../lib/shapes";
import { BedCanvas, type BedCanvasHandle, type Box, type Zoom } from "../../shared/components/BedCanvas";
import type { View } from "../../shared/components/PreviewToolbar";
import { DEFAULT_SETTINGS, UNITS } from "../../shared/lib/constants";
import type { PlotterModel } from "../../shared/lib/types";
import { inkLayer } from "../../shared/lib/ink";
import styles from "./Canvas.module.css";

/** Select picks shapes up; the rest draw. Without the distinction a shape covering the page would
 *  be a hole you couldn't draw in, and a drag over one would be ambiguous. A parametric curve is
 *  its own tool per generator, since which curve it is can't be told from the drag. A photo is added
 *  from a file, not drawn, so it isn't a tool. */
export type Tool = Exclude<ShapeKind, "curve" | "path" | "photo"> | "select" | CurveKind;

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
  /** The paper's colour, as Plot draws it: the page is this colour and the inks blend with it. */
  paperColor: string;
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
  /** Outline: every path a thin line in its layer's colour. Preview: the ink, at the pen's width. */
  view: View;
  tool: Tool;
  /** Round what is drawn and dragged to this many inches, or 0 to leave it where the pointer is. */
  snap: number;
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
// reshaped is updated as the pointer goes, so the page and the size in the list stay truthful
// mid-drag. One being moved is only drawn moved until it's let go: its size doesn't change, and a
// whole layer rewritten on every pointer move is what made a big drawing crawl.
type Drag =
  | { mode: "new"; shape: Shape }
  // Carried, not rewritten: what's being moved is drawn shifted by `by` while the pointer goes, and
  // the shapes themselves are moved once, when it's let go. Rewriting a whole layer of marks on every
  // pointer move is what made dragging a big drawing crawl. `box` is round all of it, for the page's
  // edges, and `ids` says what's being carried without searching the list for it.
  | { mode: "move"; from: { x: number; y: number }; origins: Shape[]; ids: Set<string>; box: ReturnType<typeof boxOf>; by: { x: number; y: number } }
  // Rubber band: drawn on the empty page to gather up everything it touches.
  | { mode: "marquee"; from: { x: number; y: number }; to: { x: number; y: number }; add: string[] }
  // A whole selection at once: scaled by a corner of the box round it, or turned about its middle.
  | { mode: "groupScale"; handle: Handle; origins: Shape[]; box: ReturnType<typeof boxOf> }
  | { mode: "groupTurn"; origins: Shape[]; about: { x: number; y: number }; from: number }
  | { mode: "handle"; id: string; handle: Handle; origin: Shape }
  // Turning: the angle the pointer started at, so the shape turns by how far the pointer has gone
  // round rather than jumping to wherever it was grabbed.
  | { mode: "turn"; id: string; origin: Shape; from: number };

/**
 * A corner held to the shape's own proportions: the pointer is taken as far as it has gone in the
 * direction that has moved most, and the other side follows from the ratio. `anchor` is the corner
 * that stays put.
 */
function keepProportions(anchor: { x: number; y: number }, p: { x: number; y: number }, ratio: number) {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  if (!Number.isFinite(ratio) || ratio <= 0) return p;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return Math.abs(dx) / ratio > Math.abs(dy)
    ? { x: p.x, y: anchor.y + (sy * Math.abs(dx)) / ratio }
    : { x: anchor.x + sx * Math.abs(dy) * ratio, y: p.y };
}

/** The nearest eighth of a turn from where a line started: flat, upright, or at 45 degrees. */
function straighten(x: number, y: number, toX: number, toY: number) {
  const dx = toX - x;
  const dy = toY - y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // As long as the pointer has travelled, measured along the direction it is being held to.
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: x + along * Math.cos(angle), y: y + along * Math.sin(angle) };
}

/**
 * Past this many marks, a layer gets no grip for each of them: a separation of fifty thousand strokes
 * would be fifty thousand more elements on the page, for picking out strokes nobody picks one at a
 * time. Its marks are picked up together - Select all on layer, or a band dragged round them - and
 * moved by the box round the selection.
 */
export const GRIP_LIMIT = 2000;

const sameItems = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type LayerLists = Map<string, { shapes: Shape[]; fills: Fill[] }>;

/** The Photo view: whether it's on, and the one shape of each photo that draws it. */
interface PhotoView { on: boolean; leads: Set<string> }

/**
 * The shapes and fills on each layer, keeping last time's list for a layer where nothing on it
 * changed. An edit replaces one shape and leaves the rest as they were, so every layer it didn't
 * touch comes back as the very same list - and a layer drawn from the same list isn't drawn again.
 */
function listsByLayer(shapes: Shape[], fills: Fill[], was: LayerLists): LayerLists {
  const onLayer = new Map<string, Shape[]>();
  for (const sh of shapes) {
    const list = onLayer.get(sh.layerId);
    if (list) list.push(sh);
    else onLayer.set(sh.layerId, [sh]);
  }
  const fillsOf = new Map<string, Fill[]>();
  for (const f of fills) {
    const list = fillsOf.get(f.shapeId);
    if (list) list.push(f);
    else fillsOf.set(f.shapeId, [f]);
  }
  const next: LayerLists = new Map();
  for (const [id, list] of onLayer) {
    const own = list.flatMap((sh) => fillsOf.get(sh.id) ?? []);
    const before = was.get(id);
    next.set(id, {
      shapes: before && sameItems(before.shapes, list) ? before.shapes : list,
      fills: before && sameItems(before.fills, own) ? before.fills : own,
    });
  }
  return next;
}

// One shape as an SVG element. The caller says what it's for; nothing here decides how it looks.
// Ink is painted by the shared preview rules (see lib/ink.ts), and the interface pieces by
// Canvas.module.css, so a mark and the thing you grab to move it are drawn separately even though
// they're the same rectangle.
/**
 * A photo's hatching, drawn once the photo has been read - which takes a moment the first time, so
 * this redraws itself when it's done rather than waiting on the rest of the page to. One path per
 * pass of lines: tens of thousands of strokes, and four things on the page.
 */
function PhotoInk({ shape, asPhoto }: { shape: Shape; asPhoto?: boolean }) {
  const photo = shape.photo!;
  const b = boxOf(shape);
  // The photo itself, cropped and placed as its lines are: what they're compared against.
  if (asPhoto) {
    const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
    const W = photo.width;
    const H = photo.height;
    return (
      <g transform={turnAttr(shape)}>
        <svg x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} viewBox={`${c0 * W} ${c1 * H} ${(c2 - c0) * W} ${(c3 - c1) * H}`} preserveAspectRatio="none">
          <image data-photo-view href={photo.src} width={W} height={H} preserveAspectRatio="none" />
        </svg>
      </g>
    );
  }
  return <PhotoLines shape={shape} />;
}

function PhotoLines({ shape }: { shape: Shape }) {
  const photo = shape.photo!;
  usePhotoRead(photo.src);
  const b = boxOf(shape);
  const marks = photoMarks(photo, b.x1 - b.x0, b.y1 - b.y0);
  const at = photoOrigin(photo, b.x0, b.y0);
  return (
    <g transform={turnAttr(shape)}>
      <g transform={`translate(${at.x} ${at.y})`}>
        {marks?.passes.map((d, i) => (d ? <path key={i} d={d} fill="none" /> : null))}
      </g>
    </g>
  );
}

function shapeElement(s: Shape, key: string, props: Record<string, unknown>, fonts: Record<string, StrokeFont>, photos?: PhotoView) {
  // A photo's ink is its lines - or, in the Photo view, the photo itself, drawn once however many
  // layers it's split into. What you grab it by is the box it sits in, as for a rectangle.
  if (s.kind === "photo" && s.photo && props.className !== styles.grab) {
    if (photos?.on && !photos.leads.has(s.id)) return null;
    return <PhotoInk key={key} shape={s} asPhoto={photos?.on} />;
  }
  const b = boxOf(s);
  // A turned shape is drawn turned about the middle of its box; the box itself stays square.
  const common = { ...props, ...(turnAttr(s) ? { transform: turnAttr(s) } : {}) };
  if (s.kind === "text") {
    // The glyphs, in the size the box says, with a transparent box behind them so the whole thing
    // can be picked up rather than only the strokes of the letters. The caller's props go on each
    // letter rather than on the group: vector-effect doesn't inherit in SVG, so a class on the
    // group would leave the interface's screen-width lines measured in inches instead.
    const runs = textRuns(s, fonts[s.font ?? ""]);
    return (
      <g key={key} transform={turnAttr(s)}>
        {props.className === styles.grab && (
          <rect {...props} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill="transparent" />
        )}
        {runs.map((run, i) => <path key={i} {...props} d={run.d} fill="none" />)}
      </g>
    );
  }
  if (s.kind === "path") {
    // One element for the whole path, every run a subpath of it: the browser draws its curves as
    // curves, from the same handles the file gave them, and a joined shape is one thing to grab.
    return <path key={key} {...common} fill="none" d={pathData(drawnNodes(s))} />;
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
}

/**
 * Everything some of one layer's shapes will actually put on the paper: the outlines they draw, and
 * the hatch lines their fills generate. A shape whose outline isn't plotted contributes only its
 * hatching - the shape itself is a guide, and guides are interface, drawn by the canvas.
 *
 * Kept apart and memoised so a layer is only drawn again when its own list changes: moving a shape
 * on one layer leaves every other layer's thousands of marks exactly where they were on screen.
 */
const LayerMarks = memo(function LayerMarks({ shapes, fills, fonts, photos }: { shapes: Shape[]; fills: Fill[]; fonts: Record<string, StrokeFont>; photos: PhotoView }) {
  const byId = new Map(shapes.map((sh) => [sh.id, sh]));
  // A repeated shape is drawn once per copy. The copies are marks and nothing else: what you grab,
  // and what the handles belong to, is always the shape itself.
  // A shape that isn't repeated is drawn as itself, with no group round it: in a separation of fifty
  // thousand strokes, a group each would double what the browser has to draw.
  const copies = (sh: Shape, what: (key: string) => ReactNode) =>
    sh.repeat
      ? placements(sh).map((p, i) => (
          <g key={`${sh.id}-copy-${i}`} transform={placementAttr(sh, p)}>{what(`${sh.id}-${i}`)}</g>
        ))
      : what(`${sh.id}-0`);
  return (
    <>
      {shapes.filter((sh) => sh.outline !== false).map((sh) => copies(sh, (key) => shapeElement(sh, key, {}, fonts, photos)))}
      {fills.map((fill) => {
        const shape = byId.get(fill.shapeId);
        if (!shape) return null;
        return copies(shape, (key) => (
          // The fill turns with the shape it fills, since it is that shape's own hatching.
          <g key={`${key}-fill-${fill.id}`} transform={turnAttr(shape)}>
            {fillRuns(shape, fill).map((run, i) => (
              <polyline key={i} fill="none" points={run.map((p) => `${p.x},${p.y}`).join(" ")} />
            ))}
          </g>
        ));
      })}
    </>
  );
});

// The page at true proportions, with a one-inch grid. It keeps the page's own proportions and is
// sized to them (--canvas-aspect), so the drawing gets as large as the space allows - the same way
// Plot's preview fills its column.
export function Canvas({ page, paperColor, shapes, fills, layers, activeLayer, model, zoom, toolbar, toolbarLeft, fonts, font, snap, penWidthMm, inkOpacity, inkBuilds, inkBuild, view, tool, selected, onSelect, onAdd, onUpdate, onUpdateMany, onEditStart }: Props) {
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
    paper_color: paperColor,
  };
  // Worked out when the drawing changes, not on every render: a render happens on every pointer move.
  const drawingBox: Box | null = useMemo(() => {
    if (!shapes.length) return null;
    const b = boxAround(shapes);
    return [b.x0 * UNITS, b.y0 * UNITS, b.x1 * UNITS, b.y1 * UNITS];
  }, [shapes]);

  // Where a pointer is on the page, in inches from its top-left corner.
  // The pen's real width in inches, so the line on screen is the line on paper.
  const penIn = penWidthMm / 25.4;
  const inkSim = view === "preview";
  // The Photo view draws each photo once, from the first of its layers; the rest draws as in Outline.
  const photoLeads = useMemo(() => {
    const seen = new Set<string>();
    const leads = new Set<string>();
    for (const sh of shapes) {
      if (sh.kind !== "photo") continue;
      const key = sh.photo?.group ?? sh.id;
      if (!seen.has(key)) { seen.add(key); leads.add(sh.id); }
    }
    return leads;
  }, [shapes]);
  const photos = useMemo<PhotoView>(() => ({ on: view === "photo", leads: photoLeads }), [view, photoLeads]);
  const hiddenLayers = new Set(layers.filter((l) => l.hidden).map((l) => l.id));
  const shown = useMemo(() => shapes.filter((sh) => !hiddenLayers.has(sh.layerId)), [shapes, layers]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = useMemo(() => new Set(selected), [selected]);

  // What's being carried, drawn apart from the rest so the rest can stay as it is while it moves.
  const carrying = drag?.mode === "move" ? drag : null;
  const carriedIds = carrying?.ids ?? null;
  // A layer carried whole - Select all on layer, then drag - is shifted where it already is, not
  // taken apart into what stays and what moves: taking a layer of tens of thousands of marks out of
  // its place and putting it back would draw every one of them again, twice.
  const carriedWhole = useMemo(() => {
    if (!carriedIds) return null;
    const left = new Map<string, number>();
    for (const sh of shapes) if (!carriedIds.has(sh.id)) left.set(sh.layerId, (left.get(sh.layerId) ?? 0) + 1);
    return new Set(carrying!.origins.map((sh) => sh.layerId).filter((id) => !left.get(id)));
  }, [shapes, carriedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const listsCache = useRef<LayerLists>(new Map());
  const still = useMemo(() => {
    const kept = carriedIds ? shapes.filter((sh) => !carriedIds.has(sh.id) || carriedWhole!.has(sh.layerId)) : shapes;
    const lists = listsByLayer(kept, fills, listsCache.current);
    listsCache.current = lists;
    return lists;
  }, [shapes, fills, carriedIds, carriedWhole]);
  const carried = useMemo(
    () => (carrying ? listsByLayer(carrying.origins.filter((sh) => !carriedWhole!.has(sh.layerId)), fills, new Map()) : null),
    [carriedIds, carriedWhole, fills], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shift = carrying ? `translate(${carrying.by.x} ${carrying.by.y})` : undefined;
  // Layers too big for a grip on each mark (GRIP_LIMIT), counted over the whole drawing.
  const bigLayers = useMemo(() => {
    const count = new Map<string, number>();
    for (const sh of shapes) count.set(sh.layerId, (count.get(sh.layerId) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > GRIP_LIMIT).map(([id]) => id));
  }, [shapes]);

  const pointAt = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const at = bed.current?.at(e.clientX, e.clientY);
    return at ? { x: at.x / UNITS, y: at.y / UNITS } : null; // bed units to the page's inches
  };

  /** A measurement rounded to the grid, when there is one to snap to. */
  const grid = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);
  const gridPoint = (p: { x: number; y: number }) => ({ x: grid(p.x), y: grid(p.y) });

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
    const start = gridPoint(p);
    begin(e, {
      mode: "new",
      shape: clampToPage(shapeFor(tool, activeLayer, start.x, start.y, font), page),
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
    carry(e, p, next);
  };

  const carry = (e: ReactPointerEvent, p: { x: number; y: number }, ids: string[]) => {
    const set = new Set(ids);
    // A photo's tone bands are one photo on the page: carrying one carries them all.
    const groups = new Set(shapes.filter((s) => set.has(s.id) && s.photo?.group).map((s) => s.photo!.group));
    for (const s of shapes) if (s.photo?.group && groups.has(s.photo.group)) set.add(s.id);
    const origins = shapes.filter((s) => set.has(s.id));
    if (!origins.length) return;
    begin(e, { mode: "move", from: p, origins, ids: set, box: boxAround(origins), by: { x: 0, y: 0 } });
  };

  // Started inside the box round several shapes: move them all. The way a selection with no grips of
  // its own - a whole big layer - is carried, and a larger target than any one of its marks.
  const onBoxDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || tool !== "select") return;
    e.stopPropagation();
    const p = pointAt(e);
    if (!p) return;
    onEditStart();
    carry(e, p, selected);
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

  // Started on a grip of a group: scale everything picked, or turn it, as one thing.
  const onGroupDown = (e: ReactPointerEvent, handle: Handle | "turn") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pointAt(e);
    if (!p) return;
    onEditStart();
    const box = boxAround(group);
    const about = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    begin(e, handle === "turn"
      ? { mode: "groupTurn", origins: group, about, from: (Math.atan2(p.x - about.x, about.y - p.y) * 180) / Math.PI }
      : { mode: "groupScale", handle, origins: group, box });
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
      // Shift holds a line to the square and diagonal directions, the way a set square would, and
      // squares off anything else: an ellipse drawn with it held comes out a circle.
      const to = drag.shape.kind === "line" && e.shiftKey
        ? straighten(drag.shape.x, drag.shape.y, p.x, p.y)
        : gridPoint(p);
      const end = e.shiftKey && drag.shape.kind !== "line"
        ? keepProportions({ x: drag.shape.x, y: drag.shape.y }, to, 1)
        : to;
      setDrag({ ...drag, shape: clampToPage({ ...drag.shape, x2: end.x, y2: end.y }, page) });
    } else if (drag.mode === "marquee") {
      setDrag({ ...drag, to: p });
    } else if (drag.mode === "move") {
      // The whole selection moves as one: the limit is the box round all of it, so a group slides
      // along the page's edge instead of collapsing against it.
      const { x0, y0, x1, y1 } = drag.box;
      // Snapping moves the corner of what's being carried onto the grid, not the pointer: the shape
      // lands on a line, wherever it was picked up.
      const dx = snap > 0 ? grid(x0 + p.x - drag.from.x) - x0 : p.x - drag.from.x;
      const dy = snap > 0 ? grid(y0 + p.y - drag.from.y) - y0 : p.y - drag.from.y;
      const by = { x: Math.max(-x0, Math.min(page.w - x1, dx)), y: Math.max(-y0, Math.min(page.h - y1, dy)) };
      if (by.x !== drag.by.x || by.y !== drag.by.y) setDrag({ ...drag, by });
    } else if (drag.mode === "groupScale") {
      // The corner opposite the one being dragged stays where it is, as it does for one shape.
      const b = drag.box;
      // The page holds the box round the whole group, not each shape on its own: clamping them one
      // by one would squash whichever reached the edge first and the group would come apart.
      // Shift keeps the group's proportions, measured from the corner that stays put.
      const anchor = {
        x: drag.handle === "nw" || drag.handle === "sw" ? b.x1 : b.x0,
        y: drag.handle === "nw" || drag.handle === "ne" ? b.y1 : b.y0,
      };
      const held = e.shiftKey ? keepProportions(anchor, p, (b.x1 - b.x0) / (b.y1 - b.y0)) : p;
      const g = gridPoint(held);
      const to = {
        x0: drag.handle === "nw" || drag.handle === "sw" ? Math.max(0, Math.min(g.x, b.x1 - 0.02)) : b.x0,
        y0: drag.handle === "nw" || drag.handle === "ne" ? Math.max(0, Math.min(g.y, b.y1 - 0.02)) : b.y0,
        x1: drag.handle === "ne" || drag.handle === "se" ? Math.min(page.w, Math.max(g.x, b.x0 + 0.02)) : b.x1,
        y1: drag.handle === "sw" || drag.handle === "se" ? Math.min(page.h, Math.max(g.y, b.y0 + 0.02)) : b.y1,
      };
      onUpdateMany(scaleInto(drag.origins, b, to));
    } else if (drag.mode === "groupTurn") {
      const now = (Math.atan2(p.x - drag.about.x, drag.about.y - p.y) * 180) / Math.PI;
      const raw = now - drag.from;
      const by = e.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw);
      onUpdateMany(turnAround(drag.origins, drag.about, by));
    } else if (drag.mode === "turn") {
      const by = angleFromCenter(drag.origin, p.x, p.y) - drag.from;
      const raw = (drag.origin.rotation ?? 0) + by;
      const turn = e.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw);
      onUpdate({ ...drag.origin, rotation: ((turn % 360) + 360) % 360 || undefined });
    } else {
      const b = boxOf(drag.origin);
      // Shift holds a corner to the shape's proportions, and a line's end to the square and diagonal
      // directions - the same rule the line was drawn under.
      const corner = ["nw", "ne", "sw", "se"].includes(drag.handle);
      const anchor = {
        x: drag.handle === "nw" || drag.handle === "sw" ? b.x1 : b.x0,
        y: drag.handle === "nw" || drag.handle === "ne" ? b.y1 : b.y0,
      };
      const held = !e.shiftKey ? p
        : corner ? keepProportions(anchor, p, (b.x1 - b.x0) / (b.y1 - b.y0))
        : drag.origin.kind === "line"
          ? (drag.handle === "b"
              ? straighten(drag.origin.x, drag.origin.y, p.x, p.y)
              : straighten(drag.origin.x2, drag.origin.y2, p.x, p.y))
          : p;
      const g = gridPoint(held);
      onUpdate(clampToPage(dragHandleTurned(drag.origin, drag.handle, g.x, g.y), page));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    if (drag?.mode === "new" && !isDegenerate(drag.shape)) onAdd(drag.shape);
    // Put down where it was carried to: the one time the shapes themselves move.
    if (drag?.mode === "move" && (drag.by.x || drag.by.y)) {
      onUpdateMany(drag.origins.map((s) => moveBy(s, drag.by.x, drag.by.y, page)));
    }
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

  const element = (s: Shape, key: string, props: Record<string, unknown>) => shapeElement(s, key, props, fonts);

  // The cards edit the last shape picked; its handles are shown while it is the only one.
  const chosen = selected.length === 1 ? shapes.find((s) => s.id === selected[0]) ?? null : null;
  const group = useMemo(() => (selected.length > 1 ? shapes.filter((s) => picked.has(s.id)) : []), [shapes, selected, picked]);
  const groupBox = useMemo(() => (group.length ? boxAround(group) : null), [group]);
  // A selection holding marks with no grips of their own is picked up by its box instead.
  const boxCarries = group.some((sh) => bigLayers.has(sh.layerId));
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
          </div>
        ) : undefined
      }
    >
      {({ mark }) => {
        // Everything below is in the page's inches; the bed counts in UNITS per inch.
        const handleR = (mark * 0.28) / UNITS;
        return (
          <g transform={`scale(${UNITS})`}>
            {/* The grid a drag lands on, under everything else and in the faintest line there is.
                Only while snapping is on, and only while the lines are far enough apart to read as
                a grid rather than as a wash. */}
            {snap > 0 && page.w / snap + page.h / snap <= 400 && (
              <g className={styles.grid}>
                {Array.from({ length: Math.floor(page.w / snap) }, (_, i) => (i + 1) * snap).map((x) => (
                  <line key={`v${x}`} x1={x} y1={0} x2={x} y2={page.h} />
                ))}
                {Array.from({ length: Math.floor(page.h / snap) }, (_, i) => (i + 1) * snap).map((y) => (
                  <line key={`h${y}`} x1={0} y1={y} x2={page.w} y2={y} />
                ))}
              </g>
            )}
            {/* The ink: exactly what the pen will put on the paper, in the structure Plot's preview
                uses, painted by the same rules in index.css. That's what makes a drawing look the
                same in both apps rather than merely similar. Nothing in here is clickable - what you
                grab is below, so how a mark is painted never changes what you can do to it. */}
            <g
              // Outline is the preview rules' hairline: one screen pixel whatever the zoom, flat, no
              // blending - the paths themselves. Preview is the ink, at the pen's real width.
              className={`pv-colored ${inkSim ? "pv-true-width" : "pv-hairline pv-flat"} ${styles.ink}`}
              style={{ "--pen-art": String(penIn), "--ink-build-alpha": String(inkBuild) } as CSSProperties}
            >
              {layers.map((layer) => {
                const { base, buildPass } = inkLayer(layer.color, inkBuild, inkBuilds, inkSim);
                const here = still.get(layer.id);
                const moving = carried?.get(layer.id);
                const marks = (
                  <>
                    {/* Always inside this group, shifted or not, so picking a whole layer up doesn't
                        move its marks to another place in the page and draw them all again. */}
                    <g transform={carriedWhole?.has(layer.id) ? shift : undefined}>
                      {here && <LayerMarks shapes={here.shapes} fills={here.fills} fonts={fonts} photos={photos} />}
                    </g>
                    {moving && (
                      <g transform={shift}>
                        <LayerMarks shapes={moving.shapes} fills={moving.fills} fonts={fonts} photos={photos} />
                      </g>
                    )}
                  </>
                );
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
                if (bigLayers.has(sh.layerId)) return null; // picked up with the rest of their layer
                const guide = sh.outline === false;
                return (
                  <g key={sh.id} transform={carriedIds?.has(sh.id) ? shift : undefined}>
                    {/* Filled but not outlined: shown thin and dashed, so it reads as a guide rather
                        than as a line the pen will make. You still have to see what the hatch came from. */}
                    {guide && element(sh, `${sh.id}-guide`, { className: styles.guide })}
                    {/* The grip. Transparent and generous, so grabbing a shape doesn't depend on
                        hitting a stroke that may be a fraction of a millimetre wide. */}
                    {element(sh, `${sh.id}-grab`, {
                      className: styles.grab,
                      "data-selected": picked.has(sh.id) ? "true" : undefined,
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
              {/* A group is moved, scaled and turned as one: the box round it, its four corners and
                  a grip on a stalk, the same as one shape has. */}
              {groupBox && drag?.mode !== "marquee" && (() => {
                const b = groupBox;
                const grip = { x: (b.x0 + b.x1) / 2, y: b.y0 - handleR * 4 };
                const corners: { id: Handle; x: number; y: number }[] = [
                  { id: "nw", x: b.x0, y: b.y0 }, { id: "ne", x: b.x1, y: b.y0 },
                  { id: "sw", x: b.x0, y: b.y1 }, { id: "se", x: b.x1, y: b.y1 },
                ];
                return (
                  <>
                    <rect
                      className={boxCarries ? `${styles.draft} ${styles.carryBox}` : styles.draft}
                      x={b.x0}
                      y={b.y0}
                      width={b.x1 - b.x0}
                      height={b.y1 - b.y0}
                      transform={shift}
                      onPointerDown={boxCarries ? onBoxDown : undefined}
                    />
                    {drag?.mode !== "move" && (
                      <g className={styles.handles}>
                        <line className={styles.stalk} x1={grip.x} y1={b.y0} x2={grip.x} y2={grip.y} />
                        <circle
                          cx={grip.x}
                          cy={grip.y}
                          r={handleR}
                          className={styles.turn}
                          style={{ cursor: "grab" }}
                          onPointerDown={(e) => onGroupDown(e, "turn")}
                        />
                        {corners.map((c) => (
                          <circle
                            key={c.id}
                            cx={c.x}
                            cy={c.y}
                            r={handleR}
                            style={{ cursor: CURSOR[c.id] }}
                            onPointerDown={(e) => onGroupDown(e, c.id)}
                          />
                        ))}
                      </g>
                    )}
                  </>
                );
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
                  {/* Two kinds of grip on a path: the corners of its box, which scale the whole of
                      it, and a smaller one on each point. A path's own points often sit exactly on
                      those corners, so the corners stand a little outside the box to stay reachable. */}
                  {handlePoints(chosen).map((h) => {
                    const out = chosen.points?.length && !h.point ? handleR * 1.1 : 0;
                    const b = boxOf(chosen);
                    const x = out ? h.x + (h.x <= (b.x0 + b.x1) / 2 ? -out : out) : h.x;
                    const y = out ? h.y + (h.y <= (b.y0 + b.y1) / 2 ? -out : out) : h.y;
                    return (
                      <circle
                        key={h.id}
                        className={h.point ? styles.point : undefined}
                        cx={x}
                        cy={y}
                        r={h.point ? handleR * 0.7 : handleR}
                        style={{ cursor: CURSOR[h.id] }}
                        onPointerDown={(e) => onHandleDown(e, chosen, h.id)}
                      />
                    );
                  })}
                </g>
              )}
            </g>
          </g>
        );
      }}
    </BedCanvas>
  );
}
