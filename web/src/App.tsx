import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@tomcoggia/ui";
import styles from "./App.module.css";
import { api, postJSON } from "./lib/api";
import { BUSY_STATES, DEFAULT_SETTINGS, PAPER_SIZES, PLOTTING_STATES, PRESET_FIELDS, STEPS, STORAGE } from "./lib/constants";
import { cleanNote } from "./lib/format";
import { lightness } from "./lib/color";
import { fitsOnBed, fitsOnPaper, footprint } from "./lib/geometry";
import { parsePreview, type Preview } from "./lib/preview";
import { load, save } from "./lib/storage";
import type { Confirmation, Estimate, Info, Layer, LayerEdits, PenColor, LayerView, Message, Placement, Preset, Settings, Status, Studio } from "./lib/types";
import { Header } from "./components/Header";
import { Bed, type Zoom } from "./components/Bed";
import { ZoomControl } from "./components/ZoomControl";
import { FileBrowser, type OpenResult } from "./components/FileBrowser";
import { MachinePanel } from "./components/MachinePanel";
import { Disclosure } from "./components/Disclosure";
import { DrawingNotes } from "./components/DrawingNotes";
import { PlotSummary } from "./components/PlotSummary";
import { PlotProgress } from "./components/PlotProgress";
import { FileSection } from "./components/controls/FileSection";
import { LayersSection } from "./components/controls/LayersSection";
import { PositionSection } from "./components/controls/PositionSection";
import { PresetSection } from "./components/controls/PresetSection";
import { PaperSection } from "./components/controls/PaperSection";
import { PenSection } from "./components/controls/PenSection";
import { SpeedSection } from "./components/controls/SpeedSection";
import { PlotOptionsSection } from "./components/controls/PlotOptionsSection";
import { PlotterSection } from "./components/controls/PlotterSection";
import { ActionBar } from "./components/controls/ActionBar";

// Settings that change what the NextDraw software's dry run reports.
const ESTIMATE_KEYS: (keyof Settings)[] = [
  "model", "handling", "speed_pendown", "speed_penup", "accel", "pen_pos_down", "pen_pos_up",
  "pen_rate_lower", "pen_rate_raise", "copies", "page_delay", "reordering", "auto_rotate", "hiding", "random_start",
];

// Pen and Speed settings belong to a future "Create new preset" mode; hidden until that's designed.
// The active drawing-tool preset still supplies these values.
const SHOW_PEN_AND_SPEED = false;

// Only one plotter (a NextDraw 2234), so the model picker is hidden; DEFAULT_SETTINGS.model is set to it.
const SHOW_PLOTTER_MODEL = false;

const isBusy = (s: Status | null) => Boolean(s && BUSY_STATES.includes(s.state));

function loadActivePreset(): string | null {
  const parsed = load<string>(STORAGE.preset);
  if (parsed) return parsed;
  try {
    return localStorage.getItem(STORAGE.preset); // older pages stored the bare name
  } catch {
    return null;
  }
}

export default function App() {
  const [info, setInfo] = useState<Info | null>(null);
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...(load<Partial<Settings>>(STORAGE.settings) ?? {}) }));
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(loadActivePreset);
  const [fileName, setFileName] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  /* ---------- Layers ---------- */

  // Renames and order, by layer id. They're saved into the file automatically (see Auto-save).
  // Layers come with the fast artwork and again with each estimate; whichever arrived last.
  const [drawingLayers, setDrawingLayers] = useState<Layer[] | null>(null);
  const fileLayers = drawingLayers;
  const [layerEdits, setLayerEdits] = useState<LayerEdits | null>(null);
  // The one layer chosen to print (the green printer in the Layers card). None until the operator picks one.
  const [printLayer, setPrintLayer] = useState<string | null>(null);
  const layerViews: LayerView[] = useMemo(() => {
    if (!fileLayers) return [];
    const byId = new Map(fileLayers.map((l) => [l.id, l]));
    const editsFit = layerEdits && layerEdits.order.length === fileLayers.length && layerEdits.order.every((id) => byId.has(id));
    const order = editsFit ? layerEdits!.order : fileLayers.map((l) => l.id);
    return order.map((id) => {
      const layer = byId.get(id)!;
      const name = (editsFit && layerEdits!.names[id]) || layer.name;
      const hidden = editsFit && id in layerEdits!.hidden ? layerEdits!.hidden[id] : layer.hidden;
      const color = (editsFit && layerEdits!.colors[id]) || layer.color;
      return { ...layer, name, hidden, color, originalName: layer.name, renamed: name !== layer.name, skipped: name.startsWith("%") };
    });
  }, [fileLayers, layerEdits]);
  const layerNames = () => Object.fromEntries(layerViews.map((l) => [l.id, l.name]));
  const layerHidden = () => Object.fromEntries(layerViews.map((l) => [l.id, l.hidden]));
  const layerColors = () => layerEdits?.colors ?? {};
  const renameLayer = (id: string, name: string) => {
    setLayerEdits({ order: layerViews.map((l) => l.id), names: { ...layerNames(), [id]: name }, hidden: layerHidden(), colors: layerColors() });
  };
  // Sort by darkness: the lightest color becomes layer 1 (plotted first, at the bottom) and darker
  // colors stack on top. Layers without a color stay at the bottom; ties keep their current order.
  const sortLayersByLightness = () => {
    const ranked = layerViews.map((l, i) => ({ id: l.id, i, light: lightness(l.color) }));
    ranked.sort((a, b) => {
      if (a.light === null || b.light === null) return a.light === null && b.light === null ? a.i - b.i : a.light === null ? -1 : 1;
      return b.light - a.light || a.i - b.i;
    });
    setLayerEdits({ order: ranked.map((r) => r.id), names: layerNames(), hidden: layerHidden(), colors: layerColors() });
  };
  // Picking a pen color from the palette names the layer after the pen and gives its lines that color.
  const colorLayer = (id: string, pen: PenColor) => {
    setLayerEdits({
      order: layerViews.map((l) => l.id),
      names: { ...layerNames(), [id]: pen.name },
      hidden: layerHidden(),
      colors: { ...layerColors(), [id]: pen.color },
    });
  };
  const moveLayer = (id: string, to: number) => {
    const order = layerViews.map((l) => l.id).filter((i) => i !== id);
    order.splice(to, 0, id);
    setLayerEdits({ order, names: layerNames(), hidden: layerHidden(), colors: layerColors() });
  };
  // A hidden layer isn't shown or plotted, so it can't stay the layer chosen to print.
  const setLayerVisible = (id: string, visible: boolean) => {
    setLayerEdits({ order: layerViews.map((l) => l.id), names: layerNames(), hidden: { ...layerHidden(), [id]: !visible }, colors: layerColors() });
    if (!visible && printLayer === id) setPrintLayer(null);
  };
  // Drawings with more than one layer plot one layer at a time: the one picked in the Layers card.
  const printTarget = layerViews.find((l) => l.id === printLayer && !l.hidden) ?? null;
  const needsLayerChoice = layerViews.length > 1 && !printTarget;
  const plotLayerId = layerViews.length > 1 ? printTarget?.id ?? null : null;
  // Preview mode: arrange the drawing - every shown layer in its color, show/hide and reorder layers.
  // Plot mode ("work" in code): only the layer chosen to print is drawn; layers hidden in Preview mode leave the list.
  // Drawings always open in Preview mode.
  const [layerMode, setLayerMode] = useState<"preview" | "work">("preview");
  const layerLooks = useMemo(
    () => (layerViews.length
      ? Object.fromEntries(layerViews.map((l) => [l.id, {
        color: l.color,
        skipped: l.skipped,
        hidden: layerMode === "work" ? l.id !== printTarget?.id : l.hidden,
      }]))
      : null),
    [layerViews, layerMode, printTarget],
  );
  // The drawing itself, straight from the file (instant), and the plot simulation's picture with pen
  // paths (seconds on a big drawing). Preview mode shows the drawing; Work mode and drawings without
  // layers show the simulation once it's ready.
  const [artPreview, setArtPreview] = useState<Preview | null>(null);
  const [simPreview, setSimPreview] = useState<Preview | null>(null);
  const layered = (drawingLayers?.length ?? 0) > 1;
  const preview = layered && layerMode === "preview" ? artPreview : simPreview ?? artPreview;
  const setPreview = (p: Preview | null) => {
    setArtPreview(p);
    setSimPreview(p);
  };
  const [previewScale, setPreviewScale] = useState(100); // the scale the current preview was made at
  const [placement, setPlacementState] = useState<Placement>({ x: 0, y: 0 });
  const [scale, setScaleState] = useState(100); // percent; per drawing, 100 for every new file
  const [rotation, setRotation] = useState(0); // quarter turns clockwise, in degrees; per drawing
  const [status, setStatus] = useState<Status | null>(null);
  // When the chosen layer finishes plotting, let go of it so its row shows the printed mark. Picking
  // it again (clicking the printed icon) makes it the layer to print once more, to reprint it.
  const printedKey = (status?.printed_layers ?? []).join("|");
  const seenPrinted = useRef<string>(printedKey);
  useEffect(() => {
    const before = new Set(seenPrinted.current.split("|"));
    seenPrinted.current = printedKey;
    if (printLayer && printedKey.split("|").includes(printLayer) && !before.has(printLayer)) setPrintLayer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printedKey]);

  const [lostContact, setLostContact] = useState(false);
  const [localMessage, setLocalMessage] = useState<Message | null>(null);
  const [machineError, setMachineError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"plot" | "manual" | null>(null);
  const [stepIndex, setStepIndex] = useState(1);
  // The dashed pen-up travel lines on the preview are off unless turned on under Utilities.
  const [showPenUp, setShowPenUp] = useState(() => load<boolean>(STORAGE.penUpMoves) ?? false);
  useEffect(() => save(STORAGE.penUpMoves, showPenUp), [showPenUp]);
  const [zoomChoice, setZoomChoice] = useState<Zoom>(() => load<Zoom>(STORAGE.zoom) ?? "plotter");
  useEffect(() => save(STORAGE.zoom, zoomChoice), [zoomChoice]);

  // Refs let the polling loop see current values without restarting.
  const refs = useRef({ fileName, status, lastAction, settings, scale, presets, plotLayerId, rotation, readRequested: false });
  refs.current.rotation = rotation;
  refs.current.plotLayerId = plotLayerId;
  refs.current.presets = presets;
  refs.current.fileName = fileName;
  refs.current.status = status;
  refs.current.lastAction = lastAction;
  refs.current.settings = settings;
  refs.current.scale = scale;
  const estimateSeq = useRef(0);

  const busy = isBusy(status);
  const plotting = Boolean(status && PLOTTING_STATES.includes(status.state));

  const model = info?.models.find((m) => m.id === settings.model) ?? info?.models[0];
  const fp = footprint(preview, settings, placement);
  const onBed = fitsOnBed(fp, model);
  const onPaper = fitsOnPaper(fp, settings);
  // Fall back to the whole plotter when there's no drawing (or paper) to zoom to.
  const zoom: Zoom = zoomChoice === "drawing" && !fp ? "plotter" : zoomChoice === "paper" && !(settings.paper_w > 0 && settings.paper_h > 0) ? "plotter" : zoomChoice;

  /* ---------- Settings ---------- */

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => save(STORAGE.settings, settings), [settings]);
  useEffect(() => save(STORAGE.preset, activePreset), [activePreset]);

  const setPlacement = useCallback((p: Placement, _persist = true) => {
    const next = { x: Math.max(0, p.x), y: Math.max(0, p.y) };
    setPlacementState(next);
  }, []);

  const setScale = useCallback((percent: number) => {
    const next = Math.min(1000, Math.max(1, percent));
    setScaleState(next);
  }, []);

  // A drawing was loaded: use the choices saved in it (or start at home, full size), then let auto-save
  // watch for changes from there. Returns the scale to estimate at.
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const savedKey = useRef<string | null>(null);
  const applyStudio = useCallback((name: string, studio: Studio | null) => {
    setPlacementState(studio?.placement ?? { x: 0, y: 0 });
    const nextScale = studio?.scale ?? 100;
    refs.current.scale = nextScale;
    setScaleState(nextScale);
    const nextRotation = ((Math.round((studio?.rotation ?? 0) / 90) % 4) + 4) % 4 * 90;
    refs.current.rotation = nextRotation;
    setRotation(nextRotation);
    setLayerEdits(null);
    setPrintLayer(null);
    setLayerMode("preview");
    const tool = studio?.tool ? refs.current.presets.find((p) => p.name === studio.tool) : undefined;
    if (tool) setActivePreset(tool.name);
    const patch = { ...(tool?.settings ?? {}), ...(studio?.paper ?? {}) };
    if (Object.keys(patch).length) {
      refs.current.settings = { ...refs.current.settings, ...patch };
      setSettings((prev) => ({ ...prev, ...patch }));
    }
    savedKey.current = null; // the next state seen is what the file holds
    setSaveState(null);
    setLoadedFile(name);
    return nextScale;
  }, []);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* ---------- Auto-save ---------- */

  // Changes to the drawing (layer names and order, placement, scale, drawing tool, paper) are written
  // into the SVG shortly after they're made. Saves run one at a time, and wait while the plotter is busy.
  const studioNow: Studio = {
    placement,
    scale,
    rotation,
    tool: activePreset ?? undefined,
    paper: { paper_size: settings.paper_size, paper_w: settings.paper_w, paper_h: settings.paper_h, paper_x: settings.paper_x, paper_y: settings.paper_y },
  };
  const layersNow = layerEdits
    ? layerViews.map((l) => ({ id: l.id, name: l.name, hidden: l.hidden, ...(layerEdits.colors[l.id] ? { color: l.color } : {}) }))
    : null;
  const saveKey = JSON.stringify([studioNow, layersNow]);
  const saveChain = useRef(Promise.resolve());
  useEffect(() => {
    if (!fileName || loadedFile !== fileName) return;
    if (savedKey.current === null) {
      savedKey.current = saveKey;
      return;
    }
    if (saveKey === savedKey.current || busy) return;
    const key = saveKey;
    const body = { file: fileName, studio: studioNow, ...(layersNow ? { layers: layersNow } : {}) };
    const timer = window.setTimeout(() => {
      saveChain.current = saveChain.current.then(async () => {
        if (refs.current.fileName !== fileName) return;
        setSaveState("saving");
        try {
          await postJSON("/api/drawing", body);
          savedKey.current = key;
          setSaveState("saved");
        } catch (err) {
          savedKey.current = key; // don't retry the same change; the next change tries again
          setSaveError((err as Error).message);
          setSaveState("error");
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, loadedFile, saveKey, busy]);

  /* ---------- Loading ---------- */

  useEffect(() => {
    api<Info>("/api/info")
      .then(setInfo)
      .catch(() => setLocalMessage({ text: "Couldn’t reach NextDraw Studio. Start it with server.py and reload this page.", tone: "error" }));
    api<{ presets: Preset[] }>("/api/presets").then((r) => setPresets(r.presets)).catch(() => setPresets([]));
  }, []);

  const clearDrawing = useCallback(() => {
    estimateSeq.current++; // ignore any estimate still on its way
    setFileName(null);
    setEstimate(null);
    setPreview(null);
    setDrawingLayers(null);
    setUpdating(false);
    setPlacementState({ x: 0, y: 0 });
    setScaleState(100);
    setRotation(0);
    setLayerEdits(null);
    setPrintLayer(null);
    setLoadedFile(null);
    setSaveState(null);
    setLocalMessage(null);
  }, []);

  // Poll the server for plot progress, carriage state and plotter connection.
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api<Status>("/api/status");
        if (cancelled) return;
        const { fileName: currentFile, status: prev, lastAction: action } = refs.current;
        setLostContact(false);
        if (!next.file && currentFile) clearDrawing(); // cleared in another window
        if (next.file && !currentFile) {
          // The page was reloaded with a drawing loaded: pick up the choices saved in it.
          refs.current.fileName = next.file;
          const drawing = await api<{ studio: Studio | null }>("/api/drawing").catch(() => ({ studio: null }));
          if (cancelled) return;
          applyStudio(next.file, drawing.studio);
          setFileName(next.file);
        }
        if (isBusy(prev) && !isBusy(next) && action === "plot") setLocalMessage(null);
        setStatus(next);

        // Once per page load, ask a connected plotter where its carriage is. This doesn't move anything.
        if (!refs.current.readRequested && next.plotter_found && !isBusy(next) && !next.carriage?.known) {
          refs.current.readRequested = true;
          setLastAction("manual");
          postJSON("/api/manual", { command: "read", settings: refs.current.settings }).catch(() => {});
        }
      } catch {
        if (!cancelled) setLostContact(true);
      }
      if (!cancelled) timer = window.setTimeout(poll, isBusy(refs.current.status) ? 500 : 2000);
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clearDrawing]);

  /* ---------- Preview and estimate ---------- */

  // Two steps. The drawing itself (sized, scaled, turned) comes back from the server at once and is
  // shown straight away; the plot simulation - pen paths, time, reach - takes seconds on a big
  // drawing and replaces it when done. `updating` covers the gap, and Plot waits for it.
  const [drawingVersion, setDrawingVersion] = useState(0); // bumped when a drawing is (re)loaded
  const [updating, setUpdating] = useState(false);
  const artworkKey = useRef("");
  const estimatedSeq = useRef(0); // the last request whose full simulation is on screen
  const estimateKey = ESTIMATE_KEYS.map((k) => settings[k]).join("|");
  // The plot simulation (pen paths, time, distance) never runs just because something changed: the
  // plot time is worked out when Plot is pressed, by the plot itself. The one exception is showing
  // pen-up moves (Utilities), which only the simulation can draw - for what would be plotted.
  const layerCount = drawingLayers ? drawingLayers.length : null;
  const simulate = showPenUp && layerCount !== null && (layerCount <= 1 || Boolean(plotLayerId));
  const [artWarnings, setArtWarnings] = useState<string[]>([]);
  const [trimmed, setTrimmed] = useState(false);
  useEffect(() => {
    if (!fileName) return;
    const seq = ++estimateSeq.current;
    const sentScale = refs.current.scale;
    const sentRotation = refs.current.rotation;

    const key = [fileName, drawingVersion, sentScale, sentRotation].join("|");
    if (key !== artworkKey.current) {
      artworkKey.current = key;
      setSimPreview(null); // its pen paths are for the old size or turn
      postJSON<{ svg: string; layers: Layer[]; warnings: string[]; trimmed: boolean }>("/api/artwork", { scale: sentScale, rotation: sentRotation })
        .then((art) => {
          if (key !== artworkKey.current) return; // a newer size or turn was asked for
          setArtPreview(parsePreview(art.svg));
          setPreviewScale(sentScale);
          setDrawingLayers(art.layers);
          setArtWarnings(art.warnings);
          setTrimmed(art.trimmed);
        })
        .catch(() => {}); // the estimate reports anything wrong with the file
    }

    if (!simulate) {
      setUpdating(false);
      setEstimate(null); // nothing to plot yet, so no time or distance to show
      return;
    }
    setUpdating(true);

    const timer = window.setTimeout(async () => {
      try {
        const result = await postJSON<Estimate>("/api/estimate", {
          ...refs.current.settings, scale: sentScale, layer: refs.current.plotLayerId, rotation: sentRotation,
        });
        if (seq !== estimateSeq.current || result.superseded) return; // a newer estimate is on its way
        estimatedSeq.current = seq;
        setEstimate(result);
        setSimPreview(parsePreview(result.preview_svg));
        setDrawingLayers(result.layers);
        setUpdating(false);
        setLocalMessage((m) => (m && (m.text === "Working out the plot…" || m.text.startsWith("Loading ")) ? null : m));
      } catch (err) {
        if (seq === estimateSeq.current) {
          setUpdating(false);
          setLocalMessage({ text: (err as Error).message, tone: "error" });
        }
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, drawingVersion, simulate ? estimateKey : "", scale, simulate ? plotLayerId : "", rotation, simulate]);

  /* ---------- Actions ---------- */

  // A drawing was just loaded (opened, imported or uploaded): start it at home, at full size.
  const startNewDrawing = async (name: string, studio: Studio | null) => {
    estimateSeq.current++;
    setEstimate(null);
    setPreview(null);
    setDrawingLayers(null);
    refs.current.fileName = name;
    applyStudio(name, studio);
    setStatus((s) => (s ? { ...s, resume: null } : s));
    setFileName(name);
    setDrawingVersion((v) => v + 1); // reloading the same name still redraws and re-estimates
    setLocalMessage({ text: "Working out the plot…" });
  };

  // Drag and drop from Finder: the browser only hands over a copy, not the file's location.
  const uploadFile = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!/\.svg$/i.test(file.name)) {
      setLocalMessage({ text: "Drop an SVG file. Open Illustrator files with Open… so they can be imported.", tone: "error" });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setLocalMessage({ text: `Loading ${file.name}…` });
    try {
      const res = await api<{ name: string; studio: Studio | null }>("/api/upload", { method: "POST", body: form });
      await startNewDrawing(res.name, res.studio);
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  // Trim to drawing / Restore page. The server changes the page and says how far the lines sit from the
  // old page's corner; moving the drawing by that much keeps the lines where they were on the paper.
  const [trimming, setTrimming] = useState(false);
  const trimPage = async (restore: boolean) => {
    if (busy || trimming || !fileName) return;
    setTrimming(true);
    try {
      const res = await postJSON<{ offset_mm: [number, number] }>(restore ? "/api/untrim" : "/api/trim", {
        ...settings, file: fileName, rotation, scale,
      });
      setPlacement({ x: placement.x + res.offset_mm[0], y: placement.y + res.offset_mm[1] });
      setTrimmed(!restore);
      setDrawingVersion((v) => v + 1); // redraw with the new page
    } catch (err) {
      setSaveError((err as Error).message); // shown in the File card, under the file name
      setSaveState("error");
    } finally {
      setTrimming(false);
    }
  };

  const [browserOpen, setBrowserOpen] = useState(false);
  const openBrowser = () => {
    if (!busy) setBrowserOpen(true);
  };
  const onOpened = (res: OpenResult) => {
    startNewDrawing(res.name, res.studio);
  };


  const clearFile = async () => {
    if (busy) return;
    try {
      await api("/api/file", { method: "DELETE" });
      clearDrawing();
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const resume = !busy ? status?.resume ?? null : null;

  // Confirmations are shown in the page (above the panel), not with window.confirm: embedded
  // browsers, including the in-app Browser pane, block those pop-ups and they answer "no".
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (busy) setConfirmation(null);
  }, [busy]);

  const startPlot = () => {
    if (!onBed) return;
    if (!onPaper) {
      setConfirmation({
        message: "Part of this drawing runs off the paper.",
        confirmLabel: "Plot anyway",
        onConfirm: plotNow,
      });
      return;
    }
    plotNow();
  };

  const plotNow = async () => {
    setConfirmation(null);
    setLastAction("plot");
    setLocalMessage(null);
    try {
      await postJSON("/api/plot", { ...settings, start_x: placement.x, start_y: placement.y, scale, layer: plotLayerId, rotation });
      setStatus((s) => (s ? { ...s, state: "preparing", message: "", started: false } : s));
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const resumePlot = async () => {
    setLastAction("plot");
    setLocalMessage(null);
    try {
      await postJSON("/api/resume");
      setStatus((s) => (s ? { ...s, state: "preparing", message: "", started: false } : s));
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const discardResume = () => {
    setConfirmation({
      message: "Discard the stopped plot and send the carriage home? It can’t be resumed afterward.",
      confirmLabel: "Discard",
      danger: true,
      onConfirm: discardNow,
    });
  };

  const discardNow = async () => {
    setConfirmation(null);
    setLastAction("manual"); // the move home reports in Utilities
    try {
      await api("/api/resume", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setStatus((s) => (s ? { ...s, resume: null, state: "moving", message: "" } : s));
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const stopPlot = async () => {
    try {
      await postJSON("/api/stop");
      setStatus((s) => (s ? { ...s, state: "stopping" } : s));
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const manual = async (command: string, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    const action = "manual"; // every manual command reports in the Utilities panel
    setLastAction(action);
    setLocalMessage(null);
    setMachineError(null);
    try {
      await postJSON("/api/manual", { command, settings, ...extra });
      // Show the busy state right away rather than waiting for the next poll.
      setStatus((s) => (s ? { ...s, state: command === "pen_test" ? "testing" : "moving", message: "" } : s));
    } catch (err) {
      if (action === "manual") setMachineError((err as Error).message);
      else setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const walk = (axis: "x" | "y", dir: 1 | -1) => {
    const step = STEPS[settings.units][stepIndex];
    manual("walk", { axis, distance_mm: (settings.units === "in" ? step * 25.4 : step) * dir });
  };

  /* ---------- Paper ---------- */

  const pickPaperSize = (id: string) => {
    const size = PAPER_SIZES.find((p) => p.id === id);
    if (size?.w && size.h) {
      const landscape = settings.paper_w >= settings.paper_h;
      updateSettings({ paper_size: id, paper_w: landscape ? size.h : size.w, paper_h: landscape ? size.w : size.h });
    } else {
      updateSettings({ paper_size: id });
    }
  };

  /* ---------- Presets ---------- */

  const active = presets.find((p) => p.name === activePreset);
  const presetChanged = Boolean(
    active && !PRESET_FIELDS.every((k) => !(k in active.settings) || Math.abs(Number(active.settings[k]) - Number(settings[k])) < 0.05),
  );

  const applyPreset = (name: string) => {
    const preset = presets.find((p) => p.name === name);
    setActivePreset(preset ? preset.name : null);
    if (preset) {
      updateSettings(preset.settings);
      setLocalMessage({ text: `Using “${preset.name}”.`, tone: "ok" });
    }
  };

  const savePreset = async (name: string) => {
    name = name.trim();
    if (!name) return false;
    if (presets.some((p) => p.name === name) && name !== activePreset && !window.confirm(`Replace the preset “${name}”?`)) return false;
    try {
      const payload = Object.fromEntries(PRESET_FIELDS.map((k) => [k, settings[k]]));
      const res = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPresets(res.presets);
      setActivePreset(name);
      setLocalMessage({ text: `Saved preset “${name}”.`, tone: "ok" });
      return true;
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
      return false;
    }
  };

  const deletePreset = async () => {
    const name = activePreset;
    if (!name || !window.confirm(`Delete the preset “${name}”? Your current settings stay as they are.`)) return;
    try {
      const res = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(name)}`, { method: "DELETE" });
      setPresets(res.presets);
      setActivePreset(null);
      setLocalMessage({ text: `Deleted preset “${name}”.` });
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  /* ---------- Messages ---------- */

  // Everything advisory goes in the caution callout: placement notes, the NextDraw software's warnings
  // about the drawing, and messages the plotter sent during the last plot or command.
  const plotterLog = status?.log;
  const notes = useMemo(() => {
    const list: string[] = [];
    if (fp) {
      if (!onBed) list.push("At this size and position the drawing goes past the plotter’s reach, so it can’t be plotted. Scale it down or move it closer to home.");
      if (!onPaper) list.push("Part of the drawing runs off the paper. Move the drawing, or check the paper size and where the paper sits.");
      list.push(...(estimate?.warnings ?? artWarnings).map(cleanNote));
    }
    list.push(...(plotterLog || []).map(cleanNote));
    return [...new Set(list)];
  }, [estimate, artWarnings, fp, onBed, onPaper, plotterLog]);

  let actionMessage: Message | null = localMessage;
  if (!actionMessage && status) {
    if (status.state === "testing") actionMessage = { text: "Lowering and raising the pen…" };
    else if (status.message && lastAction !== "manual") {
      actionMessage = { text: status.message, tone: status.state === "error" ? "error" : status.state === "finished" ? "ok" : undefined };
    } else if (fileName && !onBed) {
      actionMessage = { text: "At this position the drawing goes past the plotter’s reach. Move it closer to home to plot it.", tone: "error" };
    } else if (fileName && !status.plotter_found) {
      actionMessage = { text: "Connect the plotter by USB and turn it on to plot." };
    }
  }

  let machineMessage: Message | null = machineError ? { text: machineError, tone: "error" } : null;
  if (!machineMessage && status && lastAction === "manual") {
    if (status.state === "moving") machineMessage = { text: status.message || "Moving…" };
    else if (status.state === "testing") machineMessage = { text: "Lowering and raising the pen…" };
    else if (status.message) machineMessage = { text: status.message, tone: status.state === "error" ? "error" : undefined };
  }

  // Drag a file anywhere onto the page.
  const uploadRef = useRef(uploadFile);
  uploadRef.current = uploadFile;
  const [draggingFile, setDraggingFile] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files") || isBusy(refs.current.status)) return;
      depth++;
      setDraggingFile(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDraggingFile(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDraggingFile(false);
      uploadRef.current(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return (
    <div className={styles.app}>
      <FileBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} onOpened={onOpened} />
      <Header plotterFound={Boolean(status?.plotter_found)} lostContact={lostContact} />

      <main className={styles.layout}>
        <section className={styles.stage} aria-label="Drawing preview">
          <div className={styles.bedArea}>
            <Bed
              zoom={zoom}
              model={model}
              settings={settings}
              preview={preview}
              footprint={fp}
              fitsOnBed={onBed}
              fitsOnPaper={onPaper}
              placement={placement}
              onPlacementChange={setPlacement}
              carriage={status?.carriage}
              showPenUp={showPenUp}
              hasFile={Boolean(fileName)}
              draggingFile={draggingFile}
              canDrag={!busy}
              onOpenBrowser={openBrowser}
              layerLooks={layerLooks}
            />
            <ZoomControl
              zoom={zoom}
              canPaper={settings.paper_w > 0 && settings.paper_h > 0}
              canDrawing={Boolean(fp)}
              onZoom={setZoomChoice}
              updating={updating}
            />
          </div>

          <Disclosure title="Drawing position">
            <PositionSection
              placement={placement}
              units={settings.units}
              disabled={plotting}
              onChange={(p) => setPlacement(p)}
              paperX={settings.paper_x}
              paperY={settings.paper_y}
              onPaperChange={updateSettings}
            />
          </Disclosure>

          <Disclosure title="Plot options">
            <PlotOptionsSection settings={settings} disabled={plotting} onChange={updateSettings} />
          </Disclosure>

          <MachinePanel
            model={model}
            units={settings.units}
            carriage={status?.carriage}
            stepIndex={stepIndex}
            onStepIndex={setStepIndex}
            busy={busy}
            walkSupported={info?.walk_supported ?? true}
            message={machineMessage}
            onWalk={walk}
            onHome={() => manual("home")}
            onRaise={() => manual("raise_pen")}
            onLower={() => manual("lower_pen")}
            onRelease={() => manual("release")}
            onSetupHeight={() => manual("pen_setup")}
            onTestPen={() => manual("pen_test")}
            showPenUp={showPenUp}
            onShowPenUp={setShowPenUp}
          />

          <PlotSummary
            estimate={preview ? estimate : null}
            preview={preview}
            units={settings.units}
            rotated={Boolean(fp?.rotated)}
          />
        </section>

        <div className={styles.side}>
          <PlotProgress status={status} />
          <ActionBar
            message={actionMessage}
            plotting={plotting}
            stopping={status?.state === "stopping" || status?.state === "returning"}
            canPlot={!busy && Boolean(fileName) && Boolean(preview) && onBed && !needsLayerChoice}
            plotLabel={needsLayerChoice ? "Choose a layer to plot" : printTarget && plotLayerId ? `Plot ${printTarget.name}` : "Plot"}
            preparing={status?.state === "preparing"}
            resume={resume}
            confirmation={confirmation}
            onCancelConfirmation={() => setConfirmation(null)}
            onPlot={startPlot}
            onResume={resumePlot}
            onDiscard={discardResume}
            onStop={stopPlot}
          />
          <Card variant="flat" className={`${styles.controls} ${styles.fileCard}`}>
            <DrawingNotes notes={notes} className={styles.fileNotes} />
            <div className={styles.cardBody}>
              <FileSection
                fileName={fileName}
                busy={busy}
                preview={preview}
                previewScale={previewScale}
                scale={scale}
                units={settings.units}
                onScale={setScale}
                folder={status?.file_folder ?? null}
                saveState={saveState}
                saveError={saveError}
                onOpen={openBrowser}
                onClear={clearFile}
                trimmed={trimmed}
                trimming={trimming}
                onTrim={trimPage}
                onRotate={(turn) => setRotation((r) => (((r + turn * 90) % 360) + 360) % 360)}
              />
            </div>
          </Card>
          {fileName && layerViews.length > 0 && (
            <Card variant="flat" className={styles.controls}>
              <div className={styles.cardBody}>
                <LayersSection
                  mode={layerMode}
                  onMode={setLayerMode}
                  layers={layerViews}
                  target={printLayer}
                  printed={status?.printed_layers ?? []}
                  onTarget={setPrintLayer}
                  palette={active?.palette ?? []}
                  onColor={colorLayer}
                  onSort={sortLayersByLightness}
                  onVisible={setLayerVisible}
                  disabled={plotting}
                  onRename={renameLayer}
                  onMove={moveLayer}
                />
              </div>
            </Card>
          )}
          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <PresetSection
                presets={presets}
                active={active}
                changed={presetChanged}
                disabled={plotting}
                onApply={applyPreset}
                onSave={savePreset}
                onDelete={deletePreset}
              />
            </div>
          </Card>
          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <PaperSection
                settings={settings}
                disabled={plotting}
                onPickSize={pickPaperSize}
                onChange={(patch) => updateSettings(patch)}
              />
            </div>
          </Card>
          {(SHOW_PEN_AND_SPEED || SHOW_PLOTTER_MODEL) && (
            <Card variant="flat" className={styles.controls}>
              <form className={styles.controlsForm} onSubmit={(e) => e.preventDefault()} autoComplete="off">
                {SHOW_PEN_AND_SPEED && (
                  <>
                    <PenSection
                      settings={settings}
                      disabled={plotting}
                      busy={busy}
                      onChange={updateSettings}
                      onSetupHeight={() => manual("pen_setup")}
                      onTest={() => manual("pen_test")}
                    />
                    <SpeedSection settings={settings} handling={info?.handling ?? []} disabled={plotting} onChange={updateSettings} />
                  </>
                )}
                {SHOW_PLOTTER_MODEL && (
                  <PlotterSection settings={settings} models={info?.models ?? []} disabled={plotting} onChange={updateSettings} />
                )}
              </form>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
