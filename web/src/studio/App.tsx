import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { SettingsSection } from "../shared/components/controls/SettingsSection";
import { Button, Card } from "@tomcoggia/ui";
import { ArrowDownToLine, ClipboardCopy, ClipboardPaste, Copy, Layers2, LayersArrowDown, MousePointer2, PenLine, Spline, SquareDimensions, Trash2, Ungroup } from "lucide-react";
import { FileBrowser, type CombineResult, type OpenResult } from "../shared/components/FileBrowser";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { api } from "../shared/lib/api";
import { load, save as remember } from "../shared/lib/storage";
import { DEFAULT_SETTINGS, PAPER_SIZES } from "../shared/lib/constants";
import type { Info, PenColor, PlotterModel, Preset } from "../shared/lib/types";
import { listOf } from "../shared/lib/format";
import { lightness } from "../shared/lib/color";
import { joinLayerName, labelAfter, splitLayerName } from "../shared/lib/ink";
import { PreviewToolbar, SetupToolbar, type View } from "../shared/components/PreviewToolbar";
import { StatusBanner } from "../shared/components/StatusBanner";
import type { Zoom } from "../shared/components/BedCanvas";
import { Canvas, type Tool } from "./components/Canvas";
import { ConvertStage, type ConvertView } from "./components/ConvertStage";
import { mergeLines } from "./lib/mergeLines";
import { SizePopover } from "./components/SizePopover";
import { StudioHeader } from "./components/StudioHeader";
import { ThemeToggle } from "../shared/components/ThemeToggle";
import { canFill, newFillId, shapeAsOne, type Fill } from "./lib/hatch";
import { type Curve, type Point } from "./lib/parametric";
import { fontNames, loadFont, type StrokeFont } from "./lib/font";
import { flattenPath } from "./lib/path";
import { fitText } from "./lib/text";
import { type Repeat } from "./lib/repeat";
import { parseDrawing } from "./lib/parse";
import { type PhotoMarks, PLATES, photoMarks, placeOnPage, stemWithoutPlate, type Photo } from "./lib/photo";
import { usePhotoRead } from "./lib/usePhotoRead";
import { photoActions } from "./lib/photoActions";
import { useHistory } from "./lib/useHistory";
import { LAST_FILE_KEY, useDrawingFile } from "./lib/useDrawingFile";
import { bakedCopies, flattened, handOutFills, joined, markRuns, simplified, splitApart } from "./lib/shapeEdits";
import { PaletteMenu } from "../shared/components/controls/PaletteMenu";
import { Hints } from "../shared/components/controls/Hints";
import { RowMenu } from "./components/controls/RowMenu";
import { ShapeList } from "./components/panels/ShapeList";
import { PhotoCard } from "./components/panels/PhotoCard";
import { canFlatten, hasShapeCard, ShapeCard, type ShapePanel } from "./components/panels/ShapeCard";
import { TextCard } from "./components/panels/TextCard";
import { SelectionCard } from "./components/panels/SelectionCard";
import { FillPanel } from "./components/panels/FillPanel";
import { CalibrationSection } from "./components/panels/CalibrationSection";
import { FileSection } from "./components/panels/FileSection";
import { GridSection } from "./components/panels/GridSection";
import { ToolPicker } from "./components/panels/ToolPicker";
import { LayersSection, type AlignEdge } from "./components/panels/LayersSection";
import { boxAround, boxOf, clampToPage, groupLabel, groupsOf, moveBy, newGroupId, newLayerId, newShapeId, resizeTo, shapeName, turnAround, withWholeGroups, type Layer, type Page, type Shape } from "./lib/shapes";
import { buildSvg, svgForMarks } from "./lib/svg";
import { drawnMiddle, fitToPage, reshapeDrawing, runsOffPage, turnDrawingLeft } from "./lib/drawing";
import { calibrationSheet } from "./lib/calibration";
import { pairsSheet } from "./lib/penPairs";
import { readCalibration, readingProblems, sheetLayout } from "./lib/calibrationRead";
import styles from "./App.module.css";

// Page sizes, in inches, from the list Plot already offers. Stored width-first the way they're drawn
// here, so "swap" is the only orientation control needed.
const SIZES = PAPER_SIZES.filter((p) => p.w && p.h).map((p) => ({
 id: p.id,
 name: p.name,
 w: p.w! / 25.4,
 h: p.h! / 25.4,
}));

// Used when a tool has no palette of its own, so there is always a pen to draw with.
const PLAIN_PEN: PenColor = { name: "Black", color: "#262626" };
const TOOL_KEY = "studio-tool";
const FONT_KEY = "studio-font";
const SNAP_KEY = "studio-snap";
const SIMPLIFY_KEY = "studio-simplify";

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

const PAPER_COLOR_KEY = "studio-paper-color";

/** What undo puts back: the drawing, and the Paper card's scale, so undoing a scale puts the field back with it. */
interface Snapshot {
 shapes: Shape[];
 fills: Fill[];
 layers: Layer[];
 drawingScale: number;
 page: Page;
}

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
 * How far the pen travels drawing a photo's lines, in inches. Worked out once for each set of lines:
 * the same lines come back as the same object from photoMarks' own cache.
 */
const lengths = new WeakMap<PhotoMarks, number>();
function drawnLength(marks: PhotoMarks) {
 const known = lengths.get(marks);
 if (known !== undefined) return known;
 let length = 0;
 for (const d of marks.passes) {
  for (const run of flattenPath(d)) for (let i = 1; i < run.length; i++) length += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
 }
 lengths.set(marks, length);
 return length;
}

/**
 * A photo split into tone bands is one photo on the page: whatever moved, sized or turned one band
 * takes the rest of its bands along with it.
 */
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

export default function App() {
 const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
 // How big the drawing is now, as a percent of its size when it was opened or started: the Paper
 // card's scale, which rescales the drawing as it changes. Back to 100 with each drawing.
 const [drawingScale, setDrawingScale] = useState(100);
 const [shapes, setShapes] = useState<Shape[]>([]);
 const [fills, setFills] = useState<Fill[]>([]);
 const [layers, setLayers] = useState<Layer[]>(() => [{ id: newLayerId(), name: "Black", color: "#262626" }]);
 const [activeLayer, setActiveLayer] = useState<string>("");
 const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
 // A tool's measured hatch numbers are the sensible starting point for a new fill, and they live in
 // Plot's presets rather than being invented here.
 const [defaults, setDefaults] = useState({ angle: 45, spacingMm: 1.5 });
 const [presets, setPresets] = useState<Preset[]>([]);
 const presetsRef = useRef(presets); // for openDrawing, which is made once
 presetsRef.current = presets;
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
 const [model, setModel] = useState<PlotterModel | undefined>();
 // Paper to begin with: the page is what's being drawn on, and the bed is context around it.
 const [zoom, setZoom] = useState<Zoom>("paper");
 // The loupe over the page, for a close look at the lines. The same switch as Plot's.
 const [loupe, setLoupe] = useState(false);
 const [toolName, setToolName] = useState<string>(() => load<string>(TOOL_KEY) ?? "");
 const [tool, setTool] = useState<Tool>("rect");
 // Everything picked, in the order it was picked. The cards edit the last of them; a drag, a delete
 // or a nudge takes the lot, which is what makes moving a whole layer at once possible.
 // A path of a shape made of several is never picked alone: picking it picks the whole shape. What
 // was asked for is kept as it was; the selection everything else works from is that, made whole.
 const [picks, setSelected] = useState<string[]>([]);
 const selected = useMemo(() => withWholeGroups(picks, shapes), [picks, shapes]);
 const pick = (id: string | null) => setSelected(id ? [id] : []);
 // Choosing a layer in the Layers card only chooses the layer: its paths are listed, but none is
 // selected until one is clicked, on the page or in the list. Whatever was selected on the layer
 // before is let go, so nothing is left selected out of sight.
 const switchLayer = (id: string) => {
  if (id === activeLayer) return;
  setActiveLayer(id);
  setSelected([]);
 };
 const [busy, setBusy] = useState(false);
 const [browserOpen, setBrowserOpen] = useState(false);
 const [browserAdds, setBrowserAdds] = useState(false); // opened to add a file as a layer, not to open one
 // What the toolbar says. Only problems, and work still under way (`progress`), are shown: a note
 // that something went as asked is left unsaid, since the result is there to see.
 const [message, setMessage] = useState<{ text: string; ok: boolean; progress?: boolean }>({
  text: "",
  ok: true,
 });

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
  return match ? match.id : "custom";
 }, [page]);

 const { name, setName, saved, dirty, touch, opened, combined, started, save, sendToPlot } = useDrawingFile({
  shapes, fills, layers, page, sizeId, toolName, fonts, setBusy, setMessage,
 });

 // The drawing tool is written into the file too, so picking one is a change - but only when it's
 // picked here. On startup the stored tool is reconciled against Plot's presets, and that
 // correction arrives after the drawing has been read: counting it would leave a drawing that was
 // only just opened looking unsaved.
 const pickTool = useCallback((pen: string) => {
  setToolName(pen);
  touch();
 }, [touch]);

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

 const snapshot = useMemo<Snapshot>(() => ({ shapes, fills, layers, page, drawingScale }), [shapes, fills, layers, page, drawingScale]);
 const restore = useCallback((next: Snapshot) => {
  setShapes(next.shapes);
  setFills(next.fills);
  setLayers(next.layers);
  setPage(next.page);
  setDrawingScale(next.drawingScale);
  // A shape that isn't there any more can't stay selected, or its handles would hang in the air.
  const still = new Set(next.shapes.map((s) => s.id));
  setSelected((ids) => ids.filter((id) => still.has(id)));
 }, []);
 const { record, undo, redo, clear: clearHistory, canUndo, canRedo } = useHistory(snapshot, restore);

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
 // A shape's fills, picked up to be put on other shapes: every one of them, so a cross-hatch goes
 // across whole. Only their numbers matter - spacing is millimetres on the paper and the angle is
 // degrees - so they fit a shape of any size. Kept apart from the shape clipboard above.
 const [fillClipboard, setFillClipboard] = useState<Fill[] | null>(null);

 const copyShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  setClipboard({ shape, fills: fills.filter((f) => f.shapeId === id) });
  // And on the system clipboard as a file another program can open: the lines, at the size they
  // were drawn, with the hatch if there is one. Written as an SVG file and as the same text,
  // because a browser may refuse the first and every drawing program takes pasted SVG source.
  const file = svgForMarks(markRuns(shape, fonts[shape.font ?? ""], fills), penWidthMm / 25.4);
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
   group: undefined,
   groupName: undefined,
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
  const copy: Shape = { ...shape, id: newShapeId(), group: undefined, groupName: undefined, x: shape.x + nudge, y: shape.y + nudge, x2: shape.x2 + nudge, y2: shape.y2 + nudge };
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

 // A fill on a shape made of several paths goes when the shape does: taken apart, joined into one
 // path, grouped into a bigger shape, or its paths deleted. Undo brings the two back together.
 useEffect(() => {
  setFills((list) => {
   const ids = new Set(shapes.map((s) => s.id));
   const groups = groupsOf(shapes);
   const kept = list.filter((f) => ids.has(f.shapeId) || groups.has(f.shapeId));
   return kept.length === list.length ? list : kept;
  });
 }, [shapes]);

 // Shapes made of several paths. Grouping keeps the paths as they are - unlike joining, which makes
 // them one path - and puts them side by side in the drawing order, where the first of them was, so
 // the shape is drawn and written out as one thing. One level only: grouping shapes that are already
 // shapes makes one shape of all their paths. A shape's paths are all on one layer, one pen.
 const groupable = (ids: string[]) => {
  const picked = shapes.filter((s) => ids.includes(s.id));
  return picked.length > 1
   && picked.every((s) => s.kind !== "photo" && s.layerId === picked[0].layerId)
   && !(picked[0].group && picked.every((s) => s.group === picked[0].group));
 };
 const groupShapes = () => {
  if (!groupable(selected)) return;
  const ids = new Set(selected);
  record();
  const group = newGroupId();
  setShapes((list) => {
   const first = list.findIndex((s) => ids.has(s.id));
   const rest = list.filter((s) => !ids.has(s.id));
   const members = list.filter((s) => ids.has(s.id)).map((s) => ({ ...s, group, groupName: undefined }));
   return [...rest.slice(0, first), ...members, ...rest.slice(first)];
  });
 };
 /** Take the shapes picked apart again: their paths stay where they are, each a path of its own. */
 const ungroupShapes = (ids: string[]) => {
  if (!shapes.some((s) => ids.includes(s.id) && s.group)) return;
  record();
  setShapes((list) => list.map((s) => (ids.includes(s.id) && s.group ? { ...s, group: undefined, groupName: undefined } : s)));
 };
 const membersOf = (group: string) => shapes.filter((s) => s.group === group);
 /** A copy of a whole shape, its fills too, a step down and across - and picked, ready to drag. */
 const duplicateGroup = (group: string) => {
  const members = membersOf(group);
  if (!members.length) return;
  record();
  const copyOf = new Map(members.map((s) => [s.id, newShapeId()]));
  const again = newGroupId();
  const copies = members.map((s) => ({ ...moveBy(s, 0.25, 0.25, page), id: copyOf.get(s.id)!, group: again }));
  setShapes((list) => [...list, ...copies]);
  setFills((list) => [
   ...list,
   ...list.filter((f) => copyOf.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: copyOf.get(f.shapeId)! })),
   ...list.filter((f) => f.shapeId === group).map((f) => ({ ...f, id: newFillId(), shapeId: again })),
  ]);
  setSelected(copies.map((s) => s.id));
 };
 const moveGroupToLayer = (group: string, layerId: string) => {
  record();
  setShapes((list) => list.map((s) => (s.group === group ? { ...s, layerId } : s)));
  setSelected(membersOf(group).map((s) => s.id));
 };

 /**
  * Nudge everything picked. The arrow keys move it a sixteenth of an inch, a whole inch with Shift
  * and a hundredth with Alt for the last little bit; the limit is the box round the whole selection,
  * so a group slides along the page's edge rather than piling up against it.
  */
 const nudge = (dx: number, dy: number) => moveShapes(selected, dx, dy);

 // Straight lines lying along one another - a halftone's overrunning dashes, a line drawn twice -
 // merged into the strokes they look like, so the pen draws each bit of line once.
 const mergeOverlaps = () => {
  const merged = mergeLines(shapes, fills.map((f) => f.shapeId));
  if (!merged) {
   setMessage({ text: "No lines overlap: nothing to merge", ok: true });
   return;
  }
  record();
  setShapes(merged.shapes);
  setSelected([]);
  const saved = merged.saved * 0.0254;
  setMessage({
   text: `Merged ${merged.before.toLocaleString()} overlapping lines into ${merged.after.toLocaleString()} - ${saved >= 1 ? `${saved.toFixed(1)} m` : `${Math.round(saved * 1000)} mm`} less to draw`,
   ok: true,
  });
 };

 /** Move these shapes together, kept on the page; a photo's other layers go with it. */
 const moveShapes = (which: string[], dx: number, dy: number) => {
  if (!which.length) return;
  record();
  // Worked out from the list as it stands rather than from this render's copy, so two presses in
  // one tick both count instead of the second undoing the first.
  setShapes((list) => {
   const ids = new Set(which);
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
   if (!move || e.metaKey || e.ctrlKey || converting.current) return;
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
   if (!picked || converting.current) return;
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
   if (!(e.metaKey || e.ctrlKey) || e.altKey || converting.current) return;
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
   if (!selected.length || e.metaKey || e.ctrlKey || e.altKey || converting.current) return;
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   e.preventDefault();
   remove.current(selected);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, [selected]);

 // Close whatever is open and begin again on a blank page. The page size stays as it is: it's the
 // paper you're working on today, and a new drawing is almost always for the same sheet.
 // Which new drawing is waiting on the question: a blank one, a calibration sheet, or a picture
 // opened for image conversion.
 const [confirmNew, setConfirmNew] = useState<"blank" | "calibration" | "pairs" | "image" | null>(null);
 const newDrawing = useCallback(() => {
  const noShapes: Shape[] = [];
  const noFills: Fill[] = [];
  const first = { id: newLayerId(), name: "Black", color: "#262626" };
  const onlyLayer = [first];
  setShapes(noShapes);
  setDrawingScale(100);
  setFills(noFills);
  setLayers(onlyLayer);
  setActiveLayer(first.id);
  setSelected([]);
  clearHistory();
  setConfirmNew(null);
  setConvertId(null);
  setMessage({ text: "New drawing", ok: true });
  // An empty page is not unsaved work, and the paper it's on came from the drawing before it.
  started("Untitled", { shapes: noShapes, fills: noFills, layers: onlyLayer, page });
 }, [started, page, clearHistory]);

 // Undo can't bring back which file was open - a snapshot is the drawing, not the drawing's name -
 // so unsaved work gets a question rather than a silent discard.
 const startNew = (what: "blank" | "calibration" | "pairs" = "blank") => {
  if (dirty && shapes.length) setConfirmNew(what);
  else if (what === "calibration") newCalibration();
  else if (what === "pairs") newPairs();
  else newDrawing();
 };
 const beginNew = () => (confirmNew === "calibration" ? newCalibration() : confirmNew === "pairs" ? newPairs() : confirmNew === "image" && imageWaiting.current ? startImage(imageWaiting.current) : newDrawing());

 // A photo opened with the File card's photo button: a new drawing named after it, the photo placed
 // on the paper and matched to the tool's pens, and then image conversion. Several at once are
 // separations - one photo already split into plates, a layer each. The photo goes in once the new
 // drawing is in place, and is converted once it's there.
 const imageWaiting = useRef<File[] | null>(null);
 const [pendingImage, setPendingImage] = useState<File[] | null>(null);
 const [convertNext, setConvertNext] = useState(false);
 const openPhotos = (files: File[]) => {
  if (!files.length) return;
  if (dirty && shapes.length) {
   imageWaiting.current = files;
   setConfirmNew("image");
  } else startImage(files);
 };
 const startImage = (files: File[]) => {
  imageWaiting.current = null;
  newDrawing();
  setName(files.length > 1 ? stemWithoutPlate(files[0].name) : files[0].name.replace(/\.[^.]+$/, ""));
  setPendingImage(files);
 };

 const openDrawing = useCallback((res: OpenResult, note: (n: number) => string) => {
  const drawing = parseDrawing(res.svg ?? "");
  setPage(drawing.page);
  setShapes(drawing.shapes);
  setDrawingScale(100);
  setFills(drawing.fills);
  setLayers(drawing.layers);
  setActiveLayer(drawing.layers[0]?.id ?? "");
  setSelected([]);
  clearHistory();
  setConvertId(null);
  opened(res, drawing);
  // The drawing comes up in the tool it was saved for, in either app - unless that tool is gone
  // from the presets, when the one already chosen stays. Not a change to the drawing: it's the
  // file's own. (Presets not loaded yet, at startup: taken as it is, and checked when they come.)
  const saved = drawing.tool;
  if (saved) setToolName((current) => (presetsRef.current.length && !presetsRef.current.some((t) => t.name === saved) ? current : saved));
  // Saving would write only what Studio can draw, so anything else in the file has to be said out
  // loud before it's overwritten rather than discovered missing afterwards.
  setMessage(
   drawing.unsupported
    ? {
      text: `${note(drawing.shapes.length)} - ${drawing.unsupported} other ${drawing.unsupported === 1 ? "mark" : "marks"} can’t be edited here and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`,
      ok: false,
     }
    // Opened cleanly, nothing to say: the drawing's name is already in the File card.
    : { text: "", ok: true },
  );
 }, [opened, clearHistory]);

 // Files stacked into one drawing, a layer each (the file browser's "Open as layers" and "Add as
 // layers"). Opened, they are a new drawing not yet saved, which saves next to the first of them.
 // Added, they go on top of this one, and Undo takes them off again.
 const openCombined = (res: CombineResult) => {
  const drawing = parseDrawing(res.svg ?? "");
  const count = drawing.layers.length;
  if (res.added) record();
  else clearHistory();
  combined(res, drawing.unsupported);
  setPage(drawing.page);
  setShapes(drawing.shapes);
  setDrawingScale(100);
  setFills(drawing.fills);
  setLayers(drawing.layers);
  setActiveLayer(drawing.layers[drawing.layers.length - 1]?.id ?? "");
  setSelected([]);
  // What most needs saying goes first: files that may not line up, then marks Studio can't redraw.
  const said = res.added ? `Added as layers - ${count} ${count === 1 ? "layer" : "layers"} now` : `Opened as ${count} layers - not saved yet`;
  const misfit = res.mismatched.length
   ? ` - ${listOf(res.mismatched)} ${res.mismatched.length === 1 ? "isn’t" : "aren’t"} on a page this size: pick Select all on layer from ${res.mismatched.length === 1 ? "its" : "their"} menu and drag to line up`
   : "";
  const foreignNote = drawing.unsupported
   ? ` - ${drawing.unsupported} other ${drawing.unsupported === 1 ? "mark" : "marks"} can’t be edited here and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`
   : "";
  // Only when something needs attention: a clean open or add is already there to see.
  setMessage(misfit || foreignNote ? { text: said + misfit + foreignNote, ok: false } : { text: "", ok: true });
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
    if (!cancelled) openDrawing(res, (n) => `${handed ? "Opened" : "Picked up"} ${res.name} - ${n} ${n === 1 ? "path" : "paths"}`);
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

 // Whether a plotter is on USB, and which, for the header and the tool list - asked now and then,
 // since Studio doesn't drive it.
 const [plotterFound, setPlotterFound] = useState<boolean | null>(null);
 const [plotterOnUsb, setPlotterOnUsb] = useState<string | null>(null);
 useEffect(() => {
  const ask = () => api<{ plotter_found: boolean; plotter: string | null }>("/api/status")
   .then((st) => {
    setPlotterFound(Boolean(st.plotter_found));
    setPlotterOnUsb(st.plotter ?? null);
   })
   .catch(() => setPlotterFound(false));
  ask();
  const timer = window.setInterval(ask, 5000);
  return () => window.clearInterval(timer);
 }, []);

 // Plot's drawing tools, so a drawing is made with the pens it will actually be drawn with: the
 // plugged-in plotter's, as Plot lists them, or every tool while neither plotter is plugged in. The
 // presets file is shared - changed in Plot, from the other Mac, or by hand - so, as Plot does, the
 // list is read again every few seconds and taken only when it has changed. Read at once when a
 // plotter comes or goes.
 const presetsSeen = useRef<string | null>(null);
 useEffect(() => {
  let cancelled = false;
  const read = () => api<{ presets: Preset[] }>("/api/presets?plotter=connected")
   .then(({ presets: list }) => {
    const text = JSON.stringify(list);
    if (cancelled || text === presetsSeen.current) return;
    presetsSeen.current = text;
    setPresets(list);
    setToolName((current) => (list.some((t) => t.name === current) ? current : list[0]?.name ?? ""));
   })
   .catch(() => {}); // no presets is not a reason to stop; the fallbacks below stand, and the next read tries again
  read();
  const timer = window.setInterval(read, 3000);
  return () => {
   cancelled = true;
   window.clearInterval(timer);
  };
 }, [plotterOnUsb]);

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

 // A new drawing that is the drawing tool's calibration sheet, on the paper chosen now: every pen,
 // a layer each, hatched at four strengths. Unsaved, like any new drawing, until it's saved.
 const newCalibration = () => {
  if (!tool2) return;
  const sheet = calibrationSheet(tool2, page, font);
  if ("error" in sheet) {
   setConfirmNew(null);
   setMessage({ text: sheet.error, ok: false });
   return;
  }
  const fitted = sheet.shapes.map((sh) => (sh.kind === "text" ? fitText(sh, fontsRef.current[sh.font ?? ""]) : sh));
  const sheetName = `${tool2.name} calibration`;
  setShapes(fitted);
  setFills(sheet.fills);
  setLayers(sheet.layers);
  setActiveLayer(sheet.layers[0].id);
  setSelected([]);
  clearHistory();
  setConfirmNew(null);
  started(sheetName); // a new sheet to be saved and plotted
  setMessage({ text: `${sheetName}: ${sheet.layers.length} pens`, ok: true });
 };

 // A new drawing that is the drawing tool's pen pairs sheet: a spread of its pens two at a time, the
 // lighter hatched first and the darker across it, to see what overlaid hatching makes on paper.
 const newPairs = () => {
  if (!tool2) return;
  const sheet = pairsSheet(tool2, page, font);
  if ("error" in sheet) {
   setConfirmNew(null);
   setMessage({ text: sheet.error, ok: false });
   return;
  }
  const fitted = sheet.shapes.map((sh) => (sh.kind === "text" ? fitText(sh, fontsRef.current[sh.font ?? ""]) : sh));
  const sheetName = `${tool2.name} pen pairs`;
  setShapes(fitted);
  setFills(sheet.fills);
  setLayers(sheet.layers);
  setActiveLayer(sheet.layers[0].id);
  setSelected([]);
  clearHistory();
  setConfirmNew(null);
  started(sheetName);
  setMessage({ text: `${sheetName}: ${sheet.pairs.length} pairs, ${sheet.layers.length} pens`, ok: true });
 };

 // The drawing open is a calibration sheet when it has the sheet's corner marks and named patches.
 // A photo of it, plotted, is read back into the tool's preset: each pen as it really came out.
 const [setupOpen, setSetupOpen] = useState(false);

 // Image conversion: the one photo being worked on, on its own - its picture and lines take the
 // stage, and the rail holds how it's converted. The drawing waits, as it does for Setup; the keys
 // that would change it are off while it's hidden.
 const [convertId, setConvertId] = useState<string | null>(null);
 const [convertView, setConvertView] = useState<ConvertView>("side");
 const converting = useRef(false);

 const sheet = useMemo(() => sheetLayout(shapes), [shapes]);
 // Read into the drawing tool only when the sheet is of its pens: a sheet made for one marker read
 // into another would write the first one's colours over the second's.
 const sheetPens = useMemo(() => [...new Set(sheet?.patches.map((p) => p.pen) ?? [])], [sheet]);
 const strangers = sheetPens.filter((pen) => !(tool2?.palette ?? []).some((p) => p.name === pen));
 const sheetIsTool = Boolean(sheet && tool2 && sheetPens.length && !strangers.length);
 const readSheetPhoto = async (file: File | undefined) => {
  if (!file || !sheet || !tool2 || !sheetIsTool) return;
  setBusy(true);
  setMessage({ text: `Reading ${file.name}…`, ok: true, progress: true });
  try {
   const calibration = await readCalibration(file, sheet, paperColor);
   const res = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(tool2.name)}/calibration`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calibration),
   });
   setPresets(res.presets);
   const problems = readingProblems(calibration);
   const count = Object.keys(calibration.pens).length;
   setMessage(problems.length
    ? { text: `Read ${count} pens, but ${problems.join(" ")}`, ok: false }
    : { text: `Read ${count} pens into ${tool2.name}`, ok: true });
  } catch (err) {
   setMessage({ text: (err as Error).message, ok: false });
  } finally {
   setBusy(false);
  }
 };
 const palette: PenColor[] = tool2?.palette?.length ? tool2.palette : [PLAIN_PEN];
 // Darkest last in the list, so the default pen is the one you'd reach for first.
 // The real line the pen lays down, so the drawing shows its true weight against the hatch spacing.
 const penWidthMm = tool2?.settings.pen_width ?? 0.7;
 // The same three numbers Plot reads off the same preset, so the ink looks the same in both.
 const inkOpacity = tool2?.settings.ink_opacity ?? 1;
 const inkBuilds = tool2?.settings.ink_builds !== false;
 const inkOpaque = tool2?.settings.ink_opaque === true;
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

 // The photo being converted, while there still is one: undo can take it away.
 const converted = convertId ? shapes.find((s) => s.id === convertId && s.kind === "photo" && s.photo) ?? null : null;
 converting.current = Boolean(converted);
 useEffect(() => {
  if (convertId && !converted) setConvertId(null);
 }, [convertId, converted]);
 const convertBox = converted ? boxOf(converted) : null;
 // All of the photo's layers, bottom first, each in its pen: the lines it comes out as, together.
 const convertParts = converted
  ? layers.flatMap((l) => shapes.filter((sh) => sh.layerId === l.id && sh.kind === "photo" && sh.photo && (sh.id === converted.id || (converted.photo!.group && sh.photo.group === converted.photo!.group))).map((sh) => ({ photo: sh.photo!, color: l.color })))
  : [];
 const convertMarks = convertBox ? convertParts.map((part) => photoMarks(part.photo, convertBox.x1 - convertBox.x0, convertBox.y1 - convertBox.y0)) : [];
 const convertStrokes = convertMarks.reduce((n, m) => n + (m?.strokes ?? 0), 0);
 const convertRead = convertMarks.length > 0 && convertMarks.every(Boolean);
 // How far the pen travels drawing it all, in inches: what a plot of it costs, beside how many strokes.
 const convertLength = convertMarks.reduce((sum, m) => sum + (m ? drawnLength(m) : 0), 0);
 /** Into image conversion with a photo: it stays chosen, so its card is the one in the rail. */
 const openConvert = (id: string) => {
  setSelected([id]);
  setSetupOpen(false);
  setConvertId(id);
 };
 // The group id of the one shape picked, when what's picked is exactly one whole shape of several paths.
 const pickedGroup = useMemo(() => {
  const group = shapes.find((s) => s.id === selected[0])?.group;
  return group && selected.length > 1 && selected.every((id) => shapes.find((s) => s.id === id)?.group === group) ? group : undefined;
 }, [shapes, selected]);
 // That shape's paths as the one outline its fill is made from.
 const pickedWhole = useMemo(
  () => (pickedGroup ? shapeAsOne(shapes.filter((s) => s.group === pickedGroup), pickedGroup) : undefined),
  [shapes, pickedGroup],
 );
 // The shapes a fill is set on: the one chosen, a shape of several paths filled as one area, or every
 // path of a selection that can be filled, so several are hatched at once. The first of them is the
 // one whose fill the panel shows; every edit gives all of them that same fill.
 const fillTargets = chosen
  ? (canFill(chosen) ? [chosen] : [])
  : pickedWhole
   ? (canFill(pickedWhole) ? [pickedWhole] : [])
   : shapes.filter((s) => selected.includes(s.id) && canFill(s));
 const fillLead = chosen ?? fillTargets[0] ?? null;
 const chosenFills = fillLead ? fills.filter((f) => f.shapeId === fillLead.id) : [];

 // The layer new shapes land on, and the one the Shapes card lists. Always a real layer.
 const active = layers.find((l) => l.id === activeLayer) ?? layers[0];
 const onActive = shapes.filter((sh) => sh.layerId === active?.id);

 // Lining one layer up with another: everything on the active layer moved as one, so its box meets
 // the other layer's - or the paper's - at the edge or middle asked for. The layers that can be
 // lined up with are those with something on them; the paper when there's none.
 const [alignTo, setAlignTo] = useState("");
 // A layer that is all another part of the same photo moves with the active one, so it can't be
 // lined up with: the photo's layers are already in register.
 const activePhotos = new Set(onActive.flatMap((sh) => (sh.photo?.group ? [sh.photo.group] : [])));
 const alignable = layers.filter((l) => {
  if (l.id === active?.id) return false;
  const on = shapes.filter((sh) => sh.layerId === l.id);
  return on.length > 0 && !on.every((sh) => sh.photo?.group && activePhotos.has(sh.photo.group));
 });
 const alignTarget = alignTo === "paper" || alignable.some((l) => l.id === alignTo) ? alignTo : alignable[0]?.id ?? "paper";
 const alignLayer = (edge: AlignEdge) => {
  if (!onActive.length) return;
  const to = alignTarget === "paper" ? { x0: 0, y0: 0, x1: page.w, y1: page.h } : boxAround(shapes.filter((sh) => sh.layerId === alignTarget));
  const from = boxAround(onActive);
  const dx = edge === "left" ? to.x0 - from.x0 : edge === "right" ? to.x1 - from.x1 : edge === "centre" ? (to.x0 + to.x1 - from.x0 - from.x1) / 2 : 0;
  const dy = edge === "top" ? to.y0 - from.y0 : edge === "bottom" ? to.y1 - from.y1 : edge === "middle" ? (to.y0 + to.y1 - from.y0 - from.y1) / 2 : 0;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  moveShapes(onActive.map((sh) => sh.id), dx, dy);
 };
 // Turning the active layer as one, about the middle of the box round it: what dragging the turn grip
 // does to the layer picked whole, by an exact angle. Photos stay as they are - they stand square to
 // the page, and their layers are in register with each other - and turn from their own card.
 const turnLayer = (deg: number) => {
  const turning = onActive.filter((sh) => !sh.photo);
  if (!deg) return;
  if (!turning.length) {
   setMessage({ text: "A photo turns from its own card, where all its layers turn together", ok: false });
   return;
  }
  const b = boxAround(turning);
  const turned = new Map(turnAround(turning, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, deg).map((sh) => [sh.id, sh]));
  record();
  setShapes((list) => list.map((sh) => turned.get(sh.id) ?? sh));
  setMessage(turning.length < onActive.length
   ? { text: "The photo on this layer stays as it is: turn it from its own card", ok: false }
   : { text: "", ok: true });
 };
 const pickedIds = useMemo(() => new Set(selected), [selected]);
 // What the one shape picked is called, when what's picked is exactly one whole shape.
 const pickedShape = useMemo(() => {
  const group = pickedGroup;
  if (!group) return undefined;
  const ofLayer = [...groupsOf(shapes.filter((s) => s.layerId === shapes.find((m) => m.group === group)?.layerId)).keys()];
  return groupLabel(membersOf(group), ofLayer.indexOf(group));
 }, [shapes, pickedGroup]); // eslint-disable-line react-hooks/exhaustive-deps
 // The chosen photo's card counts its lines, which can only be made once the photo has been read.
 usePhotoRead(chosen?.photo?.src);

 const {
  addPhoto, addSeparations, setSeparationPlate, switchPhotoMode, setKeyLayer, splitPhoto, splitPhotoByColor,
  placePhoto, photoScale, setPhotoScale, setPhotoMargin, replacePhoto, turnPhoto, setPhotoOf,
 } = photoActions({
  chosen, shapes, setShapes, layers, setLayers, active, setActiveLayer, page, tool: tool2,
  spacingMm: defaults.spacingMm, all: photoAll, record, addShape, pick, setTool, setMessage,
 });

 // The picture opened for conversion goes in once its new, empty drawing is in place...
 useEffect(() => {
  if (!pendingImage || shapes.length) return;
  const files = pendingImage;
  setPendingImage(null);
  setConvertNext(true);
  if (files.length > 1) addSeparations(files);
  else addPhoto(files[0]);
 }, [pendingImage, shapes.length]); // eslint-disable-line react-hooks/exhaustive-deps
 // ...and is converted once it's there and chosen.
 useEffect(() => {
  if (!convertNext || chosen?.kind !== "photo") return;
  setConvertNext(false);
  openConvert(chosen.id);
 }, [convertNext, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

 const newFill = (angle: number): Fill => ({
  id: newFillId(),
  shapeId: fillLead!.id,
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
  const lead = fillLead;
  if (!lead) return;
  record();
  const targets = new Set(fillTargets.map((s) => s.id));
  setFills((list) => {
   const mine = list.filter((f) => f.shapeId === lead.id);
   const others = list.filter((f) => !targets.has(f.shapeId) && f.shapeId !== lead.id);
   const updated = [...mine];
   if (next) updated[at] = next;
   else updated.splice(at, 1);
   const kept = updated.filter(Boolean);
   // The rest of a selection take the lead's fill whole, each its own copy.
   const copies = fillTargets
    .filter((s) => s.id !== lead.id)
    .flatMap((s) => kept.map((f) => ({ ...f, id: newFillId(), shapeId: s.id })));
   return [...others, ...kept, ...copies];
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

 /** Turn the whole drawing a quarter turn anticlockwise, page and all (see turnDrawingLeft). */
 const turnDrawing = () => {
  record();
  const turned = turnDrawingLeft(shapes, fills, page);
  setFills(turned.fills);
  setShapes(turned.shapes);
  setPage(turned.page);
 };

 /** Scale the whole drawing by `k` about one point, then move it by `by`, leaving the paper as it is. */
 const reshape = (k: number, about: Point, by?: Point) => {
  const next = reshapeDrawing(shapes, k, about, by);
  record();
  setShapes(next);
  setDrawingScale((now) => Number((now * k).toFixed(1)));
  setMessage(runsOffPage(next, page) ? { text: "The drawing now runs off the paper", ok: false } : { text: "", ok: true });
 };

 /**
  * Set the drawing's scale, as a percent of its size when it was opened or started: the drawing is
  * scaled from the scale it is at now to the new one, about the middle of what it draws.
  */
 const scaleDrawing = (percent: number) => {
  if (!shapes.length || percent <= 0 || percent === drawingScale) return;
  reshape(percent / drawingScale, drawnMiddle(shapes));
 };

 /** Scale the drawing as big as the paper allows inside a margin all round, and centre it there. */
 const fitDrawing = (marginMm: number) => {
  const fit = fitToPage(shapes, page, marginMm / 25.4);
  if (fit) reshape(fit.k, fit.about, fit.by);
 };

 /** Set a shape's size from the list, in inches, keeping its top-left corner where it is. */
 const setShapeSize = (id: string, w: number, h: number) => {
  const shape = shapes.find((s) => s.id === id);
  if (!shape) return;
  record();
  setShapes((list) => list.map((s) => (s.id === id ? clampToPage(resizeTo(s, w, h), page) : s)));
 };

 /** Flatten a shape to points it can be edited by (see flattened): its fills go to all it becomes. */
 const flattenShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const made = shape ? flattened(shape, fonts[shape.font ?? ""]) : [];
  if (!made.length) return;
  record();
  setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
  setFills((list) => handOutFills(list, id, made));
  pick(made[0].id);
 };

 /** Bake a shape's copies into shapes of their own (see bakedCopies), each with the fills it had. */
 const bakeRepeat = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const made = shape ? bakedCopies(shape) : [];
  if (made.length < 2) return; // one copy is the shape itself: nothing to hand out
  record();
  setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
  setFills((list) => handOutFills(list, id, made));
  pick(made[0].id);
 };

 /** Join what's picked into one shape (see joined). A fill on the first of them is kept. */
 const joinShapes = () => {
  const ids = new Set(selected);
  // A photo is its lines made from a picture, not an outline to join: it stays as it is.
  const picked = shapes.filter((s) => ids.has(s.id) && s.kind !== "photo");
  const one = joined(picked, fonts);
  if (!one) return;
  record();
  const gone = picked.filter((s) => s.id !== one.id).map((s) => s.id);
  setShapes((list) => list.flatMap((s) => (s.id === one.id ? [one] : gone.includes(s.id) ? [] : [s])));
  setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
  setSelected([one.id]);
 };

 /** Drop the points a path doesn't need, to within the Simplify tolerance (see simplified). */
 const simplifyShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const simpler = shape && simplified(shape, simplifyMm / 25.4);
  if (!simpler) return;
  record();
  setShapes((list) => list.map((s) => (s.id === id ? simpler : s)));
  setPanel(null); // asked for, done, and out of the way again
 };

 /** Take a joined shape apart again: each run becomes a shape of its own. */
 const splitShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const made = shape ? splitApart(shape) : [];
  if (made.length < 2) return;
  record();
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
  if (!fillTargets.length) return;
  record();
  const ids = new Set(fillTargets.map((s) => s.id));
  // A shape filled as one area: its outline is every one of its paths.
  setShapes((list) => list.map((sh) => (ids.has(sh.id) || (sh.group && ids.has(sh.group)) ? { ...sh, outline: on } : sh)));
 };

 /** Hatch a shape, or stop hatching it. A shape that isn't hatched is drawn as its own outline:
  * turning the hatch off puts that outline back, so nothing is left invisible. */
 const setHatched = (on: boolean) => {
  if (!fillLead) return;
  setFillAt(0, on ? newFill(defaults.angle) : null);
  if (!on) {
   const ids = new Set(fillTargets.filter((s) => s.outline === false).map((s) => s.id));
   if (ids.size) setShapes((list) => list.map((sh) => (ids.has(sh.id) || (sh.group && ids.has(sh.group)) ? { ...sh, outline: undefined } : sh)));
  }
 };

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
  // The copy's shapes are shapes of their own, not more paths of the ones they were copied from.
  const groupIds = new Map(shapes.filter((sh) => sh.layerId === id && sh.group).map((sh) => [sh.group!, newGroupId()]));
  setLayers((list) => {
   const next = [...list];
   next.splice(next.findIndex((l) => l.id === id) + 1, 0, copy);
   return next;
  });
  setShapes((list) => [...list, ...list.filter((sh) => ids.has(sh.id)).map((sh) => ({ ...sh, id: ids.get(sh.id)!, layerId: copy.id, group: sh.group && groupIds.get(sh.group) }))]);
  setFills((list) => [
   ...list,
   ...list.filter((f) => ids.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: ids.get(f.shapeId)! })),
   ...list.filter((f) => groupIds.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: groupIds.get(f.shapeId)! })),
  ]);
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
 // The pen of the layer being renamed, if it has one: then only the label after it is typed.
 const penBeforeEdit = useRef<string | null>(null);
 const typeLayerName = (id: string, typed: string) => {
  const pen = penBeforeEdit.current;
  const name = pen ? joinLayerName(pen, typed) : typed;
  setLayers((list) => list.map((l) => (l.id === id ? { ...l, name } : l)));
 };
 /** Escape: the name it had, whole. */
 const restoreLayerName = (id: string) =>
  setLayers((list) => list.map((l) => (l.id === id ? { ...l, name: nameBeforeEdit.current } : l)));
 const settleLayerName = (id: string) =>
  setLayers((list) => list.map((l) => {
   if (l.id !== id) return l;
   const pen = penBeforeEdit.current;
   const typed = pen ? joinLayerName(pen, labelAfter(l.name, pen).trim()) : l.name.trim();
   const wanted = typed || nameBeforeEdit.current;
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

 // Picking from the list: the row's box puts a path in or takes it out, as a checkbox would; its
 // name takes that path alone, or with Shift does what the box does.
 // A shape's row takes all of its paths out together, as it puts them all in.
 const pickFromRow = (id: string, add: boolean) =>
  setSelected((current) => {
   if (!add) return [id];
   const whole = withWholeGroups([id], shapes);
   return current.some((one) => whole.includes(one)) ? current.filter((one) => !whole.includes(one)) : [...current, id];
  });

 // The shape whose name is open for typing into, and what it was called before: renaming is asked
 // for from the row's menu, and Escape puts the old name back.
 const [renaming, setRenaming] = useState<string | null>(null);
 // The same for a layer's name, which is edited the same way and for the same reason.
 const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
 // A shape made of several paths is renamed the same way, by its group's id: every one of its paths
 // carries the name.
 const typeShapeName = (id: string, name: string) =>
  setShapes((list) => (list.some((s) => s.group === id)
   ? list.map((s) => (s.group === id ? { ...s, groupName: name } : s))
   : list.map((s) => (s.id === id ? { ...s, name } : s))));
 const settleShapeName = (id: string) =>
  setShapes((list) => (list.some((s) => s.group === id)
   ? list.map((s) => (s.group === id ? { ...s, groupName: s.groupName?.trim() || undefined } : s))
   : list.map((s) => (s.id === id ? { ...s, name: s.name?.trim() || undefined } : s))));

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
 const [rowMenu, setRowMenu] = useState<{ kind: "layer" | "shape" | "group"; id: string; anchor: HTMLElement } | null>(null);
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
  const size = SIZES.find((s) => s.id === id);
  if (!size) return;
  record();
  // Keep the orientation the page is already in, so choosing a size doesn't also turn it.
  const landscape = page.w >= page.h;
  setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
 };

 // Asked in the rail rather than in a dialog: the question is about this drawing, and the answer is
 // one of three buttons. Saving first is offered because wanting a new drawing is rarely the same as
 // wanting to lose this one. Shown in whichever rail is up, since Setup starts new drawings too.
 const confirmNewBlock = confirmNew && (
         <div className={styles.confirm} role="alertdialog" aria-label="Start a new drawing">
          <p>
           {saved ? `“${name}” has` : "This drawing has"} changes that aren’t saved.
          </p>
          <div className={styles.actions}>
           <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
             if (await save()) beginNew();
            }}
           >
            Save, then start new
           </Button>
           <Button size="sm" tone="danger" variant="secondary" onClick={beginNew}>
            Discard and start new
           </Button>
           <Button size="sm" variant="tertiary" onClick={() => setConfirmNew(null)}>
            Keep editing
           </Button>
          </div>
         </div>
 );

 // The same Paper card in both rails: a calibration sheet is laid out on the paper chosen here.
 const paperSection = (
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
   onTurnDrawing={turnDrawing}
   drawingScale={drawingScale}
   onScaleDrawing={scaleDrawing}
   onFit={shapes.length ? fitDrawing : undefined}
  />
 );

 // Setup: getting the drawing tools ready, away from the drawing. For now that is calibration -
 // a sheet of every pen plotted and photographed, read back as each pen really comes out.
 const setupRail = (
  <Card variant="flat" className={styles.controls}>
   <div className={`${styles.cardBody} ${controls.cardSections}`}>
    <Section title="Setup">
     <p className={controls.hint}>Getting the drawing tools ready. The drawing stays as it is; the gear goes back to it.</p>
    </Section>
    {paperSection}
    <DrawingToolSection tools={presets} value={toolName} onPick={pickTool} collapsibleKey="setup-pen" disabled={busy} />
    <CalibrationSection
     tool={tool2}
     toolName={toolName}
     busy={busy}
     sheetOpen={Boolean(sheet)}
     sheetIsTool={sheetIsTool}
     strangers={strangers}
     onNewSheet={() => startNew("calibration")}
     onNewPairs={() => startNew("pairs")}
     onReadPhoto={readSheetPhoto}
     confirm={confirmNewBlock}
    />
    <Section title="Appearance" action={<ThemeToggle />}>
     <p className={controls.hint}>Light or dark. Plot follows the same choice.</p>
    </Section>
   </div>
  </Card>
 );

 // The chosen photo's card: in the drawing's rail, and in image conversion's under its own.
 const photoCard = chosen?.kind === "photo" && chosen.photo ? (
  <PhotoCard
   shape={chosen as Shape & { photo: Photo }}
   title={shapeName(chosen, onActive.indexOf(chosen))}
   shapes={shapes}
   layers={layers}
   busy={busy}
   all={photoAll}
   onAll={setPhotoAll}
   scale={(() => { const { b, fitW } = photoScale(chosen); return Math.round(((b.x1 - b.x0) / fitW) * 100); })()}
   actions={{
    turn: turnPhoto,
    replace: replacePhoto,
    setPlate: setSeparationPlate,
    switchMode: switchPhotoMode,
    set: setPhotoOf,
    split: splitPhoto,
    splitByColor: splitPhotoByColor,
    setKeyLayer,
    place: placePhoto,
    setMargin: setPhotoMargin,
    setScale: setPhotoScale,
    pickBand: (id, layerId) => { pick(id); setActiveLayer(layerId); },
   }}
  />
 ) : null;

 // Setup and image conversion both take the drawing's place; going to one leaves the other.
 const setupToolbar = (
  <SetupToolbar
   open={setupOpen}
   onToggle={() => {
    setConvertId(null);
    setSetupOpen((open) => !open);
   }}
  />
 );

 // Image conversion's rail: what it is and how the lines come out, then the photo's own card.
 const convertLayer = converted ? layers.find((l) => l.id === converted.layerId) : undefined;
 const convertRail = converted && (
  <>
   <Card variant="flat" className={styles.controls}>
    <div className={`${styles.cardBody} ${controls.cardSections}`}>
     <Section
      title="Image conversion"
      action={<Button size="sm" variant="secondary" title="Leave image conversion: the drawing with its layers and tools, the photo drawn as set here" onClick={() => setConvertId(null)}>Edit as drawing</Button>}
     >
      <p className={controls.hint}>
       Working out how best to draw this picture. Scroll over it to zoom, drag to move, double-click to see all of it.
      </p>
      <p className={controls.hint}>
       {convertRead
        ? `${convertStrokes.toLocaleString()} ${convertStrokes === 1 ? "stroke" : "strokes"}, ${convertLength * 0.0254 >= 1 ? `${(convertLength * 0.0254).toFixed(1)} m` : `${Math.round(convertLength * 25.4)} mm`} of drawing${convertParts.length > 1 ? ` in ${convertParts.length} pens` : convertLayer ? `, in ${convertLayer.name}` : ""}.`
        : "Reading the photo…"}
      </p>
     </Section>
    </div>
   </Card>
   {photoCard}
  </>
 );

 /** The copied fill onto the chosen shape, or every fillable shape selected, in place of their own. */
 const pasteFill = () => {
  if (!fillClipboard || !fillTargets.length) return;
  record();
  const ids = new Set(fillTargets.map((s) => s.id));
  setFills((list) => [
   ...list.filter((f) => !ids.has(f.shapeId)),
   ...fillTargets.flatMap((s) => fillClipboard.map((f) => ({ ...f, id: newFillId(), shapeId: s.id }))),
  ]);
 };

 // The Hatch settings, for the chosen shape or for a whole selection at once.
 const fillPanel = fillLead && (
  <FillPanel
   fills={chosenFills}
   outline={fillLead.outline !== false}
   count={fillTargets.length}
   asOne={Boolean(pickedWhole) && !chosen}
   actions={{
    setHatched,
    setAt: setFillAt,
    setByHand: setFillByHand,
    followTool,
    // A second pass square to the first, which is what makes it read as a mesh rather than as two
    // hatchings that happen to share a shape.
    setCross: (on) => setFillAt(1, on ? { ...newFill((chosenFills[0].angle + 90) % 180), connected: chosenFills[0].connected } : null),
    setConnected: (connected) => {
     record();
     setFills((list) => list.map((f) => (fillTargets.some((t) => t.id === f.shapeId) ? { ...f, connected } : f)));
    },
    setOutline,
   }}
  />
 );

 const banner = useMemo(
  () => (message.text && (!message.ok || message.progress) ? { text: message.text, error: !message.ok, working: message.progress } : null),
  [message],
 );

 return (
  <div className={styles.app}>
   {/* Problems, and what's under way, across the top of the page - never on the preview's rulers. */}
   <StatusBanner message={banner} />
   <Hints />
   <FileBrowser
    open={browserOpen}
    endpoint="/api/studio/read"
    onClose={() => setBrowserOpen(false)}
    addMode={browserAdds}
    onOpened={(res) => openDrawing(res, (n) => `Opened ${res.name} - ${n} ${n === 1 ? "path" : "paths"}`)}
    combine={{
     endpoint: "/api/studio/combine",
     canAdd: shapes.length > 0,
     // This drawing as it would be saved, for the files to go on top of.
     base: () => buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, fonts }),
     onCombined: openCombined,
    }}
   />
   <StudioHeader plotterFound={plotterFound} />
   {colorMenu && layers.some((l) => l.id === colorMenu.id) && (
    <PaletteMenu
     anchor={colorMenu.anchor}
     palette={palette}
     current={layers.find((l) => l.id === colorMenu.id)?.color ?? null}
     onPick={(pen) => {
      // The name travels with the colour: Plot colours a layer from the pen its name matches. The
      // layer becomes the pen's name, with the label it had kept after it - "Black - Crop marks" in
      // Red is "Red - Crop marks" - and nothing else: no number in front, which plotting order doesn't
      // need, and no old name that wasn't a pen and a label: "13-date" in Turquoise is "Turquoise". A
      // second layer in the same pen and label is "Turquoise 2", which still matches the pen.
      const was = splitLayerName(layers.find((l) => l.id === colorMenu.id)?.name ?? "", palette);
      const wanted = joinLayerName(pen.name, was.pen ? was.label.trim() : "");
      patchLayer(colorMenu.id, { name: uniqueName(wanted, layers.filter((l) => l.id !== colorMenu.id).map((l) => l.name)), color: pen.color });
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
     actions={rowMenu.kind === "group"
      ? [
       {
        label: "Rename",
        icon: <PenLine />,
        onSelect: () => {
         nameBeforeEdit.current = membersOf(rowMenu.id)[0]?.groupName ?? "";
         record();
         setRenaming(rowMenu.id);
        },
       },
       { label: "Ungroup", icon: <Ungroup />, onSelect: () => ungroupShapes(membersOf(rowMenu.id).map((s) => s.id)) },
       { label: "Duplicate shape", icon: <Copy />, onSelect: () => duplicateGroup(rowMenu.id) },
       ...layers
        .filter((l) => l.id !== membersOf(rowMenu.id)[0]?.layerId)
        .map((l) => ({
         label: `Move to ${l.name}`,
         icon: <Layers2 />,
         onSelect: () => moveGroupToLayer(rowMenu.id, l.id),
        })),
       { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => removeShapes(membersOf(rowMenu.id).map((s) => s.id)) },
      ]
      : rowMenu.kind === "layer"
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
         // A layer drawn in one of the tool's pens keeps the pen: what is typed is the label after it.
         penBeforeEdit.current = splitLayerName(nameBeforeEdit.current, palette).pen;
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
       { label: "Copy path", icon: <ClipboardCopy />, onSelect: () => copyShape(rowMenu.id) },
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
       { label: "Duplicate path", icon: <Copy />, onSelect: () => duplicateShape(rowMenu.id) },
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
    <section className={styles.stage} aria-label={converted ? "Image conversion" : "Drawing page"}>
     {converted && convertBox ? (
      <ConvertStage
       photo={converted.photo!}
       w={convertBox.x1 - convertBox.x0}
       h={convertBox.y1 - convertBox.y0}
       parts={convertParts}
       view={convertView}
       onView={setConvertView}
       history={{ canUndo, canRedo, onUndo: undo, onRedo: redo }}
       toolbar={setupToolbar}
       disabled={busy}
      />
     ) : (
     <Canvas
      loupe={loupe}
      page={page}
      paperColor={paperColor}
      shapes={shapes}
      fills={fills}
      model={model}
      zoom={zoom}
      // One bar over the page for everything true of what is being looked at: what has just
      // been done, how the drawing is drawn, and how close the view sits. It used to be two
      // groups at opposite ends of the width line.
      toolbar={setupToolbar}
      toolbarLeft={(
       <PreviewToolbar
        view={view}
        onView={setView}
        zoom={zoom}
        onZoom={setZoom}
        canDrawing={shapes.length > 0}
        canPhoto={shapes.some((sh) => sh.kind === "photo")}
        history={{ canUndo, canRedo, onUndo: undo, onRedo: redo }}
        disabled={busy}
        loupe={loupe}
        onLoupe={setLoupe}
       />
      )}
      layers={layers}
      activeLayer={active?.id ?? ""}
      penWidthMm={penWidthMm}
      inkOpacity={inkOpacity}
      inkBuilds={inkBuilds}
      inkOpaque={inkOpaque}
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
     )}
    </section>

    <div className={styles.side}>
     {setupOpen ? setupRail : (<>
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <FileSection
        name={name}
        onName={setName}
        saved={saved}
        dirty={dirty}
        hasShapes={shapes.length > 0}
        busy={busy}
        confirm={confirmNewBlock}
        onOpen={() => {
         setBrowserAdds(false);
         setBrowserOpen(true);
        }}
        onAddLayer={() => {
         setBrowserAdds(true);
         setBrowserOpen(true);
        }}
        onOpenPhotos={openPhotos}
        onNew={() => startNew()}
        onSendToPlot={sendToPlot}
        onSave={save}
       />

       {/* What the drawing is made on and with, in the same card as the drawing itself: the same
         Settings, Paper and Drawing tool cards as Plot's, with the grid, which is Studio's alone. */}
       <SettingsSection collapsibleKey="settings">
        {paperSection}

        {!converted && <GridSection snapping={snapping} onSnapping={setSnapping} step={snapStep} onStep={setSnapStep} />}

        <DrawingToolSection tools={presets} value={toolName} onPick={pickTool} collapsibleKey="pen" disabled={busy} />
       </SettingsSection>
      </div>
     </Card>
     {/* Image conversion keeps the file and what it is drawn on and with; the rest is the drawing's. */}
     {converted ? convertRail : (<>

     <ToolPicker tool={tool} onTool={setTool} />

     {/* The layers, and what is on the one being worked on: two sections of one card. */}
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <Section title="Artwork" collapsibleKey="artwork">
       <LayersSection
        layers={layers}
        active={active}
        activeHasShapes={onActive.length > 0}
        canMerge={shapes.length > 1}
        tool={tool2}
        busy={busy}
        colorMenuId={colorMenu?.id}
        rowMenuId={rowMenu?.id}
        renaming={renamingLayer}
        onSort={sortLayersByLightness}
        onMerge={mergeOverlaps}
        onAdd={addLayer}
        onSwitch={switchLayer}
        onVisible={(id, visible) => patchLayer(id, { hidden: !visible })}
        onColorMenu={(id, anchor) => setColorMenu((open) => (open?.id === id ? null : { id, anchor }))}
        onRowMenu={(id, anchor) => setRowMenu((open) => (open?.id === id ? null : { kind: "layer", id, anchor }))}
        onRenameType={typeLayerName}
        onRenameCancel={restoreLayerName}
        renamePen={penBeforeEdit.current}
        onRenameDone={(id) => {
         settleLayerName(id);
         setRenamingLayer(null);
        }}
        onRestackStart={record}
        onRestack={(id, to) => setLayers((list) => {
         const from = list.findIndex((l) => l.id === id);
         if (from < 0 || from === to) return list;
         const next = [...list];
         next.splice(to, 0, next.splice(from, 1)[0]);
         return next;
        })}
        alignTarget={alignTarget}
        alignable={alignable}
        onAlignTarget={setAlignTo}
        onAlign={alignLayer}
        onTurn={turnLayer}
       />

       {active && (
        <ShapeList
         layer={active}
         shapes={onActive}
         picked={pickedIds}
         busy={busy}
         renaming={renaming}
         rowMenuId={rowMenu?.id}
         onPick={pickFromRow}
         onDeleteAll={() => {
          record();
          const gone = onActive.map((sh) => sh.id);
          setShapes((list) => list.filter((sh) => !gone.includes(sh.id)));
          setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
          setSelected([]);
         }}
         onRenameType={typeShapeName}
         onRenameCancel={(id) => typeShapeName(id, nameBeforeEdit.current)}
         onRenameDone={(id) => {
          settleShapeName(id);
          setRenaming(null);
         }}
         onRowMenu={(id, anchor) => setRowMenu((open) => (open?.id === id ? null : { kind: "shape", id, anchor }))}
         onGroupMenu={(id, anchor) => setRowMenu((open) => (open?.id === id ? null : { kind: "group", id, anchor }))}
        />
       )}
       </Section>
      </div>
     </Card>

     {selected.length > 1 && (
      <SelectionCard
       count={selected.length}
       fillable={fillTargets.length}
       busy={busy}
       shapeName={pickedShape}
       asOne={Boolean(pickedWhole)}
       canGroup={groupable(selected)}
       canUngroup={shapes.some((s) => s.group && pickedIds.has(s.id))}
       canPaste={Boolean(fillClipboard)}
       onGroup={groupShapes}
       onUngroup={() => ungroupShapes(selected)}
       onJoin={joinShapes}
       onPaste={pasteFill}
       fillPanel={fillPanel}
      />
     )}

     {photoCard}

     {chosen?.kind === "text" && <TextCard shape={chosen} fonts={fontList} onChange={setTextOf} />}

     {chosen && hasShapeCard(chosen) && (
      <ShapeCard
       shape={chosen}
       title={shapeName(chosen, onActive.indexOf(chosen))}
       busy={busy}
       hasFill={fills.some((f) => f.shapeId === chosen.id)}
       canPaste={Boolean(fillClipboard)}
       panel={panel}
       onPanel={showPanel}
       fillPanel={fillPanel}
       simplifyMm={simplifyMm}
       onSimplifyMm={setSimplifyMm}
       actions={{
        flatten: flattenShape,
        setCurve,
        split: splitShape,
        simplify: simplifyShape,
        copyFill: () => setFillClipboard(fills.filter((f) => f.shapeId === chosen.id)),
        pasteFill,
        setRotation,
        setRepeat,
        bake: bakeRepeat,
       }}
      />
     )}
     </>)}
     </>)}

    </div>
   </main>
  </div>
 );
}
