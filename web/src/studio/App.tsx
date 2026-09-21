import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonRound, Card, Checkbox, InputSelect, InputText, InputTextarea, LayerController } from "@tomcoggia/ui";
import { AlignJustify, ArrowDownToLine, AudioWaveform, Circle, CircleDashed, CircleDot, Copy, Ellipsis, EllipsisVertical, FilePlus, FolderOpen, Grid2x2, Layers2, LoaderPinwheel, Menu, Minus, MousePointer2, Orbit, Pentagon, Plus, Radar, Rainbow, Ratio, Redo2, Spline, Square, SquareDimensions, Star, Trash2, Type, Undo2, Waves } from "lucide-react";
import { FileBrowser, LAST_FOLDER_KEY, type OpenResult } from "../components/FileBrowser";
import { Section } from "../components/controls/Section";
import { NumberField } from "../components/controls/NumberField";
import controls from "../components/controls/controls.module.css";
import { api, postJSON } from "../lib/api";
import { load, save as remember } from "../lib/storage";
import { DEFAULT_SETTINGS, PAPER_SIZES, PLOT_CHANNEL, STORAGE } from "../lib/constants";
import type { Info, PenColor, PlotterModel, Preset } from "../lib/types";
import { trimNum } from "../lib/format";
import { ZoomControl } from "../components/ZoomControl";
import { InkSimControl } from "../components/InkSimControl";
import type { Zoom } from "../components/BedCanvas";
import { useRowDrag } from "../lib/useRowDrag";
import { Canvas, type Tool } from "./components/Canvas";
import { SizePopover } from "./components/SizePopover";
import { StudioHeader } from "./components/StudioHeader";
import { canConnect, canFill, fillNumbers, newFillId, FILL_LABEL, type Fill, type FillKind } from "./lib/hatch";
import { closingTurns, curveStrokes, CURVE_FIELDS, type Curve, type Point } from "./lib/parametric";
import { fontNames, loadFont, type StrokeFont } from "./lib/font";
import { flattenPath, simplifyRun } from "./lib/path";
import { fitText, textRuns } from "./lib/text";
import { defaultRepeat, placements, REPEAT_FIELDS, type Repeat, type RepeatKind } from "./lib/repeat";
import { parseDrawing } from "./lib/parse";
import { PaletteMenu } from "../components/controls/PaletteMenu";
import { RowMenu } from "../components/controls/RowMenu";
import { boxOf, centerOf, clampToPage, moveBy, newLayerId, newShapeId, outlinePoints, pathRuns, pointsBox, resizeTo, shapeName, turnPoint, POINT_HANDLE_LIMIT, type Layer, type Page, type Shape } from "./lib/shapes";
import { buildSvg, cleanFileName } from "./lib/svg";
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
  { kind: "select", label: "Select", hint: "Select: drag a shape to move it, its corners to resize", icon: <MousePointer2 /> },
  { kind: "rect", label: "Rectangle", hint: "Draw a rectangle: drag on the page", icon: <Square /> },
  { kind: "ellipse", label: "Ellipse", hint: "Draw an ellipse: drag on the page", icon: <Circle /> },
  { kind: "line", label: "Line", hint: "Draw a line: drag on the page", icon: <Minus /> },
  // Parametric shapes: drawn as a box like the rest, then tuned by their numbers in the Curve card.
  { kind: "hypotrochoid", label: "Spirograph", hint: "Draw a spirograph: drag on the page, then set its circles", icon: <LoaderPinwheel /> },
  { kind: "parabolic", label: "Parabolic curve", hint: "Draw curve stitching: drag on the page, then set its strings", icon: <Spline /> },
  { kind: "polygon", label: "Polygon", hint: "Draw a polygon: drag on the page, then set how many sides", icon: <Pentagon /> },
  { kind: "star", label: "Star", hint: "Draw a star: drag on the page, then set its points", icon: <Star /> },
  { kind: "spiral", label: "Spiral", hint: "Draw a spiral: drag on the page, then set its turns", icon: <Radar /> },
  { kind: "arc", label: "Arc", hint: "Draw an arc: drag on the page, then set where it starts and how far it goes", icon: <Rainbow /> },
  { kind: "wave", label: "Wave", hint: "Draw a wave: drag on the page, then set how many", icon: <Waves /> },
  { kind: "text", label: "Text", hint: "Set some words: drag to say how tall, then type them", icon: <Type /> },
];

// Used when a tool has no palette of its own, so there is always a pen to draw with.
const PLAIN_PEN: PenColor = { name: "Black", color: "#262626" };
const TOOL_KEY = "studio-tool";
const FONT_KEY = "studio-font";
const SNAP_KEY = "studio-snap";
const SIMPLIFY_KEY = "studio-simplify";

// What each kind of fill is, at a glance, and what it costs the pen.
const FILL_ICON: Record<FillKind, JSX.Element> = {
  hatch: <Menu />,
  concentric: <CircleDashed />,
  wavy: <AudioWaveform />,
  dashes: <AlignJustify />,
};

const FILL_HINT: Record<FillKind, string> = {
  hatch: "Straight lines, the spacing apart",
  concentric: "The shape's own outline stepped inward",
  wavy: "The same lines drawn as waves",
  dashes: "The same lines broken into strokes: lighter, and a pen lift each",
};

// How a shape repeats, as the row of round buttons in the Repeat card: one of them is always on.
const REPEATS: { kind: RepeatKind | null; label: string; hint: string; icon: JSX.Element }[] = [
  { kind: null, label: "Just the one", hint: "Draw this shape once", icon: <CircleDot /> },
  { kind: "line", label: "Row", hint: "Repeat it in a row, in whatever direction you point it", icon: <Ellipsis /> },
  { kind: "grid", label: "Grid", hint: "Repeat it in rows and columns", icon: <Grid2x2 /> },
  { kind: "ring", label: "Ring", hint: "Repeat it round a circle, with this shape at the top", icon: <Orbit /> },
];

// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
const LAST_FILE_KEY = "studio-last-file";

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
  const [message, setMessage] = useState<{ text: string; ok: boolean }>({
    text: "Nothing saved yet",
    ok: false,
  });
  const dirty = useRef(false);

  // Anything drawn since the last save has to be written again before Plot can print it.
  useEffect(() => {
    dirty.current = true;
  }, [shapes, fills, page, name]);

  const sizeId = useMemo(() => {
    const match = SIZES.find(
      (s) =>
        (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) ||
        (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01),
    );
    return match?.id ?? "";
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
      setSelected((ids) => ids.filter((id) => next.shapes.some((s) => s.id === id)));
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
    setShapes((list) => list.map((s) => (s.id === next.id ? next : s)));
  }, []);

  /** Several shapes changed at once, as a drag of a whole selection does. */
  const updateShapes = useCallback((changed: Shape[]) => {
    const byId = new Map(changed.map((s) => [s.id, s]));
    setShapes((list) => list.map((s) => byId.get(s.id) ?? s));
  }, []);

  // A copy of a shape and its fill, on the same layer, nudged down and to the right so it can be
  // seen - and chosen, ready to be dragged where it's wanted.
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
      const moving = list.filter((s) => selected.includes(s.id));
      if (!moving.length) return list;
      const boxes = moving.map(boxOf);
      const x0 = Math.min(...boxes.map((b) => b.x0));
      const y0 = Math.min(...boxes.map((b) => b.y0));
      const x1 = Math.max(...boxes.map((b) => b.x1));
      const y1 = Math.max(...boxes.map((b) => b.y1));
      const byX = Math.max(-x0, Math.min(page.w - x1, dx));
      const byY = Math.max(-y0, Math.min(page.h - y1, dy));
      if (!byX && !byY) return list;
      const byId = new Map(moving.map((s) => [s.id, moveBy(s, byX, byY, page)]));
      return list.map((s) => byId.get(s.id) ?? s);
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
        ...(saved ? { folder: saved.path.slice(0, saved.path.lastIndexOf("/")) } : {}),
      });
      const where = { path: res.path, folder: res.folder };
      setName(res.name.replace(/\.svg$/i, ""));
      setSaved(where);
      // What's on disk now is exactly what Studio holds, whatever the file used to contain.
      setForeign(0);
      setOpenedAs(res.name);
      remember(LAST_FILE_KEY, res.path);
      remember(LAST_FOLDER_KEY, res.path.slice(0, res.path.lastIndexOf("/")));
      dirty.current = false;
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
    const where = dirty.current || !saved ? await save() : saved;
    if (!where) return;
    setBusy(true);
    try {
      await postJSON("/api/open", { path: where.path });
      if (await plotPageAnswers()) {
        setMessage({ text: "Opened in Plot, in its own tab", ok: true });
        setBusy(false);
        return;
      }
      if (!window.open("/", PLOT_CHANNEL)) window.location.href = "/";
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
    setShapes([]);
    setFills([]);
    const first = { id: newLayerId(), name: "Black", color: "#262626" };
    setLayers([first]);
    setActiveLayer(first.id);
    setSelected([]);
    setPast([]);
    setFuture([]);
    setName("Untitled");
    setSaved(null);
    setForeign(0);
    setOpenedAs(null);
    setConfirmNew(false);
    remember(LAST_FILE_KEY, null); // don't reopen the old drawing next time Studio starts
    setMessage({ text: "New drawing", ok: true });
    window.setTimeout(() => {
      dirty.current = false; // an empty page is not unsaved work
    }, 0);
  }, []);

  // Undo can't bring back which file was open - a snapshot is the drawing, not the drawing's name -
  // so unsaved work gets a question rather than a silent discard.
  const startNew = () => (dirty.current && shapes.length ? setConfirmNew(true) : newDrawing());

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
    window.setTimeout(() => {
      dirty.current = false;
    }, 0);
  }, []);

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
      const last = load<string>(LAST_FILE_KEY);
      if (!last || cancelled) return;
      try {
        const res = await api<OpenResult>(`/api/studio/read?path=${encodeURIComponent(last)}`);
        if (!cancelled) openDrawing(res, (n) => `Picked up ${res.name} - ${n} ${n === 1 ? "shape" : "shapes"}`);
      } catch {
        // Start clean but keep the pointer: the file may be fine and the server merely unreachable,
        // and throwing the only record of what was being worked on is the one unrecoverable move.
        // Opening or saving anything else replaces it anyway.
        if (!cancelled) setMessage({ text: `Couldn’t reopen the last drawing. Use Open… to pick it up.`, ok: false });
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

  // Shown or not, the drawing is the same; this is only how it's painted. Remembered per browser,
  // under Plot's key, so turning it on in one app turns it on in the other.
  const [inkSim, setInkSim] = useState(() => load<boolean>(STORAGE.inkSim) ?? false);
  useEffect(() => remember(STORAGE.inkSim, inkSim), [inkSim]);

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
   *  follows whatever that comes to. */
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
   * Bake a shape: give up the numbers behind it and keep what they drew. A curve becomes a path with
   * every point draggable, and a repeat becomes its copies, each its own shape. What was one thing
   * following its parameters becomes several things to edit by hand - which is the point, and why it
   * can't be undone except with undo.
   */
  const bakeShape = (id: string, keepPattern = false) => {
    const shape = shapes.find((s) => s.id === id);
    if (!shape) return;
    record();
    const centre = centerOf(shape);
    const made: Shape[] = [];
    // Keeping the pattern bakes the shape itself and leaves the repeat - and the turn - in place, so
    // the copies go on following it and the points that can now be dragged are the ones they follow.
    const places = keepPattern ? [{ dx: 0, dy: 0, deg: 0 }] : placements(shape);
    for (const place of places) {
      // The shape's own turn first, then the copy's: the same order the drawing is written in.
      const put = (p: Point) => {
        if (keepPattern) return p; // the turn stays a setting, so the points are left as they are
        const turned = turnPoint(turnPoint(p, centre, shape.rotation ?? 0), centre, place.deg);
        return { x: turned.x + place.dx, y: turned.y + place.dy };
      };
      if (shape.kind === "text") {
        // Every stroke of every letter becomes its own path: the words are given up, the marks stay.
        for (const glyph of textRuns(shape, fonts[shape.font ?? ""])) {
          for (const run of flattenPath(glyph.d)) {
            const points = run.map(put);
            if (points.length < 2) continue;
            const b = pointsBox(points);
            made.push({
              ...shape, id: made.length ? newShapeId() : shape.id,
              kind: "path", points, text: undefined, font: undefined, tracking: undefined,
              leading: undefined,
              repeat: keepPattern ? shape.repeat : undefined,
              rotation: keepPattern ? shape.rotation : undefined,
              x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
            });
          }
        }
      } else if (shape.curve) {
        for (const run of curveStrokes(shape)) {
          const points = run.map(put);
          if (points.length < 2) continue;
          const b = pointsBox(points);
          made.push({
            ...shape, id: made.length ? newShapeId() : shape.id,
            kind: "path", points, curve: undefined,
            repeat: keepPattern ? shape.repeat : undefined,
            rotation: keepPattern ? shape.rotation : undefined,
            x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
          });
        }
      } else {
        // A rectangle, an ellipse, a line or a path: flattened to its own points, so each one can be
        // pulled about point by point afterwards.
        const points = outlinePoints(shape).map(put);
        if (points.length < 2) continue;
        const b = pointsBox(points);
        made.push({
          ...shape, id: made.length ? newShapeId() : shape.id,
          kind: "path", points,
          repeat: keepPattern ? shape.repeat : undefined,
          rotation: keepPattern ? shape.rotation : undefined,
          x: b.x0, y: b.y0, x2: b.x1, y2: b.y1,
        });
      }
    }
    if (!made.length) return;
    setShapes((list) => list.flatMap((s) => (s.id === id ? made : [s])));
    // Each new shape gets the fills the original had, so the drawing looks the same afterwards.
    setFills((list) => list.flatMap((f) => (f.shapeId === id
      ? made.map((s) => ({ ...f, id: s.id === id ? f.id : newFillId(), shapeId: s.id }))
      : [f])));
    pick(made[0].id);
  };

  /** Every run of marks a shape makes, in inches on the page: its copies, its turn and all. */
  const runsOf = (shape: Shape): Point[][] => {
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
        : shape.kind === "path" ? pathRuns(shape)
        : [outlinePoints(shape)];
      for (const run of own) {
        if (run.length > 1) runs.push(run.map(put));
      }
    }
    return runs;
  };

  /**
   * Join what's picked into one shape: every mark of every one of them becomes a run of a single
   * path, which then moves, scales and turns as one thing. A fill on the first of them is kept, and
   * with several runs to count against, a ring inside a ring leaves a hole.
   */
  const joinShapes = () => {
    const picked = shapes.filter((s) => selected.includes(s.id));
    if (picked.length < 2) return;
    const runs = picked.flatMap(runsOf);
    if (!runs.length) return;
    record();
    const first = picked[0];
    const b = pointsBox(runs.flat());
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
    const simpler = runs.map((run) => simplifyRun(run, tolerance)).filter((run) => run.length > 1);
    if (!simpler.length || simpler.reduce((n, r) => n + r.length, 0) >= runs.reduce((n, r) => n + r.length, 0)) return;
    record();
    setShapes((list) => list.map((s) => (s.id === id
      ? { ...s, ...(s.runs ? { runs: simpler } : { points: simpler[0] }) }
      : s)));
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

  const setOutline = (on: boolean) => {
    if (!chosen) return;
    record();
    setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, outline: on } : sh)));
  };

  /** Hatch a shape, or stop hatching it. A shape that isn't hatched is drawn as its own outline:
   *  turning the hatch off puts that outline back, so nothing is left invisible. */
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
    const size = SIZES.find((s) => s.id === id);
    if (!size) return;
    record();
    // Keep the orientation the page is already in, so choosing a size doesn't also turn it.
    const landscape = page.w >= page.h;
    setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
  };

  return (
    <div className={styles.app}>
      <FileBrowser
        open={browserOpen}
        endpoint="/api/studio/read"
        onClose={() => setBrowserOpen(false)}
        onOpened={(res) => openDrawing(res, (n) => `Opened ${res.name} - ${n} ${n === 1 ? "shape" : "shapes"}`)}
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
                label: "Select everything on it",
                icon: <MousePointer2 />,
                disabled: !shapes.some((s) => s.layerId === rowMenu.id),
                // Picked as one, they move as one: the way a whole layer is shifted about the page.
                onSelect: () => setSelected(shapes.filter((s) => s.layerId === rowMenu.id).map((s) => s.id)),
              },
              { label: "Duplicate", icon: <Copy />, onSelect: () => duplicateLayer(rowMenu.id) },
              {
                label: "Merge with below",
                icon: <ArrowDownToLine />,
                disabled: layers.findIndex((l) => l.id === rowMenu.id) < 1,
                onSelect: () => mergeDown(rowMenu.id),
              },
              // There's always somewhere to draw, so the last layer stays.
              { label: "Delete", icon: <Trash2 />, danger: true, disabled: layers.length < 2, onSelect: () => removeLayer(rowMenu.id) },
            ]
            : [
              { label: "Duplicate", icon: <Copy />, onSelect: () => duplicateShape(rowMenu.id) },
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
            shapes={shapes}
            fills={fills}
            model={model}
            zoom={zoom}
            toolbarLeft={<InkSimControl on={inkSim} onChange={setInkSim} />}
            toolbar={
              <ZoomControl
                zoom={zoom}
                canPaper
                canDrawing={shapes.length > 0}
                onZoom={setZoom}
                updating={false}
                showLeft={null}
                onShowLeft={() => {}}
              />
            }
            layers={layers}
            activeLayer={active?.id ?? ""}
            penWidthMm={penWidthMm}
            inkOpacity={inkOpacity}
            inkBuilds={inkBuilds}
            inkBuild={inkBuild}
            inkSim={inkSim}
            tool={tool}
            fonts={fonts}
            font={font}
            snap={snapping ? snapStep : 0}
            selected={selected}
            onSelect={setSelected}
            onUpdateMany={updateShapes}
            onAdd={addShape}
            onUpdate={updateShape}
            onEditStart={record}
          />
        </section>

        <div className={styles.side}>
          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <Section
                title="Drawing"
                action={
                  <span className={styles.headerTools}>
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
                      icon={<FolderOpen />}
                      aria-label="Open a drawing"
                      title="Open a drawing to carry on with"
                      disabled={busy}
                      onClick={() => setBrowserOpen(true)}
                    />
                  </span>
                }
              >
                <InputText
                  size="md"
                  label="Name"
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className={styles.actions}>
                  <Button size="sm" variant="secondary" disabled={busy || !shapes.length} onClick={save}>
                    Save
                  </Button>
                  <Button size="sm" disabled={busy || !shapes.length} onClick={openInPlot}>
                    Open in Plot
                  </Button>
                </div>
                <p className={controls.fileWhere} title={saved?.path ?? undefined}>
                  {saved ? `In ${saved.folder}` : "Not saved yet"}
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
            </div>
          </Card>

          {/* What the drawing is made on and with: two settings under one lid, each of which
              folds on its own, as does the card around them. */}
          <Card variant="flat" className={styles.controls}>
            <div className={`${styles.cardBody} ${styles.settings}`}>
              <Section title="Settings" collapsibleKey="settings">
                <Section title="Paper" collapsibleKey="paper">
                  <div className={styles.pageRow}>
                    <InputSelect size="md" label="Page size" hideLabel value={sizeId} onChange={(e) => setSize(e.target.value)}>
                      {SIZES.map((size) => (
                        <option key={size.id} value={size.id}>
                          {size.name}
                        </option>
                      ))}
                    </InputSelect>
                    <ButtonRound
                      size="sm"
                      icon={<Ratio />}
                      aria-label="Turn the page"
                      title="Turn the page: swap its width and height"
                      onClick={() => {
                        record();
                        setPage((p) => ({ w: p.h, h: p.w }));
                      }}
                    />
                  </div>
                </Section>

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

                <Section title="Drawing tool" collapsibleKey="pen">
                  <InputSelect
                    size="md"
                    label="Tool"
                    hideLabel
                    value={toolName}
                    disabled={busy || !presets.length}
                    onChange={(e) => setToolName(e.target.value)}
                  >
                    {presets.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </InputSelect>
                  <p className={styles.empty}>
                    {`Draws a ${penWidthMm} mm line${palette.length > 1 ? ` in ${palette.length} colors` : ""}`}
                  </p>
                </Section>
              </Section>
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
              </div>
            </div>
          </Card>

          {/* The layers, and what is on the one being worked on: two sections of one card. */}
          <Card variant="flat" className={styles.controls}>
            <div className={`${styles.cardBody} ${styles.settings}`}>
              <Section title="Artwork" collapsibleKey="artwork">
              <Section
                title="Layers"
                collapsibleKey="layers"
                action={
                  <span className={styles.headerTools}>
                    <ButtonRound size="sm" icon={<Undo2 />} aria-label="Undo" title="Undo the last change"
                      disabled={busy || !past.length} onClick={undo} />
                    <ButtonRound size="sm" icon={<Redo2 />} aria-label="Redo" title="Redo the change just undone"
                      disabled={busy || !future.length} onClick={redo} />
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
                          swatchProps={{
                            "aria-label": `Pen color for ${layer.name}`,
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
                          onChange={() => setActiveLayer(layer.id)}
                          aria-label={`Draw on layer ${at + 1}, ${layer.name}`}
                          label={
                            <input
                              value={layer.name}
                              aria-label={`Name of layer ${at + 1}`}
                              title="The layer's name: click to change it"
                              disabled={busy}
                              onFocus={() => {
                                nameBeforeEdit.current = layer.name;
                                record();
                              }}
                              onChange={(e) => typeLayerName(layer.id, e.target.value)}
                              onBlur={() => settleLayerName(layer.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                              }}
                            />
                          }
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

              {active && (
                <Section
                  title={`On ${active.name}`}
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
                  {onActive.length === 0 ? (
                    <p className={styles.empty}>Drag on the page to draw one.</p>
                  ) : (
                    <ul className={styles.shapeList}>
                      {onActive.map((sh, i) => {
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
                              number={i + 1}
                              // No swatch: everything on a layer draws in that layer's one ink, and
                              // the row right above says which it is.
                              hideVisibility
                              hideHandle
                              checked={selected.includes(sh.id)}
                              aria-label={`Shape ${i + 1}, ${name}`}
                              // The click decides, not the box: several shapes can be picked, which
                              // a radio would otherwise undo for us. Shift adds one to the selection
                              // or takes it out; a plain click picks that shape alone.
                              onChange={() => {}}
                              onClick={(e) => {
                                e.preventDefault();
                                setSelected((current) => (e.shiftKey
                                  ? (current.includes(sh.id) ? current.filter((id) => id !== sh.id) : [...current, sh.id])
                                  : [sh.id]));
                              }}
                              label={
                                <span className={styles.shapeLabel}>
                                  <span className={styles.shapeName}>{name}</span>
                                  {/* The size sits at the end of the row, against the button that
                                      opens it. Numbers alone: the page is inches throughout, and the
                                      boxes that open say so. */}
                                  <button
                                    type="button"
                                    className={styles.shapeSize}
                                    aria-label={`Size of ${name}`}
                                    aria-haspopup="dialog"
                                    aria-expanded={sizing === sh.id}
                                    title="Set this shape's size"
                                    onClick={(e) => {
                                      const anchor = e.currentTarget;
                                      pick(sh.id);
                                      setSizing((open) => (open === sh.id ? null : sh.id));
                                      setSizeAnchor(anchor);
                                    }}
                                  >
                                    {`${trimNum(b.x1 - b.x0, 2)} × ${trimNum(b.y1 - b.y0, 2)}`}
                                    <SquareDimensions className={styles.sizeIcon} aria-hidden />
                                  </button>
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
                    </ul>
                  )}
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
              <div className={`${styles.cardBody} ${styles.settings}`}>
                <Section title="Shape" collapsibleKey="shape">
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

                {/* Baking takes the whole thing - every copy of a repeat, every letter of a text -
                    and leaves paths whose points can be pulled about one at a time. */}
                <Section title="Bake" collapsibleKey="bake">
                  {(chosen.runs?.length ?? 0) > 1 && (
                    <Button size="md" variant="secondary" onClick={() => splitShape(chosen.id)}>
                      {`Split into ${chosen.runs?.length} shapes`}
                    </Button>
                  )}
                  {chosen.repeat && chosen.kind !== "path" && (
                    <Button size="md" variant="secondary" onClick={() => bakeShape(chosen.id, true)}>
                      Bake shape
                    </Button>
                  )}
                  <Button size="md" variant="secondary" onClick={() => bakeShape(chosen.id)}>
                    {chosen.repeat ? "Bake pattern" : "Bake shape"}
                  </Button>
                  <p className={styles.empty}>
                    {chosen.repeat
                      ? `Baking the shape gives up only its own numbers: its points can be dragged and every copy follows. Baking the pattern leaves ${placements(chosen).length} shapes, each free of the others.`
                      : "The numbers behind it are given up; its points can then be dragged one by one."}
                  </p>
                </Section>

                {chosen.kind === "path" && (
                <Section title="Simplify" collapsibleKey="simplify">
                  {(() => {
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
                </Section>
                )}

                {canFill(chosen) && (
                <Section title="Fill" collapsibleKey="fill">
                  <Checkbox
                    checked={chosenFills.length > 0}
                    label="Hatch this shape"
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
                  {chosenFills.map((fill, i) => (fill.custom ? (
                    <p key={`${fill.id}-note`} className={styles.empty}>
                      {`Set by hand, so it stays at ${fill.spacingMm} mm`}
                      <Button size="sm" variant="ghost" onClick={() => followTool(i, fill)}>
                        {toolName ? `Follow ${toolName}` : "Follow the tool"}
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
                      label="Connect the line ends"
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
                </Section>
                )}
                </Section>
              </div>
            </Card>
          )}

          {/* What is done to a shape as a whole: how it sits, and how many of it there are. */}
          {chosen && (
            <Card variant="flat" className={styles.controls}>
              <div className={`${styles.cardBody} ${styles.settings}`}>
                <Section title="Transform" collapsibleKey="transform">
                <Section title="Rotate" collapsibleKey="rotate">
                  <NumberField
                    label="Rotation"
                    unit="°"
                    step={5}
                    value={chosen.rotation ?? 0}
                    onChange={setRotation}
                  />
                </Section>

                <Section title="Repeat" collapsibleKey="repeat">
                  <div className={styles.tools} role="group" aria-label="How this shape repeats">
                    {REPEATS.map((r) => {
                      const on = (chosen.repeat?.kind ?? null) === r.kind;
                      return (
                        <ButtonRound
                          key={r.label}
                          size="sm"
                          icon={r.icon}
                          className={on ? controls.roundActive : undefined}
                          aria-label={r.label}
                          aria-pressed={on}
                          title={r.hint}
                          onClick={() => setRepeat(r.kind ? defaultRepeat(r.kind, chosen) : undefined)}
                        />
                      );
                    })}
                  </div>
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
                </Section>
                </Section>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
