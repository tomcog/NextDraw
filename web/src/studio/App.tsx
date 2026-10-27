import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
// Separations into many plates are solved off the page (importing this turns it on).
import "../shared/lib/drawing/separationWorker";
import { PaperSection, paperMarginMm } from "../shared/components/controls/PaperSection";
import { PanelToolbar, panelIcon } from "../shared/components/PanelToolbar";
import { Button, Card } from "@tomcoggia/ui";
import { ArrowDownToLine, ClipboardCopy, ClipboardPaste, Copy, Layers, Layers2, LayersArrowDown, Lock, LockOpen, MousePointer2, PenLine, Sparkles, Spline, SquareDimensions, Trash2, Ungroup } from "lucide-react";
import { FileBrowser, type CombineResult } from "../shared/components/FileBrowser";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { api } from "../shared/lib/api";
import { isSvgFile, useFileDrop } from "../shared/lib/useFileDrop";
import type { FitAlign } from "../shared/lib/geometry";
import { load, save as remember } from "../shared/lib/storage";
import { DEFAULT_SETTINGS, PAPER_SIZES, penWidthOf } from "../shared/lib/constants";
import type { Info, PenColor, PlotterModel, Preset } from "../shared/lib/types";
import { listOf } from "../shared/lib/format";
import { lightness } from "../shared/lib/color";
import { isVarnishLayer, joinLayerName, labelAfter, splitLayerName, VARNISH, VARNISH_COLOR } from "../shared/lib/ink";
import { HistoryToolbar, type View } from "../shared/components/PreviewToolbar";
import { StatusBanner } from "../shared/components/StatusBanner";
import { AppSwitch } from "../shared/components/AppSwitch";
import { UnsavedChangesModal } from "../shared/components/UnsavedChangesModal";
import { ToolbarSeparator } from "../shared/components/ToolbarSeparator";
import type { Zoom } from "../shared/components/BedCanvas";
import { Canvas, isStrokeTool, type Tool } from "./components/Canvas";
import { strokeKey, withoutStrokes } from "./lib/strokePick";
import { mergeLines } from "./lib/mergeLines";
import { SIGNATURE_FONT, SIGNATURE_LABEL, signatureShapes, signatureSize } from "./lib/signature";
import { TrimMarksSection } from "../shared/components/controls/TrimMarksSection";
import { drawingBoxOf, trimShapeOf, withDrawingMoved, withTrimBox, withTrimMarks, withTrimOff, withTrimOn, type TrimDrawing } from "../shared/lib/drawing/trimMarks";
import { TRIM_LABEL } from "../shared/lib/drawing/trimMarks";
import { isRegistrationBlock, registrationLayers, registrationShapes, registrationSize } from "./lib/registration";
import { clearSpot, inkMap } from "./lib/clearSpot";
import { SizePopover } from "./components/SizePopover";
import { StudioHeader } from "./components/StudioHeader";
import { canFill, newFillId, shapeAsOne, type Fill } from "../shared/lib/drawing/hatch";
import { type Curve, type Point } from "../shared/lib/drawing/parametric";
import { fontNames, loadFont, type StrokeFont } from "../shared/lib/drawing/font";
import { fitText } from "../shared/lib/drawing/text";
import { type Repeat } from "../shared/lib/drawing/repeat";
import { parseDrawing } from "../shared/lib/drawing/parse";
import { PLATE_OFF, platesOf } from "../shared/lib/drawing/photo";
import { useHistory } from "../shared/lib/useHistory";
import { useDrawingFile, type Current } from "../shared/lib/drawing/useDrawingFile";
import { lockBanner, useEditLock } from "../shared/lib/useEditLock";
import { bakedCopies, flattened, handOutFills, joined, markRuns, pointCount, simplified, simplifyDrawing, splitApart, refitted } from "./lib/shapeEdits";
import { PaletteMenu } from "../shared/components/controls/PaletteMenu";
import { Hints } from "../shared/components/controls/Hints";
import { RowMenu } from "../shared/components/controls/RowMenu";
import { ShapeList } from "./components/panels/ShapeList";
import { canFlatten, hasShapeCard, ShapeCard, type ShapePanel } from "./components/panels/ShapeCard";
import { TextCard } from "./components/panels/TextCard";
import { SelectionCard } from "./components/panels/SelectionCard";
import { FillPanel } from "./components/panels/FillPanel";
import { FileSection } from "../shared/components/controls/FileSection";
import { useUnits } from "../shared/lib/useUnits";
import { GridSection } from "./components/panels/GridSection";
import { SIMPLIFIER_START, SimplifierSection, type SimplifierState } from "./components/panels/SimplifierSection";
import { JIGGLE_START, JiggleSection, newJiggleSeed, type JiggleState } from "./components/panels/JiggleSection";
import { jiggled } from "./lib/jiggle";
import { ToolPicker } from "./components/panels/ToolPicker";
import { LayersSection } from "../shared/components/controls/LayersSection";
import { shapeIcon } from "./components/panels/ToolPicker";
import { addPointOnLongest, boxAround, boxOf, clampToPage, groupLabel, groupsOf, moveBy, newGroupId, newLayerId, newShapeId, pointsBox, resizeTo, scaleInto, shapeName, turnAround, withWholeGroups, type Layer, type Page, type Shape } from "../shared/lib/drawing/shapes";
import { areaPicker, silhouetteOf } from "../shared/lib/drawing/silhouette";
import { buildSvg, svgForMarks } from "../shared/lib/drawing/svg";
import { fitToPage, reshapeDrawing, runsOffPage } from "../shared/lib/drawing/whole";
import { turnDrawingOnPaper } from "../shared/lib/drawing/turnPaper";
import { useSharedPen } from "../shared/lib/useSharedPen";
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
// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
const FONT_KEY = "studio-font";
const SNAP_KEY = "studio-snap";
const SIMPLIFY_KEY = "studio-simplify";
const SIMPLIFY_REFIT_KEY = "studio-simplify-refit";

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
 d: "strokes",
 q: "lasso",
};

const PAPER_COLOR_KEY = "studio-paper-color";

/** What undo puts back: the drawing, and the Paper card's scale, so undoing a scale puts the field back with it. */
interface Snapshot {
 shapes: Shape[];
 fills: Fill[];
 layers: Layer[];
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
 * Shapes made upright in a box of `size`, turned a quarter to the left so the turned box's top-left
 * lands at `at`: made about the turned box's middle, then turned about it, each shape's own turn
 * taking up the angle as the Turn handle's would.
 */
function quarterLeft(at: { x: number; y: number }, size: { w: number; h: number }, make: (topLeft: { x: number; y: number }) => Shape[]): Shape[] {
 const mid = { x: at.x + size.h / 2, y: at.y + size.w / 2 };
 return turnAround(make({ x: mid.x - size.w / 2, y: mid.y - size.h / 2 }), mid, -90);
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
   ...s, x: lead.x, y: lead.y, x2: lead.x2, y2: lead.y2, rotation: lead.rotation, scale: lead.scale,
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
 const [shapes, setShapes] = useState<Shape[]>([]);
 const [fills, setFills] = useState<Fill[]>([]);
 const [layers, setLayers] = useState<Layer[]>(() => [{ id: newLayerId(), name: "Black", color: "#262626" }]);
 // The targeted layers, in the order they were targeted: none, one, or several worked on as one -
 // picked, listed, turned and simplified together. New shapes land on the one targeted last, or with
 // none targeted on the top layer, which is then targeted. Anything that sets a single layer
 // (opening, adding, deleting one) sets it alone.
 const [targets, setTargets] = useState<string[]>([]);
 const activeLayer = targets[targets.length - 1] ?? "";
 const setActiveLayer = (to: string | ((current: string) => string)) =>
  setTargets((list) => {
   const id = typeof to === "function" ? to(list[list.length - 1] ?? "") : to;
   return id ? [id] : [];
  });
 // Paths hidden from view by their row's eye. Studio's view alone, as a layer's eye is: the file
 // keeps them, and Plot draws them.
 const [hiddenShapes, setHiddenShapes] = useState<Set<string>>(() => new Set());
 const showShapes = (ids: string[], visible: boolean) =>
  setHiddenShapes((set) => {
   const next = new Set(set);
   for (const id of ids) (visible ? next.delete(id) : next.add(id));
   return next;
  });
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
 // Simplify reshaping the curves' handles round fewer points, in place of thinning and smoothing.
 const [simplifyRefit, setSimplifyRefit] = useState<boolean>(() => load<boolean>(SIMPLIFY_REFIT_KEY) ?? false);
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
 // Select to start with: a drawing opened is usually to be looked at and moved before it's drawn on.
 const [tool, setTool] = useState<Tool>("select");
 // Everything picked, in the order it was picked. The cards edit the last of them; a drag, a delete
 // or a nudge takes the lot, which is what makes moving a whole layer at once possible.
 // A path of a shape made of several is never picked alone: picking it picks the whole shape. What
 // was asked for is kept as it was; the selection everything else works from is that, made whole.
 const [picks, setSelected] = useState<string[]>([]);
 // Nothing on a locked layer is ever in it, however it was asked for.
 const selected = useMemo(() => {
  const locked = new Set(layers.filter((l) => l.locked).map((l) => l.id));
  const whole = withWholeGroups(picks, shapes);
  return locked.size ? whole.filter((id) => !locked.has(shapes.find((s) => s.id === id)?.layerId ?? "")) : whole;
 }, [picks, shapes, layers]);
 // Strokes picked with Stroke select or the Lasso - single runs of paths, by strokeKey - for Delete
 // to take out without taking their paths apart. Only while one of those tools is in hand: taking it
 // up lets the shapes go, putting it down lets the strokes go.
 const [strokePick, setStrokePick] = useState<string[]>([]);
 useEffect(() => {
  if (isStrokeTool(tool)) setSelected([]);
  else setStrokePick([]);
 }, [tool]);
 // A stroke that's gone - undone, deleted, its path joined or taken apart - is no longer picked.
 useEffect(() => {
  if (!strokePick.length) return;
  const live = new Set(shapes.flatMap((sh) => (sh.runs ?? (sh.points ? [sh.points] : [])).map((_, i) => strokeKey(sh.id, i))));
  setStrokePick((list) => (list.every((k) => live.has(k)) ? list : list.filter((k) => live.has(k))));
 }, [shapes]); // eslint-disable-line react-hooks/exhaustive-deps
 /** Take the picked strokes out. Their paths keep the rest; a path left with none goes, and its fill. */
 const deleteStrokes = () => {
  if (!strokePick.length) return;
  const { shapes: next, gone } = withoutStrokes(shapes, new Set(strokePick));
  record();
  setShapes(next);
  if (gone.length) {
   setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
   setSelected((current) => current.filter((id) => !gone.includes(id)));
  }
  setStrokePick([]);
 };
 const pick = (id: string | null) => setSelected(id ? [id] : []);
 // Choosing a layer in the Layers card only chooses the layer: its paths are listed, but none is
 // selected until one is clicked, on the page or in the list. Whatever was selected on the layer
 // before is let go, so nothing is left selected out of sight. With `add`, the layer joins the
 // targets, or leaves them - the last one too, leaving none - and what was picked on the others
 // stays picked.
 const switchLayer = (id: string, add = false) => {
  if (!add) {
   if (targets.length === 1 && id === activeLayer) return;
   setTargets([id]);
   setSelected([]);
   return;
  }
  // From the list as it is now, not as this render saw it: a stroke down the boxes (useTargetPaint)
  // can switch several layers before the next render, and each must add to the last.
  const leaving = targets.includes(id);
  setTargets((list) => (list.includes(id) ? list.filter((t) => t !== id) : [...list, id]));
  if (leaving) setSelected((ids) => ids.filter((sid) => shapes.find((sh) => sh.id === sid)?.layerId !== id));
 };
 const [busy, setBusy] = useState(false);
 const [browserOpen, setBrowserOpen] = useState(false);
 // What the toolbar says. Only problems, and work still under way (`progress`), are shown: a note
 // that something went as asked is left unsaid, since the result is there to see.
 const [message, setMessage] = useState<{ text: string; ok: boolean; progress?: boolean }>({
  text: "",
  ok: true,
 });

 // The paper's colour: the page is drawn in it and the inks blend with it, as they do in Plot. Kept
 // in the drawing, like its size, so all three apps show the same paper; this browser remembers the
 // last one for a new drawing.
 const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
 // Inches or millimetres for the Paper card: one choice for all three apps.
 const [units, setUnits] = useUnits();
 useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
 // Which of the rail's cards are out, from the toolbar at the left, as in Photo and Plot.
 const [fileCard, setFileCard] = useState(() => load<boolean>("studio-file-card") ?? true);
 useEffect(() => remember("studio-file-card", fileCard), [fileCard]);
 const [paperCard, setPaperCard] = useState(() => load<boolean>("studio-paper-card") ?? true);
 useEffect(() => remember("studio-paper-card", paperCard), [paperCard]);
 const [penCard, setPenCard] = useState(() => load<boolean>("studio-pen-card") ?? true);
 useEffect(() => remember("studio-pen-card", penCard), [penCard]);
 const [gridCard, setGridCard] = useState(() => load<boolean>("studio-grid-card") ?? true);
 useEffect(() => remember("studio-grid-card", gridCard), [gridCard]);
 // The Trim marks card, from its switch last in the panels toolbar: the same card as Image's and Plot's.
 const [trimCard, setTrimCard] = useState(() => load<boolean>("studio-trim-card") ?? false);
 useEffect(() => remember("studio-trim-card", trimCard), [trimCard]);
 // The Simplifier as the tool in hand, its card out. Put down each time the page opens, as a tool is.
 const [simplifierCard, setSimplifierCard] = useState(false);
 // Jiggle the same way: a tool in hand with its card out, put down when another is taken up. Its
 // numbers are kept between visits - a second pass is usually jiggled the way the last one was.
 const [jiggleCard, setJiggleCard] = useState(false);
 const [jiggle, setJiggle] = useState<JiggleState>(() => ({ ...JIGGLE_START, ...load<JiggleState>("studio-jiggle") }));
 useEffect(() => remember("studio-jiggle", jiggle), [jiggle]);
 // The Layers card, out or put away from its switch under Select; remembered, like the other cards.
 const [layersCard, setLayersCard] = useState(() => load<boolean>("studio-layers-card") ?? true);
 useEffect(() => remember("studio-layers-card", layersCard), [layersCard]);
 // The Simplifier's settings, in mm on the paper, and whether it works on the whole drawing or one layer.
 // Which simplifications are ticked and how far each reaches, until Simplify keeps them and clears it.
 const [simplifier, setSimplifier] = useState<SimplifierState>(SIMPLIFIER_START);
 const [simplifyScope, setSimplifyScope] = useState<"drawing" | "layer">(() => load<"drawing" | "layer">("studio-simplifier-scope") ?? "drawing");
 useEffect(() => remember("studio-simplifier-scope", simplifyScope), [simplifyScope]);
 const sizeId = useMemo(() => {
  const match = SIZES.find(
   (s) =>
    (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) ||
    (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01),
  );
  return match ? match.id : "custom";
 }, [page]);

 // The drawing is the current drawing, shared by the three apps: picked up on starting, and again
 // when it's changed or replaced in another app or window (showCurrent, below).
 const { name, setName, saved, dirty, lock, touch, loaded, combined, started, save, snapshot: takeSnapshot, open, openDropped, goTo, openIn } = useDrawingFile({
  shapes, fills, layers, page, sizeId, toolName, paperColor, fonts, setBusy, setMessage, onCurrent: (current) => showCurrent(current),
 });

 // The drawing tool is written into the file too, so picking one is a change - but only when it's
 // picked here. On startup the stored tool is reconciled against Plot's presets, and that
 // correction arrives after the drawing has been read: counting it would leave a drawing that was
 // only just opened looking unsaved.
 const pickTool = useCallback((pen: string) => {
  setToolName(pen);
  touch();
  sharePen(pen);
 }, [touch]); // eslint-disable-line react-hooks/exhaustive-deps
 // The paper's color too, picked here: a change to the drawing, which the other apps follow.
 const pickPaperColor = (color: string) => {
  if (color === paperColor) return;
  setPaperColor(color);
  touch();
 };

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
     // Every plate of the photo's set - four, or six to eight with the extra inks.
     const plates = platesOf(sh.photo.plates).map((p, i) => { const m = members.find((x) => x.photo?.plate === p); return sh.photo!.plates?.[i] === PLATE_OFF ? PLATE_OFF : m ? colourOf(m) : sh.photo!.plates?.[i] ?? "#000000"; });
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

 const snapshot = useMemo<Snapshot>(() => ({ shapes, fills, layers, page }), [shapes, fills, layers, page]);
 const restore = useCallback((next: Snapshot) => {
  setShapes(next.shapes);
  setFills(next.fills);
  setLayers(next.layers);
  setPage(next.page);
  // A shape that isn't there any more can't stay selected, or its handles would hang in the air.
  const still = new Set(next.shapes.map((s) => s.id));
  setSelected((ids) => ids.filter((id) => still.has(id)));
 }, []);
 const { record, undo, redo, clear: clearHistory, canUndo, canRedo } = useHistory(snapshot, restore);

 const addShape = useCallback((shape: Shape) => {
  record();
  // Text is as wide as its words: the drag only says how tall.
  setShapes((list) => [...list, shape.kind === "text" ? fitText(shape, fontsRef.current[shape.font ?? ""]) : shape]);
  // Drawn with nothing targeted: it lands on the top layer, which is targeted, so it can be picked.
  setTargets((list) => (list.length ? list : [shape.layerId]));
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
   layerId: layerId ?? drawOn.id,
  };
  setShapes((list) => [...list, copy]);
  setFills((list) => [...list, ...clipboard.fills.map((f) => ({ ...f, id: newFillId(), shapeId: copy.id }))]);
  if (layerId ? layerId !== activeLayer : !targets.length) setActiveLayer(copy.layerId);
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
 /** Everything selected onto one layer, drawn in its pen, and still selected: the Layers card's button. */
 const moveSelectedToLayer = (layerId: string) => {
  const ids = new Set(selected);
  if (!shapes.some((s) => ids.has(s.id) && s.layerId !== layerId)) return;
  record();
  setShapes((list) => list.map((s) => (ids.has(s.id) ? { ...s, layerId } : s)));
  // The layer they went to is worked on with the rest, so they stay picked and in its list.
  if (!targets.includes(layerId)) setTargets([...targets, layerId]);
 };
 const moveGroupToLayer = (group: string, layerId: string) => {
  record();
  setShapes((list) => list.map((s) => (s.group === group ? { ...s, layerId } : s)));
  setSelected(membersOf(group).map((s) => s.id));
 };

 /**
  * Nudge everything picked. The arrow keys move it a point (1/72 in), a whole inch with Shift
  * and a hundredth with Alt for the last little bit; the limit is the box round the whole selection,
  * so a group slides along the page's edge rather than piling up against it.
  */
 const nudge = (dx: number, dy: number) => moveShapes(selected, dx, dy);

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
   const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 1 / 72; // a point
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
   setSimplifierCard(false); // another tool taken up puts the Simplifier down
   setJiggleCard(false);
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
 const removeStrokes = useRef(deleteStrokes);
 removeStrokes.current = deleteStrokes;
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape") return;
   if (e.metaKey || e.ctrlKey || e.altKey) return;
   const el = document.activeElement;
   if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
   // With Stroke select or the Lasso, Delete takes out the strokes picked - never whole shapes -
   // and Escape lets them go.
   if (isStrokeTool(tool)) {
    if (!strokePick.length) return;
    e.preventDefault();
    if (e.key === "Escape") setStrokePick([]);
    else removeStrokes.current();
    return;
   }
   if (e.key === "Escape" || !selected.length) return;
   e.preventDefault();
   remove.current(selected);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, [selected, tool, strokePick]);

 // Close whatever is open and begin again on a blank page. The page size stays as it is: it's the
 // paper you're working on today, and a new drawing is almost always for the same sheet.
 // Whether a new drawing is waiting on the question about unsaved work.
 // Something that would put another drawing in this one's place, waiting on the question about
 // unsaved work: what it is, said in the buttons, and doing it.
 const [confirmNext, setConfirmNext] = useState<{ what: string; go: () => void } | null>(null);
 const newDrawing = useCallback((quiet = false) => {
  const noShapes: Shape[] = [];
  const noFills: Fill[] = [];
  const first = { id: newLayerId(), name: "Black", color: "#262626" };
  const onlyLayer = [first];
  setShapes(noShapes);
  setFills(noFills);
  setLayers(onlyLayer);
  setActiveLayer(first.id);
  setSelected([]);
  clearHistory();
  setConfirmNext(null);
  if (!quiet) setMessage({ text: "New drawing", ok: true });
  // An empty page is not unsaved work, and the paper it's on came from the drawing before it.
  started("Untitled", { shapes: noShapes, fills: noFills, layers: onlyLayer, page });
 }, [started, page, clearHistory]);

 // Undo can't bring back which file was open - a snapshot is the drawing, not the drawing's name -
 // so unsaved work gets a question rather than a silent discard.
 const unsaved = dirty && shapes.length > 0;
 const ask = (what: string, go: () => void) => (unsaved ? setConfirmNext({ what, go }) : go());

 // An SVG dragged from the computer onto the page opens in this one's place, as Open… does.
 const draggingFile = useFileDrop((files) => {
  const svg = files.find(isSvgFile);
  if (!svg) {
   setMessage({ text: "Drop an SVG file to open it. Open Illustrator files with Open… so they can be imported.", ok: false });
   return;
  }
  ask("open another", () => void openDropped(svg));
 }, () => !busy && !lock);

 // The current drawing, on screen: on starting, opened here, or changed in another app or window.
 const showCurrent = useCallback((current: Current) => {
  if (current.empty) {
   newDrawing(true);
   return;
  }
  const drawing = parseDrawing(current.svg);
  setPage(drawing.page);
  setShapes(drawing.shapes);
  setFills(drawing.fills);
  setLayers(drawing.layers);
  setActiveLayer(drawing.layers[0]?.id ?? "");
  setSelected([]);
  clearHistory();
  loaded(current, drawing);
  // The pen stays the one every app is using (useSharedPen): a drawing opened doesn't swap it for
  // the one it was saved with.
  if (drawing.paperColor) setPaperColor(drawing.paperColor);
  // Saving would write only what Studio can draw, so anything else in the file has to be said out
  // loud before it's overwritten rather than discovered missing afterwards.
  setMessage(
   drawing.unsupported
    ? {
      text: `${current.name} - ${drawing.unsupported} other ${drawing.unsupported === 1 ? "mark" : "marks"} can’t be edited here and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`,
      ok: false,
     }
    // Opened cleanly, nothing to say: the drawing's name is already in the File card.
    : { text: "", ok: true },
  );
 }, [loaded, clearHistory, newDrawing]);

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

 // Say so if the server isn't there, rather than only failing at the moment of saving. The drawing
 // itself is the current drawing, picked up by useDrawingFile.
 useEffect(() => {
  let cancelled = false;
  api<Info>("/api/info")
   .then((info) => !cancelled && setModel(info.models.find((m) => m.id === DEFAULT_SETTINGS.model) ?? info.models[0]))
   .catch(() => !cancelled && setMessage({ text: "Can’t reach the server. Is server.py running?", ok: false }));
  return () => {
   cancelled = true;
  };
 }, []);

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
 // The pen every app is using: taken when it's picked in Plot or Image, sent there when it's picked here.
 // Not a change to the drawing when it comes from elsewhere.
 const sharePen = useSharedPen(presets, setToolName);

 // How the drawing is drawn: its paths as thin lines, or the ink they will make. Only how it's
 // painted - the drawing is the same either way. Not remembered: a drawing always opens in
 // Outline, which is quick whatever its size, and Preview is asked for when it is wanted.
 const [view, setView] = useState<View>("outline");
 // No photo left to show: back to the lines.
 const hasPhoto = shapes.some((sh) => sh.kind === "photo");
 useEffect(() => {
  if (!hasPhoto && view === "photo") setView("outline");
 }, [hasPhoto, view]);

 const tool2 = presets.find((t) => t.name === toolName) ?? null;


 const palette: PenColor[] = tool2?.palette?.length ? tool2.palette : [PLAIN_PEN];
 // Darkest last in the list, so the default pen is the one you'd reach for first.
 // The real line the pen lays down, so the drawing shows its true weight against the hatch spacing.
 const penWidthMm = penWidthOf(tool2);
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
 useEffect(() => remember(SIMPLIFY_REFIT_KEY, simplifyRefit), [simplifyRefit]);

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

 // The layer targeted last, if any, and every layer targeted, in the order they stack: the layer
 // card lists what's on all of them, and they turn as one. New shapes land on the last targeted, or
 // with none targeted on the top layer.
 const active = layers.find((l) => l.id === activeLayer);
 const drawOn = active ?? layers[layers.length - 1];
 const targetLayers = layers.filter((l) => targets.includes(l.id));
 const targetIds = useMemo(() => new Set(targetLayers.map((l) => l.id)), [targetLayers.map((l) => l.id).join("|")]);
 const onActive = shapes.filter((sh) => targetIds.has(sh.layerId));

 // Turning the active layer as one, about the middle of the box round it: what dragging the turn grip
 // does to the layer picked whole, by an exact angle. Photos stay as they are - they stand square to
 // the page, and their layers are in register with each other - and turn in Photo.
 const turnLayer = (deg: number) => {
  const turning = onActive.filter((sh) => !sh.photo);
  if (!deg) return;
  if (!turning.length) {
   setMessage({ text: "An image is turned in Image, where all its layers turn together", ok: false });
   return;
  }
  const b = boxAround(turning);
  const turned = new Map(turnAround(turning, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, deg).map((sh) => [sh.id, sh]));
  record();
  setShapes((list) => list.map((sh) => turned.get(sh.id) ?? sh));
  setMessage(turning.length < onActive.length
   ? { text: "The image on this layer stays as it is: turn it in Image", ok: false }
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

 /** Set the chosen shape's scale, about the middle of its box: a stored percent, like the turn, so
  *  it can be changed again. The geometry moves by new / old, so 100 puts it back as it was. */
 const setScale = (percent: number) => {
  if (!chosen || !(percent > 0)) return;
  const was = chosen.scale ?? 100;
  if (percent === was) return;
  const b = boxOf(chosen);
  const k = percent / was;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const to = { x0: cx - ((b.x1 - b.x0) * k) / 2, y0: cy - ((b.y1 - b.y0) * k) / 2, x1: cx + ((b.x1 - b.x0) * k) / 2, y1: cy + ((b.y1 - b.y0) * k) / 2 };
  const [scaled] = scaleInto([chosen], b, to);
  record();
  setShapes((list) => list.map((s) => (s.id === chosen.id ? { ...scaled, scale: percent === 100 ? undefined : percent } : s)));
 };

 /** The drawing a quarter turn on the paper, right or left, about its middle: the paper stays as it lies. */
 const turnAll = async (dir: 1 | -1) => {
  let turned;
  try {
   turned = await turnDrawingOnPaper(shapes, fills, page, dir);
  } catch (err) {
   setMessage({ text: `Couldn’t turn the image: ${(err as Error).message}`, ok: false });
   return;
  }
  record();
  setFills(turned.fills);
  setShapes(turned.shapes);
 };

 /** Scale the whole drawing by `k` about one point, then move it by `by`, leaving the paper as it is. */
 const reshape = (k: number, about: Point, by?: Point) => {
  const next = reshapeDrawing(shapes, k, about, by);
  record();
  setShapes(next);
  setMessage(runsOffPage(next, page) ? { text: "The drawing now runs off the paper", ok: false } : { text: "", ok: true });
 };


 /** Scale the drawing as big as the paper allows inside a margin all round - deeper at the bottom, if asked - placed as `align` says. */
 const fitDrawing = (marginMm: number, align: FitAlign, bottomMm = marginMm) => {
  const fit = fitToPage(shapes, page, marginMm / 25.4, align, bottomMm / 25.4);
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

 /**
  * The signature (signature.ts): TC and this year, in the page's bottom right corner inside the Paper
  * card's margin - moved down into the margin if the drawing is there (clearSpot.ts) - picked so it can be dragged where it goes. On its own layer - the one labelled Signature if there
  * is one, else a new one in Black (or the darkest pen) - kept under Varnish, so it's plotted last
  * and can be any pen. `turned`: the same, turned a quarter to the left (placed by its turned box).
  */
 /**
  * Trim marks drawn with their tool: on the drawing's Trim marks layer - made, in the darkest pen and
  * under any Varnish, if there isn't one yet - whatever layer is in hand, so they plot as their own pen
  * and Image's Trim marks card finds them.
  */
 const addTrimMarks = (shape: Shape) => {
  // One undo step for the layer and the marks on it.
  record();
  let layer = layers.find((l) => splitLayerName(l.name, palette).label.trim().toLowerCase() === TRIM_LABEL.toLowerCase());
  if (!layer) {
   const pen = [...palette].sort((a, b) => (lightness(a.color) ?? 1) - (lightness(b.color) ?? 1))[0];
   const made: Layer = { id: newLayerId(), name: uniqueName(joinLayerName(pen.name, TRIM_LABEL), layers.map((l) => l.name)), color: pen.color };
   layer = made;
   setLayers((list) => {
    const varnish = list.findIndex((l) => isVarnishLayer(l.name));
    return varnish >= 0 ? [...list.slice(0, varnish), made, ...list.slice(varnish)] : [...list, made];
   });
  }
  const on = layer.id;
  setShapes((list) => [...list, { ...shape, layerId: on }]);
  setTargets((list) => (list.includes(on) ? list : [...list, on]));
  pick(shape.id);
  setTool("select");
 };

 /** A change to the trim marks, or to the drawing placed in them: one undo step. */
 const editTrim = (edit: (d: TrimDrawing) => TrimDrawing) => {
  const next = edit({ shapes, layers, page });
  if (next.shapes === shapes && next.layers === layers) return;
  record();
  setShapes(next.shapes);
  setLayers(next.layers);
 };

 const addSignature = async (turned = false) => {
  let font = fonts[SIGNATURE_FONT];
  if (!font) {
   try {
    font = await loadFont(SIGNATURE_FONT);
    const loaded = font;
    setFonts((all) => ({ ...all, [SIGNATURE_FONT]: loaded }));
   } catch (err) {
    setMessage({ text: `Couldn't add the signature: ${(err as Error).message}`, ok: false });
    return;
   }
  }
  record();
  let layer = layers.find((l) => splitLayerName(l.name, palette).label.trim().toLowerCase() === SIGNATURE_LABEL.toLowerCase());
  if (!layer) {
   const pen = palette.find((p) => p.name.toLowerCase() === "black")
    ?? [...palette].sort((a, b) => (lightness(a.color) ?? 1) - (lightness(b.color) ?? 1))[0];
   const made: Layer = { id: newLayerId(), name: uniqueName(joinLayerName(pen.name, SIGNATURE_LABEL), layers.map((l) => l.name)), color: pen.color };
   layer = made;
   setLayers((list) => {
    const varnish = list.findIndex((l) => isVarnishLayer(l.name));
    return varnish >= 0 ? [...list.slice(0, varnish), made, ...list.slice(varnish)] : [...list, made];
   });
  }
  const year = new Date().getFullYear();
  const size = signatureSize(year, font);
  const inset = paperMarginMm() / 25.4;
  const map = await inkMap(buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, paperColor, fonts }), page);
  const { at, clear } = clearSpot(map, page, inset, turned ? { w: size.h, h: size.w } : size, "br");
  if (!clear) setMessage({ text: "The drawing reaches the page edge here - the signature is on it", ok: false });
  const made = turned
   ? quarterLeft(at, size, (from) => signatureShapes(year, font, layer.id, from))
   : signatureShapes(year, font, layer.id, at);
  const on = layer.id;
  setShapes((list) => [...list, ...made]);
  setTargets((list) => (list.includes(on) ? list : [...list, on]));
  setSelected(made.map((s) => s.id));
  setTool("select");
 };

 /**
  * Registration blocks (registration.ts): one for each shown layer but the trim marks' and the
  * signature's, butted with no gap for a hidden
  * one, in the page's lower left corner inside the Paper card's margin - moved down into the margin
  * if the drawing is there (clearSpot.ts) - left to right in plotting order. Any already there go first, so pressing it again after the layers change makes them afresh
  * rather than piling up. `turned`: the row turned a quarter to the left, a column from the bottom up.
  */
 const addRegistration = async (turned = false) => {
  const blocked = registrationLayers(layers, palette);
  if (!blocked.length) return;
  const gone = new Set(shapes.filter(isRegistrationBlock).map((s) => s.id));
  const inset = paperMarginMm() / 25.4;
  const size = registrationSize(blocked);
  const rest = shapes.filter((s) => !gone.has(s.id));
  const map = await inkMap(buildSvg(rest, fills, layers, page, { paperSizeId: sizeId, toolName, paperColor, fonts }), page);
  const { at, clear } = clearSpot(map, page, inset, turned ? { w: size.h, h: size.w } : size, "bl");
  if (!clear) setMessage({ text: "The drawing reaches the page edge here - the registration blocks are on it", ok: false });
  record();
  const row = (from: { x: number; y: number }) => registrationShapes(blocked, { x: from.x, y: from.y + size.h });
  const made = turned ? quarterLeft(at, size, row) : row(at);
  setShapes((list) => [...list.filter((s) => !gone.has(s.id)), ...made]);
  setFills((list) => list.filter((f) => !gone.has(f.shapeId)));
  setSelected((ids) => ids.filter((id) => !gone.has(id)));
  setTool("select");
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

 /**
  * Bake a shape's copies and spread them across layers: the first stays on the shape's layer, and
  * each one after it goes onto a layer of its own - the same pen, named as a copy of that layer
  * ("Black 2", "Black 3") and placed after it in the copies' order - so each can be plotted, hidden
  * or given another pen by itself. A copy leaves the shape's group: a group lives on one layer.
  */
 const spreadRepeat = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const home = shape && layers.find((l) => l.id === shape.layerId);
  const baked = shape ? bakedCopies(shape) : [];
  if (!home || baked.length < 2) return;
  record();
  const names = layers.map((l) => l.name);
  const made: Layer[] = baked.slice(1).map(() => {
   const name = uniqueName(home.name, names);
   names.push(name);
   return { ...home, id: newLayerId(), name };
  });
  const spread = baked.map((s, i) => (i ? { ...s, layerId: made[i - 1].id, group: undefined } : s));
  setLayers((list) => list.flatMap((l) => (l.id === home.id ? [l, ...made] : [l])));
  setShapes((list) => list.flatMap((s) => (s.id === id ? spread : [s])));
  setFills((list) => handOutFills(list, id, spread));
  pick(spread[0].id);
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

 /** Drop the points a path doesn't need, to within the Simplify tolerance: thinned and smoothed (see simplified), or refitted (see refitted). */
 const simplifyShape = (id: string) => {
  const shape = shapes.find((s) => s.id === id);
  const simpler = shape && (simplifyRefit ? refitted(shape, simplifyMm / 25.4) : simplified(shape, simplifyMm / 25.4));
  if (!simpler) return;
  record();
  setShapes((list) => list.map((s) => (s.id === id ? simpler : s)));
  setPanel(null); // asked for, done, and out of the way again
 };

 /**
  * The Simplifier over the drawing, or the layer being drawn on, worked out while its card is out so
  * the card can say how many points go before anything changes.
  */
 // What the Simplifier works on: the paths on the layers it's set to, and only those showing - a
 // hidden layer is left as it is.
 const hiddenLayerIds = useMemo(() => new Set(layers.filter((l) => l.hidden).map((l) => l.id)), [layers]);
 const simplifierOn = (s: Shape) => !hiddenLayerIds.has(s.layerId) && (simplifyScope === "drawing" || targetIds.has(s.layerId));
 const simplifierRun = (list: Shape[]) => {
  const inches = (k: keyof SimplifierState["on"]) => (simplifier.on[k] ? simplifier.mm[k] / 25.4 : 0);
  const opts = {
   refit: inches("refit"), mergeShort: inches("mergeShort"), straighten: inches("straighten"), joinEnds: inches("joinEnds"), dropTiny: inches("dropTiny"),
   pruneEvery: simplifier.prune.on ? simplifier.prune.every : 0, pruneMode: simplifier.prune.mode, pruneSeed: simplifier.prune.seed,
  };
  const onLayer = simplifierOn;
  // Overlapping straight lines merged first, so the rest - and Prune's count of strokes - work on the
  // strokes they come to.
  const merged = simplifier.merge ? mergeLines(list, fills.map((f) => f.shapeId), onLayer)?.shapes ?? list : list;
  const run = simplifyDrawing(merged, onLayer, opts);
  const left = new Set(run.shapes.map((s) => s.id));
  return { shapes: run.shapes, gone: list.filter((s) => !left.has(s.id)).map((s) => s.id), before: pointCount(list.filter(onLayer)) };
 };
 const simplifierPreview = useMemo(() => {
  if (!simplifierCard) return null;
  const run = simplifierRun(shapes);
  return { ...run, after: pointCount(run.shapes.filter(simplifierOn)) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [simplifierCard, shapes, fills, simplifier, simplifyScope, targetIds, hiddenLayerIds]);
 const applySimplifier = () => {
  if (!simplifierPreview) return;
  const { shapes: simpler, gone } = simplifierPreview;
  record();
  setShapes(simpler);
  if (gone.length) {
   setFills((list) => list.filter((f) => !gone.includes(f.shapeId)));
   setSelected((ids) => ids.filter((id) => !gone.includes(id)));
  }
  setSimplifier(SIMPLIFIER_START); // kept, and the card is clear for the next go
 };
 // While anything is ticked, the page shows the drawing simplified, and takes no edits: a shape dragged
 // there would be written back simplified, and kept without Simplify being pressed.
 const simplifierShowing = Boolean(simplifierCard && simplifierPreview && (Object.values(simplifier.on).some(Boolean) || simplifier.prune.on || simplifier.merge));
 const keepAsIs = () => {};

 /**
  * Jiggle over the targeted layers that are showing, worked out while its card is out so the page
  * shows it as it's set: the layers moved, or - jiggling a copy - the copy beside them.
  */
 const jiggleOn = (s: Shape) => targetIds.has(s.layerId) && !hiddenLayerIds.has(s.layerId);
 const jiggleStrokes = useMemo(
  () => shapes.filter(jiggleOn).reduce((n, s) => n + Math.max(1, s.runs?.length ?? 1), 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shapes, targetIds, hiddenLayerIds],
 );
 const jiggleRun = (list: Shape[]) =>
  jiggled(list, jiggleOn, { distance: jiggle.mm / 25.4, angle: jiggle.angle, randomness: jiggle.randomness / 100, noise: jiggle.noiseMm / 25.4, seed: jiggle.seed });
 const jigglePreview = useMemo(() => {
  if (!jiggleCard || !jiggleStrokes) return null;
  const moved = jiggleRun(shapes);
  if (!jiggle.copy) return moved;
  // The copy beside the layer, on it for now, as it will be on its own layer above it.
  return [...shapes, ...moved.filter(jiggleOn).map((s) => ({ ...s, id: `jiggle-${s.id}`, group: s.group && `jiggle-${s.group}` }))];
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [jiggleCard, jiggleStrokes, shapes, jiggle, targetIds, hiddenLayerIds]);
 const jiggleShowing = Boolean(jigglePreview);
 // The page takes no edits while it shows either: what was dragged would be kept as it's shown.
 const previewing = simplifierShowing || jiggleShowing;
 const applyJiggle = () => {
  if (!jigglePreview) return;
  if (jiggle.copy) {
   duplicateLayers(targetLayers.filter((l) => !l.hidden).map((l) => l.id), jiggleRun);
  } else {
   record();
   setShapes(jiggleRun(shapes));
  }
  setJiggle((j) => ({ ...j, seed: newJiggleSeed() })); // the next go is a fresh draw
 };

 // What the page draws: the drawing, or the Simplifier's or Jiggle's version of it, less the paths hidden by eye.
 const canvasShapes = useMemo(() => {
  const list = simplifierShowing ? simplifierPreview!.shapes : jiggleShowing ? jigglePreview! : shapes;
  return hiddenShapes.size ? list.filter((sh) => !hiddenShapes.has(sh.id)) : list;
 }, [simplifierShowing, simplifierPreview, jiggleShowing, jigglePreview, shapes, hiddenShapes]);

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
 const duplicateLayer = (id: string) => duplicateLayers([id]);
 // The same for several at once, each copy above its own layer; `change` works on the shapes as they
 // are copied - Jiggle's way of making its copy.
 const duplicateLayers = (layerIds: string[], change: (list: Shape[]) => Shape[] = (list) => list) => {
  const originals = layers.filter((l) => layerIds.includes(l.id));
  if (!originals.length) return;
  record();
  const names = layers.map((l) => l.name);
  const copies = new Map(originals.map((layer) => {
   const name = uniqueName(layer.name, names);
   names.push(name);
   return [layer.id, { ...layer, id: newLayerId(), name } as Layer];
  }));
  const ids = new Map(shapes.filter((sh) => copies.has(sh.layerId)).map((sh) => [sh.id, newShapeId()]));
  // The copy's shapes are shapes of their own, not more paths of the ones they were copied from.
  const groupIds = new Map(shapes.filter((sh) => copies.has(sh.layerId) && sh.group).map((sh) => [sh.group!, newGroupId()]));
  setLayers((list) => list.flatMap((l) => (copies.has(l.id) ? [l, copies.get(l.id)!] : [l])));
  setShapes((list) => [
   ...list,
   ...change(list.filter((sh) => ids.has(sh.id))).map((sh) => ({ ...sh, id: ids.get(sh.id)!, layerId: copies.get(sh.layerId)!.id, group: sh.group && groupIds.get(sh.group) })),
  ]);
  setFills((list) => [
   ...list,
   ...list.filter((f) => ids.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: ids.get(f.shapeId)! })),
   ...list.filter((f) => groupIds.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: groupIds.get(f.shapeId)! })),
  ]);
  const activeCopy = copies.get(activeLayer) ?? [...copies.values()][0];
  setActiveLayer(activeCopy.id);
 };

 // The Varnish layer: clear glitter gel (Gelly Roll Stardust) over the finished drawing, so what's
 // under it sparkles. Not a pen - it goes over whatever pen the drawing is made with - but a layer of
 // the drawing, always on top and so plotted last. Filled three ways: the whole drawing (its
 // silhouette, hatched), over chosen lines (the same lines again), or inside a shape moved onto it
 // and hatched. How sparkly is the hatching's spacing and passes, or how many times lines are gone over.
 const varnishLayer = layers.find((l) => isVarnishLayer(l.name));
 // Kept on top: it goes over everything, so it's plotted after everything.
 useEffect(() => {
  const at = layers.findIndex((l) => isVarnishLayer(l.name));
  if (at >= 0 && at !== layers.length - 1) setLayers((list) => [...list.filter((l) => !isVarnishLayer(l.name)), list[at]]);
 }, [layers]);
 /** The Varnish layer, made if there isn't one. Call inside a change that has already been recorded. */
 const ensureVarnish = (): Layer => {
  if (varnishLayer) return varnishLayer;
  const made: Layer = { id: newLayerId(), name: VARNISH, color: VARNISH_COLOR };
  setLayers((list) => [...list, made]);
  return made;
 };
 // A varnish hatch's spacing to start from: lines a little apart, a light even sparkle, from the
 // gel's 0.5 mm line. Tighter, or a cross-hatch, for more.
 const VARNISH_SPACING_MM = 1;

 // Over chosen lines: the exact lines of these shapes again, and their hatching, on the Varnish layer.
 // Gone over again, they're another pass, and sparkle more.
 const varnishOver = (ids: string[]) => {
  const picked = shapes.filter((sh) => ids.includes(sh.id) && !isVarnishLayer(layers.find((l) => l.id === sh.layerId)?.name ?? ""));
  if (!picked.length) return;
  record();
  const target = ensureVarnish();
  const shapeIds = new Map(picked.map((sh) => [sh.id, newShapeId()]));
  const groupIds = new Map(picked.filter((sh) => sh.group).map((sh) => [sh.group!, newGroupId()]));
  setShapes((list) => [...list, ...picked.map((sh) => ({ ...sh, id: shapeIds.get(sh.id)!, layerId: target.id, group: sh.group && groupIds.get(sh.group) }))]);
  setFills((list) => [
   ...list,
   ...list.filter((f) => shapeIds.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: shapeIds.get(f.shapeId)! })),
   ...list.filter((f) => groupIds.has(f.shapeId)).map((f) => ({ ...f, id: newFillId(), shapeId: groupIds.get(f.shapeId)! })),
  ]);
  setMessage({ text: `${picked.length} ${picked.length === 1 ? "path" : "paths"} gone over on the ${VARNISH} layer: plotted last, over the ink`, ok: true });
 };

 // A silhouette - the outline round what's drawn, holes and paper inside filled in - as one mask
 // path on the Varnish layer, hatched with no outline: of the whole drawing (everything on the other
 // layers that shows), or of one layer's shapes alone. A start to tweak, not a final answer: the mask
 // is a path like any other, its points dragged on the page.
 const varnishWhole = () => varnishSilhouette(shapes.filter((sh) => {
  const layer = layers.find((l) => l.id === sh.layerId);
  return layer && !layer.hidden && !isVarnishLayer(layer.name);
 }), "Silhouette", "The drawing's silhouette");
 const varnishLayerSilhouette = (id: string) => {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  varnishSilhouette(shapes.filter((sh) => sh.layerId === id), joinLayerName("Silhouette", layer.name), `${layer.name}'s silhouette`);
 };
 const varnishSilhouette = (drawn: Shape[], name: string, what: string) => {
  const runs = silhouetteOf(drawn, { penMm: penWidthOf(tool2) });
  if (!runs.length) {
   setMessage({ text: "There's nothing drawn there yet to varnish", ok: false });
   return;
  }
  record();
  const target = ensureVarnish();
  const b = pointsBox(runs.flat());
  const mask: Shape = {
   id: newShapeId(), layerId: target.id, kind: "path", runs, x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
   name, outline: false,
  };
  setShapes((list) => [...list, mask]);
  setFills((list) => [...list, { id: newFillId(), shapeId: mask.id, angle: 45, spacingMm: VARNISH_SPACING_MM, scale: 100, custom: true }]);
  setActiveLayer(target.id);
  setSelected([mask.id]);
  setMessage({ text: `${what}, hatched on the ${VARNISH} layer${runs.length > 1 ? ` (${runs.length} parts)` : ""}: set Spacing or Cross-hatch for more sparkle`, ok: true });
 };

 // Picking areas: one layer's solid patches - a stripe filled in with packed hatching - clicked one
 // at a time, each a hatched mask on the Varnish layer, while the looser hatching of the same pen
 // round them is left alone. On until Escape, or until it's chosen again from the menu.
 const [picking, setPicking] = useState<string | null>(null);
 const pickingLayer = picking ? layers.find((l) => l.id === picking) : undefined;
 // The layer's ink read once for clicking in, and read again only when its shapes change.
 const pickerFor = useRef<{ shapes: Shape[]; picker: ReturnType<typeof areaPicker> } | null>(null);
 // The masks this round of picking has made: kept selected, so the card under Layers is their fill
 // and one Spacing sets all of them.
 const pickedMasks = useRef<string[]>([]);
 const sameList = (a: Shape[], b: Shape[]) => a.length === b.length && a.every((x, i) => x === b[i]);
 const startPicking = (id: string) => {
  if (picking === id) {
   setPicking(null);
   setMessage({ text: "Done picking areas", ok: true });
   return;
  }
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  pickerFor.current = null;
  pickedMasks.current = [];
  setPicking(id);
  setSelected([]);
  setMessage({ text: `Click inside a solid area of ${layer.name} to varnish it. Escape when done`, ok: true });
 };
 const pickArea = (p: { x: number; y: number }) => {
  if (!pickingLayer) return;
  const own = shapes.filter((sh) => sh.layerId === pickingLayer.id);
  const cached = pickerFor.current;
  const picker = cached && sameList(cached.shapes, own) ? cached.picker : areaPicker(own);
  pickerFor.current = { shapes: own, picker };
  const runs = picker?.at(p) ?? [];
  if (!runs.length) {
   setMessage({ text: `No solid ${pickingLayer.name} there: click inside a filled-in area. Escape when done`, ok: false });
   return;
  }
  record();
  const target = ensureVarnish();
  const name = joinLayerName("Area", pickingLayer.name);
  // A part each: every one its own path, with a grip on every point.
  const masks: Shape[] = runs.map((run) => {
   const b = pointsBox(run);
   return { id: newShapeId(), layerId: target.id, kind: "path", runs: [run], x: b.x0, y: b.y0, x2: b.x1, y2: b.y1, name, outline: false };
  });
  setShapes((list) => [...list, ...masks]);
  setFills((list) => [...list, ...masks.map((m) => ({ id: newFillId(), shapeId: m.id, angle: 45, spacingMm: VARNISH_SPACING_MM, scale: 100, custom: true }))]);
  // Any undone since are left out.
  pickedMasks.current = [...pickedMasks.current.filter((mid) => shapes.some((sh) => sh.id === mid)), ...masks.map((m) => m.id)];
  setSelected(pickedMasks.current);
  const n = pickedMasks.current.length;
  setMessage({ text: `${n} ${n === 1 ? "area" : "areas"} of ${pickingLayer.name} hatched on the ${VARNISH} layer, selected: set their Spacing below. Click for more, Escape when done`, ok: true });
 };
 // Escape puts it down; so does the layer going.
 useEffect(() => {
  if (!picking) return;
  if (!pickingLayer) {
   setPicking(null);
   return;
  }
  const onKey = (e: KeyboardEvent) => {
   if (e.key !== "Escape") return;
   setPicking(null);
   setMessage({ text: "Done picking areas", ok: true });
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, [picking, pickingLayer]);

 // Merge visible: the shapes on every shown layer, and the fills on them, move onto the topmost shown
 // layer and take on its name, colour and place in the stack; the other shown layers go. Hidden
 // layers are left as they are.
 const visibleLayers = layers.filter((l) => !l.hidden);
 const mergeVisible = () => {
  if (visibleLayers.length < 2) return;
  const top = visibleLayers[visibleLayers.length - 1];
  const merged = new Set(visibleLayers.slice(0, -1).map((l) => l.id));
  record();
  setShapes((list) => list.map((sh) => (merged.has(sh.layerId) ? { ...sh, layerId: top.id } : sh)));
  setLayers((list) => list.filter((l) => !merged.has(l.id)));
  setActiveLayer((current) => (merged.has(current) ? top.id : current));
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
  if (first?.layerId && !targetIds.has(first.layerId)) setActiveLayer(first.layerId);
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

 // Asked in the library's Modal, over everything: Setup starts new drawings too.
 const confirmModal = (
  <UnsavedChangesModal
   open={Boolean(confirmNext)}
   name={saved ? name : null}
   onSave={async () => {
    if (!confirmNext || !(await save())) return false;
    setConfirmNext(null);
    confirmNext.go();
    return true;
   }}
   onDiscard={() => {
    if (!confirmNext) return;
    setConfirmNext(null);
    confirmNext.go();
   }}
   onCancel={() => setConfirmNext(null)}
  />
 );

 // The Paper card, in the drawing's rail and image conversion's.
 const paperSection = (
  <PaperSection
   w={page.w * 25.4}
   h={page.h * 25.4}
   sizeId={sizeId}
   units={units}
   onUnits={setUnits}
   color={paperColor}
   collapsibleKey="paper"
   onSize={setSize}
   onDimensions={(w, h) => {
    record();
    setPage({ w: w / 25.4, h: h / 25.4 });
   }}
   onColor={pickPaperColor}
   // The paper turns with the drawing: landscape to portrait with everything on it, as a sheet is turned.
   onTurnDrawing={(dir) => void turnAll(dir)}
   onFit={shapes.length ? fitDrawing : undefined}
  />
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

 /**
  * The Simplifier's way on from a drawing of image layers: a snapshot with them baked into paths,
  * opened to simplify in this drawing's place. This drawing stays on disk as it was saved; changes
  * to it not saved yet are asked about first, as for opening anything else.
  */
 const bakeAndEdit = async () => {
  const res = await takeSnapshot();
  if (!res || !(await open(res.path))) return;
  setMessage({ text: `Working on the snapshot ${res.name.replace(/\.svg$/i, "")}, ready to simplify`, ok: true });
 };
 const workOnSnapshot = () => ask("bake and edit", () => void bakeAndEdit());

 // An image layer is drawn, moved and sized here like anything else, but its lines are worked out from
 // its picture each time, so they can't be edited one by one. Baked - a snapshot with the images made
 // into paths, opened here - they can: the same way on as the Simplifier's.
 const photoCard = chosen?.kind === "photo" && chosen.photo ? (
  <Card variant="flat" className={styles.controls}>
   <div className={`${styles.cardBody} ${controls.cardSections}`}>
    <Section title="Image" icon={panelIcon("image")}>
     <div className={styles.confirm}>
      <p>This is an image, drawn as lines worked out from its picture, so they can’t be edited one by one. Bake it to work on them: a snapshot of the drawing with its images made into paths, opened here. This drawing stays as it is.</p>
      <Button size="sm" disabled={busy} title="Save a snapshot of this drawing with its images baked into paths, and open it to edit" onClick={workOnSnapshot}>
       Bake and edit
      </Button>
     </div>
    </Section>
   </div>
  </Card> ) : null;

 // A snapshot just saved: said at the top, with the ways on from it, until something else is said.
 // Either puts it in this drawing's place, so unsaved work here is asked about first.
 const [snapped, setSnapped] = useState<{ name: string; path: string } | null>(null);
 useEffect(() => setSnapped(null), [message]);
 // Plot drawing this, or waiting to resume it: looked at, not changed (useEditLock).
 const mainRef = useRef<HTMLElement>(null);
 useEditLock(lock, mainRef);
 const banner = useMemo(
  () => (lock && !(message.text && !message.ok)
   ? lockBanner(lock, () => void goTo("plot"))
   : message.text && (!message.ok || message.progress)
   ? { text: message.text, error: !message.ok, working: message.progress }
   : snapped
    ? {
     text: `Snapshot saved: ${snapped.name}`,
     brand: true,
     id: snapped.path,
     actions: [
      { label: "Open here", onClick: () => ask("open the snapshot", () => void open(snapped.path)) },
      { label: "Open in Plot", onClick: () => ask("open the snapshot", () => void openIn("plot", snapped.path)) },
     ],
    }
    : null),
  [message, snapped, lock], // eslint-disable-line react-hooks/exhaustive-deps
 );

 return (
  <div className={styles.app}>
   {/* Problems, and what's under way, across the top of the page - never on the preview's rulers. */}
   <StatusBanner message={banner} />
   <Hints />
   {confirmModal}
   <FileBrowser
    open={browserOpen}
    endpoint="/api/studio/read"
    onClose={() => setBrowserOpen(false)}
    // Read to pick it, then - once any unsaved work here is dealt with - made the current drawing.
    onOpened={(res) => ask("open another", () => void open(res.path))}
    combine={{
     endpoint: "/api/studio/combine",
     canAdd: shapes.length > 0,
     // This drawing as it would be saved, for the files to go on top of.
     base: () => buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, paperColor, fonts }),
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
       { label: "Varnish over", icon: <Sparkles />, onSelect: () => varnishOver(membersOf(rowMenu.id).map((m) => m.id)) },
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
        disabled: !shapes.some((s) => s.layerId === rowMenu.id) || layers.find((l) => l.id === rowMenu.id)?.locked,
        // Picked as one, they move as one: the way a whole layer is shifted about the page. The layer
        // becomes the target too, as only the target layer's shapes are picked on the page.
        onSelect: () => {
         setActiveLayer(rowMenu.id);
         setSelected(shapes.filter((s) => s.layerId === rowMenu.id).map((s) => s.id));
        },
       },
       // Locked, nothing on it can be picked or moved on the page; its pen can still be changed.
       layers.find((l) => l.id === rowMenu.id)?.locked
        ? { label: "Unlock layer", icon: <LockOpen />, onSelect: () => patchLayer(rowMenu.id, { locked: false }) }
        : { label: "Lock layer", icon: <Lock />, onSelect: () => patchLayer(rowMenu.id, { locked: true }) },
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
       ...(isVarnishLayer(layers.find((l) => l.id === rowMenu.id)?.name ?? "") ? [] : [{
        label: "Varnish over",
        icon: <Sparkles />,
        onSelect: () => varnishOver(shapes.filter((sh) => sh.layerId === rowMenu.id).map((sh) => sh.id)),
       }, {
        // This layer's silhouette, hatched: the area it draws sparkles, not just its lines.
        label: "Varnish silhouette",
        icon: <Sparkles />,
        onSelect: () => varnishLayerSilhouette(rowMenu.id),
       }, {
        // Its solid patches only, one click each: a bandana's stripes and not the same pen's
        // shading round them.
        label: picking === rowMenu.id ? "Stop picking areas" : "Varnish areas…",
        icon: <Sparkles />,
        onSelect: () => startPicking(rowMenu.id),
       }]),
       {
        label: "Merge visible",
        icon: <LayersArrowDown />,
        disabled: visibleLayers.length < 2,
        onSelect: mergeVisible,
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
       { label: "Varnish over", icon: <Sparkles />, onSelect: () => varnishOver([rowMenu.id]) },
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

   <main ref={mainRef} className={styles.layout}>
    <div className={styles.tools}>
     <AppSwitch current="studio" orientation="vertical" onRefused={(why) => setMessage({ text: why, ok: false })} />
     <ToolbarSeparator className={styles.toolsSeparator} />
     <PanelToolbar
      cards={[
       { key: "file", on: fileCard, toggle: () => setFileCard((on) => !on) },
       { key: "paper", on: paperCard, toggle: () => setPaperCard((on) => !on) },
       { key: "pen", on: penCard, toggle: () => setPenCard((on) => !on) },
       { key: "grid", on: gridCard, toggle: () => setGridCard((on) => !on) },
       { key: "trim", on: trimCard, toggle: () => setTrimCard((on) => !on) },
      ]}
     />
     <ToolPicker
      tool={tool}
      onTool={(t) => {
       setTool(t);
       setSimplifierCard(false);
       setJiggleCard(false);
      }}
      layersOut={layersCard}
      onLayers={() => setLayersCard((on) => !on)}
      simplifying={simplifierCard}
      jiggling={jiggleCard}
      onSignature={(turned) => void addSignature(turned)}
      onRegistration={(turned) => void addRegistration(turned)}
      // Picked, the page picks shapes as Select does; picked again, it's put down for Select.
      onSimplify={() => {
       setTool("select");
       setJiggleCard(false);
       setSimplifierCard((on) => !on);
      }}
      onJiggle={() => {
       setTool("select");
       setSimplifierCard(false);
       setJiggleCard((on) => !on);
      }}
     />
     <HistoryToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} disabled={busy} />
    </div>
    <section className={styles.stage} aria-label="Drawing page" data-dragging-file={draggingFile || undefined}>
     <Canvas
      page={page}
      paperColor={paperColor}
      shapes={canvasShapes}
      fills={fills}
      model={model}
      // One bar over the page for everything true of what is being looked at: what has just
      // been done, how the drawing is drawn, and how close the view sits - the shared canvas's.
      bar={{
        view,
        onView: setView,
        zoom,
        onZoom: setZoom,
        canDrawing: shapes.length > 0,
        canPhoto: shapes.some((sh) => sh.kind === "photo"),
        loupe,
        onLoupe: setLoupe,
      }}
      layers={layers}
      activeLayer={drawOn?.id ?? ""}
      targetLayers={targetIds}
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
      onUpdateMany={previewing ? keepAsIs : updateShapes}
      onAdd={previewing ? keepAsIs : (shape) => (shape.curve?.kind === "trim" ? addTrimMarks(shape) : addShape(shape))}
      onUpdate={previewing ? keepAsIs : updateShape}
      onEditStart={previewing ? keepAsIs : record}
      onPick={pickingLayer ? pickArea : undefined}
      strokePick={strokePick}
      onStrokePick={previewing ? () => {} : setStrokePick}
     />
    </section>

    <div className={styles.side}>
     <>
     {fileCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <FileSection
        collapsibleKey="studio-file"
        name={name}
        onName={setName}
        saved={saved}
        dirty={dirty}
        hasShapes={shapes.length > 0}
        busy={busy}
        onSave={save}
        onOpen={() => setBrowserOpen(true)}
        onNew={() => ask("start new", () => newDrawing())}
       />

      </div>
     </Card>
     )}

     {/* What the drawing is made on and with, and the grid, which is Studio's alone: a card each,
       shown or hidden from the toolbar, the same Paper and Pen cards as Photo's and Plot's. */}
     {paperCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>{paperSection}</div>
     </Card>
     )}
     {penCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <DrawingToolSection tools={presets} value={toolName} onPick={pickTool} collapsibleKey="pen" disabled={busy} />
      </div>
     </Card>
     )}
     {gridCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <GridSection snapping={snapping} onSnapping={setSnapping} step={snapStep} onStep={setSnapStep} />
      </div>
     </Card>
     )}
     {/* Trim marks: a live layer, set from this card - the same edits Image and Plot make. */}
     {trimCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <TrimMarksSection
        collapsibleKey="studio-trim"
        trim={trimShapeOf(shapes)}
        drawing={drawingBoxOf(shapes)}
        page={page}
        units={units}
        busy={busy}
        onOn={(on) => editTrim((d) => (on ? withTrimOn(d, palette, paperMarginMm() / 25.4) : withTrimOff(d)))}
        setBox={(box) => editTrim((d) => withTrimBox(d, box))}
        setMarks={(curve) => editTrim((d) => withTrimMarks(d, curve))}
        moveDrawing={(dx, dy) => editTrim((d) => withDrawingMoved(d, dx, dy))}
       />
      </div>
     </Card>
     )}

     {/* The Layers card, shown or hidden from its switch at the left. */}
     {layersCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <LayersSection
        icon={<Layers />}
        layers={layers}
        active={active}
        targets={targetIds}
        tool={tool2}
        busy={busy}
        colorMenuId={colorMenu?.id}
        rowMenuId={rowMenu?.id}
        renaming={renamingLayer}
        onSort={sortLayersByLightness}
        onAdd={addLayer}
        onVarnish={varnishWhole}
        onSwitch={switchLayer}
        onVisible={(id, visible) => patchLayer(id, { hidden: !visible })}
        onUnlock={(id) => patchLayer(id, { locked: false })}
        onColorMenu={(id, anchor) => setColorMenu((open) => (open?.id === id ? null : { id, anchor }))}
        onRowMenu={(id, anchor) => setRowMenu((open) => (open?.id === id ? null : { kind: "layer", id, anchor }))}
        onRenameType={typeLayerName}
        onRenameCancel={restoreLayerName}
        renamePen={penBeforeEdit.current}
        onRenameDone={(id) => {
         settleLayerName(id);
         setRenamingLayer(null);
        }}
        movableTo={(id) => (selected.length ? shapes.filter((s) => pickedIds.has(s.id) && s.layerId !== id).length : 0)}
        onMoveHere={moveSelectedToLayer}
        onRestackStart={record}
        onRestack={(id, to) => setLayers((list) => {
         const from = list.findIndex((l) => l.id === id);
         if (from < 0 || from === to) return list;
         const next = [...list];
         next.splice(to, 0, next.splice(from, 1)[0]);
         return next;
        })}
       />
      </div>
     </Card>
     )}
     {/* The layer being drawn on, a card of its own under the layers: turned, and its paths. Out and
       away with the Layers card, from its switch. */}
     {layersCard && targetLayers.length > 0 && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <ShapeList
         layers={targetLayers}
         shapes={onActive}
         picked={pickedIds}
         busy={busy}
         renaming={renaming}
         rowMenuId={rowMenu?.id}
         onPick={pickFromRow}
         // The Varnish layer is only ever filled: no turning it.
         onTurn={targetLayers.every((l) => isVarnishLayer(l.name)) ? undefined : turnLayer}
         hidden={hiddenShapes}
         onVisible={showShapes}
         onSelectAll={() => setSelected(onActive.map((sh) => sh.id))}
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
      </div>
     </Card>
     )}
     {/* Under the Layers card when both are out, as its switch is under Layers'. */}
     {simplifierCard && simplifierPreview && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <SimplifierSection
        value={simplifier}
        onChange={setSimplifier}
        scope={simplifyScope}
        onScope={setSimplifyScope}
        layerName={targetLayers.length > 1 ? "the targeted layers" : active?.name ?? "this layer"}
        before={simplifierPreview.before}
        after={simplifierPreview.after}
        removed={simplifierPreview.gone.length}
        busy={busy}
        onApply={applySimplifier}
        images={shapes.filter((sh) => sh.kind === "photo").length}
        hasPaths={pointCount(shapes) > 0}
        onSnapshot={shapes.some((sh) => sh.kind === "photo") ? workOnSnapshot : undefined}
       />
      </div>
     </Card>
     )}

     {jiggleCard && (
     <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
       <JiggleSection
        value={jiggle}
        onChange={setJiggle}
        layerName={targetLayers.length > 1 ? "the targeted layers" : active?.name ?? "this layer"}
        strokes={jiggleStrokes}
        busy={busy}
        onApply={applyJiggle}
       />
      </div>
     </Card>
     )}

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
       icon={shapeIcon(chosen)}
       title={shapeName(chosen, onActive.indexOf(chosen))}
       busy={busy}
       hasFill={fills.some((f) => f.shapeId === chosen.id)}
       canPaste={Boolean(fillClipboard)}
       panel={panel}
       onPanel={showPanel}
       fillPanel={fillPanel}
       varnish={isVarnishLayer(layers.find((l) => l.id === chosen.layerId)?.name ?? "")}
       simplifyMm={simplifyMm}
       onSimplifyMm={setSimplifyMm}
       simplifyRefit={simplifyRefit}
       onSimplifyRefit={setSimplifyRefit}
       actions={{
        flatten: flattenShape,
        setCurve,
        split: splitShape,
        simplify: simplifyShape,
        copyFill: () => setFillClipboard(fills.filter((f) => f.shapeId === chosen.id)),
        pasteFill,
        setRotation,
        setScale,
        setRepeat,
        addPoint: () => {
         record();
         setShapes((list) => list.map((sh) => (sh.id === chosen.id ? addPointOnLongest(sh) : sh)));
        },
        bake: bakeRepeat,
        spread: spreadRepeat,
       }}
      />
     )}
     </>

    </div>
   </main>
  </div>
 );
}
