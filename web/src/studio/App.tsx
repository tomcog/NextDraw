import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { SettingsSection } from "../shared/components/controls/SettingsSection";
import { Button, ButtonRound, Card, Checkbox, ConfirmButton, InputSelect, InputText, InputTextarea, LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { ArrowDownToLine, AudioWaveform, Circle, ClipboardCopy, ClipboardPaste, Copy, Ellipsis, EllipsisVertical, FilePlus, FlameKindling, FolderOpen, Image as ImageIcon, ImagePlus, Grid2x2, Layers2, LayersArrowDown, LayersArrowUp, LineStyle, LoaderPinwheel, Menu, Minus, MousePointer2, Orbit, PaintBucket, PenLine, Pentagon, Plus, Rainbow, RotateCw, Save, Send, Shell, Signal, Spline, Square, SquareDimensions, SquareStack, Star, Target, Trash2, Type, Waves } from "lucide-react";
import { FileBrowser, LAST_FOLDER_KEY, type CombineResult, type OpenResult } from "../shared/components/FileBrowser";
import { Section } from "../shared/components/controls/Section";
import { NumberField } from "../shared/components/controls/NumberField";
import controls from "../shared/components/controls/controls.module.css";
import { api, postJSON } from "../shared/lib/api";
import { load, save as remember } from "../shared/lib/storage";
import { DEFAULT_SETTINGS, PAPER_SIZES, PLOT_CHANNEL } from "../shared/lib/constants";
import type { Info, PenColor, PlotterModel, Preset } from "../shared/lib/types";
import { listOf, trimNum } from "../shared/lib/format";
import { lightness } from "../shared/lib/color";
import { isPalettePen } from "../shared/lib/ink";
import { APP_URL } from "../shared/lib/apps";
import { PreviewToolbar, type View } from "../shared/components/PreviewToolbar";
import type { Zoom } from "../shared/components/BedCanvas";
import { useRowDrag } from "./lib/useRowDrag";
import { Canvas, type Tool } from "./components/Canvas";
import { SizePopover } from "./components/SizePopover";
import { StudioHeader } from "./components/StudioHeader";
import { canConnect, canFill, fillNumbers, fillRuns, newFillId, FILL_LABEL, type Fill, type FillKind } from "./lib/hatch";
import { closingTurns, curveStrokes, CURVE_FIELDS, type Curve, type Point } from "./lib/parametric";
import { fontNames, loadFont, type StrokeFont } from "./lib/font";
import { flattenPath, flattenRun, mapNode, parsePath, simplifyRun, type Node } from "./lib/path";
import { fitText, textRuns } from "./lib/text";
import { defaultRepeat, placements, REPEAT_FIELDS, type Repeat, type RepeatKind } from "./lib/repeat";
import { parseDrawing } from "./lib/parse";
import { BAND_NAMES, BLACK_SHARE, KEY_FROM, LAYER_SETTINGS, PLATES, PLATE_AIMS, MOST_LAYERS, PHOTO_DEFAULTS, WAVE_DEFAULTS, OUTLINE_DEFAULTS, CENTER_DEFAULTS, photoMarks, colourGroups, darkestOf, isColourful, matchPens, placeOnPage, plateNamed, platePens, readTones, stemWithoutPlate, workingCopy, type Photo, type PhotoPart, type Plate } from "./lib/photo";
import { usePhotoRead } from "./lib/usePhotoRead";
import { PaletteMenu } from "../shared/components/controls/PaletteMenu";
import { Hints } from "../shared/components/controls/Hints";
import { RowMenu } from "./components/controls/RowMenu";
import { boxAround, boxOf, centerOf, clampToPage, drawnNodes, drawnRuns, moveBy, newLayerId, newShapeId, outlinePoints, pathRuns, pointsBox, resizeTo, shapeName, turnPoint, POINT_HANDLE_LIMIT, type Layer, type Page, type Shape } from "./lib/shapes";
import { buildSvg, svgForMarks, cleanFileName } from "./lib/svg";
import styles from "./App.module.css";

// Page sizes, in inches, from the list Plot already offers. Stored width-first the way they're drawn
// here, so "swap" is the only orientation control needed.
const SIZES = PAPER_SIZES.filter((p) => p.w && p.h).map((p) => ({
 id: p.id,
 name: p.name,
 w: p.w! / 25.4,
 h: p.h! / 25.4,
}));

const TOOLS: { kind: Tool; label: string; hint: string; icon: JSX.Element }[] = [
 { kind: "select", label: "Select", hint: "Select (V): drag a shape to move it, its corners to resize", icon: <MousePointer2 /> },
 { kind: "rect", label: "Rectangle", hint: "Rectangle (R): drag on the page", icon: <Square /> },
 { kind: "ellipse", label: "Ellipse", hint: "Oval (O): drag on the page", icon: <Circle /> },
 { kind: "line", label: "Line", hint: "Line (L): drag on the page", icon: <Minus /> },
 // Parametric shapes: drawn as a box like the rest, then tuned by their numbers in the Curve card.
 { kind: "hypotrochoid", label: "Spirograph", hint: "Draw a spirograph: drag on the page, then set its circles", icon: <LoaderPinwheel /> },
 { kind: "parabolic", label: "Parabolic curve", hint: "Draw curve stitching: drag on the page, then set its strings", icon: <Signal /> },
 { kind: "polygon", label: "Polygon", hint: "Polygon (P): drag on the page, then set how many sides", icon: <Pentagon /> },
 { kind: "star", label: "Star", hint: "Star (S): drag on the page, then set its points", icon: <Star /> },
 { kind: "spiral", label: "Spiral", hint: "Draw a spiral: drag on the page, then set its turns", icon: <Shell /> },
 { kind: "arc", label: "Arc", hint: "Arc (A): drag on the page, then set where it starts and how far it goes", icon: <Rainbow /> },
 { kind: "wave", label: "Wave", hint: "Draw a wave: drag on the page, then set how many", icon: <AudioWaveform /> },
 { kind: "text", label: "Text", hint: "Text (T): drag to say how tall, then type the words", icon: <Type /> },
];

// Used when a tool has no palette of its own, so there is always a pen to draw with.
const PLAIN_PEN: PenColor = { name: "Black", color: "#262626" };
const TOOL_KEY = "studio-tool";
const FONT_KEY = "studio-font";
const SNAP_KEY = "studio-snap";
const SIMPLIFY_KEY = "studio-simplify";

// What each kind of fill is, at a glance, and what it costs the pen.
/** The letter that picks each tool. Lower case: the key is read that way, so Shift makes no odds. */
const TOOL_KEYS: Record<string, Tool> = {
 v: "select",
 r: "rect",
 o: "ellipse",
 l: "line",
 t: "text",
 p: "polygon",
 s: "star",
 a: "arc",
};

const FILL_ICON: Record<FillKind, JSX.Element> = {
 hatch: <Menu />,
 concentric: <Target />,
 wavy: <Waves />,
 dashes: <LineStyle />,
};

const FILL_HINT: Record<FillKind, string> = {
 hatch: "Straight lines, the spacing apart",
 concentric: "The shape's own outline stepped inward",
 wavy: "The same lines drawn as waves",
 dashes: "The same lines broken into strokes: lighter, and a pen lift each",
};

// How a shape repeats, as the row of round buttons in the Repeat card: one of them is always on.
const REPEATS: { kind: RepeatKind; label: string; hint: string; icon: JSX.Element }[] = [
 { kind: "line", label: "Row", hint: "Repeat it in a row, in whatever direction you point it", icon: <Ellipsis /> },
 { kind: "grid", label: "Grid", hint: "Repeat it in rows and columns", icon: <Grid2x2 /> },
 { kind: "ring", label: "Ring", hint: "Repeat it round a circle, with this shape at the top", icon: <Orbit /> },
];

// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
const LAST_FILE_KEY = "studio-last-file";
const PAPER_COLOR_KEY = "studio-paper-color";
/** The most shapes the Shapes card lists a row for. */
const SHAPE_LIST_LIMIT = 200;

// Undo keeps whole copies of the drawing rather than a list of changes: a drawing is a handful of
// shapes, so a copy costs nothing, and there's no way for a replayed change to go wrong.
interface Snapshot {
 shapes: Shape[];
 fills: Fill[];
 layers: Layer[];
 page: Page;
}
const HISTORY_LIMIT = 60;

type Saved = { path: string; folder: string } | null;

/** The one set of a shape's settings on show, or none at all. */
type ShapePanel = "simplify" | "fill" | "rotate" | "repeat" | null;

/** The drawing as it was last read from or written to a file: what "no changes to save" means. */
type OnDisk = { shapes: Shape[]; fills: Fill[]; layers: Layer[]; page: Page; name: string };

/**
 * A layer name nothing else in the drawing has. Studio finds a filled shape's layer by name when the
 * shape's outline isn't drawn, so two layers with one name would be two layers it can't tell apart.
 * A clash takes the next free number: "Yellow" becomes "Yellow 2", and "Yellow 2" becomes "Yellow 3".
 */
function uniqueName(wanted: string, taken: string[]): string {
 if (!taken.includes(wanted)) return wanted;
 const base = wanted.replace(/ \d+$/, "");
 let n = 2;
 while (taken.includes(`${base} ${n}`)) n++;
 return `${base} ${n}`;
}

/**
 * A photo split into tone bands is one photo on the page: whatever moved, sized or turned one band
 * takes the rest of its bands along with it.
 */
/** How a photo is split: by value, into colour groups, into CMYK plates, or already split into separations elsewhere. */
const photoMode = (p: Photo) => (p.separation ? "separations" : p.plate ? "cmyk" : p.ink ? "colour" : "value");

function withPhotoGroups(list: Shape[], changed: Shape[]): Shape[] {
 const leads = new Map(changed.filter((s) => s.photo?.group).map((s) => [s.photo!.group!, s]));
 if (!leads.size) return list;
 const moved = new Set(changed.map((s) => s.id));
 return list.map((s) => {
  const lead = s.photo?.group ? leads.get(s.photo.group) : undefined;
  if (!lead || moved.has(s.id)) return s;
  return {
   ...s, x: lead.x, y: lead.y, x2: lead.x2, y2: lead.y2, rotation: lead.rotation,
   photo: { ...s.photo!, crop: lead.photo?.crop, fit: lead.photo?.fit, margin: lead.photo?.margin },
  };
 });
}

/**
 * A photo sized to the page stops being sized to it once it's moved or sized by hand: that is a
 * choice of where it goes, and sizing the page again shouldn't undo it.
 */
function unfitIfMoved(before: Shape | undefined, after: Shape): Shape {
 if (!before || !after.photo?.fit) return after;
 const same = before.x === after.x && before.y === after.y && before.x2 === after.x2 && before.y2 === after.y2
  && (before.rotation ?? 0) === (after.rotation ?? 0);
 return same ? after : { ...after, photo: { ...after.photo, fit: undefined } };
}

/** Whether a Plot page is open in another tab of this browser: it answers when asked (see Plot's poll). */
function plotPageAnswers(): Promise<boolean> {
 if (!("BroadcastChannel" in window)) return Promise.resolve(false);
 return new Promise((resolve) => {
  const channel = new BroadcastChannel(PLOT_CHANNEL);
  const done = (answer: boolean) => {
   window.clearTimeout(timer);
   channel.close();
   resolve(answer);
  };
  const timer = window.setTimeout(() => done(false), 600);
  channel.onmessage = (e) => {
   if (e.data?.type === "plot-here") done(true);
  };
  channel.postMessage({ type: "open-in-plot" });
 });
}

/**
 * Whether a shape still has numbers to give up. Points drawn as the lines between them are already
 * what flattening would leave; a turn and a set of copies are not given up by it, so neither counts.
 */
const canFlatten = (s: Shape) => !(s.kind === "path" && !s.smooth);

export default function App() {
 const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
 const [shapes, setShapes] = useState<Shape[]>([]);
 const [fills, setFills] = useState<Fill[]>([]);
 const [layers, setLayers] = useState<Layer[]>(() => [{ id: newLayerId(), name: "Black", color: "#262626" }]);
 const [activeLayer, setActiveLayer] = useState<string>("");
 const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
 // A tool's measured hatch numbers are the sensible starting point for a new fill, and they live in
 // Plot's presets rather than being invented here.
 const [defaults, setDefaults] = useState({ angle: 45, spacingMm: 1.5 });
 const [presets, setPresets] = useState<Preset[]>([]);
 // The single-stroke fonts: the names the app offers, the ones that have been read, and the one new
 // text is set in. A font is only fetched when something wants to be drawn in it.
 const [fontList, setFontList] = useState<string[]>([]);
 const [fonts, setFonts] = useState<Record<string, StrokeFont>>({});
 // The same fonts, for the callbacks that run outside a render: adding, resizing, saving.
 const fontsRef = useRef(fonts);
 fontsRef.current = fonts;
 const [font, setFont] = useState<string>(() => load<string>(FONT_KEY) ?? "");
 // Snapping: what a drag rounds to, in inches, and whether it is on at all. Remembered, since it is
 // a way of working rather than a property of the drawing.
 const [snapping, setSnapping] = useState<boolean>(() => load<boolean>(`${SNAP_KEY}-on`) ?? false);
 const [snapStep, setSnapStep] = useState<number>(() => load<number>(SNAP_KEY) ?? 0.25);
 // How far a simplified path may stray from the one it was, in millimetres on the paper.
 const [simplifyMm, setSimplifyMm] = useState<number>(() => load<number>(SIMPLIFY_KEY) ?? 0.2);
 // Which of the shape's settings are on show, if any. One at a time, the way a row of tabs works:
 // each of these is settled once and then left alone - a shape is turned, or filled, or thinned
 // out - and all four sets of numbers at once buries the shape they are about. Pressing the one
 // that is open closes it, so the card can also be left with none of them showing.
 const [panel, setPanel] = useState<ShapePanel>(null);
 const showPanel = (which: Exclude<ShapePanel, null>) =>
  setPanel((open) => (open === which ? null : which));
 const simplifying = panel === "simplify";
 const filling = panel === "fill";
 const repeating = panel === "repeat";
 const rotating = panel === "rotate";
 const [model, setModel] = useState<PlotterModel | undefined>();
 // Paper to begin with: the page is what's being drawn on, and the bed is context around it.
 const [zoom, setZoom] = useState<Zoom>("paper");
 const [toolName, setToolName] = useState<string>(() => load<string>(TOOL_KEY) ?? "");
 const [tool, setTool] = useState<Tool>("rect");
 // Everything picked, in the order it was picked. The cards edit the last of them; a drag, a delete
 // or a nudge takes the lot, which is what makes moving a whole layer at once possible.
 const [selected, setSelected] = useState<string[]>([]);
 const pick = (id: string | null) => setSelected(id ? [id] : []);
 const [name, setName] = useState("Untitled");
 const [saved, setSaved] = useState<Saved>(null);
 const [busy, setBusy] = useState(false);
 const [browserOpen, setBrowserOpen] = useState(false);
 // Marks in the drawing on disk that Studio can't redraw, and the name it was opened under. Saving
 // rewrites a file from the shapes Studio holds, so overwriting that file would delete them.
 const [past, setPast] = useState<Snapshot[]>([]);
 const [future, setFuture] = useState<Snapshot[]>([]);
 const [foreign, setForeign] = useState(0);
 const [openedAs, setOpenedAs] = useState<string | null>(null);
 // Where a drawing that has never been saved will be: files stacked into one are saved next to the
 // first of them, not in the shared folder a new drawing goes to. Null means the server's default.
 const [saveTo, setSaveTo] = useState<string | null>(null);
 const [message, setMessage] = useState<{ text: string; ok: boolean }>({
  text: "Nothing saved yet",
  ok: false,
 });
 // Anything drawn since the last save has to be written again before Plot can print it. State
 // rather than a ref, because the Save button is disabled while it's false and so has to re-render
 // when it changes.
 const [dirty, setDirty] = useState(false);

 // What the file on disk was written from. Every edit replaces one of these arrays and leaves the
 // rest alone, so comparing them by identity answers "is there anything to save" in five pointer
 // comparisons - no deep compare of every path on every drag.
 const onDisk = useRef<OnDisk | null>(null);

 // Asking the question here, rather than raising a flag on a change and lowering it after a save,
 // is what makes the answer reliable: a save can rename the drawing and an open lands in its own
 // good time, and this doesn't care which order any of that happens in. A value missing from the
 // list is a change that would leave Save greyed out with the work still only on screen.
 useEffect(() => {
  const was = onDisk.current;
  setDirty(
   !was ||
    was.shapes !== shapes ||
    was.fills !== fills ||
    was.layers !== layers ||
    was.page !== page ||
    was.name !== name,
  );
 }, [shapes, fills, layers, page, name]);

 // Leaving with work that's only on screen - a reload, a closed tab, going to Plot where the browser
 // won't open a tab of its own - asks first, in the browser's own words.
 useEffect(() => {
  if (!dirty || !shapes.length) return;
  const hold = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener("beforeunload", hold);
  return () => window.removeEventListener("beforeunload", hold);
 }, [dirty, shapes.length]);

 // Called by whoever just read or wrote the file, with the very values that went to disk.
 const markClean = useCallback((written: OnDisk) => {
  onDisk.current = written;
  setDirty(false);
 }, []);

 // The drawing tool is written into the file too, so picking one is a change - but only when it's
 // picked here. On startup the stored tool is reconciled against Plot's presets, and that
 // correction arrives after the drawing has been read: counting it would leave a drawing that was
 // only just opened looking unsaved.
 const pickTool = useCallback((pen: string) => {
  setToolName(pen);
  setDirty(true);
 }, []);

 // Custom stays chosen while its width and height are typed, even through a size that happens to be
 // one of the list's on the way.
 const [customPaper, setCustomPaper] = useState(false);
 // The paper's colour: the page is drawn in it and the inks blend with it, as they do in Plot. This
 // browser's choice, like the grid - it's the sheet on the plotter today, not part of the drawing.
 const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
 useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
 const sizeId = useMemo(() => {
  const match = SIZES.find(
   (s) =>
    (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) ||
    (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01),
  );
  return customPaper || !match ? "custom" : match.id;
 }, [page, customPaper]);

 // A photo split by colour draws each layer's area in that layer's pen, and each layer is worked
 // out alongside the rest - the pens of every area, and the key's. Give a layer another pen, and it
 // draws the same area in the new one, and the others are worked out again for it.
 useEffect(() => {
  setShapes((list) => {
   let changed = false;
   const colourOf = (m: Shape) => layers.find((l) => l.id === m.layerId)?.color ?? m.photo!.ink!;
   const next = list.map((sh) => {
    if (!sh.photo?.ink) return sh;
    const members = sh.photo.group ? list.filter((m) => m.photo?.group === sh.photo!.group) : [sh];
    const regionInks = (sh.photo.regions ?? []).map((_, r) => {
     const m = members.find((x) => x.photo?.region === r && !x.photo?.key);
     return m ? colourOf(m) : null;
    });
    const keyMember = members.find((x) => x.photo?.key);
    const keyInk = keyMember ? colourOf(keyMember) : undefined;
    const ink = colourOf(sh);
    if (sh.photo.plate) {
     // A CMYK plate: all four plates' pens, in plate order.
     const plates = PLATES.map((p) => { const m = members.find((x) => x.photo?.plate === p); return m ? colourOf(m) : "#000000"; });
     if (ink === sh.photo.ink && plates.join() === (sh.photo.plates ?? []).join()) return sh;
     changed = true;
     return { ...sh, photo: { ...sh.photo, ink, plates } };
    }
    if (ink === sh.photo.ink && keyInk === sh.photo.keyInk && regionInks.join() === (sh.photo.regionInks ?? []).join()) return sh;
    changed = true;
    return { ...sh, photo: { ...sh.photo, ink, keyInk, regionInks } };
   });
   return changed ? next : list;
  });
 }, [layers, shapes]);

 // Photos sized to the page follow it: a new paper size, or turning it, sizes them again.
 useEffect(() => {
  setShapes((list) => {
   let changed = false;
   const next = list.map((sh) => {
    const p = sh.photo;
    if (!p?.fit) return sh;
    const { crop, ...box } = placeOnPage(p.width / p.height, page, p.fit, p.margin ?? 0.5);
    if (Math.abs(box.x - sh.x) < 1e-6 && Math.abs(box.y - sh.y) < 1e-6 && Math.abs(box.x2 - sh.x2) < 1e-6 && Math.abs(box.y2 - sh.y2) < 1e-6) return sh;
    changed = true;
    return { ...sh, ...box, rotation: undefined, photo: { ...p, crop } };
   });
   return changed ? next : list;
  });
 }, [page]);

 // Called just before a change, never during one: a drag records once, when it starts.
 const record = useCallback(() => {
  setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), { shapes, fills, layers, page }]);
  setFuture([]);
 }, [shapes, fills, layers, page]);

 const step = useCallback(
  (from: Snapshot[], to: Snapshot[], setFrom: typeof setPast, setTo: typeof setFuture, take: "last" | "first") => {
   if (!from.length) return;
   const next = take === "last" ? from[from.length - 1] : from[0];
   setFrom(take === "last" ? from.slice(0, -1) : from.slice(1));
   setTo([{ shapes, fills, layers, page }, ...to].slice(0, HISTORY_LIMIT));
   setShapes(next.shapes);
   setFills(next.fills);
   setLayers(next.layers);
   setPage(next.page);
   // A shape that isn't there any more can't stay selected, or its handles would hang in the air.
   const still = new Set(next.shapes.map((s) => s.id));
   setSelected((ids) => ids.filter((id) => still.has(id)));
  },
  [shapes, fills, layers, page],
 );

 const undo = useCallback(() => step(past, future, setPast, setFuture, "last"), [step, past, future]);
 const redo = useCallback(() => step(future, past, setFuture, setPast, "first"), [step, future, past]);

 // The usual keys, except while typing: in the name field they belong to the text.
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
   e.preventDefault();
   (e.shiftKey ? redo : undo)();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, [undo, redo]);

 const addShape = useCallback((shape: Shape) => {
  record();
  // Text is as wide as its words: the drag only says how tall.
  setShapes((list) => [...list, shape.kind === "text" ? fitText(shape, fontsRef.current[shape.font ?? ""]) : shape]);
  pick(shape.id);
  setTool("select"); // what you want next is nearly always to nudge the thing you just drew
 }, [record]);

 const updateShape = useCallback((shape: Shape) => {
  const next = shape.kind === "text" ? fitText(shape, fontsRef.current[shape.font ?? ""]) : shape;
  setShapes((list) => {
   const placed = unfitIfMoved(list.find((s) => s.id === next.id), next);
   return withPhotoGroups(list.map((s) => (s.id === placed.id ? placed : s)), [placed]);
  });
 }, []);

 /** Several shapes changed at once, as a drag of a whole selection does. */
 const updateShapes = useCallback((changed: Shape[]) => {
  setShapes((list) => {
   const was = new Map(list.map((s) => [s.id, s]));
   const placed = changed.map((s) => unfitIfMoved(was.get(s.id), s));
   const byId = new Map(placed.map((s) => [s.id, s]));
   return withPhotoGroups(list.map((s) => byId.get(s.id) ?? s), placed);
  });
 }, []);

 // A copy of a shape and its fill, on the same layer, nudged down and to the right so it can be
 // seen - and chosen, ready to be dragged where it's wanted.
 // Copied shapes, kept in the app rather than in the system clipboard: what is on it is a shape
 // with its fills and its own numbers, and nothing outside Studio would know what to do with that.
 const [clipboard, setClipboard] = useState<{ shape: Shape; fills: Fill[] } | null>(null);

 const copyShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  setClipboard({ shape, fills: fills.filter((f) => f.shapeId === id) });
  // And on the system clipboard as a file another program can open: the lines, at the size they
  // were drawn, with the hatch if there is one. Written as an SVG file and as the same text,
  // because a browser may refuse the first and every drawing program takes pasted SVG source.
  const file = svgForMarks(runsOf(shape, true), penWidthMm / 25.4);
  if (!file || !navigator.clipboard) return;
  const write = navigator.clipboard.write?.bind(navigator.clipboard);
  const asText = () => navigator.clipboard.writeText?.(file).catch(() => {});
  if (!write || typeof ClipboardItem === "undefined") {
   void asText();
   return;
  }
  void write([
   new ClipboardItem({
    "image/svg+xml": new Blob([file], { type: "image/svg+xml" }),
    "text/plain": new Blob([file], { type: "text/plain" }),
   }),
  ]).catch(asText);
 };

 /** Put the copied shape down on a layer - the one being drawn on unless another is named. */
 const pasteShape = (layerId?: string) => {
  if (!clipboard) return;
  record();
  // A step down and across, so it lands beside what it came from rather than exactly on it.
  const copy: Shape = {
   ...moveBy(clipboard.shape, 0.25, 0.25, page),
   id: newShapeId(),
   layerId: layerId ?? activeLayer,
  };
  setShapes((list) => [...list, copy]);
  setFills((list) => [...list, ...clipboard.fills.map((f) => ({ ...f, id: newFillId(), shapeId: copy.id }))]);
  if (layerId && layerId !== activeLayer) setActiveLayer(layerId);
  pick(copy.id);
 };

 const duplicateShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  record();
  const nudge = 0.25;
  const copy: Shape = { ...shape, id: newShapeId(), x: shape.x + nudge, y: shape.y + nudge, x2: shape.x2 + nudge, y2: shape.y2 + nudge };
  setShapes((list) => [...list, copy]);
  setFills((list) => [...list, ...list.filter((f) => f.shapeId === id).map((f) => ({ ...f, id: newFillId(), shapeId: copy.id }))]);
  pick(copy.id);
 };

 // Move a shape to another pen. Its fills go with it, since a fill belongs to its shape, and both
 // are drawn in whatever colour the new layer carries.
 const moveShapeToLayer = (id: string, layerId: string) => {
  record();
  setShapes((list) => list.map((s) => (s.id === id ? { ...s, layerId } : s)));
  pick(id);
 };

 const removeShape = (id: string) => removeShapes([id]);

 /** Throw away several shapes at once - what Delete does to a whole selection. */
 const removeShapes = (ids: string[]) => {
  if (!ids.length) return;
  record();
  setShapes((list) => list.filter((s) => !ids.includes(s.id)));
  setFills((list) => list.filter((f) => !ids.includes(f.shapeId)));
  setSelected((current) => current.filter((id) => !ids.includes(id)));
 };

 /**
  * Nudge everything picked. The arrow keys move it a sixteenth of an inch, a whole inch with Shift
  * and a hundredth with Alt for the last little bit; the limit is the box round the whole selection,
  * so a group slides along the page's edge rather than piling up against it.
  */
 const nudge = (dx: number, dy: number) => {
  if (!selected.length) return;
  record();
  // Worked out from the list as it stands rather than from this render's copy, so two presses in
  // one tick both count instead of the second undoing the first.
  setShapes((list) => {
   const ids = new Set(selected);
   const moving = list.filter((s) => ids.has(s.id));
   if (!moving.length) return list;
   const { x0, y0, x1, y1 } = boxAround(moving);
   const byX = Math.max(-x0, Math.min(page.w - x1, dx));
   const byY = Math.max(-y0, Math.min(page.h - y1, dy));
   if (!byX && !byY) return list;
   const byId = new Map(moving.map((s) => [s.id, unfitIfMoved(s, moveBy(s, byX, byY, page))]));
   return withPhotoGroups(list.map((s) => byId.get(s.id) ?? s), [...byId.values()]);
  });
 };
 const nudgeRef = useRef(nudge);
 nudgeRef.current = nudge;

 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 1 / 16;
   const by: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
   };
   const move = by[e.key];
   if (!move || e.metaKey || e.ctrlKey) return;
   const el = document.activeElement;
   // In a field the arrows belong to the text, or to the number being stepped.
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   e.preventDefault();
   nudgeRef.current(move[0], move[1]);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, []);

 // A letter per tool, the way every drawing program has it: the pointer after drawing something,
 // and the three plain shapes without reaching for the toolbar.
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   const picked = TOOL_KEYS[e.key.toLowerCase()];
   if (!picked) return;
   if (e.metaKey || e.ctrlKey || e.altKey) return; // paste, and whatever else the system has
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   setTool(picked);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, []);

 // The same two things from the keyboard. Only with a modifier, and never while typing, where the
 // browser's own copy and paste belong to the text.
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   const key = e.key.toLowerCase();
   if (key === "c" && selected.length === 1) {
    e.preventDefault();
    copyShape(selected[0]);
   } else if (key === "v" && clipboard) {
    e.preventDefault();
    pasteShape();
   }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }); // eslint-disable-line react-hooks/exhaustive-deps

 // Delete (or Backspace) throws away everything picked - except while typing, where those keys
 // belong to the text. Undo brings it back, since removeShapes records first.
 const remove = useRef(removeShapes);
 remove.current = removeShapes;
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.key !== "Delete" && e.key !== "Backspace") return;
   if (!selected.length || e.metaKey || e.ctrlKey || e.altKey) return;
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   e.preventDefault();
   remove.current(selected);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, [selected]);

 // Write the drawing into the folder Plot opens from. Returns where it landed, or null on failure.
 const save = async (): Promise<Saved> => {
  if (!shapes.length) {
   setMessage({ text: "Draw something first", ok: false });
   return null;
  }
  // A drawing Studio only partly understands is written back from the shapes it holds, which would
  // drop the rest. Saving a copy is allowed; overwriting the original is not.
  if (foreign > 0 && cleanFileName(name) === openedAs) {
   setMessage({
    text: `${openedAs} has ${foreign} ${foreign === 1 ? "mark" : "marks"} Studio can’t redraw. Give it another name to save a copy.`,
    ok: false,
   });
   return null;
  }
  setBusy(true);
  try {
   const svg = buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, fonts });
   // Next to the file that was opened, so a drawing opened from the Desktop is saved back to the
   // Desktop - its card says "In ~/Desktop", and that is where it gets looked for. A drawing never
   // saved goes to the server's default, the shared iCloud folder.
   const res = await postJSON<{ name: string; path: string; folder: string }>("/api/studio/save", {
    name: cleanFileName(name),
    svg,
    ...(saved ? { folder: saved.path.slice(0, saved.path.lastIndexOf("/")) } : saveTo ? { folder: saveTo } : {}),
   });
   const where = { path: res.path, folder: res.folder };
   const savedName = res.name.replace(/\.svg$/i, "");
   setName(savedName);
   setSaved(where);
   setSaveTo(null);
   // What's on disk now is exactly what Studio holds, whatever the file used to contain.
   setForeign(0);
   setOpenedAs(res.name);
   remember(LAST_FILE_KEY, res.path);
   remember(LAST_FOLDER_KEY, res.path.slice(0, res.path.lastIndexOf("/")));
   markClean({ shapes, fills, layers, page, name: savedName });
   setMessage({ text: `Saved to ${res.folder}`, ok: true });
   return where;
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
   return null;
  } finally {
   setBusy(false);
  }
 };

 // Save if there's anything new, then hand the drawing to Plot. A Plot page already open in another
 // tab takes it from there - it shows whatever drawing was opened last - and Studio stays put. With no
 // Plot page open, one opens in a new tab; only if the browser won't allow that does this tab go.
 const openInPlot = async () => {
  const where = dirty || !saved ? await save() : saved;
  if (!where) return;
  setBusy(true);
  try {
   await postJSON("/api/open", { path: where.path });
   if (await plotPageAnswers()) {
    setMessage({ text: "Opened in Plot, in its own tab", ok: true });
    setBusy(false);
    return;
   }
   if (!window.open(APP_URL.plot, PLOT_CHANNEL)) window.location.href = APP_URL.plot;
   setBusy(false);
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
   setBusy(false);
  }
 };

 // Close whatever is open and begin again on a blank page. The page size stays as it is: it's the
 // paper you're working on today, and a new drawing is almost always for the same sheet.
 const [confirmNew, setConfirmNew] = useState(false);
 const newDrawing = useCallback(() => {
  const noShapes: Shape[] = [];
  const noFills: Fill[] = [];
  const first = { id: newLayerId(), name: "Black", color: "#262626" };
  const onlyLayer = [first];
  setShapes(noShapes);
  setFills(noFills);
  setLayers(onlyLayer);
  setActiveLayer(first.id);
  setSelected([]);
  setPast([]);
  setFuture([]);
  setName("Untitled");
  setSaved(null);
  setSaveTo(null);
  setForeign(0);
  setOpenedAs(null);
  setConfirmNew(false);
  remember(LAST_FILE_KEY, null); // don't reopen the old drawing next time Studio starts
  setMessage({ text: "New drawing", ok: true });
  // An empty page is not unsaved work, and the paper it's on came from the drawing before it.
  markClean({ shapes: noShapes, fills: noFills, layers: onlyLayer, page, name: "Untitled" });
 }, [markClean, page]);

 // Undo can't bring back which file was open - a snapshot is the drawing, not the drawing's name -
 // so unsaved work gets a question rather than a silent discard.
 const startNew = () => (dirty && shapes.length ? setConfirmNew(true) : newDrawing());

 const openDrawing = useCallback((res: OpenResult, note: (n: number) => string) => {
  const drawing = parseDrawing(res.svg ?? "");
  setPage(drawing.page);
  setShapes(drawing.shapes);
  setFills(drawing.fills);
  setLayers(drawing.layers);
  setActiveLayer(drawing.layers[0]?.id ?? "");
  setSelected([]);
  setPast([]);
  setFuture([]);
  setName(res.name.replace(/\.svg$/i, ""));
  setSaved({ path: res.path, folder: res.folder });
  setSaveTo(null);
  setForeign(drawing.unsupported);
  setOpenedAs(res.name);
  remember(LAST_FILE_KEY, res.path);
  // Saving would write only what Studio can draw, so anything else in the file has to be said out
  // loud before it's overwritten rather than discovered missing afterwards.
  setMessage(
   drawing.unsupported
    ? {
      text: `${note(drawing.shapes.length)} - ${drawing.unsupported} other ${drawing.unsupported === 1 ? "mark" : "marks"} can’t be edited here and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`,
      ok: false,
     }
    : { text: note(drawing.shapes.length), ok: true },
  );
  // What's on screen is what's in the file, so there's nothing new to write yet.
  markClean({
   shapes: drawing.shapes,
   fills: drawing.fills,
   layers: drawing.layers,
   page: drawing.page,
   name: res.name.replace(/\.svg$/i, ""),
  });
 }, [markClean]);

 // Files stacked into one drawing, a layer each (the file browser's "Open as layers" and "Add as
 // layers"). Opened, they are a new drawing not yet saved, which saves next to the first of them.
 // Added, they go on top of this one, and Undo takes them off again.
 const openCombined = (res: CombineResult) => {
  const drawing = parseDrawing(res.svg ?? "");
  const count = drawing.layers.length;
  if (res.added) {
   record();
  } else {
   setPast([]);
   setFuture([]);
   setName(res.name.replace(/\.svg$/i, ""));
   setSaved(null);
   setSaveTo(res.folder_path ?? null);
   setOpenedAs(null);
   remember(LAST_FILE_KEY, null); // nothing on disk to pick up again yet
   onDisk.current = null; // on screen and nowhere else: there is something to save
  }
  setPage(drawing.page);
  setShapes(drawing.shapes);
  setFills(drawing.fills);
  setLayers(drawing.layers);
  setActiveLayer(drawing.layers[drawing.layers.length - 1]?.id ?? "");
  setSelected([]);
  setForeign((was) => (res.added ? was : 0) + drawing.unsupported);
  // What most needs saying goes first: files that may not line up, then marks Studio can't redraw.
  const said = res.added ? `Added as layers - ${count} ${count === 1 ? "layer" : "layers"} now` : `Opened as ${count} layers - not saved yet`;
  const misfit = res.mismatched.length
   ? ` - ${listOf(res.mismatched)} ${res.mismatched.length === 1 ? "isn’t" : "aren’t"} on a page this size: pick Select all on layer from ${res.mismatched.length === 1 ? "its" : "their"} menu and drag to line up`
   : "";
  const foreignNote = drawing.unsupported
   ? ` - ${drawing.unsupported} other ${drawing.unsupported === 1 ? "mark" : "marks"} can’t be edited here and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`
   : "";
  setMessage({ text: said + misfit + foreignNote, ok: !misfit && !foreignNote });
 };

 // Say so if the server isn't there, rather than only failing at the moment of saving. Then pick up
 // the drawing this browser was last working on, so coming back from Plot lands where you left off.
 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    const info = await api<Info>("/api/info");
    if (!cancelled) setModel(info.models.find((m) => m.id === DEFAULT_SETTINGS.model) ?? info.models[0]);
   } catch {
    if (!cancelled) setMessage({ text: "Can’t reach the server. Is server.py running?", ok: false });
    return;
   }
   // A drawing handed over in the address - Plot's "Line up in Studio" - comes before the one
   // worked on last. The address is put back as it was, so reloading doesn't open it again.
   const handed = new URLSearchParams(window.location.search).get("open");
   if (handed) window.history.replaceState(null, "", window.location.pathname);
   const last = handed ?? load<string>(LAST_FILE_KEY);
   if (!last || cancelled) return;
   try {
    const res = await api<OpenResult>(`/api/studio/read?path=${encodeURIComponent(last)}`);
    if (!cancelled) openDrawing(res, (n) => `${handed ? "Opened" : "Picked up"} ${res.name} - ${n} ${n === 1 ? "shape" : "shapes"}`);
   } catch (err) {
    // Start clean but keep the pointer: the file may be fine and the server merely unreachable,
    // and throwing the only record of what was being worked on is the one unrecoverable move.
    // Opening or saving anything else replaces it anyway. A drawing handed over says why it didn't open.
    if (!cancelled) setMessage({ text: handed ? (err as Error).message : `Couldn’t reopen the last drawing. Use Open… to pick it up.`, ok: false });
   }
  })();
  return () => {
   cancelled = true;
  };
 }, [openDrawing]);

 // Plot's drawing tools, so a drawing is made with the pens it will actually be drawn with.
 useEffect(() => {
  api<{ presets: Preset[] }>("/api/presets")
   .then(({ presets: list }) => {
    setPresets(list);
    setToolName((current) => (list.some((t) => t.name === current) ? current : list[0]?.name ?? ""));
   })
   .catch(() => {}); // no presets is not a reason to stop; the fallbacks below stand
 }, []);

 // How the drawing is drawn: its paths as thin lines, or the ink they will make. Only how it's
 // painted - the drawing is the same either way. Not remembered: a drawing always opens in
 // Outline, which is quick whatever its size, and Preview is asked for when it is wanted.
 const [view, setView] = useState<View>("outline");
 // No photo left to show: back to the lines.
 const hasPhoto = shapes.some((sh) => sh.kind === "photo");
 useEffect(() => {
  if (!hasPhoto && view === "photo") setView("outline");
 }, [hasPhoto, view]);
 // Whether a photo's settings go to the layer being set, or to all its layers at once.
 const [photoAll, setPhotoAll] = useState(false);

 const tool2 = presets.find((t) => t.name === toolName) ?? null;
 const palette: PenColor[] = tool2?.palette?.length ? tool2.palette : [PLAIN_PEN];
 // Darkest last in the list, so the default pen is the one you'd reach for first.
 // The real line the pen lays down, so the drawing shows its true weight against the hatch spacing.
 const penWidthMm = tool2?.settings.pen_width ?? 0.7;
 // The same three numbers Plot reads off the same preset, so the ink looks the same in both.
 const inkOpacity = tool2?.settings.ink_opacity ?? 1;
 const inkBuilds = tool2?.settings.ink_builds !== false;
 const inkBuild = tool2?.settings.ink_build ?? 1;

 // A fill starts from the chosen tool's own measured numbers when it has them - and follows that
 // tool afterwards, because the spacing belongs to the pen: the same fill wants 0.35 mm from an
 // EnerGel and 1.7 mm from a marker. A fill whose numbers were set by hand keeps them.
 useEffect(() => {
  const hatch = tool2?.hatch;
  if (!hatch?.spacing_mm) return;
  const next = { angle: hatch.angle ?? 45, spacingMm: hatch.spacing_mm };
  setDefaults(next);
  setFills((list) => {
   if (!list.some((f) => !f.custom && f.spacingMm !== next.spacingMm)) return list;
   return list.map((f) => (f.custom ? f : { ...f, spacingMm: next.spacingMm }));
  });
 }, [tool2]);

 useEffect(() => {
  if (toolName) remember(TOOL_KEY, toolName);
 }, [toolName]);

 // The fonts: the list once, then each one the drawing actually asks for.
 useEffect(() => {
  fontNames()
   .then((names) => {
    setFontList(names);
    setFont((current) => (names.includes(current) ? current : names[0] ?? ""));
   })
   .catch(() => setFontList([]));
 }, []);
 useEffect(() => {
  const wanted = new Set([font, ...shapes.map((s) => s.font ?? "")].filter(Boolean));
  for (const name of wanted) {
   if (fonts[name]) continue;
   loadFont(name)
    .then((loaded) => setFonts((all) => ({ ...all, [name]: loaded })))
    .catch(() => {});
  }
 }, [font, shapes, fonts]);
 useEffect(() => {
  if (font) remember(FONT_KEY, font);
 }, [font]);
 useEffect(() => remember(`${SNAP_KEY}-on`, snapping), [snapping]);
 useEffect(() => remember(SNAP_KEY, snapStep), [snapStep]);
 useEffect(() => remember(SIMPLIFY_KEY, simplifyMm), [simplifyMm]);

 /** Change a text shape: its words, its font, or the room between letters and lines. Its box
  * follows whatever that comes to. */
 const setTextOf = (patch: { text?: string; font?: string; tracking?: number; leading?: number }) => {
  if (!chosen || chosen.kind !== "text") return;
  record();
  setShapes((list) => list.map((s) => {
   if (s.id !== chosen.id) return s;
   const next = { ...s, ...patch };
   return fitText(next, fonts[next.font ?? ""]);
  }));
 };

 // One shape at a time in the cards: the last one picked, and only while it is the only one, so
 // nothing is edited behind your back when a whole group is selected.
 const chosen = selected.length === 1 ? shapes.find((s) => s.id === selected[0]) ?? null : null;
 const chosenFills = chosen ? fills.filter((f) => f.shapeId === chosen.id) : [];

 // The layer new shapes land on, and the one the Shapes card lists. Always a real layer.
 const active = layers.find((l) => l.id === activeLayer) ?? layers[0];
 const onActive = shapes.filter((sh) => sh.layerId === active?.id);
 const pickedIds = useMemo(() => new Set(selected), [selected]);
 // The chosen photo's card counts its lines, which can only be made once the photo has been read.
 usePhotoRead(chosen?.photo?.src);

 // A photo, from a file on this Mac: made into a working copy, fitted to the page inside a half-inch
 // margin at its own proportions, and put on the layer being drawn on - whose ink it is hatched in.
 const photoInput = useRef<HTMLInputElement>(null);
 const addPhoto = async (file: File | undefined) => {
  if (!file || !active) return;
  try {
   const copy = await workingCopy(file);
   await readTones(copy.src);
   const margin = 0.5;
   const { crop, ...box } = placeOnPage(copy.width / copy.height, page, "fit", margin);
   const stem = file.name.replace(/\.[^.]+$/, "");
   const photo: Photo = { ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit", margin };
   const pens = tool2?.palette ?? [];
   // Matched to the tool's pens as it comes in. A colour photo is split by its colours, each group in
   // the nearest pen; a black and white one is one layer, in the pen nearest its darkest shade. With
   // no palette, it goes on the layer being drawn on, in that layer's ink.
   let parts: { pen: PenColor; photo: Partial<Photo> }[] = [];
   if (pens.length && isColourful(copy.src)) {
    const groups = colourGroups(copy.src, 4, photo.brightness, photo.contrast);
    const matched = matchPens(groups, pens);
    parts = groups.flatMap((_, region) => (matched[region] ? [{ pen: matched[region]!, photo: { ink: matched[region]!.color, regions: groups, region } as Partial<Photo> }] : []))
     // Stacked by the pens' own lightness, lightest at the bottom, as the layers are laid down.
     .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    // And the key on top, in the palette's darkest pen, to darken the shadows of every colour.
    const key = darkestPen(pens);
    if (parts.length && key) parts.push({ pen: key, photo: { key: true, ink: key.color, regions: groups } });
    const regionInks = groups.map((_, r) => matched[r]?.color ?? null);
    parts = parts.map((part) => ({ ...part, photo: { ...part.photo, regionInks, keyInk: key?.color } }));
   } else if (pens.length) {
    const pen = matchPens([darkestOf(copy.src)], pens)[0];
    if (pen) parts = [{ pen, photo: {} }];
   }
   if (!parts.length) {
    addShape({ id: newShapeId(), layerId: active.id, kind: "photo", name: stem, ...box, photo });
    setMessage({ text: `Added ${file.name}, hatched in ${active.name}`, ok: true });
    return;
   }
   // New layers for it, just above the one being drawn on - unless that one is empty, as a new
   // drawing's first layer is, in which case the first of them takes its place.
   record();
   const reuse = !shapes.some((sh) => sh.layerId === active.id);
   const group = parts.length > 1 ? newShapeId() : undefined;
   const newLayers: Layer[] = parts.map((part, i) => (i === 0 && reuse
    ? { ...active, name: layerNameOf(part), color: part.pen.color }
    : { id: newLayerId(), name: layerNameOf(part), color: part.pen.color }));
   const made: Shape[] = parts.map((part, i) => ({
    id: newShapeId(),
    layerId: newLayers[i].id,
    kind: "photo",
    name: parts.length > 1 ? `${stem} ${layerNameOf(part)}` : stem,
    ...box,
    photo: { ...photo, ...part.photo, group },
   }));
   setLayers((list) => {
    const at = list.findIndex((l) => l.id === active.id);
    const kept = reuse ? list.map((l) => (l.id === active.id ? newLayers[0] : l)) : list;
    const adding = reuse ? newLayers.slice(1) : newLayers;
    return [...kept.slice(0, at + 1), ...adding, ...kept.slice(at + 1)];
   });
   setShapes((list) => [...list, ...made]);
   setActiveLayer(newLayers[0].id);
   pick(made[0].id);
   setTool("select");
   setMessage({ text: `Added ${file.name}, in ${parts.map((p) => p.pen.name).join(", ")}`, ok: true });
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
  }
 };
 /**
  * Separations made elsewhere - a photo already split into greyscale plates, one file each - put in
  * as one photo on the page with a layer per plate, each drawing its own picture: darker where more
  * of its pen goes. A file named for its plate ("_C", "cyan", "-K") gets the palette's pen nearest
  * that plate and its screen angle; four files that don't say are taken as C, M, Y and K in the
  * order given; anything else is its own ink, in the darkest pen. Sized by the first, and the rest
  * over it, so they register. Layers stack by their pens' lightness, lightest at the bottom.
  */
 const addSeparations = async (files: File[]) => {
  if (!active || !files.length) return;
  try {
   const copies = await Promise.all(files.map(async (file) => {
    const copy = await workingCopy(file);
    await readTones(copy.src);
    return { file, copy };
   }));
   const pens = tool2?.palette ?? [];
   const matched = pens.length >= 4 ? platePens(pens) : [];
   const named = copies.map(({ file }) => plateNamed(file.name));
   // Four files and none named: C, M, Y and K, in the order they came.
   const plates = named.every((p) => !p) && copies.length === 4 ? [...PLATES] : named;
   const darkest = darkestPen(pens);
   const [first] = copies;
   const margin = 0.5;
   const { crop, ...box } = placeOnPage(first.copy.width / first.copy.height, page, "fit", margin);
   const stem = stemWithoutPlate(first.file.name);
   const group = copies.length > 1 ? newShapeId() : undefined;
   const parts = copies.map(({ file, copy }, i) => {
    const plate = plates[i];
    const pen = plate ? matched[PLATES.indexOf(plate)] ?? darkest : darkest;
    const separation = plate ? PLATE_AIMS[plate].name : file.name.replace(/\.[^.]+$/, "");
    return {
     pen,
     separation,
     layerName: pen?.name ?? separation,
     layerColor: pen?.color ?? active.color,
     photo: {
      ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit" as const, margin, group, separation,
      angle: plate ? PLATE_AIMS[plate].angle : PHOTO_DEFAULTS.angle + 15 * i,
     } as Photo,
    };
   }).sort((a, b) => (lightness(b.layerColor) ?? 0) - (lightness(a.layerColor) ?? 0));
   record();
   const reuse = !shapes.some((sh) => sh.layerId === active.id);
   const newLayers: Layer[] = parts.map((part, i) => (i === 0 && reuse
    ? { ...active, name: part.layerName, color: part.layerColor }
    : { id: newLayerId(), name: part.layerName, color: part.layerColor }));
   const made: Shape[] = parts.map((part, i) => ({
    id: newShapeId(), layerId: newLayers[i].id, kind: "photo", name: `${stem} ${part.separation}`, ...box, photo: part.photo,
   }));
   setLayers((list) => {
    const at = list.findIndex((l) => l.id === active.id);
    const kept = reuse ? list.map((l) => (l.id === active.id ? newLayers[0] : l)) : list;
    const adding = reuse ? newLayers.slice(1) : newLayers;
    return [...kept.slice(0, at + 1), ...adding, ...kept.slice(at + 1)];
   });
   setShapes((list) => [...list, ...made]);
   setActiveLayer(newLayers[0].id);
   pick(made[0].id);
   setTool("select");
   // Pictures of other proportions are stretched over the first, which puts them out of register.
   const aspect = first.copy.width / first.copy.height;
   const odd = copies.filter(({ copy }) => Math.abs(copy.width / copy.height / aspect - 1) > 0.01).map(({ file }) => file.name);
   setMessage(odd.length
    ? { text: `${odd.join(", ")} ${odd.length === 1 ? "isn't" : "aren't"} the same shape as ${first.file.name}, so ${odd.length === 1 ? "it's" : "they're"} stretched to it and won't line up`, ok: false }
    : { text: `Added ${copies.length} separations: ${parts.map((p) => `${p.separation} in ${p.layerName}`).join(", ")}`, ok: true });
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
  }
 };

 /**
  * Which plate the chosen separation is: its name, its screen angle, and its layer's pen - the
  * palette's nearest to that plate, if the tool has four pens.
  */
 const setSeparationPlate = (plate: Plate | "other") => {
  if (!chosen?.photo?.separation) return;
  const pens = tool2?.palette ?? [];
  const pen = plate !== "other" && pens.length >= 4 ? platePens(pens)[PLATES.indexOf(plate)] : undefined;
  const was = chosen.photo.separation;
  const wasPlate = PLATES.some((p) => PLATE_AIMS[p].name === was);
  const separation = plate === "other" ? (wasPlate ? "Ink" : was) : PLATE_AIMS[plate].name;
  const name = chosen.name?.endsWith(` ${was}`) ? chosen.name.slice(0, -was.length - 1) : chosen.name ?? "Photo";
  record();
  setShapes((list) => list.map((sh) => (sh.id === chosen.id
   ? { ...sh, name: `${name} ${separation}`, photo: { ...sh.photo!, separation, ...(plate !== "other" ? { angle: PLATE_AIMS[plate].angle } : {}) } }
   : sh)));
  if (pen) setLayers((list) => list.map((l) => (l.id === chosen.layerId ? { ...l, name: pen.name, color: pen.color } : l)));
 };

 /**
  * Split the chosen photo into tone bands, one layer each, or put it back to one. The lightest band
  * keeps the photo's own layer and settings; each darker one gets a layer of its own above it, in the
  * same ink, named after the ink and the band - so the layers still say which pen to load, and the
  * lightest stays at the bottom. Every band starts from the same settings, to be changed one by one.
  */
 /**
  * Rebuild the chosen photo as these layers: one photo shape each, the first keeping the photo's own
  * shape and layer, the rest on new layers put just above it, in order. The layers the photo's other
  * shapes were on go with them, once nothing else is left on them.
  */
 const rebuildPhoto = (parts: { layerName: string; layerColor: string; shapeName: string; photo: Partial<Photo> }[], group: string | undefined, note: string) => {
  if (!chosen?.photo) return;
  const oldGroup = chosen.photo.group;
  const members = oldGroup ? shapes.filter((sh) => sh.photo?.group === oldGroup) : [chosen];
  const base = members.find((m) => !m.photo?.band || m.photo.band[0] <= 0) ?? chosen;
  const baseLayer = layers.find((l) => l.id === base.layerId);
  if (!baseLayer || !parts.length) return;
  record();
  const others = new Set(members.filter((m) => m.id !== base.id).map((m) => m.id));
  const emptied = new Set(members.filter((m) => others.has(m.id)).map((m) => m.layerId)
   .filter((id) => id !== baseLayer.id && !shapes.some((sh) => sh.layerId === id && !others.has(sh.id))));
  const added: Layer[] = parts.slice(1).map((p) => ({ id: newLayerId(), name: p.layerName, color: p.layerColor }));
  const made: Shape[] = parts.map((p, i) => ({
   ...base,
   id: i === 0 ? base.id : newShapeId(),
   layerId: i === 0 ? baseLayer.id : added[i - 1].id,
   name: p.shapeName,
   photo: { ...base.photo!, ...p.photo, group },
  }));
  setLayers((list) => {
   const kept = list
    .filter((l) => !emptied.has(l.id))
    .map((l) => (l.id === baseLayer.id ? { ...l, name: parts[0].layerName, color: parts[0].layerColor } : l));
   const at = kept.findIndex((l) => l.id === baseLayer.id);
   return [...kept.slice(0, at + 1), ...added, ...kept.slice(at + 1)];
  });
  setShapes((list) => [...list.filter((sh) => !others.has(sh.id) && sh.id !== base.id), ...made]);
  pick(base.id);
  setMessage({ text: note, ok: true });
 };

 /** The chosen photo's layers as they stand, bottom first: what a mode remembers of itself. */
 const photoParts = (): PhotoPart[] => {
  if (!chosen?.photo) return [];
  const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
  const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
  return [...members].sort((a, b) => place(a) - place(b)).map((m) => {
   const layer = layers.find((l) => l.id === m.layerId);
   const own = Object.fromEntries(LAYER_SETTINGS.map((k) => [k, m.photo![k]]));
   return { layerName: layer?.name ?? "Black", layerColor: layer?.color ?? "#262626", shapeName: m.name ?? "Photo", photo: own };
  });
 };

 /**
  * Split the chosen photo the other way - by value or by colour - keeping how it was split this way
  * for when it comes back, and putting back how it was split that way before, if it has been.
  */
 const switchPhotoMode = (to: "value" | "colour" | "cmyk") => {
  if (!chosen?.photo) return;
  const from = photoMode(chosen.photo);
  if (from === to) return;
  const modes = { ...(chosen.photo.modes ?? {}), [from]: photoParts() };
  const back = modes[to];
  if (back?.length) {
   rebuildPhoto(
    back.map((part) => ({ ...part, photo: { ...Object.fromEntries(LAYER_SETTINGS.map((k) => [k, undefined])), ...part.photo, modes } })),
    back.length > 1 ? chosen.photo.group ?? newShapeId() : undefined,
    `Back to how it was split by ${to}`,
   );
  } else if (to === "colour") {
   splitPhotoByColor(3, { modes });
  } else if (to === "cmyk") {
   splitPhotoCmyk({ modes });
  } else {
   splitPhoto(1, { modes });
  }
 };

 /**
  * Split the chosen photo into CMYK: four plates, each in the tool's pen nearest printing's cyan,
  * magenta, yellow or black, each hatched at its screen angle, drawn across the whole photo and
  * blended on paper. Layers stack by their pens' lightness, lightest at the bottom.
  */
 const splitPhotoCmyk = (extra: Partial<Photo> = {}) => {
  if (!chosen?.photo) return;
  const pens = tool2?.palette ?? [];
  if (pens.length < 4) {
   setMessage({ text: `${tool2?.name ?? "This tool"} needs four pens in its palette to split a photo into CMYK`, ok: false });
   return;
  }
  const matched = platePens(pens);
  if (matched.some((p) => !p)) return;
  const plates = matched.map((p) => p!.color);
  const { name } = photoStem();
  const parts = PLATES.map((plate, i) => ({ plate, pen: matched[i]! }))
   .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
  rebuildPhoto(
   parts.map(({ plate, pen }) => ({
    layerName: pen.name,
    layerColor: pen.color,
    shapeName: `${name} ${pen.name}`,
    photo: {
     band: undefined, key: undefined, keyInk: undefined, regions: undefined, region: undefined, regionInks: undefined,
     plate, plates, ink: pen.color, angle: PLATE_AIMS[plate].angle, ...extra,
    },
   })),
   chosen.photo.group ?? newShapeId(),
   `Split into CMYK: ${PLATES.map((p, i) => `${PLATE_AIMS[p].name} in ${matched[i]!.name}`).join(", ")}`,
  );
 };

 /** The palette's darkest pen: what a photo's key layer starts in. */
 const darkestPen = (pens: PenColor[]) =>
  [...pens].sort((a, b) => (lightness(a.color) ?? 1) - (lightness(b.color) ?? 1))[0];
 /** A photo layer's name: its pen's, and " key" after it for the key. */
 const layerNameOf = (part: { pen: PenColor; photo: Partial<Photo> }) => (part.photo.key ? `${part.pen.name} key` : part.pen.name);

 /** Put the chosen photo's key layer on, in the palette's darkest pen, or take it off. */
 const setKeyLayer = (on: boolean) => {
  if (!chosen?.photo?.ink || !chosen.photo.regions) return;
  const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
  const existing = members.find((m) => m.photo?.key);
  if (on === Boolean(existing)) return;
  record();
  if (!on && existing) {
   const emptied = !shapes.some((sh) => sh.layerId === existing.layerId && sh.id !== existing.id);
   setShapes((list) => list.filter((sh) => sh.id !== existing.id).map((sh) => (members.some((m) => m.id === sh.id) ? { ...sh, photo: { ...sh.photo!, keyInk: undefined } } : sh)));
   if (emptied) setLayers((list) => list.filter((l) => l.id !== existing.layerId));
   if (chosen.id === existing.id) pick(members.find((m) => m.id !== existing.id)?.id ?? null);
   setMessage({ text: "Key layer off", ok: true });
   return;
  }
  const pen = darkestPen(tool2?.palette ?? []);
  if (!pen) return;
  const group = chosen.photo.group ?? newShapeId();
  const top = members.reduce((hi, m) => Math.max(hi, layers.findIndex((l) => l.id === m.layerId)), -1);
  const layer: Layer = { id: newLayerId(), name: `${pen.name} key`, color: pen.color };
  const { name } = photoStem();
  const keyShape: Shape = { ...chosen, id: newShapeId(), layerId: layer.id, name: `${name} ${pen.name} key`, photo: { ...chosen.photo, group, key: true, region: undefined, ink: pen.color, keyInk: pen.color } };
  setLayers((list) => [...list.slice(0, top + 1), layer, ...list.slice(top + 1)]);
  setShapes((list) => [...list.map((sh) => (members.some((m) => m.id === sh.id) ? { ...sh, photo: { ...sh.photo!, group, keyInk: pen.color } } : sh)), keyShape]);
  setMessage({ text: `Key layer on, in ${pen.name}`, ok: true });
 };

 /**
  * The photo's own name, and the ink a split by value draws in, without what an earlier split added:
  * the band word after a name, or the pen's name after a colour split's. From a colour split, the
  * value split takes its darkest ink.
  */
 const photoStem = () => {
  const words = /\s+(lightest|lighter|light|mid|dark|darker|darkest)$/i;
  const members = chosen?.photo?.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : chosen ? [chosen] : [];
  const base = members[0];
  const layer = layers.find((l) => l.id === base?.layerId);
  let name = base?.name ?? "Photo";
  if (base?.photo?.ink && layer && name.endsWith(` ${layer.name}`)) name = name.slice(0, -layer.name.length - 1);
  else name = name.replace(words, "");
  // From a colour split, the key's ink if it has one - the darkest - else its darkest colour's.
  const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
  const darkest = [...members].sort((a, b) => (a.photo?.key ? 1 : 0) - (b.photo?.key ? 1 : 0) || place(a) - place(b)).pop();
  const inkLayer = base?.photo?.ink ? layers.find((l) => l.id === darkest?.layerId) : layer;
  return { name, ink: (inkLayer?.name ?? "Black").replace(words, "").replace(/\s+key$/i, ""), color: inkLayer?.color ?? "#262626" };
 };

 /**
  * Split the chosen photo by value into tone bands, one layer each, or put it back to one. The
  * lightest band keeps the photo's own layer; each darker one gets a layer above it, in the same ink,
  * named after the ink and the band - so the layers still say which pen to load, lightest at the
  * bottom. Every band starts from the same settings, to be changed one by one.
  */
 const splitPhoto = (count: number, extra: Partial<Photo> = {}) => {
  if (!chosen?.photo) return;
  const n = Math.min(MOST_LAYERS, Math.max(1, Math.round(count)));
  const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
  if (members.length === n && !chosen.photo.ink && !extra.modes) return;
  const { name, ink, color } = photoStem();
  const words = BAND_NAMES[n] ?? [];
  rebuildPhoto(
   Array.from({ length: n }, (_, i) => ({
    layerName: n > 1 ? `${ink} ${words[i]}` : ink,
    layerColor: color,
    shapeName: n > 1 ? `${name} ${words[i]}` : name,
    photo: { band: n > 1 ? [i / n, (i + 1) / n] as [number, number] : undefined, ink: undefined, regions: undefined, region: undefined, key: undefined, keyInk: undefined, regionInks: undefined, plate: undefined, plates: undefined, ...extra },
   })),
   n > 1 ? chosen.photo.group ?? newShapeId() : undefined,
   n > 1 ? `Split into ${n} tone layers` : "One layer, by value",
  );
 };

 /**
  * Split the chosen photo by colour: its colours gathered into this many groups of similar colours,
  * each group matched to the nearest pen of the tool's palette, one layer each - named and coloured
  * after its pen, lightest at the bottom. Each layer draws its group's area, in its pen; give the
  * layer another pen and it draws the same area in that one. A group so pale it's the paper gets no
  * layer, so a photo can come back with fewer than asked.
  */
 const splitPhotoByColor = (count: number, extra: Partial<Photo> = {}) => {
  if (!chosen?.photo) return;
  const pens = tool2?.palette ?? [];
  if (!pens.length) {
   setMessage({ text: `${tool2?.name ?? "This tool"} has no palette of inks to split a photo into`, ok: false });
   return;
  }
  const n = Math.min(MOST_LAYERS, Math.max(1, Math.round(count)));
  const groups = colourGroups(chosen.photo.src, n, chosen.photo.brightness, chosen.photo.contrast);
  const matched = matchPens(groups, pens);
  const parts = groups
   .map((hex, region) => ({ hex, region, pen: matched[region] }))
   .filter((g): g is { hex: string; region: number; pen: PenColor } => Boolean(g.pen))
   // Stacked by the pens' own lightness, lightest at the bottom: a group's pen can be a good deal
   // lighter or darker than the group's colour, and the layers go down in the pens.
   .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
  if (!parts.length) {
   setMessage({ text: "There's no colour in this photo to split, only paper", ok: false });
   return;
  }
  const { name } = photoStem();
  // The key on top, in the palette's darkest pen - or the pen the photo's key already has.
  const oldKey = chosen.photo.group ? shapes.find((sh) => sh.photo?.group === chosen.photo!.group && sh.photo?.key) : undefined;
  const keyPen = oldKey ? { name: layers.find((l) => l.id === oldKey.layerId)?.name.replace(/\s+key$/i, "") ?? "Key", color: oldKey.photo!.ink! } : darkestPen(pens);
  const regionInks = groups.map((_, r) => matched[r]?.color ?? null);
  const withKey = keyPen && (oldKey || photoMode(chosen.photo) !== "colour" || chosen.photo.keyInk !== undefined);
  rebuildPhoto(
   [
    ...parts.map(({ region, pen }) => ({
     layerName: pen.name,
     layerColor: pen.color,
     shapeName: `${name} ${pen.name}`,
     photo: { band: undefined, key: undefined, plate: undefined, plates: undefined, ink: pen.color, regions: groups, region, regionInks, keyInk: withKey ? keyPen!.color : undefined, ...extra },
    })),
    ...(withKey ? [{
     layerName: `${keyPen!.name} key`,
     layerColor: keyPen!.color,
     shapeName: `${name} ${keyPen!.name} key`,
     photo: { band: undefined, key: true, plate: undefined, plates: undefined, ink: keyPen!.color, regions: groups, region: undefined, regionInks, keyInk: keyPen!.color, ...extra },
    }] : []),
   ],
   parts.length + (withKey ? 1 : 0) > 1 ? chosen.photo.group ?? newShapeId() : undefined,
   `Split into ${parts.map((p) => p.pen.name).join(", ")}${withKey ? `, with ${keyPen!.name} as the key` : ""}${parts.length < n ? ` - the rest was paper, or near enough another` : ""}`,
  );
 };

 /**
  * Size the chosen photo - all its bands - to the page: all of it as large as it fits, or filling the
  * page and cropped, inside a margin. Square to the page again, whatever it was turned to.
  */
 const placePhoto = (how: "fit" | "fill", margin: number) => {
  if (!chosen?.photo) return;
  record();
  const group = chosen.photo.group;
  const { crop, ...box } = placeOnPage(chosen.photo.width / chosen.photo.height, page, how, margin);
  setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
   ? { ...sh, ...box, rotation: undefined, photo: { ...sh.photo!, crop, fit: how, margin } }
   : sh)));
 };
 /**
  * Scale the chosen photo - all its bands - about its middle, keeping its proportions. 100% is the
  * size Fit gives it inside the margin, so the number means the same whatever the page. Scaled by
  * number, it's no longer sized to the page.
  */
 const photoScale = (sh: Shape) => {
  const b = boxOf(sh);
  const aspect = (b.x1 - b.x0) / Math.max(1e-6, b.y1 - b.y0);
  const fit = placeOnPage(aspect, page, "fit", sh.photo?.margin ?? 0.5);
  return { b, aspect, fitW: fit.x2 - fit.x };
 };
 const setPhotoScale = (percent: number) => {
  if (!chosen?.photo || !(percent > 0)) return;
  const { b, aspect, fitW } = photoScale(chosen);
  const w = (fitW * percent) / 100;
  const h = w / aspect;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const box = { x: cx - w / 2, y: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
  record();
  const group = chosen.photo.group;
  setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
   ? { ...sh, ...box, photo: { ...sh.photo!, fit: undefined } }
   : sh)));
 };

 /** The margin a photo is sized inside: changing it sizes the photo again, if it's sized to the page. */
 const setPhotoMargin = (margin: number) => {
  if (!chosen?.photo) return;
  if (chosen.photo.fit) return placePhoto(chosen.photo.fit, margin);
  setPhotoOf({ margin });
 };

 /**
  * Put a different picture in the chosen photo - all its layers - keeping everything else: how it's
  * split, its layers and pens, and every layer's settings. Sized to the page, it's sized again for the
  * new picture; placed by hand, it keeps its place and width, its height following the new picture.
  * Split by colour, the new picture is sorted into the same colour groups, so the layers stay as
  * they are.
  */
 const replaceInput = useRef<HTMLInputElement>(null);
 const replacePhoto = async (file: File | undefined) => {
  if (!file || !chosen?.photo) return;
  try {
   const copy = await workingCopy(file);
   await readTones(copy.src);
   const aspect = copy.width / copy.height;
   const was = chosen.photo;
   let box: { x: number; y: number; x2: number; y2: number };
   let crop: Photo["crop"];
   if (was.fit) {
    const placed = placeOnPage(aspect, page, was.fit, was.margin ?? 0.5);
    crop = placed.crop;
    box = { x: placed.x, y: placed.y, x2: placed.x2, y2: placed.y2 };
   } else {
    const b = boxOf(chosen);
    const w = b.x1 - b.x0;
    const h = w / aspect;
    const cy = (b.y0 + b.y1) / 2;
    box = { x: b.x0, y: cy - h / 2, x2: b.x1, y2: cy + h / 2 };
    crop = undefined;
   }
   record();
   if (was.separation) {
    // A separation is one plate of the photo: only its own picture changes, in the same place, so it
    // stays in register with the rest.
    setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height } } : sh)));
    const aspect0 = was.width / was.height;
    setMessage(Math.abs(aspect / aspect0 - 1) > 0.01
     ? { text: `${file.name} isn't the same shape as the other plates, so it's stretched to them and won't line up`, ok: false }
     : { text: `Replaced the ${was.separation} plate with ${file.name}`, ok: true });
    return;
   }
   const group = was.group;
   setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
    ? { ...sh, ...box, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height, crop } }
    : sh)));
   setMessage({ text: `Replaced the photo with ${file.name}, keeping its settings`, ok: true });
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
  }
 };

 /** Change how the chosen photo is turned into lines. */
 const setPhotoOf = (patch: Partial<Photo>) => {
  if (!chosen?.photo) return;
  record();
  // Brightness and contrast are the photo's, not a band's: they decide where the bands are cut, and
  // bands cut from different photos would overlap or leave gaps. The rest is each band's own.
  const group = chosen.photo.group;
  const whole: Partial<Photo> = {};
  if (patch.brightness !== undefined) whole.brightness = patch.brightness;
  if (patch.contrast !== undefined) whole.contrast = patch.contrast;
  if (patch.bleed !== undefined) whole.bleed = patch.bleed;
  if (patch.keyStrength !== undefined) whole.keyStrength = patch.keyStrength;
  if (patch.keyFrom !== undefined) whole.keyFrom = patch.keyFrom;
  if (patch.blackShare !== undefined) whole.blackShare = patch.blackShare;
  // Set for all its layers: everything changed here goes to every one of them.
  const toAll = photoAll ? patch : whole;
  setShapes((list) => list.map((sh) => {
   if (sh.id === chosen.id) return { ...sh, photo: { ...sh.photo!, ...patch } };
   if (group && sh.photo?.group === group && Object.keys(toAll).length) return { ...sh, photo: { ...sh.photo, ...toAll } };
   return sh;
  }));
 };

 const newFill = (angle: number): Fill => ({
  id: newFillId(),
  shapeId: chosen!.id,
  angle,
  spacingMm: defaults.spacingMm,
  scale: 100,
 });

 /** A fill the user has typed numbers into stops following the tool until it's told to again. */
 const setFillByHand = (at: number, next: Fill) => setFillAt(at, { ...next, custom: true });

 /** Hand this fill back to the tool: its numbers become the tool's again, and follow it from now on. */
 const followTool = (at: number, fill: Fill) =>
  setFillAt(at, { ...fill, custom: undefined, angle: defaults.angle, spacingMm: defaults.spacingMm });

 /** Replace one of the chosen shape's fills, or drop it. Adding uses `at` past the end. */
 const setFillAt = (at: number, next: Fill | null) => {
  if (!chosen) return;
  record();
  setFills((list) => {
   const mine = list.filter((f) => f.shapeId === chosen.id);
   const others = list.filter((f) => f.shapeId !== chosen.id);
   const updated = [...mine];
   if (next) updated[at] = next;
   else updated.splice(at, 1);
   return [...others, ...updated.filter(Boolean)];
  });
 };

 /** Turn the chosen shape about the middle of its box. Its fill turns with it. */
 const setRotation = (deg: number) => {
  if (!chosen) return;
  record();
  // Kept in 0-359 so the field never walks off into the hundreds when it's nudged round.
  const turn = ((deg % 360) + 360) % 360;
  setShapes((list) => list.map((s) => (s.id === chosen.id ? { ...s, rotation: turn || undefined } : s)));
 };

 /** Set a shape's size from the list, in inches, keeping its top-left corner where it is. */
 const setShapeSize = (id: string, w: number, h: number) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  record();
  setShapes((list) => list.map((s) => (s.id === id ? clampToPage(resizeTo(s, w, h), page) : s)));
 };

 /**
  * Flatten a shape: give up the numbers behind what it is, and keep what they drew. A curve becomes
  * a path with every point draggable, a word becomes the strokes of its font, a rectangle becomes
  * its four corners. What the shape IS becomes points; where its marks LAND is left alone, so the
  * turn and the copies stay settings and the copies go on following the points that can now be
  * dragged. Nothing is flattened for the sake of another app - the file always carries the marks
  * themselves - so this is only ever about being able to edit a thing by hand.
  */
 const flattenShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  record();
  const made: Shape[] = [];
  if (shape.kind === "text") {
   // Every stroke of every letter becomes its own path: the words are given up, the marks stay.
   for (const glyph of textRuns(shape, fonts[shape.font ?? ""])) {
    // The letter's own curves, kept as curves: a flattened word is the strokes of its font, not
    // the font walked out into segments.
    for (const points of parsePath(glyph.d)) {
     if (points.length < 2) continue;
     const b = pointsBox(flattenRun(points));
     made.push({
      ...shape, id: made.length ? newShapeId() : shape.id,
      kind: "path", points, text: undefined, font: undefined, tracking: undefined,
      leading: undefined,
      x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
     });
    }
   }
  } else if (shape.curve) {
   for (const points of curveStrokes(shape)) {
    if (points.length < 2) continue;
    const b = pointsBox(points);
    made.push({
     ...shape, id: made.length ? newShapeId() : shape.id,
     // The curve's numbers are given up, but not its shape: the points are kept as a curve
     // through them, so simplifying down to a handful still draws what was drawn.
     kind: "path", points, curve: undefined, smooth: true,
     x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
    });
   }
  } else {
   // A rectangle, an ellipse, a line or a path: left as its own points, so each one can be
   // pulled about point by point afterwards. A smoothed path gives up the curve here - what is
   // left is the points the pen was going to be walked through anyway.
   const runs = (shape.kind === "path" ? drawnRuns(shape) : [outlinePoints(shape)])
    .filter((run) => run.length > 1);
   if (!runs.length) return;
   const b = pointsBox(runs.flat());
   made.push({
    ...shape, id: shape.id,
    kind: "path", smooth: undefined,
    ...(runs.length > 1 ? { runs, points: undefined } : { runs: undefined, points: runs[0] }),
    x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
   });
  }
  if (!made.length) return;
  setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
  // Each new shape gets the fills the original had, so the drawing looks the same afterwards.
  setFills((list) => list.flatMap((f) => (f.shapeId === id
   ? made.map((s) => ({ ...f, id: s.id === id ? f.id : newFillId(), shapeId: s.id }))
   : [f])));
  pick(made[0].id);
 };

 /**
  * Bake a shape's copies: each one becomes a shape of its own, keeping the numbers behind it. A
  * ring of eight spirographs becomes eight spirographs, each still a spirograph to edit, rather
  * than eight paths - baking says where the marks land, not what they are made of. The turn a ring
  * gave a copy becomes that copy's own turn, and the shape's own turn stays the setting it was, so
  * all this changes is how many shapes there are and where they sit.
  */
 const bakeRepeat = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape?.repeat) return;
  record();
  // Turning about the middle and then moving is the same as moving and then turning about the
  // middle where it landed, which is why each copy can be its own shape at its own angle.
  const shift = (run: Node[], dx: number, dy: number) =>
   run.map((n) => mapNode(n, (p) => ({ x: p.x + dx, y: p.y + dy })));
  const made: Shape[] = placements(shape).map((place, i) => {
   const turn = (shape.rotation ?? 0) + place.deg;
   return {
    ...shape,
    id: i ? newShapeId() : shape.id,
    repeat: undefined,
    rotation: turn || undefined,
    x: shape.x + place.dx, y: shape.y + place.dy,
    x2: shape.x2 + place.dx, y2: shape.y2 + place.dy,
    ...(shape.runs
     ? { runs: shape.runs.map((run) => shift(run, place.dx, place.dy)) }
     : shape.points
      ? { points: shift(shape.points, place.dx, place.dy) }
      : {}),
   };
  });
  if (made.length < 2) return; // one copy is the shape itself: nothing to hand out
  setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
  setFills((list) => list.flatMap((f) => (f.shapeId === id
   ? made.map((s) => ({ ...f, id: s.id === id ? f.id : newFillId(), shapeId: s.id }))
   : [f])));
  pick(made[0].id);
 };

 /** Every run of marks a shape makes, in inches on the page: its copies, its turn and all. */
 const runsOf = (shape: Shape, withFills = false): Point[][] => {
  const centre = centerOf(shape);
  const runs: Point[][] = [];
  for (const place of placements(shape)) {
   const put = (p: Point) => {
    const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
    return { x: turned.x + place.dx, y: turned.y + place.dy };
   };
   const own = shape.kind === "text"
    ? textRuns(shape, fonts[shape.font ?? ""]).flatMap((g) => flattenPath(g.d))
    : shape.curve ? curveStrokes(shape)
    : shape.kind === "path" ? drawnRuns(shape)
    : [outlinePoints(shape)];
   // Its own outline, unless the shape is only there to be filled - and then its fill, for the
   // callers that want everything the pen draws rather than the shape's own line.
   if (!withFills || shape.outline !== false) {
    for (const run of own) {
     if (run.length > 1) runs.push(run.map(put));
    }
   }
   if (withFills) {
    for (const fill of fills.filter((f) => f.shapeId === shape.id)) {
     for (const run of fillRuns(shape, fill)) {
      if (run.length > 1) runs.push(run.map(put));
     }
    }
   }
  }
  return runs;
 };

 /** Every run a shape makes, as nodes: like runsOf, but a curve stays a curve rather than being
  * walked out - what joining wants, so a joined shape is no less exact than its parts. */
 const nodesOf = (shape: Shape): Node[][] => {
  const centre = centerOf(shape);
  const out: Node[][] = [];
  for (const place of placements(shape)) {
   const put = (p: Point): Point => {
    const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
    return { x: turned.x + place.dx, y: turned.y + place.dy };
   };
   const own: Node[][] = shape.kind === "text"
    ? textRuns(shape, fonts[shape.font ?? ""]).flatMap((g) => parsePath(g.d))
    : shape.curve ? curveStrokes(shape)
    : shape.kind === "path" ? drawnNodes(shape)
    : [outlinePoints(shape)];
   if (shape.outline !== false) out.push(...own.map((run) => run.map((n) => mapNode(n, put))));
  }
  return out;
 };

 /**
  * Join what's picked into one shape: every mark of every one of them becomes a run of a single
  * path, which then moves, scales and turns as one thing. A fill on the first of them is kept, and
  * with several runs to count against, a ring inside a ring leaves a hole.
  */
 const joinShapes = () => {
  const ids = new Set(selected);
  // A photo is its lines made from a picture, not an outline to join.
  const picked = shapes.filter((s) => ids.has(s.id) && s.kind !== "photo");
  if (picked.length < 2) return;
  const runs = picked.flatMap((s) => nodesOf(s));
  if (!runs.length) return;
  record();
  const first = picked[0];
  const b = pointsBox(runs.flatMap((run) => flattenRun(run)));
  const joined: Shape = {
   ...first, kind: "path", runs, points: undefined,
   curve: undefined, repeat: undefined, rotation: undefined,
   text: undefined, font: undefined, tracking: undefined, leading: undefined,
   x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
  };
  const gone = picked.slice(1).map((s) => s.id);
  setShapes((list) => list.flatMap((s) => (s.id === first.id ? [joined] : gone.includes(s.id) ? [] : [s])));
  setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
  setSelected([first.id]);
 };

 /**
  * Drop the points a path doesn't need. A drawing that has been through another program arrives
  * with its curves walked into thousands of points; this leaves the ones that carry the shape, so
  * they can be dragged - and the plotter has less to read.
  */
 const simplifyShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const runs = shape ? pathRuns(shape) : [];
  if (!shape || !runs.length) return;
  const tolerance = simplifyMm / 25.4;
  // Simplified from the points the path draws - its curves walked out - so a curved path is
  // thinned by what is on the page, not by its handles.
  const simpler = runs.map((run) => simplifyRun(flattenRun(run), tolerance)).filter((run) => run.length > 1);
  if (!simpler.length || simpler.reduce((n, r) => n + r.length, 0) >= runs.reduce((n, r) => n + r.length, 0)) return;
  record();
  // Simplifying is for keeping the shape while dropping the points, so what comes out is drawn as
  // a curve through them: straight lines between a tenth as many points would be a different
  // drawing. The Smooth button turns that off again for a path that really is straight.
  setShapes((list) => list.map((s) => (s.id === id
   ? { ...s, smooth: true, ...(s.runs ? { runs: simpler } : { points: simpler[0] }) }
   : s)));
  setPanel(null); // asked for, done, and out of the way again
 };

 /** Take a joined shape apart again: each run becomes a shape of its own. */
 const splitShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const runs = shape ? pathRuns(shape) : [];
  if (!shape || runs.length < 2) return;
  record();
  const made = runs.map((run, i) => {
   const b = pointsBox(run);
   return {
    ...shape, id: i ? newShapeId() : shape.id, kind: "path" as const,
    runs: undefined, points: run, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
   };
  });
  setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
  setSelected(made.map((s) => s.id));
 };

 /** Repeat the chosen shape, or stop repeating it. Every copy follows the shape itself. */
 const setRepeat = (repeat: Repeat | undefined) => {
  if (!chosen) return;
  record();
  setShapes((list) => list.map((s) => (s.id === chosen.id ? { ...s, repeat } : s)));
 };

 /** Change one of the chosen curve's numbers. The shape is redrawn from them as they change. */
 const setCurve = (next: Curve) => {
  if (!chosen) return;
  record();
  setShapes((list) => list.map((s) => (s.id === chosen.id ? { ...s, curve: next } : s)));
 };

 /** Draw the chosen path as a curve through its points, or as the lines between them. */
 const setSmooth = (id: string, on: boolean) => {
  record();
  setShapes((list) => list.map((s) => (s.id === id ? { ...s, smooth: on || undefined } : s)));
 };

 const setOutline = (on: boolean) => {
  if (!chosen) return;
  record();
  setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, outline: on } : sh)));
 };

 /** Hatch a shape, or stop hatching it. A shape that isn't hatched is drawn as its own outline:
  * turning the hatch off puts that outline back, so nothing is left invisible. */
 const setHatched = (on: boolean) => {
  if (!chosen) return;
  setFillAt(0, on ? newFill(defaults.angle) : null);
  if (!on && chosen.outline === false) {
   setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, outline: undefined } : sh)));
  }
 };

 // Restacking. The list is shown top-down but `layers` is bottom-first, like Plot's, so a row moved
 // n places down the list moves n places up the stack.
 const layerList = useRef<HTMLUListElement>(null);
 const layerRows = useRef(new Map<string, HTMLElement>());
 // Layers are shown top-first, the way they stack on the paper; the array holds them bottom-first,
 // the order they're drawn in. So a drop at display position `to` is a move to the mirrored index.
 const { dragging: layerDrag, start: startLayerDrag } = useRowDrag({
  rows: [...layers].reverse().map((l) => l.id),
  rowRefs: layerRows,
  listRef: layerList,
  disabled: busy,
  onStart: record,
  onMove: (id, to) =>
   setLayers((list) => {
    const from = list.length - 1 - list.findIndex((l) => l.id === id);
    if (to === from) return list;
    const next = [...list];
    next.splice(next.length - 1 - to, 0, next.splice(next.length - 1 - from, 1)[0]);
    return next;
   }),
 });

 const patchLayer = (id: string, patch: Partial<Layer>) => {
  record();
  setLayers((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
 };

 const addLayer = () => {
  record();
  // The next pen along in the palette, so a new layer doesn't arrive the same colour as the last.
  const used = new Set(layers.map((l) => l.name));
  const pen = palette.find((p) => !used.has(p.name)) ?? palette[palette.length - 1];
  const layer: Layer = { id: newLayerId(), name: pen.name, color: pen.color };
  setLayers((list) => [...list, layer]);
  setActiveLayer(layer.id);
 };

 // The layers in the order their inks want to be laid down: the lightest drawn first, everything
 // darker over it. Layer 1 is the bottom of the list, so that reads as lightest at the bottom. A
 // layer whose ink can't be read keeps to the bottom rather than being guessed at, and layers of
 // the same lightness stay in the order they were already in. The same sort Plot does, from the
 // same reading of the colour, so a drawing arrives there already stacked the way it will plot.
 const sortLayersByLightness = () => {
  record();
  setLayers((list) => {
   const ranked = list.map((l, i) => ({ l, i, light: lightness(l.color) }));
   ranked.sort((a, b) => {
    if (a.light === null || b.light === null) {
     return a.light === null && b.light === null ? a.i - b.i : a.light === null ? -1 : 1;
    }
    return b.light - a.light || a.i - b.i;
   });
   return ranked.map((r) => r.l);
  });
 };

 // A copy of a layer, directly above it: the same colour and every shape and fill on it, in the same
 // places, under the next free name. Plotted after the original, it's a second coat.
 const duplicateLayer = (id: string) => {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  record();
  const copy: Layer = { ...layer, id: newLayerId(), name: uniqueName(layer.name, layers.map((l) => l.name)) };
  const ids = new Map(shapes.filter((sh) => sh.layerId === id).map((sh) => [sh.id, newShapeId()]));
  setLayers((list) => {
   const next = [...list];
   next.splice(next.findIndex((l) => l.id === id) + 1, 0, copy);
   return next;
  });
  setShapes((list) => [...list, ...list.filter((sh) => ids.has(sh.id)).map((sh) => ({ ...sh, id: ids.get(sh.id)!, layerId: copy.id }))]);
  setFills((list) => [...list, ...list.filter((f) => ids.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: ids.get(f.shapeId)! }))]);
  setActiveLayer(copy.id);
 };

 // Merge with the layer below: its shapes, and the fills on them, move up onto this layer and take on
 // its name, colour and visibility; the layer below goes. This layer stays where it is in the stack.
 const mergeDown = (id: string) => {
  const at = layers.findIndex((l) => l.id === id);
  if (at < 1) return; // the bottom layer has nothing below it
  const below = layers[at - 1];
  record();
  setShapes((list) => list.map((sh) => (sh.layerId === below.id ? { ...sh, layerId: id } : sh)));
  setLayers((list) => list.filter((l) => l.id !== below.id));
  setActiveLayer((current) => (current === below.id ? id : current));
 };

 // Renaming in place. One undo step for the whole edit, taken as the field is entered, and the name is
 // settled when it's left: never empty, never a name another layer already has.
 const nameBeforeEdit = useRef<string>("");
 const typeLayerName = (id: string, name: string) =>
  setLayers((list) => list.map((l) => (l.id === id ? { ...l, name } : l)));
 const settleLayerName = (id: string) =>
  setLayers((list) => list.map((l) => {
   if (l.id !== id) return l;
   const wanted = l.name.trim() || nameBeforeEdit.current;
   return { ...l, name: uniqueName(wanted, list.filter((o) => o.id !== id).map((o) => o.name)) };
  }));

 // The same for a shape: typed in place, settled when the field is left. A name that is wiped out
 // goes back to being what the shape is and where it sits, rather than being left blank.
 // Picked on the page rather than in the list. The layer follows the shape: the list under it shows
 // one layer at a time, so a shape picked from another one would otherwise be held but not shown,
 // and what was drawn next would land on a layer nobody had chosen.
 const selectOnCanvas = (ids: string[]) => {
  setSelected(ids);
  const first = shapes.find((s) => s.id === ids[0]);
  if (first?.layerId && first.layerId !== activeLayer) setActiveLayer(first.layerId);
 };

 // Picking from the list: a plain click takes that shape alone, shift adds one or takes it out.
 // The row's box and its name both do this, which is why it is a function rather than a handler.
 const pickFromRow = (id: string, add: boolean) =>
  setSelected((current) => (add
   ? (current.includes(id) ? current.filter((one) => one !== id) : [...current, id])
   : [id]));

 // The shape whose name is open for typing into, and what it was called before: renaming is asked
 // for from the row's menu, and Escape puts the old name back.
 const [renaming, setRenaming] = useState<string | null>(null);
 // The same for a layer's name, which is edited the same way and for the same reason.
 const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
 const typeShapeName = (id: string, name: string) =>
  setShapes((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
 const settleShapeName = (id: string) =>
  setShapes((list) => list.map((s) => (s.id === id ? { ...s, name: s.name?.trim() || undefined } : s)));

 // A click anywhere but the field itself settles the name. The field's own blur does this too; this
 // is what covers the case where it never took focus in the first place, which would otherwise
 // leave the row typeable for good.
 useEffect(() => {
  if (!renaming && !renamingLayer) return;
  const away = (e: PointerEvent) => {
   if ((e.target as Element | null)?.closest?.("[data-renaming]")) return;
   if (renaming) {
    settleShapeName(renaming);
    setRenaming(null);
   }
   if (renamingLayer) {
    settleLayerName(renamingLayer);
    setRenamingLayer(null);
   }
  };
  document.addEventListener("pointerdown", away, true);
  return () => document.removeEventListener("pointerdown", away, true);
 }, [renaming, renamingLayer]); // eslint-disable-line react-hooks/exhaustive-deps

 // Any colour at all for a layer, from the system colour picker - for a pen that isn't in the tool's
 // palette. Only the colour changes; the layer keeps the name it has.
 const colorInput = useRef<HTMLInputElement>(null);
 const [customFor, setCustomFor] = useState<string | null>(null);
 const pickCustomColor = (id: string, near: HTMLElement) => {
  setCustomFor(id);
  const input = colorInput.current;
  if (input) {
   // The picker opens where its input is, so the input goes to the layer's swatch first.
   const at = near.getBoundingClientRect();
   input.style.left = `${at.left}px`;
   input.style.top = `${at.bottom}px`;
   input.value = layers.find((l) => l.id === id)?.color ?? "#808080";
   input.click();
  }
 };

 // The kebab menu on a layer or shape row: duplicate and delete.
 const [rowMenu, setRowMenu] = useState<{ kind: "layer" | "shape"; id: string; anchor: HTMLElement } | null>(null);
 // The shape whose size in the list is open for typing into. One at a time, like a rename.
 const [sizing, setSizing] = useState<string | null>(null);
 const [sizeAnchor, setSizeAnchor] = useState<HTMLElement | null>(null);

 // The popover closes itself on a click elsewhere or Escape; this is the other way it goes:
 useEffect(() => {
  if (sizing && (selected.length !== 1 || selected[0] !== sizing)) setSizing(null);
 }, [selected, sizing]);


 const removeLayer = (id: string) => {
  if (layers.length < 2) return; // there is always somewhere to draw
  record();
  const gone = shapes.filter((sh) => sh.layerId === id).map((sh) => sh.id);
  setShapes((list) => list.filter((sh) => sh.layerId !== id));
  setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
  setLayers((list) => list.filter((l) => l.id !== id));
  setActiveLayer((current) => (current === id ? layers.find((l) => l.id !== id)!.id : current));
  setSelected((current) => current.filter((id) => !gone.includes(id)));
 };

 const setSize = (id: string) => {
  setCustomPaper(id === "custom");
  const size = SIZES.find((s) => s.id === id);
  if (!size) return;
  record();
  // Keep the orientation the page is already in, so choosing a size doesn't also turn it.
  const landscape = page.w >= page.h;
  setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
 };

 return (
  <div className={styles.app}>
   <Hints />
   <FileBrowser
    open={browserOpen}
    endpoint="/api/studio/read"
    onClose={() => setBrowserOpen(false)}
    onOpened={(res) => openDrawing(res, (n) => `Opened ${res.name} - ${n} ${n === 1 ? "shape" : "shapes"}`)}
    combine={{
     endpoint: "/api/studio/combine",
     canAdd: shapes.length > 0,
     // This drawing as it would be saved, for the files to go on top of.
     base: () => buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, fonts }),
     onCombined: openCombined,
    }}
   />
   <StudioHeader message={message.text} ok={message.ok} />
   {colorMenu && layers.some((l) => l.id === colorMenu.id) && (
    <PaletteMenu
     anchor={colorMenu.anchor}
     palette={palette}
     current={layers.find((l) => l.id === colorMenu.id)?.color ?? null}
     onPick={(pen) => {
      // The name travels with the colour: Plot colours a layer from the pen its name matches.
      patchLayer(colorMenu.id, { name: uniqueName(pen.name, layers.filter((l) => l.id !== colorMenu.id).map((l) => l.name)), color: pen.color });
      setColorMenu(null);
     }}
     onCustom={() => pickCustomColor(colorMenu.id, colorMenu.anchor)}
     onClose={() => setColorMenu(null)}
    />
   )}
   {sizing && sizeAnchor && chosen?.id === sizing && (
    <SizePopover
     anchor={sizeAnchor}
     name={shapeName(chosen, onActive.indexOf(chosen))}
     width={boxOf(chosen).x1 - boxOf(chosen).x0}
     height={boxOf(chosen).y1 - boxOf(chosen).y0}
     onSize={(w, h) => setShapeSize(chosen.id, w, h)}
     onClose={() => setSizing(null)}
    />
   )}

   {rowMenu && (
    <RowMenu
     anchor={rowMenu.anchor}
     onClose={() => setRowMenu(null)}
     actions={rowMenu.kind === "layer"
      ? [
       {
        label: "Select all on layer",
        icon: <MousePointer2 />,
        disabled: !shapes.some((s) => s.layerId === rowMenu.id),
        // Picked as one, they move as one: the way a whole layer is shifted about the page.
        onSelect: () => setSelected(shapes.filter((s) => s.layerId === rowMenu.id).map((s) => s.id)),
       },
       {
        label: "Rename",
        icon: <PenLine />,
        onSelect: () => {
         nameBeforeEdit.current = layers.find((l) => l.id === rowMenu.id)?.name ?? "";
         record();
         setRenamingLayer(rowMenu.id);
        },
       },
       {
        label: "Paste",
        icon: <ClipboardPaste />,
        disabled: !clipboard,
        onSelect: () => pasteShape(rowMenu.id),
       },
       { label: "Duplicate layer", icon: <Copy />, onSelect: () => duplicateLayer(rowMenu.id) },
       {
        label: "Merge with below",
        icon: <LayersArrowDown />,
        disabled: layers.findIndex((l) => l.id === rowMenu.id) < 1,
        onSelect: () => mergeDown(rowMenu.id),
       },
       // There's always somewhere to draw, so the last layer stays.
       { label: "Delete", icon: <Trash2 />, danger: true, disabled: layers.length < 2, onSelect: () => removeLayer(rowMenu.id) },
      ]
      : [
       {
        label: "Rename",
        icon: <PenLine />,
        onSelect: () => {
         const s = shapes.find((sh) => sh.id === rowMenu.id);
         nameBeforeEdit.current = s?.name ?? "";
         record();
         setRenaming(rowMenu.id);
        },
       },
       ...(shapes.find((s) => s.id === rowMenu.id)?.kind === "path"
        ? [
         {
          // A path is either drawn through its points or between them; the label says
          // which it would become rather than which it is.
          label: shapes.find((s) => s.id === rowMenu.id)?.smooth ? "Draw straight" : "Smooth",
          icon: <Spline />,
          onSelect: () => setSmooth(rowMenu.id, !shapes.find((s) => s.id === rowMenu.id)?.smooth),
         },
        ]
        : []),
       { label: "Copy shape", icon: <ClipboardCopy />, onSelect: () => copyShape(rowMenu.id) },
       {
        label: "Set size",
        icon: <SquareDimensions />,
        // It opens off the kebab that asked for it, and needs the shape picked to know what
        // it is sizing.
        onSelect: () => {
         pick(rowMenu.id);
         setSizeAnchor(rowMenu.anchor);
         setSizing(rowMenu.id);
        },
       },
       {
        label: "Flatten",
        icon: <ArrowDownToLine />,
        // A path drawn as the lines between its own points has nothing left to give up. A
        // smoothed one has: flattening gives up the curve drawn through them.
        disabled: (() => {
         const s = shapes.find((sh) => sh.id === rowMenu.id);
         return !s || !canFlatten(s);
        })(),
        onSelect: () => flattenShape(rowMenu.id),
       },
       { label: "Duplicate shape", icon: <Copy />, onSelect: () => duplicateShape(rowMenu.id) },
       // One entry per other layer: a layer is a pen, so this is "draw this in that pen".
       ...layers
        .filter((l) => l.id !== shapes.find((s) => s.id === rowMenu.id)?.layerId)
        .map((l) => ({
         label: `Move to ${l.name}`,
         icon: <Layers2 />,
         onSelect: () => moveShapeToLayer(rowMenu.id, l.id),
        })),
       { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => removeShape(rowMenu.id) },
      ]}
    />
   )}
   <input
    ref={colorInput}
    type="color"
    className={styles.hiddenPicker}
    tabIndex={-1}
    aria-hidden
    onChange={(e) => {
     if (customFor) patchLayer(customFor, { color: e.target.value.toLowerCase() });
    }}
   />

   <main className={styles.layout}>
    <section className={styles.stage} aria-label="Drawing page">
     <Canvas
      page={page}
      paperColor={paperColor}
      shapes={shapes}
      fills={fills}
      model={model}
      zoom={zoom}
      // One bar over the page for everything true of what is being looked at: what has just
      // been done, how the drawing is drawn, and how close the view sits. It used to be two
      // groups at opposite ends of the width line.
      toolbarLeft={(
       <PreviewToolbar
        view={view}
        onView={setView}
        zoom={zoom}
        onZoom={setZoom}
        canDrawing={shapes.length > 0}
        canPhoto={shapes.some((sh) => sh.kind === "photo")}
        history={{ canUndo: past.length > 0, canRedo: future.length > 0, onUndo: undo, onRedo: redo }}
        disabled={busy}
       />
      )}
      layers={layers}
      activeLayer={active?.id ?? ""}
      penWidthMm={penWidthMm}
      inkOpacity={inkOpacity}
      inkBuilds={inkBuilds}
      inkBuild={inkBuild}
      view={view}
      tool={tool}
      fonts={fonts}
      font={font}
      snap={snapping ? snapStep : 0}
      selected={selected}
      onSelect={selectOnCanvas}
      onUpdateMany={updateShapes}
      onAdd={addShape}
      onUpdate={updateShape}
      onEditStart={record}
     />
    </section>

    <div className={styles.side}>
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <Section
        title="File"
        action={
         <span className={styles.headerTools}>
          {/* In the order they come up: the drawing in hand is saved, another is opened,
            a new one is started, and what is finished goes to Plot. */}
          {/* The library's safety button: the half of "are you sure?" that keeps the
            work, and the one button here that writes a file. */}
          <ConfirmButton
           size="sm"
           tone="safety"
           icon={<Save />}
           aria-label="Save"
           title={`Save this drawing${saved ? ` to ${saved.folder}` : ""}`}
           disabled={busy || !shapes.length || !dirty}
           onClick={save}
          />
          <ButtonRound
           size="sm"
           icon={<FolderOpen />}
           aria-label="Open a drawing"
           title="Open a drawing to carry on with"
           disabled={busy}
           onClick={() => setBrowserOpen(true)}
          />
          <ButtonRound
           size="sm"
           icon={<FilePlus />}
           aria-label="New drawing"
           title="Close this drawing and start a new one"
           disabled={busy}
           onClick={startNew}
          />
          <ButtonRound
           size="sm"
           icon={<Send />}
           aria-label="Send to Plot"
           title="Save this drawing and open it in Plot, ready to draw"
           disabled={busy || !shapes.length}
           onClick={openInPlot}
          />
         </span>
        }
       >
        <InputText
         size="md"
         label="Name"
         // The card is called File and the field holds the drawing's name: saying so twice under
         // the words themselves helps nobody who can see them.
         hideLabel
         value={name}
         disabled={busy}
         onChange={(e) => setName(e.target.value)}
        />
        <p className={controls.fileWhere} title={saved?.path ?? undefined}>
         {saved ? saved.folder : "Not saved yet"}
        </p>

        {/* Asked here rather than in a dialog: the question is about this card's drawing, and
          the answer is one of two buttons. Saving first is offered because wanting a new
          drawing is rarely the same as wanting to lose this one. */}
        {confirmNew && (
         <div className={styles.confirm} role="alertdialog" aria-label="Start a new drawing">
          <p>
           {saved ? `“${name}” has` : "This drawing has"} changes that aren’t saved.
          </p>
          <div className={styles.actions}>
           <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
             if (await save()) newDrawing();
            }}
           >
            Save, then start new
           </Button>
           <Button size="sm" tone="danger" variant="secondary" onClick={newDrawing}>
            Discard and start new
           </Button>
           <Button size="sm" variant="tertiary" onClick={() => setConfirmNew(false)}>
            Keep editing
           </Button>
          </div>
         </div>
        )}

       </Section>

       {/* What the drawing is made on and with, in the same card as the drawing itself: the same
         Settings, Paper and Drawing tool cards as Plot's, with the grid, which is Studio's alone. */}
       <SettingsSection tool={toolName} collapsibleKey="settings">
        <PaperSection
         w={page.w * 25.4}
         h={page.h * 25.4}
         sizeId={sizeId}
         units="in"
         color={paperColor}
         collapsibleKey="paper"
         onSize={setSize}
         onDimensions={(w, h) => {
          record();
          setPage({ w: w / 25.4, h: h / 25.4 });
         }}
         onColor={setPaperColor}
        />

        <Section title="Grid" collapsibleKey="grid">
         <Checkbox
          checked={snapping}
          label="Snap to the grid"
          title="Round what is drawn, moved and resized to the grid"
          onChange={(e) => setSnapping(e.target.checked)}
         />
         {snapping && (
          <NumberField
           label="Every"
           unit="in"
           min={0.01}
           max={12}
           step={0.125}
           value={snapStep}
           onChange={setSnapStep}
          />
         )}
        </Section>

        <DrawingToolSection tools={presets} value={toolName} onPick={pickTool} collapsibleKey="pen" disabled={busy} />
       </SettingsSection>
      </div>
     </Card>

     <Card variant="flat" className={styles.controls}>
      <div className={styles.cardBody}>
       <div className={styles.tools} role="group" aria-label="Shape to draw">
        {TOOLS.map((t) => (
         <ButtonRound
          key={t.kind}
          size="sm"
          icon={t.icon}
          className={tool === t.kind ? controls.roundActive : undefined}
          aria-label={t.label}
          aria-pressed={tool === t.kind}
          title={t.hint}
          onClick={() => setTool(t.kind)}
         />
        ))}
        {/* Not a tool to drag with: a photo comes from a file, and is placed on the page to fit. */}
        <ButtonRound
         size="sm"
         icon={<ImagePlus />}
         aria-label="Add a photo"
         title="Add a photo, matched to the tool's pens. Pick several greyscale separations at once (…_C, …_M, …_Y, …_K) for a layer each"
         disabled={busy}
         onClick={() => photoInput.current?.click()}
        />
        <input
         ref={photoInput}
         type="file"
         accept="image/*"
         hidden
         multiple
         onChange={(e) => {
          // Several at once are separations: one photo already split into plates, a layer each.
          const files = [...(e.target.files ?? [])];
          if (files.length > 1) addSeparations(files);
          else addPhoto(files[0]);
          e.target.value = ""; // so the same photo can be added again
         }}
        />
       </div>
      </div>
     </Card>

     {/* The layers, and what is on the one being worked on: two sections of one card. */}
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <Section title="Artwork" collapsibleKey="artwork">
       <Section
        title="Layers"
        collapsibleKey="layers"
        action={
         <span className={styles.headerTools}>
          {layers.length > 1 && (
           <ButtonRound size="sm" icon={<LayersArrowUp />} aria-label="Sort layers by darkness"
            title="Sort by darkness: the lightest ink is layer 1 and drawn first, with darker inks over it"
            disabled={busy} onClick={sortLayersByLightness} />
          )}
          <ButtonRound size="sm" icon={<Plus />} aria-label="Add a layer"
           title="Add a layer: one more pen to draw with" disabled={busy} onClick={addLayer} />
         </span>
        }
       >
        <ul className={styles.layerList} ref={layerList}>
         {[...layers].reverse().map((layer) => {
          const at = layers.indexOf(layer); // 0 is the bottom layer, as in Plot
          return (
           <li
            key={layer.id}
            className={styles.layerRow}
            data-dragging={layerDrag === layer.id}
            ref={(el) => {
             if (el) layerRows.current.set(layer.id, el);
             else layerRows.current.delete(layer.id);
            }}
           >
            <LayerController
             name="studio-layer"
             purpose="draw"
             number={at + 1}
             color={layer.color}
             // Struck through when the layer isn't one of this tool's pens by name and colour - the
             // same rule as Plot's Layers card. Only a tool with a palette of its own is asked.
             swatchCut={isPalettePen(layer.name, layer.color, tool2?.palette ?? []) === false}
             swatchProps={{
              "aria-label": isPalettePen(layer.name, layer.color, tool2?.palette ?? []) === false
               ? `Pen color for ${layer.name} - no ${tool2?.name ?? ""} pen is called that, in that colour`
               : `Pen color for ${layer.name}`,
              "aria-haspopup": "menu",
              "aria-expanded": colorMenu?.id === layer.id,
              title: "Choose the pen this layer draws with",
              disabled: busy,
              onClick: (e) => {
               const anchor = e.currentTarget;
               setColorMenu((open) => (open?.id === layer.id ? null : { id: layer.id, anchor }));
              },
             }}
             checked={active?.id === layer.id}
             visible={!layer.hidden}
             onVisibleChange={(visible) => patchLayer(layer.id, { hidden: !visible })}
             disabled={busy}
             onChange={() => {
              setActiveLayer(layer.id);
              // A layer with one shape on it is that shape: picking the layer picks it, so its card
              // comes up without a second click. With more on it, a photo's band on this layer still
              // is - the bands sit on top of each other on the page, so this is how to reach each.
              const on = shapes.filter((sh) => sh.layerId === layer.id);
              const band = chosen?.photo?.group && on.find((sh) => sh.photo?.group === chosen.photo!.group);
              if (on.length === 1) pick(on[0].id);
              else if (band) pick(band.id);
             }}
             aria-label={`Draw on layer ${at + 1}, ${layer.name}`}
             label={renamingLayer === layer.id ? (
              <input
               className={`${styles.shapeName} ${styles.shapeNameEdit}`}
               data-renaming
               value={layer.name}
               aria-label={`Name of layer ${at + 1}`}
               autoFocus
               disabled={busy}
               onFocus={(e) => e.currentTarget.select()}
               onChange={(e) => typeLayerName(layer.id, e.target.value)}
               onBlur={() => {
                settleLayerName(layer.id);
                setRenamingLayer(null);
               }}
               onKeyDown={(e) => {
                if (e.key === "Escape") typeLayerName(layer.id, nameBeforeEdit.current);
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
               }}
              />
             ) : (
              // Text, not a field: clicking it draws on that layer. Renaming is asked
              // for from the kebab, so nothing typed can land in a name by accident.
              // Green while it is the one being drawn on, like the nib beside it.
              <span
               className={layer.id === activeLayer
                ? `${styles.shapeName} ${styles.shapeNameOn}`
                : styles.shapeName}
               title="Click to draw on this layer"
               onClick={() => setActiveLayer(layer.id)}
              >
               {layer.name}
              </span>
             )}
             handleProps={{
              "aria-label": `Move ${layer.name}`,
              title: "Drag to restack",
              disabled: busy || layers.length < 2,
              onPointerDown: (e) => startLayerDrag(e, layer.id),
             }}
            />
            <ButtonRound size="sm" variant="ghost" icon={<EllipsisVertical />}
             aria-label={`More for layer ${layer.name}`}
             aria-haspopup="menu"
             aria-expanded={rowMenu?.id === layer.id}
             title="Duplicate, merge or delete this layer"
             disabled={busy}
             onClick={(e) => {
              const anchor = e.currentTarget;
              setRowMenu((open) => (open?.id === layer.id ? null : { kind: "layer", id: layer.id, anchor }));
             }} />
           </li>
          );
         })}
        </ul>
       </Section>

       {/* Only while there is something on the layer: a heading over a line saying there is
         nothing under it is two lines to say one thing. */}
       {active && onActive.length > 0 && (
        <Section
         // The layer's ink in front of its name - after the "On", so the dot reads as part
         // of the name rather than as a bullet before the whole heading. A mark to read,
         // not a control: picking the colour is the swatch in the row above.
         title={(
          <>
           On
           <span className={controls.legendDot} style={{ background: active.color }} aria-hidden />
           {active.name}
          </>
         )}
         collapsibleKey="shapes-on-layer"
         action={
          onActive.length ? (
           <ButtonRound size="sm" icon={<Trash2 />} aria-label="Delete everything on this layer"
            title="Delete every shape on this layer" disabled={busy}
            onClick={() => {
             record();
             const gone = onActive.map((sh) => sh.id);
             setShapes((list) => list.filter((sh) => !gone.includes(sh.id)));
             setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
             setSelected([]);
            }} />
          ) : undefined
         }
        >
         <ul className={styles.shapeList}>
           {onActive.slice(0, SHAPE_LIST_LIMIT).map((sh, i) => {
            const b = boxOf(sh);
            const name = shapeName(sh, i);
            return (
             // The same row a layer has: its number, its name, and the same kebab
             // after it - with the size where a layer keeps its eye.
             <li key={sh.id} className={styles.layerRow}>
              <LayerController
               // A group of its own per row: several shapes can be picked at once,
               // and a browser only ever lets one radio of a group be on.
               name={`studio-shape-${sh.id}`}
               purpose="draw"
               // No numeral: a layer is numbered because it is plotted in that
               // order, and a shape on it isn't. The row still says which it is to a
               // screen reader, below.
               number={null}
               // No swatch: everything on a layer draws in that layer's one ink, and
               // the row right above says which it is.
               hideVisibility
               hideHandle
               // A photo isn't drawn like the other shapes, so its row says so in the box.
               icon={sh.kind === "photo" ? <ImageIcon /> : undefined}
               checked={pickedIds.has(sh.id)}
               aria-label={`Shape ${i + 1}, ${name}`}
               // The click decides, not the box: several shapes can be picked, which
               // a radio would otherwise undo for us. Shift adds one to the selection
               // or takes it out; a plain click picks that shape alone.
               onChange={() => {}}
               onClick={(e) => {
                e.preventDefault();
                pickFromRow(sh.id, e.shiftKey);
               }}
               label={
                <span className={styles.shapeLabel}>
                 {/* The name is text: clicking the row picks the shape, and a field
                   sitting here would take the caret and quietly eat whatever was
                   typed next. Renaming is asked for from the kebab. */}
                 {renaming === sh.id ? (
                  <input
                   className={`${styles.shapeName} ${styles.shapeNameEdit}`}
                   data-renaming
                   value={name}
                   aria-label={`Name of ${name}`}
                   autoFocus
                   disabled={busy}
                   onFocus={(e) => e.currentTarget.select()}
                   onChange={(e) => typeShapeName(sh.id, e.target.value)}
                   onBlur={() => {
                    settleShapeName(sh.id);
                    setRenaming(null);
                   }}
                   onKeyDown={(e) => {
                    if (e.key === "Escape") typeShapeName(sh.id, nameBeforeEdit.current);
                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                   }}
                  />
                 ) : (
                  <span
                   className={pickedIds.has(sh.id)
                    ? `${styles.shapeName} ${styles.shapeNameOn}`
                    : styles.shapeName}
                   title="Click to pick this shape"
                   onClick={(e) => pickFromRow(sh.id, e.shiftKey)}
                  >
                   {name}
                  </span>
                 )}
                 {/* How big it is, at the end of the row. Numbers alone: the page is
                   inches throughout, and setting them is the kebab's job. */}
                 <span className={styles.shapeSize}>
                  {`${trimNum(b.x1 - b.x0, 2)} × ${trimNum(b.y1 - b.y0, 2)}`}
                 </span>
                </span>
               }
              />
              <ButtonRound size="sm" variant="ghost" icon={<EllipsisVertical />}
               aria-label={`More for ${name}`}
               aria-haspopup="menu"
               aria-expanded={rowMenu?.id === sh.id}
               title="Duplicate, move or delete this shape"
               disabled={busy}
               onClick={(e) => {
                const anchor = e.currentTarget;
                setRowMenu((open) => (open?.id === sh.id ? null : { kind: "shape", id: sh.id, anchor }));
               }} />
             </li>
            );
           })}
           {onActive.length > SHAPE_LIST_LIMIT && (
            // A separation's layer is tens of thousands of marks: a row each would be a list nobody
            // reads, and the slowest thing on the page. They're picked up together instead.
            <li className={styles.empty}>
             {`And ${(onActive.length - SHAPE_LIST_LIMIT).toLocaleString()} more - too many to list. Select all on layer, from the layer’s menu, picks them all.`}
            </li>
           )}
         </ul>
        </Section>
       )}
       </Section>
      </div>
     </Card>

     {selected.length > 1 && (
      <Card variant="flat" className={styles.controls}>
       <div className={styles.cardBody}>
        <Section title={`${selected.length} shapes`} collapsibleKey="selection">
         <Button size="md" variant="secondary" onClick={joinShapes}>Join into one shape</Button>
         <p className={styles.empty}>
          They become one path, drawn in as many strokes as they had marks, and move, scale
          and turn together from then on.
         </p>
        </Section>
       </div>
      </Card>
     )}

     {chosen?.kind === "photo" && chosen.photo && (() => {
      const b = boxOf(chosen);
      const marks = photoMarks(chosen.photo, b.x1 - b.x0, b.y1 - b.y0);
      return (
      <Card variant="flat" className={styles.controls}>
       <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section
         title={shapeName(chosen, onActive.indexOf(chosen))}
         collapsibleKey="photo"
         action={
          <>
           <Button size="sm" variant="secondary" title={chosen.photo.separation ? "Put a different picture in for this plate, keeping its settings" : "Put a different photo in, keeping every setting"} onClick={() => replaceInput.current?.click()}>
            Replace…
           </Button>
           <input
            ref={replaceInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
             replacePhoto(e.target.files?.[0]);
             e.target.value = "";
            }}
           />
          </>
         }
        >
         {/* How many layers the photo is split into by tone. Each band layer has its own settings
           below; the photo's picture, brightness and contrast are what the bands are cut from. */}
         {/* By value: read as black and white, split into tone bands. By colour: split into groups
           of similar colours, each drawn in the tool's nearest pen. Either way, a layer each, with
           its own lines. */}
         {chosen.photo.separation ? (
          // Separations made elsewhere: each layer is its own picture, so there's nothing to split.
          // Which plate this one is sets its name, its screen angle and its pen.
          <>
           <InputSelect
            size="md"
            label="Plate"
            value={PLATES.find((p) => PLATE_AIMS[p].name === chosen.photo!.separation) ?? "other"}
            onChange={(e) => setSeparationPlate(e.target.value as Plate | "other")}
           >
            {PLATES.map((p) => <option key={p} value={p}>{PLATE_AIMS[p].name}</option>)}
            <option value="other">{PLATES.some((p) => PLATE_AIMS[p].name === chosen.photo!.separation) ? "Another ink" : chosen.photo.separation}</option>
           </InputSelect>
           <p className={styles.empty}>A separation: this layer draws its own greyscale picture, more of its pen where it's darker. Replace swaps this plate alone.</p>
          </>
         ) : (
         <>
         <SegmentedControl size="sm" variant="dark" aria-label="Split by">
          <Segment selected={photoMode(chosen.photo) === "value"} title="By value: the photo as black and white, split into tone bands" onClick={() => switchPhotoMode("value")}>Value</Segment>
          <Segment selected={photoMode(chosen.photo) === "colour"} title="By colour: the photo's colours gathered into groups, each drawn in the tool's nearest pen" onClick={() => switchPhotoMode("colour")}>Colour</Segment>
          <Segment selected={photoMode(chosen.photo) === "cmyk"} title="CMYK: four plates - cyan, magenta, yellow and black - in the tool's nearest pens, blended on paper" onClick={() => switchPhotoMode("cmyk")}>CMYK</Segment>
         </SegmentedControl>
         {photoMode(chosen.photo) === "cmyk" ? (
          // How much of the colours' shared grey the black plate takes over: more, and the darks are
          // black; less, and they're the three colours laid over each other.
          <NumberField label="Black" unit="%" min={0} max={100} step={5} value={Math.round((chosen.photo.blackShare ?? BLACK_SHARE) * 100)} onChange={(v) => setPhotoOf({ blackShare: v / 100 })} />
         ) : chosen.photo.ink ? (
          <>
           <NumberField
            label="Inks"
            min={1}
            max={MOST_LAYERS}
            step={1}
            value={chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group && !sh.photo?.key).length : 1}
            onChange={splitPhotoByColor}
           />
           {/* A key ink over the colours, darkening shadows the colour layers can't reach alone.
             Its pen is the layer's: change it with the layer's dot. */}
           <Checkbox
            checked={Boolean(chosen.photo.keyInk)}
            label="Key layer, to darken shadows"
            onChange={(e) => setKeyLayer(e.target.checked)}
           />
           {chosen.photo.keyInk && (
            // The key's shading over the colours: how dark a part must be before it's shaded, and
            // how heavy the shading gets at black. The colours under it draw as they would without it.
            <div className={styles.fillRow}>
             <NumberField label="Shading starts at" unit="%" min={0} max={95} step={5} value={Math.round((chosen.photo.keyFrom ?? KEY_FROM) * 100)} onChange={(v) => setPhotoOf({ keyFrom: v / 100 })} />
             <NumberField label="Key strength" unit="%" min={0} max={100} step={5} value={Math.round((chosen.photo.keyStrength ?? 1) * 100)} onChange={(v) => setPhotoOf({ keyStrength: v / 100 })} />
            </div>
           )}
          </>
         ) : (
          <NumberField
           label="Tone layers"
           min={1}
           max={MOST_LAYERS}
           step={1}
           value={chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group).length : 1}
           onChange={splitPhoto}
          />
         )}
         </>
         )}
         {/* Sized to the page, inside the margin: the whole photo as large as it fits, or the page
           filled and the photo cropped. Moved or sized by hand, it's neither. */}
         <div className={styles.fillRow}>
          <SegmentedControl size="sm" variant="dark" aria-label="Size to the page">
           <Segment selected={chosen.photo.fit === "fit"} title="Fit to page: all of the photo, as large as it fits inside the margin" onClick={() => placePhoto("fit", chosen.photo!.margin ?? 0.5)}>Fit</Segment>
           <Segment selected={chosen.photo.fit === "fill"} title="Fill page: the whole page inside the margin, the photo cropped to it" onClick={() => placePhoto("fill", chosen.photo!.margin ?? 0.5)}>Fill</Segment>
          </SegmentedControl>
          <NumberField label="Margin" unit="in" min={0} max={4} step={0.25} value={chosen.photo.margin ?? 0.5} onChange={setPhotoMargin} />
          <NumberField
           label="Scale"
           unit="%"
           min={5}
           max={1000}
           step={5}
           value={(() => { const { b, fitW } = photoScale(chosen); return Math.round(((b.x1 - b.x0) / fitW) * 100); })()}
           onChange={setPhotoScale}
          />
         </div>
         {/* Which band's lines the rest of the card sets. The bands lie on top of each other, so
           this is how to reach each one; its layer in the list does the same. */}
         {chosen.photo.group && (
          // Where the settings below go: to the layer picked in the switch under this, or to every
          // layer of the photo at once. The switch still says whose settings are showing.
          <SegmentedControl size="sm" variant="dark" aria-label="Settings for">
           <Segment selected={!photoAll} title="The settings below go to the layer picked here" onClick={() => setPhotoAll(false)}>This layer</Segment>
           <Segment selected={photoAll} title="The settings below go to all the photo's layers at once" onClick={() => setPhotoAll(true)}>All layers</Segment>
          </SegmentedControl>
         )}
         {chosen.photo.group && (() => {
          // In the order of their layers, bottom first: the same order as the numbers in the
          // Layers list, lightest ink on the left once the layers are sorted by darkness.
          const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
          const bands = shapes
           .filter((sh) => sh.photo?.group === chosen.photo!.group)
           .sort((a, b) => place(a) - place(b));
          // Bands by value are named for their tone; by colour, for their ink.
          // Each band by its layer: the number the Layers list gives it, and a dot in its ink - up
          // to six of them, too many for words.
          return (
           <SegmentedControl size="sm" variant="dark" aria-label="Band to set">
            {bands.map((band) => {
             const at = layers.findIndex((l) => l.id === band.layerId);
             const layer = layers[at];
             return (
              <Segment
               key={band.id}
               selected={band.id === chosen.id}
               aria-label={`Layer ${at + 1}, ${layer?.name ?? ""}`}
               title={`Layer ${at + 1}, ${layer?.name ?? ""}: its lines`}
               onClick={() => { pick(band.id); setActiveLayer(band.layerId); }}
              >
               <span className={styles.bandDot} style={{ background: layer?.color }} aria-hidden="true" />
               {at + 1}
              </Segment>
             );
            })}
           </SegmentedControl>
          );
         })()}
         {photoMode(chosen.photo) === "colour" && chosen.photo.group && (
          // Colour layers overlap where colours blend: a part of the photo is drawn by every
          // layer whose colour is nearly as close as the nearest, within this.
          <>
           <NumberField label="Bleed" unit="%" min={0} max={25} step={1} value={Math.round((chosen.photo.bleed ?? 0) * 100)} onChange={(v) => setPhotoOf({ bleed: v / 100 })} />
           <p className={styles.empty}>
            {(chosen.photo.bleed ?? 0) > 0
             ? "Where the photo's colours blend, the layers either side both draw, and their lines overlap."
             : "Each part of the photo is drawn by the one layer nearest its colour."}
           </p>
          </>
         )}
         {chosen.photo.band && (() => {
          const [lo, hi] = chosen.photo.band;
          const bleed = chosen.photo.bleed ?? 0;
          const from = Math.round(Math.max(0, lo - (lo > 0 ? bleed : 0)) * 100);
          const to = Math.round(Math.min(1, hi + (hi < 1 ? bleed : 0)) * 100);
          return (
           <>
            {/* How far the bands reach into each other, so their lines overlap where they meet. */}
            <NumberField label="Bleed" unit="%" min={0} max={25} step={1} value={Math.round(bleed * 100)} onChange={(v) => setPhotoOf({ bleed: v / 100 })} />
            <p className={styles.empty}>{`This layer draws the tones from ${from}% to ${to}% dark.`}</p>
           </>
          );
         })()}
         <div className={styles.fillRow}>
          <NumberField label="Brightness" min={-100} max={100} step={5} value={chosen.photo.brightness} onChange={(brightness) => setPhotoOf({ brightness })} />
          <NumberField label="Contrast" min={-100} max={100} step={5} value={chosen.photo.contrast} onChange={(contrast) => setPhotoOf({ contrast })} />
         </div>
         {/* What this band's tone is drawn as, and the numbers that style has. Each band its own. */}
         <InputSelect
          size="md"
          label="Drawn as"
          value={chosen.photo.style ?? "hatch"}
          title={({
           hatch: "Hatching: lines that cross and fill in as the photo darkens",
           waves: "Tone lines: one line along each row, waving harder and tighter where it's darker",
           outlines: "Outlines: the photo traced as contour lines, following its edges and shapes",
           centerlines: "Centerlines: each dark stroke of a line drawing drawn once, down its middle, so a ring is one circle",
          } as const)[chosen.photo.style ?? "hatch"]}
          onChange={(e) => {
           const style = e.target.value as NonNullable<Photo["style"]>;
           setPhotoOf({ style: style === "hatch" ? undefined : style });
          }}
         >
          <option value="hatch">Hatching</option>
          <option value="waves">Tone lines</option>
          <option value="outlines">Outlines</option>
          <option value="centerlines">Centerlines</option>
         </InputSelect>
         {/* This layer's lines shifted from where the photo puts them: into register with the
           others, or out of it on purpose. Its own; the rest stay put. */}
         <div className={styles.fillRow}>
          <NumberField label="Offset X" unit="mm" min={-100} max={100} step={0.1} value={chosen.photo.offsetMm?.[0] ?? 0} onChange={(x) => setPhotoOf({ offsetMm: [x, chosen.photo!.offsetMm?.[1] ?? 0] })} />
          <NumberField label="Offset Y" unit="mm" min={-100} max={100} step={0.1} value={chosen.photo.offsetMm?.[1] ?? 0} onChange={(y) => setPhotoOf({ offsetMm: [chosen.photo!.offsetMm?.[0] ?? 0, y] })} />
         </div>
         {chosen.photo.style === "centerlines" ? (
          <div className={styles.fillRow}>
           <NumberField label="Darker than" unit="%" min={1} max={99} step={5} value={Math.round((chosen.photo.centerFrom ?? CENTER_DEFAULTS.from) * 100)} onChange={(v) => setPhotoOf({ centerFrom: v / 100 })} />
           <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.05} value={chosen.photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm} onChange={(centerSmoothMm) => setPhotoOf({ centerSmoothMm })} />
           <NumberField label="Shortest" unit="mm" min={0} max={20} step={0.25} value={chosen.photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm} onChange={(centerShortestMm) => setPhotoOf({ centerShortestMm })} />
          </div>
         ) : chosen.photo.style === "outlines" ? (
          <div className={styles.fillRow}>
           <NumberField label="Lines" min={1} max={40} step={1} value={chosen.photo.contours ?? OUTLINE_DEFAULTS.contours} onChange={(contours) => setPhotoOf({ contours })} />
           <NumberField label="Smoothing" unit="mm" min={0} max={20} step={0.25} value={chosen.photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm} onChange={(smoothMm) => setPhotoOf({ smoothMm })} />
          </div>
         ) : chosen.photo.style === "waves" ? (
          <div className={styles.fillRow}>
           <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={chosen.photo.angle} onChange={(angle) => setPhotoOf({ angle })} />
           <NumberField label="Row spacing" unit="mm" min={0.2} max={20} step={0.25} value={chosen.photo.rowMm ?? WAVE_DEFAULTS.rowMm} onChange={(rowMm) => setPhotoOf({ rowMm })} />
           <NumberField label="Wave length" unit="mm" min={0.2} max={20} step={0.1} value={chosen.photo.waveMm ?? WAVE_DEFAULTS.waveMm} onChange={(waveMm) => setPhotoOf({ waveMm })} />
          </div>
         ) : (
          <div className={styles.fillRow}>
           <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={chosen.photo.angle} onChange={(angle) => setPhotoOf({ angle })} />
           <NumberField label="Closest lines" unit="mm" min={0.1} max={5} step={0.05} value={chosen.photo.spacingMm} onChange={(spacingMm) => setPhotoOf({ spacingMm })} />
           <NumberField label="Passes" min={1} max={4} step={1} value={chosen.photo.levels} onChange={(levels) => setPhotoOf({ levels })} />
          </div>
         )}
         <p className={styles.empty}>
          {marks
           ? chosen.photo.style === "centerlines"
            ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}${marks.circles ? `, ${marks.circles} of them ${marks.circles === 1 ? "a circle" : "circles"}` : ""}, each drawn once down the middle of a stroke in the picture${marks.widthMm ? ` (they're about ${marks.widthMm.toFixed(1)} mm wide there)` : ""}. Darker than sets what counts as a line; Shortest drops specks and whiskers.`
            : chosen.photo.style === "outlines"
            ? `${marks.strokes.toLocaleString()} contours, along the photo's edges and shapes. More lines follow finer changes of tone; more smoothing, only the big ones.`
            : chosen.photo.style === "waves"
            ? `${marks.strokes.toLocaleString()} strokes. Each row waves harder and tighter where the photo is darker; white is left as paper.`
            : `${marks.strokes.toLocaleString()} strokes. The closest lines start at the tool’s solid-fill spacing; each pass adds lines where the photo is darker.`
           : "Reading the photo…"}
         </p>
        </Section>
       </div>
      </Card>
      );
     })()}

     {chosen?.kind === "text" && (
      <Card variant="flat" className={styles.controls}>
       <div className={styles.cardBody}>
        <Section title="Text" collapsibleKey="text">
         <InputTextarea
          size="md"
          label="Words"
          rows={2}
          autoResize
          value={chosen.text ?? ""}
          maxLength={500}
          // Enter starts a new line here rather than doing anything to the drawing.
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => setTextOf({ text: e.target.value })}
         />
         <InputSelect
          size="md"
          label="Font"
          value={chosen.font ?? ""}
          disabled={!fontList.length}
          onChange={(e) => setTextOf({ font: e.target.value })}
         >
          {!fontList.length && <option value="">No fonts on this Mac</option>}
          {fontList.map((f) => <option key={f} value={f}>{f}</option>)}
         </InputSelect>
         <div className={styles.fillRow}>
          <NumberField
           label="Letter spacing"
           unit="%"
           step={1}
           min={-20}
           max={200}
           value={chosen.tracking ?? 0}
           onChange={(tracking) => setTextOf({ tracking })}
          />
          <NumberField
           label="Line spacing"
           unit="×"
           step={0.1}
           min={0.2}
           max={10}
           value={chosen.leading ?? 1}
           onChange={(leading) => setTextOf({ leading })}
          />
         </div>
         <p className={styles.empty}>
          Drag a corner to set how tall the letters are. Letter spacing is a share of that
          height, so it stays put as the text is resized.
         </p>
        </Section>
       </div>
      </Card>
     )}

     {/* What the shape itself is made of: the numbers that draw it, and how it is filled in. */}
     {chosen && (chosen.curve || canFill(chosen) || chosen.kind === "path") && (
      <Card variant="flat" className={styles.controls}>
       <div className={`${styles.cardBody} ${controls.cardSections}`}>
        {/* Named after the shape it is about, which is what the card is: the chosen shape,
          and what can be done to it. The fold is remembered under one key all the same. */}
        <Section
         title={shapeName(chosen, onActive.indexOf(chosen))}
         collapsibleKey="shape"
         // Beside the shape's name rather than in the row below it: every button in that
         // row opens something to adjust, and this one is done the moment it is pressed.
         // Anything still made of numbers can be flattened, so the button stands here for
         // every kind of shape rather than being repeated inside each one's settings.
         action={canFlatten(chosen) ? (
          <ButtonRound
           size="sm"
           icon={<ArrowDownToLine />}
           aria-label="Flatten shape"
           title="Flatten: the numbers behind this shape are given up and it becomes points to drag. Its turn and its copies are left as they are."
           onClick={() => flattenShape(chosen.id)}
          />
         ) : undefined}
        >
        {/* No flatten of its own: giving up these numbers is what Flatten does, and the
          card says that once, beside the shape's name, for every kind of shape. */}
        {chosen.curve && (
        <Section title="Curve" collapsibleKey="curve">
         <div className={styles.fillRow}>
          {CURVE_FIELDS[chosen.curve.kind].map((f) => (
           <NumberField
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            step={f.step}
            unit={f.unit}
            value={Number((chosen.curve as unknown as Record<string, number>)[f.key])}
            onChange={(v) => setCurve({ ...(chosen.curve as Curve), [f.key]: v } as Curve)}
           />
          ))}
         </div>
         {chosen.curve.kind === "hypotrochoid" && (
          // Past this it retraces itself, and a retraced line is a line the pen draws twice.
          <p className={styles.empty}>
           {`Closes after ${closingTurns(chosen.curve.R, chosen.curve.r)} turns`}
          </p>
         )}
        </Section>
        )}

        {(chosen.runs?.length ?? 0) > 1 && (
         <Button size="md" variant="secondary" onClick={() => splitShape(chosen.id)}>
          {`Split into ${chosen.runs?.length} shapes`}
         </Button>
        )}
        <div className={styles.tools} role="group" aria-label="What is done to this shape">
         {/* Simplify keeps its button here rather than in the row's menu: it opens a
           tolerance to type, and you come back to it until the points are where you
           want them. */}
         {chosen.kind === "path" && (
          <ButtonRound
           size="sm"
           icon={<LineStyle />}
           className={simplifying ? controls.roundActive : undefined}
           aria-label="Simplify"
           aria-expanded={simplifying}
           aria-pressed={simplifying}
           title="Simplify: take out the points the path can do without"
           onClick={() => showPanel("simplify")}
          />
         )}
         {/* Only a shape with an inside can be hatched. */}
         {canFill(chosen) && (
          <ButtonRound
           size="sm"
           icon={<PaintBucket />}
           className={filling ? controls.roundActive : undefined}
           aria-label="Hatch"
           aria-expanded={filling}
           aria-pressed={filling}
           title="Hatch: fill this shape with lines, and set how they run"
           onClick={() => showPanel("fill")}
          />
         )}
         {/* One button per thing that can be done to a shape as a whole, each opening its
           own settings: how far it is turned, and how many of it there are. */}
         <ButtonRound
          size="sm"
          icon={<RotateCw />}
          className={rotating ? controls.roundActive : undefined}
          aria-label="Rotate"
          aria-expanded={rotating}
          aria-pressed={rotating}
          title="Rotate: turn this shape about the middle of its box"
          onClick={() => showPanel("rotate")}
         />
         <ButtonRound
          size="sm"
          icon={<SquareStack />}
          className={repeating ? controls.roundActive : undefined}
          aria-label="Repeat"
          aria-expanded={repeating}
          aria-pressed={repeating}
          title="Repeat: draw this shape more than once, in a row, a grid or a ring"
          onClick={() => showPanel("repeat")}
         />
        </div>

        {chosen.kind === "path" && simplifying && (() => {
         const points = pathRuns(chosen).reduce((n, r) => n + r.length, 0);
         return (
          <>
           <div className={styles.fillRow}>
            <Button size="md" variant="secondary" onClick={() => simplifyShape(chosen.id)}>
             Simplify
            </Button>
            <NumberField
             label="Within"
             unit="mm"
             min={0.01}
             max={10}
             step={0.05}
             value={simplifyMm}
             onChange={setSimplifyMm}
            />
           </div>
           <p className={styles.empty}>
            {`${points} point${points === 1 ? "" : "s"}${points > POINT_HANDLE_LIMIT ? " - too many to drag one by one" : ""}`}
           </p>
          </>
         );
        })()}

        {canFill(chosen) && filling && (
        <>
         <Checkbox
          checked={chosenFills.length > 0}
          label="Fill shape"
          onChange={(e) => setHatched(e.target.checked)}
         />
         {chosenFills.length > 0 && (
          <div className={styles.tools} role="group" aria-label="What the fill is made of">
           {(Object.keys(FILL_LABEL) as FillKind[]).map((k) => {
            const on = (chosenFills[0].kind ?? "hatch") === k;
            return (
             <ButtonRound
              key={k}
              size="sm"
              icon={FILL_ICON[k]}
              className={on ? controls.roundActive : undefined}
              aria-label={FILL_LABEL[k]}
              aria-pressed={on}
              title={FILL_HINT[k]}
              // Both passes of a cross-hatch are the same kind of thing.
              onClick={() => chosenFills.forEach((f, at) => setFillAt(at, { ...f, kind: k }))}
             />
            );
           })}
          </div>
         )}
         {chosenFills.map((fill, i) => (
          <div key={fill.id} className={styles.fillRow}>
           <NumberField
            label={i === 0 ? "Angle" : "Cross angle"}
            unit="°"
            step={5}
            value={fill.angle}
            onChange={(angle) => setFillByHand(i, { ...fill, angle })}
           />
           <NumberField
            label="Spacing"
            unit="mm"
            step={0.1}
            min={0.05}
            value={fill.spacingMm}
            onChange={(spacingMm) => setFillByHand(i, { ...fill, spacingMm })}
           />
          </div>
         ))}
         {/* No sentence saying the spacing was set by hand: the field above says the number,
           and the way back to the tool's own is the only part of it worth the room. */}
         {chosenFills.map((fill, i) => (fill.custom ? (
          <p key={`${fill.id}-note`} className={`${styles.empty} ${styles.fillFollow}`}>
           <Button size="sm" variant="ghost" onClick={() => followTool(i, fill)}>
            Use tool spacing
           </Button>
          </p>
         ) : null))}
         {chosenFills.length > 0 && (chosenFills[0].kind ?? "hatch") === "wavy" && (
          <div className={styles.fillRow}>
           <NumberField
            label="Wave"
            unit="mm"
            step={0.5}
            min={0.2}
            value={fillNumbers(chosenFills[0]).waveMm}
            onChange={(waveMm) => chosenFills.forEach((f, at) => setFillByHand(at, { ...f, waveMm }))}
           />
           <NumberField
            label="Swing"
            unit="mm"
            step={0.25}
            min={0}
            value={fillNumbers(chosenFills[0]).swingMm}
            onChange={(swingMm) => chosenFills.forEach((f, at) => setFillByHand(at, { ...f, swingMm }))}
           />
          </div>
         )}
         {chosenFills.length > 0 && (chosenFills[0].kind ?? "hatch") === "dashes" && (
          <div className={styles.fillRow}>
           <NumberField
            label="Dash"
            unit="mm"
            step={0.5}
            min={0.2}
            value={fillNumbers(chosenFills[0]).dashMm}
            onChange={(dashMm) => chosenFills.forEach((f, at) => setFillByHand(at, { ...f, dashMm }))}
           />
           <NumberField
            label="Gap"
            unit="mm"
            step={0.5}
            min={0.1}
            value={fillNumbers(chosenFills[0]).gapMm}
            onChange={(gapMm) => chosenFills.forEach((f, at) => setFillByHand(at, { ...f, gapMm }))}
           />
          </div>
         )}
         {chosenFills.length > 0 && (
          <Checkbox
           checked={chosenFills.length > 1}
           label="Cross-hatch"
           onChange={(e) =>
            // A second pass square to the first, which is what makes it read as a mesh
            // rather than as two hatchings that happen to share a shape.
            setFillAt(1, e.target.checked ? { ...newFill((chosenFills[0].angle + 90) % 180), connected: chosenFills[0].connected } : null)
           }
          />
         )}
         {chosenFills.length > 0 && canConnect(chosenFills[0]) && (
          <Checkbox
           checked={chosenFills[0].connected === true}
           label="Connect ends"
           // Each pass becomes one zigzag stroke, joined along the shape's edge. Both passes
           // of a cross-hatch follow the one switch.
           onChange={(e) => {
            const connected = e.target.checked;
            record();
            setFills((list) => list.map((f) => (f.shapeId === chosen.id ? { ...f, connected } : f)));
           }}
          />
         )}
         {/* Only worth asking about while there is a hatch: a shape with no hatch is its
           outline, and nothing else. */}
         {chosenFills.length > 0 && (
          <Checkbox
           checked={chosen.outline !== false}
           label="Draw the outline too"
           onChange={(e) => setOutline(e.target.checked)}
          />
         )}
        </>
        )}
       {rotating && (
        <NumberField
         label="Rotation"
         unit="°"
         step={5}
         value={chosen.rotation ?? 0}
         onChange={setRotation}
        />
       )}

       {repeating && (
       <>
        {/* Whether there is more than one of it, then how they are laid out - the same two
          questions in the same order as a fill, which asks whether the shape is filled
          before it asks what the filling is made of. A row is the plainest of the three,
          so that is what ticking the box gives you to adjust. */}
        <Checkbox
         checked={!!chosen.repeat}
         label="Duplicate"
         onChange={(e) => setRepeat(e.target.checked ? defaultRepeat("line", chosen) : undefined)}
        />
        {chosen.repeat && (
        <div className={styles.tools} role="group" aria-label="How this shape repeats">
         {REPEATS.map((r) => {
          const on = chosen.repeat?.kind === r.kind;
          return (
           <ButtonRound
            key={r.label}
            size="sm"
            icon={r.icon}
            className={on ? controls.roundActive : undefined}
            aria-label={r.label}
            aria-pressed={on}
            title={r.hint}
            onClick={() => setRepeat(defaultRepeat(r.kind, chosen))}
           />
          );
         })}
         {/* At the end of the row that made the copies: the one thing that gives them up
           and leaves each as a shape of its own. */}
         <ButtonRound
          size="sm"
          icon={<FlameKindling />}
          aria-label="Bake the copies"
          title={`Bake: all ${placements(chosen).length} copies become shapes of their own, each still made of its own numbers`}
          onClick={() => bakeRepeat(chosen.id)}
         />
        </div>
        )}
        {chosen.repeat && (
         <div className={styles.fillRow}>
          {REPEAT_FIELDS[chosen.repeat.kind].map((f) => (
           <NumberField
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            step={f.step}
            unit={f.unit}
            value={Number((chosen.repeat as unknown as Record<string, number>)[f.key])}
            onChange={(v) => setRepeat({ ...(chosen.repeat as Repeat), [f.key]: v } as Repeat)}
           />
          ))}
         </div>
        )}
        {chosen.repeat?.kind === "ring" && (
         <Checkbox
          checked={chosen.repeat.facing}
          label="Turn each copy to face out"
          onChange={(e) => setRepeat({ ...(chosen.repeat as Repeat), facing: e.target.checked } as Repeat)}
         />
        )}
        {chosen.repeat && (
         <p className={styles.empty}>{`${placements(chosen).length} shapes in all, counting the one you drew`}</p>
        )}
       </>
       )}
        </Section>
       </div>
      </Card>
     )}

    </div>
   </main>
  </div>
 );
}
