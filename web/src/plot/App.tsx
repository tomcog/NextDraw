import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@tomcoggia/ui";
import styles from "./App.module.css";
import { api, postJSON } from "../shared/lib/api";
import { barrelOffsetMm, BUSY_STATES, DEFAULT_SETTINGS, IDRAW_MODEL, PAPER_SIZES, PLOT_CHANNEL, PLOTTING_STATES, PRESET_FIELDS, STEPS, STORAGE } from "../shared/lib/constants";
import { cleanNote, listOf } from "../shared/lib/format";
import { lightness } from "../shared/lib/color";
import { fitsOnBed, fitsOnPaper, footprint, minPlacement } from "../shared/lib/geometry";
import { parsePlotPaths, type PlotPaths } from "../shared/lib/progressPaths";
import { parsePreview, type Preview } from "../shared/lib/preview";
import { load, save } from "../shared/lib/storage";
import type { Confirmation, Estimate, Info, Ink, Layer, PenColor, LayerView, Message, Placement, Preset, Settings, Status, Plot } from "../shared/lib/types";
import { inkHex, isPalettePen, joinLayerName, penNameAt, penNameOf, splitLayerName } from "../shared/lib/ink";
import { Hints } from "../shared/components/controls/Hints";
import { Header } from "./components/Header";
import { Bed, type Zoom } from "../shared/components/Bed";
import { PaletteEditor } from "./components/PaletteEditor";
import { PreviewToolbar, type View } from "../shared/components/PreviewToolbar";
import { openInStudio } from "../shared/lib/apps";
import { FileBrowser, type OpenResult } from "../shared/components/FileBrowser";
import { MachinePanel } from "./components/MachinePanel";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { DrawingNotes } from "./components/DrawingNotes";
import { SettingsHud } from "./components/SettingsHud";
import { PlotSummary } from "./components/PlotSummary";
import { PlotProgress } from "./components/PlotProgress";
import { FileSection } from "./components/controls/FileSection";
import { LayersSection } from "./components/controls/LayersSection";
import { PositionSection } from "./components/controls/PositionSection";
import { PresetSection } from "./components/controls/PresetSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { SettingsSection } from "../shared/components/controls/SettingsSection";
import { PenSection } from "./components/controls/PenSection";
import { SpeedSection } from "./components/controls/SpeedSection";
import { PlotOptionsSection } from "./components/controls/PlotOptionsSection";
import { PlotterSection } from "./components/controls/PlotterSection";
import { ActionBar } from "./components/controls/ActionBar";

// Settings that change what the NextDraw software's dry run reports.
const ESTIMATE_KEYS: (keyof Settings)[] = [
  "model", "handling", "speed_pendown", "speed_penup", "accel", "pen_pos_down", "pen_pos_up",
  "pen_rate_lower", "pen_rate_raise", "copies", "page_delay", "reordering", "auto_rotate", "hiding", "random_start",
  "join_gap",  // joining paths changes both the pen lifts and the time, so the estimate has to rerun
];

// Pen and Speed settings belong to a future "Create new preset" mode; hidden until that's designed.
// The active drawing-tool preset still supplies these values.
const SHOW_PEN_AND_SPEED = false;

// Only one plotter (a NextDraw 2234), so the model picker is hidden; DEFAULT_SETTINGS.model is set to it.
const SHOW_PLOTTER_MODEL = false;

const isBusy = (s: Status | null) => Boolean(s && BUSY_STATES.includes(s.state));

// The tools are shared by both plotters, but each is set up on one: Plot lists the connected one's only.
const PLOTTER_PRESETS = "/api/presets?plotter=connected";

// The settings and tool every open Plot page shows, as the server keeps them.
type SharedSettings = { settings: Partial<Settings> | null; preset: string | null; version: string | null };

// JSON with its keys in order, so the same settings always read the same however they were put together.
const sortedJSON = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));

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
  // Which layers Plot is holding back, by id. Plot's own decision about today's plot, kept in its own
  // metadata block - the drawing's layers belong to Studio and Plot never edits them.
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  // A layer named after one of its tool's pens is SHOWN in that pen's color, so editing a palette
  // updates the preview. Display only: the color in the file stays whatever Studio put there.
  const [penColors, setPenColors] = useState<Record<string, string>>({});
  // The order to plot the layers in, bottom first, when it isn't the drawing's own. Which ink goes
  // down before which is a plotting decision, so it's kept in Plot's block and the file keeps its
  // order - the same bargain as the ink colors below.
  const [plotOrder, setPlotOrder] = useState<string[] | null>(null);
  // The ink a layer is being plotted in today, when the operator has chosen one. Swapping a pen to
  // see how the drawing looks in it is a decision about this plot, so it's kept in Plot's own block
  // and the drawing's colors are left alone - which is what lets "the drawing's own" put it back.
  const [inkColors, setInkColors] = useState<Record<string, Ink>>({});
  // What Plot calls a layer, when that isn't what the drawing calls it. Choosing an ink renames the
  // layer to that ink: the name is how you know which pen to put in the holder, so a layer called
  // "Sky Blue" going down in Marigold is a trap at the moment it matters most. It lives in Plot's own
  // block - the same bargain as the ink and the order above - because the drawing's layer names are
  // Studio's, and <nds:design> maps shapes to layers BY NAME: renaming one in the file would leave
  // Studio unable to find the shapes on it.
  // Layers linked to print together, as groups of ids: layers going down in the same pen, plotted in
  // one pass rather than one after another with the same pen put back in. Plot's decision, kept in its
  // own block like the inks. A link only holds while its layers really are the same pen of the same
  // tool - see `linksOf` - so a stale one is ignored rather than plotting two inks at once.
  const [layerLinks, setLayerLinks] = useState<string[][]>([]);
  // Hatch spacings found while plotting, by layer id, in mm on paper: an ink that wants its Studio
  // fills closer together or further apart than the drawing has them. Plot regenerates the fills at
  // this spacing for the preview and the plot; the drawing's own fills are left as Studio made them.
  const [hatchSpacing, setHatchSpacing] = useState<Record<string, number>>({});
  // Skip tiny paths: leave out of the plot every path whose longest side is under this (mm on paper),
  // marks so small the pen would only dab a dot. Chosen per drawing and saved in it; null when off.
  const [skipTiny, setSkipTiny] = useState<number | null>(null);
  // A second drawing tool (mixed media): null normally; "" once added but not yet chosen.
  const [secondTool, setSecondTool] = useState<string | null>(null);
  const [secondToolLayers, setSecondToolLayers] = useState<string[]>([]);
  // Small paths: slow the plotter by this percent for drawings full of tiny marks; null when off.
  const [smallPaths, setSmallPaths] = useState<number | null>(null);
  // The one layer chosen to print (the green printer in the Layers card). None until the operator picks one.
  const [printLayer, setPrintLayer] = useState<string | null>(null);
  // The drawing's layers as they are in the file - name, order and color all Studio's. Plot adds only
  // its own two things: whether it is holding the layer back today, and the pen color to show it in.
  // A tool's pens by name, and the tool a layer is drawn with. The drawing-tool card has richer
  // versions of both further down; these are what the layer views need before it exists.
  const paletteOfTool = useCallback(
    (tool: string) => presets.find((p) => p.name === tool)?.palette ?? [],
    [presets],
  );
  const toolOfLayer = useCallback(
    (id: string) => (secondTool && secondToolLayers.includes(id) ? secondTool : activePreset) ?? "",
    [secondTool, secondToolLayers, activePreset],
  );
  const layerViews: LayerView[] = useMemo(() => {
    if (!fileLayers) return [];
    // A saved order only applies while it's still this drawing's layers; otherwise the file's own
    // order stands, rather than half an order applied to a drawing that has changed underneath it.
    const fits = plotOrder
      && plotOrder.length === fileLayers.length
      && new Set(plotOrder).size === fileLayers.length
      && plotOrder.every((id) => fileLayers.some((l) => l.id === id));
    const ordered = fits ? plotOrder!.map((id) => fileLayers.find((l) => l.id === id)!) : fileLayers;
    const views = ordered.map((layer) => {
      const palette = paletteOfTool(toolOfLayer(layer.id));
      // The colour this layer is going down in: an ink chosen for today, else the pen its name calls
      // for, else the colour the drawing was made in.
      const color = inkHex(inkColors[layer.id], palette, paletteOfTool) || penColors[layer.id] || layer.color;
      // The pen that draws that colour - which is the pen to put in the holder. The drawing's name
      // is Studio's to set and the file keeps it; a layer given another pen here is shown under
      // that pen's name, with the label Studio gave it kept after it, as Studio renames a layer given
      // a pen: "Black - Crop marks" in Red reads "Red - Crop marks", and "13-date" in Turquoise reads
      // "Turquoise". Worked out from the ink chosen rather than stored.
      const pen = penNameAt(color, palette);
      const skipped = layer.name.startsWith("%");
      const tool = toolOfLayer(layer.id);
      const inkPen = penNameOf(inkColors[layer.id], palette);
      const own = splitLayerName(layer.name, palette);
      const name = inkPen ? joinLayerName(inkPen, own.pen ? own.label.trim() : "") : layer.name;
      return {
        ...layer,
        name,
        pen,
        color,
        inkPen,
        // Judged by the name the row shows: that is what you load a pen by.
        inPalette: isPalettePen(name, color, palette),
        penKey: pen && tool && !skipped ? `${tool}/${pen}` : null,
        // What the drawing itself says, so a swapped ink can be told from the planned one and undone.
        ownColor: penColors[layer.id] || layer.color,
        hidden: hiddenLayers.includes(layer.id) || layer.hidden,
        skipped,
      };
    });
    // Two layers given the same pen would read alike: the later ones are numbered on, "Black 2", the
    // way Studio names a second layer in a pen - which still reads as that pen.
    const taken = new Set(views.filter((v) => !v.inkPen).map((v) => v.name));
    for (const v of views) {
      if (!v.inkPen) continue;
      let name = v.name;
      for (let n = 2; taken.has(name); n++) name = `${v.name} ${n}`;
      taken.add(name);
      v.name = name;
    }
    return views;
  }, [fileLayers, hiddenLayers, penColors, inkColors, plotOrder, paletteOfTool, toolOfLayer]);
  // Lightest at the bottom: layer 1 is plotted first and everything darker goes over it, which is how
  // the inks build on paper. Layers whose color can't be read stay at the bottom, under the ones that
  // can; ties keep the order they already had.
  const sortLayersByLightness = () => {
    const ranked = layerViews.map((l, i) => ({ id: l.id, i, light: lightness(l.color) }));
    ranked.sort((a, b) => {
      if (a.light === null || b.light === null) {
        return a.light === null && b.light === null ? a.i - b.i : a.light === null ? -1 : 1;
      }
      return b.light - a.light || a.i - b.i;
    });
    setPlotOrder(ranked.map((r) => r.id));
  };
  // Picking a pen shows the layer in that ink. Picking "the drawing's own" hands it back.
  //
  // A pen is recorded as the pen it is - its tool and its name - so the layer keeps following it as
  // the palette is edited. Only the system colour picker, which belongs to no pen, records a colour.
  const colorLayer = (id: string, pick: { pen: PenColor } | { hex: string } | null) =>
    setInkColors((all) => {
      if (!pick) {
        const { [id]: _gone, ...rest } = all;
        return rest;
      }
      if (!("pen" in pick)) return { ...all, [id]: pick.hex };
      const tool = (usesSecond(id) ? secondPreset : active)?.name;
      // No tool to name the pen against (presets never loaded): the colour still stands on its own.
      return { ...all, [id]: tool ? { tool, pen: pick.pen.name, hex: pick.pen.color } : pick.pen.color };
    });
  // Choosing an ink changes the colour and nothing else: the layer's name is the drawing's.
  const colorAndNameLayer = (id: string, pick: { pen: PenColor } | { hex: string } | null) => {
    colorLayer(id, pick);
    // A new ink is a different pen, so the layer leaves whatever it was linked with. Left in place, the
    // link would come back to life if the ink were ever swapped back, which nobody would expect.
    setLayerLinks((groups) => groups.map((g) => g.filter((i) => i !== id)).filter((g) => g.length > 1));
  };
  // The layers each layer prints together with (itself not included), in plot order. Only the members
  // of its group that go down in the very same pen of the same tool count: a palette edit or a tool
  // change can make two linked layers different inks, and those must never go down in one pass.
  const linksOf = useMemo(() => {
    const byId = new Map(layerViews.map((l) => [l.id, l]));
    const partners = new Map<string, string[]>();
    for (const group of layerLinks) {
      for (const id of group) {
        const key = byId.get(id)?.penKey;
        if (!key) continue;
        const same = layerViews.filter((l) => l.id !== id && l.penKey === key && group.includes(l.id)).map((l) => l.id);
        if (same.length) partners.set(id, same);
      }
    }
    return partners;
  }, [layerViews, layerLinks]);
  // Link a layer with others in its pen, merging whatever any of them is already linked with. Linked
  // layers are one step of the plot, so they're gathered in the order too: the others move to sit
  // directly below this one - the link is made from the uppermost of them - which is also what lets
  // the Layers card draw them as one block.
  const linkLayers = (id: string, others: string[]) => {
    setLayerLinks((groups) => {
      const members = [id, ...others];
      const joined = groups.filter((g) => g.some((i) => members.includes(i))).flat();
      const rest = groups.filter((g) => !g.some((i) => members.includes(i)));
      return [...rest, [...new Set([...joined, ...members])]];
    });
    const order = layerViews.map((l) => l.id);
    const moving = order.filter((i) => others.includes(i));
    const kept = order.filter((i) => !others.includes(i));
    const at = kept.indexOf(id);
    const next = [...kept.slice(0, at), ...moving, ...kept.slice(at)];
    if (next.join("|") !== order.join("|")) setPlotOrder(next);
  };
  // A hatch spacing for the layers being plotted, found while plotting. Setting it back to the
  // drawing's own spacing drops the override, so the file carries nothing that says nothing.
  const setLayersHatch = (ids: string[], mm: number) =>
    setHatchSpacing((all) => {
      const next = { ...all };
      for (const id of ids) {
        const own = layerViews.find((l) => l.id === id)?.fill_spacing;
        if (own == null) continue;
        if (Math.abs(mm - own) < 1e-9) delete next[id];
        else next[id] = mm;
      }
      return next;
    });
  // Undo a link: every layer of the group goes back to plotting on its own, where it now stands.
  const unlinkLayers = (id: string) =>
    setLayerLinks((groups) => groups.filter((g) => !g.includes(id)));
  // Forget which layers have been plotted. The marks are the page's note to itself about what is
  // already on the paper; the paper changes without the app hearing about it.
  const resetPrinted = () => {
    api("/api/printed", { method: "DELETE" })
      .then(() => setStatus((s) => (s ? { ...s, printed_layers: [] } : s)))
      .catch(() => setLocalMessage({ text: "Couldn't clear the printed marks.", tone: "error" }));
  };
  // A hidden layer isn't shown or plotted, so it can't stay the layer chosen to print.
  const setLayerVisible = (id: string, visible: boolean) => {
    setHiddenLayers((list) => (visible ? list.filter((i) => i !== id) : [...list, id]));
    if (!visible && printLayer === id) setPrintLayer(null);
  };
  // Drawings with more than one layer plot one layer at a time: the one picked in the Layers card.
  const printTarget = layerViews.find((l) => l.id === printLayer && !l.hidden) ?? null;
  // A layer whose name starts with % is never drawn, so it doesn't make this a drawing with a choice
  // to make: a hatch fill with its outline turned off leaves its source shape on one of those, and
  // asking which layer to plot when only one of them can be would be asking about nothing.
  const plottableLayers = layerViews.filter((l) => !l.skipped);
  const needsLayerChoice = plottableLayers.length > 1 && !printTarget;
  // A drawing with one plottable layer plots whole, and a layer hidden here is only hidden in Plot's
  // own metadata - the plotter would still draw it. So with nothing shown there is nothing to plot.
  const nothingShown = plottableLayers.length > 0 && plottableLayers.every((l) => l.hidden);
  const plotLayerId = plottableLayers.length > 1 ? printTarget?.id ?? null : null;
  // Everything that goes down in this plot: the chosen layer and the shown layers linked with it, in
  // plot order. The chosen layer comes first - its tool is the one in the holder.
  const printIds = useMemo(() => {
    if (!printTarget) return [];
    const linked = new Set(linksOf.get(printTarget.id) ?? []);
    return [printTarget.id, ...layerViews.filter((l) => linked.has(l.id) && !l.hidden).map((l) => l.id)];
  }, [printTarget, linksOf, layerViews]);
  const plotLayerIds = plotLayerId ? printIds : null;
  // The number the Layers card shows against a layer: the list runs bottom-last, and layer by layer the
  // hidden ones leave it, so the number is read off the same rows rather than off the drawing.
  const layerNumber = (id: string) =>
    [...layerViews].reverse().filter((l) => layerMode === "preview" || !l.hidden).findIndex((l) => l.id === id) + 1;
  // Whole drawing ("preview" in code): arrange the drawing - every shown layer in its color, show/hide and reorder layers.
  // Layer by layer ("work" in code): only the layer chosen to print is drawn; layers hidden in the whole drawing leave the list.
  // Drawings always open showing the whole drawing.
  const [layerMode, setLayerMode] = useState<"preview" | "work">("preview");
  const layerLooks = useMemo(
    () => (layerViews.length
      ? Object.fromEntries(layerViews.map((l) => [l.id, {
        color: l.color,
        skipped: l.skipped,
        hidden: layerMode === "work" ? !printIds.includes(l.id) : l.hidden,
      }]))
      : null),
    [layerViews, layerMode, printIds],
  );
  // Layer ids bottom-first, so the preview stacks them the way the plot draws them.
  const layerOrder = useMemo(() => layerViews.map((l) => l.id), [layerViews]);
  // The drawing itself, straight from the file (instant), and the plot simulation's picture with pen
  // paths (seconds on a big drawing). The whole drawing shows the drawing; layer by layer and drawings without
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
  // Nothing plots without a plotter on the USB, so the Plot button waits for one the same way it
  // waits for a layer to be chosen. Losing the server counts too: the plot would have nowhere to go.
  // Two plotters plugged into one Mac can't be told which is which by the NextDraw software, so then
  // neither is ready.
  const severalPlotters = (status?.plotters ?? 0) > 1;
  const plotterReady = Boolean(status?.plotter_found) && !severalPlotters && !lostContact;
  const [localMessage, setLocalMessage] = useState<Message | null>(null);
  const [machineError, setMachineError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"plot" | "manual" | null>(null);
  const [stepIndex, setStepIndex] = useState(1);
  // The dashed pen-up travel lines on the preview are off unless turned on under Utilities.
  const [showPenUp, setShowPenUp] = useState(() => load<boolean>(STORAGE.penUpMoves) ?? false);
  useEffect(() => save(STORAGE.penUpMoves, showPenUp), [showPenUp]);
  // How the preview draws the drawing: Outline, every path a thin line - what can be afforded whatever
  // the file, so a drawing always opens in it - or Preview, the ink at each tool's width, which is
  // asked for. The same choice Studio offers, from the same bar; Progress is Plot's alone.
  const [view, setView] = useState<View>("outline");
  // The tool's settings over the preview are for setting a tool up, not for plotting with one, so
  // they're hidden until asked for from the Drawing tool card - and stay asked for until put away.
  const [hudOpen, setHudOpen] = useState(() => load<boolean>(STORAGE.hudOpen) ?? false);
  useEffect(() => save(STORAGE.hudOpen, hudOpen), [hudOpen]);
  const [zoomChoice, setZoomChoice] = useState<Zoom>(() => load<Zoom>(STORAGE.zoom) ?? "plotter");
  // The loupe over the preview, for a close look at the lines. Put away each time the page opens.
  const [loupe, setLoupe] = useState(false);
  useEffect(() => save(STORAGE.zoom, zoomChoice), [zoomChoice]);

  // Refs let the polling loop see current values without restarting.
  const refs = useRef({ fileName, status, lastAction, settings, scale, presets, plotLayerIds, rotation, hatchSpacing, readRequested: false, plotSettings: settings, skipTiny: null as number | null, activePreset, opened: undefined as string | null | undefined,
    // Following the other open pages: the last shared-settings version and drawing save this page has
    // taken up, and whether it has changes of its own not yet sent.
    settingsVersion: undefined as string | null | undefined, settingsUnsent: false,
    drawingSaved: undefined as string | null | undefined, unsaved: false });
  refs.current.rotation = rotation;
  refs.current.hatchSpacing = hatchSpacing;
  refs.current.skipTiny = skipTiny;
  refs.current.plotLayerIds = plotLayerIds;
  refs.current.presets = presets;
  refs.current.activePreset = activePreset;
  refs.current.fileName = fileName;
  refs.current.status = status;
  refs.current.lastAction = lastAction;
  refs.current.settings = settings;
  refs.current.scale = scale;
  const estimateSeq = useRef(0);

  const busy = isBusy(status);
  const plotting = Boolean(status && PLOTTING_STATES.includes(status.state));

  // The iDraw is told apart by the server; its travel is the A3 model's, under its own name.
  const onIdraw = status?.plotter === "idraw";
  const listedModel = info?.models.find((m) => m.id === (onIdraw ? IDRAW_MODEL : settings.model)) ?? info?.models[0];
  const model = onIdraw && listedModel ? { ...listedModel, name: "iDraw" } : listedModel;
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

  // The settings and the tool are kept on the server, so every open Plot page - odin's own screen and
  // any other device's - shows the same ones: a change on one is sent there, and the others take it up
  // on their next status poll. This browser's own copy above is only what the page starts from when the
  // server has none yet.
  const [sharedReady, setSharedReady] = useState(false);
  const sharedKey = sortedJSON({ settings, preset: activePreset });
  const syncedKey = useRef<string | null>(null); // what the server holds, as far as this page knows
  refs.current.settingsUnsent = sharedReady && sharedKey !== syncedKey.current;
  const takeShared = useCallback((shared: SharedSettings) => {
    const next = { ...DEFAULT_SETTINGS, ...shared.settings };
    syncedKey.current = sortedJSON({ settings: next, preset: shared.preset });
    refs.current.settingsVersion = shared.version;
    refs.current.settings = next;
    refs.current.activePreset = shared.preset;
    setSettings(next);
    setActivePreset(shared.preset);
  }, []);
  useEffect(() => {
    if (!sharedReady || sharedKey === syncedKey.current) return;
    const body = { settings, preset: activePreset };
    const timer = window.setTimeout(() => {
      postJSON<{ version: string }>("/api/plot-settings", body, "PUT")
        .then((r) => {
          syncedKey.current = sharedKey;
          refs.current.settingsVersion = r.version;
        })
        .catch(() => { /* the next change sends them again */ });
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedKey, sharedReady]);

  // The drawing's page may start before home by its empty margin, never so far that its lines would.
  const minPlace = minPlacement(fp);
  const minPlaceRef = useRef(minPlace);
  minPlaceRef.current = minPlace;
  const setPlacement = useCallback((p: Placement, _persist = true) => {
    const min = minPlaceRef.current;
    const next = { x: Math.max(min.x, p.x), y: Math.max(min.y, p.y) };
    setPlacementState(next);
  }, []);

  // Centre the drawing's lines on the paper along one axis; its empty margin goes where it falls.
  const centreOnPaper = fp && settings.paper_w > 0 && settings.paper_h > 0
    ? (axis: "x" | "y") => {
      const into = axis === "x" ? fp.ink.x0 - fp.x : fp.ink.y0 - fp.y; // lines' offset in the page, in
      const size = axis === "x" ? fp.ink.x1 - fp.ink.x0 : fp.ink.y1 - fp.ink.y0;
      const paperAt = axis === "x" ? settings.paper_x : settings.paper_y;
      const paperSize = axis === "x" ? settings.paper_w : settings.paper_h;
      const at = Math.round((paperAt + (paperSize - size * 25.4) / 2 - into * 25.4) * 10) / 10;
      setPlacement({ ...placement, [axis]: at });
    }
    : null;

  const setScale = useCallback((percent: number) => {
    const next = Math.min(1000, Math.max(1, percent));
    setScaleState(next);
  }, []);

  // Fit the drawing's lines to the paper inside a margin all round (mm), centred: the scale that
  // fills the room on its tighter side, and the start that centres the lines at that scale. The
  // drawing's page scales about its corner, so its lines keep their share of it at any scale.
  const fitToPaper = preview && settings.paper_w > 0 && settings.paper_h > 0
    ? (marginMm: number) => {
      const f = preview.ink ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
      const pageMm = { w: (preview.widthIn * 25.4 * 100) / previewScale, h: (preview.heightIn * 25.4 * 100) / previewScale }; // at 100%
      const ink = { w: (f.x1 - f.x0) * pageMm.w, h: (f.y1 - f.y0) * pageMm.h };
      const room = { w: settings.paper_w - 2 * marginMm, h: settings.paper_h - 2 * marginMm };
      if (room.w <= 0 || room.h <= 0) return;
      const fits = Math.min(ink.w > 1e-6 ? room.w / ink.w : Infinity, ink.h > 1e-6 ? room.h / ink.h : Infinity);
      if (!Number.isFinite(fits)) return;
      // Down to a tenth of a percent, so the lines come out inside the margin rather than a hair over.
      const next = Math.min(1000, Math.max(1, Math.floor(fits * 1000) / 10));
      const k = next / 100;
      const at = (paperAt: number, paperSize: number, inkSize: number, inkFrom: number, pageSize: number) =>
        Math.round((paperAt + (paperSize - inkSize * k) / 2 - inkFrom * pageSize * k) * 10) / 10;
      setScale(next);
      // Straight to the state: setPlacement's floor is worked out at the old scale. Its lines never
      // start before home, as setPlacement's floor would have them.
      setPlacementState({
        x: Math.max(-f.x0 * pageMm.w * k, at(settings.paper_x, settings.paper_w, ink.w, f.x0, pageMm.w)),
        y: Math.max(-f.y0 * pageMm.h * k, at(settings.paper_y, settings.paper_h, ink.h, f.y0, pageMm.h)),
      });
    }
    : undefined;

  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const savedKey = useRef<string | null>(null);
  // Bumped whenever choices are taken from the file, so auto-save takes them as its starting point.
  const [choicesTick, setChoicesTick] = useState(0);
  // The choices saved in a drawing: where it goes, how big, its layers, its paper. Used when a drawing
  // is opened, and when another open page (odin's own screen, the laptop) saves its choices.
  // keepPaper: joining a drawing other pages already have open. Their paper is in the shared settings,
  // which may hold a change not yet saved into the file, so the file's paper isn't taken over it.
  const applyChoices = useCallback((plot: Plot | null, keepPaper = false) => {
    setPlacementState(plot?.placement ?? { x: 0, y: 0 });
    const nextScale = plot?.scale ?? 100;
    refs.current.scale = nextScale;
    setScaleState(nextScale);
    const nextRotation = ((Math.round((plot?.rotation ?? 0) / 90) % 4) + 4) % 4 * 90;
    refs.current.rotation = nextRotation;
    setRotation(nextRotation);
    setHiddenLayers(plot?.hidden_layers ?? []);
    setInkColors(plot?.layer_colors ?? {});
    setPlotOrder(plot?.layer_order ?? null);
    setLayerLinks(plot?.layer_links ?? []);
    setHatchSpacing(plot?.hatch_spacing ?? {});
    setSkipTiny(plot?.skip_tiny ?? null);
    setSmallPaths(plot?.small_paths ?? null);
    setSecondTool(plot?.second_tool ?? null);
    setSecondToolLayers(plot?.second_tool_layers ?? []);
    // The drawing tool is deliberately NOT taken from the file. It stands for the pen actually in the
    // holder, and a file can arrive at any moment - saved from Studio, synced from odin - which would
    // otherwise swap the chosen pen, and its pen positions and speeds with it, in the middle of
    // setting up a plot. The tool the page remembers stays chosen until it's changed by hand. Plot
    // still writes `tool` into the file, because Studio reads it to draw in the right ink.
    const patch = keepPaper ? {} : { ...(plot?.paper ?? {}) };
    if (Object.keys(patch).length) {
      refs.current.settings = { ...refs.current.settings, ...patch };
      setSettings((prev) => ({ ...prev, ...patch }));
    }
    savedKey.current = null; // the next state seen is what the file holds
    setChoicesTick((t) => t + 1);
    return nextScale;
  }, []);
  // A drawing was loaded: use the choices saved in it (or start at home, full size), then let auto-save
  // watch for changes from there. Returns the scale to estimate at.
  const applyPlot = useCallback((name: string, plot: Plot | null, keepPaper = false) => {
    const nextScale = applyChoices(plot, keepPaper);
    setPenColors({});
    setPrintLayer(null);
    setLayerMode("preview");
    setSaveState(null);
    setLoadedFile(name);
    return nextScale;
  }, [applyChoices]);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* ---------- Auto-save ---------- */

  // How the drawing is to be plotted - placement, scale, rotation, tool, paper, which layers are held
  // back - written into Plot's own metadata block shortly after each change, so reopening the file on
  // any machine puts the drawing back exactly where it was. Plot writes nothing else: the geometry and
  // the layers are Studio's. Saves run one at a time, and wait while the plotter is busy.
  const drawingNow: Plot = {
    placement,
    scale,
    rotation,
    tool: activePreset ?? undefined,
    ...(smallPaths ? { small_paths: smallPaths } : {}),
    ...(secondTool ? { second_tool: secondTool, second_tool_layers: secondToolLayers } : {}),
    ...(hiddenLayers.length ? { hidden_layers: hiddenLayers } : {}),
    ...(Object.keys(inkColors).length ? { layer_colors: inkColors } : {}),
    ...(plotOrder?.length ? { layer_order: plotOrder } : {}),
    ...(layerLinks.length ? { layer_links: layerLinks } : {}),
    ...(Object.keys(hatchSpacing).length ? { hatch_spacing: hatchSpacing } : {}),
    ...(skipTiny ? { skip_tiny: skipTiny } : {}),
    paper: { paper_size: settings.paper_size, paper_w: settings.paper_w, paper_h: settings.paper_h, paper_x: settings.paper_x, paper_y: settings.paper_y, paper_color: settings.paper_color },
  };
  const saveKey = JSON.stringify(drawingNow);
  refs.current.unsaved = savedKey.current !== null && saveKey !== savedKey.current;
  const saveChain = useRef(Promise.resolve());
  useEffect(() => {
    if (!fileName || loadedFile !== fileName) return;
    if (savedKey.current === null) {
      savedKey.current = saveKey;
      return;
    }
    if (saveKey === savedKey.current || busy) return;
    const key = saveKey;
    const body = { file: fileName, plot: drawingNow };
    const timer = window.setTimeout(() => {
      saveChain.current = saveChain.current.then(async () => {
        if (refs.current.fileName !== fileName) return;
        setSaveState("saving");
        try {
          const res = await postJSON<{ saved?: string }>("/api/drawing", body);
          if (res.saved) refs.current.drawingSaved = res.saved; // our own save: nothing to follow
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
  }, [fileName, loadedFile, saveKey, busy, choicesTick]);

  /* ---------- Loading ---------- */

  useEffect(() => {
    api<Info>("/api/info")
      .then(setInfo)
      .catch(() => setLocalMessage({ text: "Couldn’t reach NextDraw Plot. Start it with server.py and reload this page.", tone: "error" }));
    (async () => {
      // The settings the other open pages are showing come first: opening a page mustn't change them.
      const shared = await api<SharedSettings>("/api/plot-settings").catch(() => null);
      if (shared?.settings) takeShared(shared);
      try {
        const r = await api<{ presets: Preset[] }>(PLOTTER_PRESETS);
        setPresets(r.presets);
        // Presets are shared (iCloud Drive) and can be edited elsewhere: use the chosen tool's current
        // values rather than the ones remembered from the last time it was picked.
        // With no tool chosen (or the chosen one gone), start with the first in the list.
        const chosen = r.presets.find((p) => p.name === refs.current.activePreset) ?? r.presets[0];
        if (chosen && !(shared?.settings && chosen.name === shared.preset)) {
          setActivePreset(chosen.name);
          setSettings((prev) => ({ ...prev, ...chosen.settings }));
        }
      } catch {
        setPresets([]);
      }
      setSharedReady(true);
    })();
  }, [takeShared]);

  // The presets file is shared - edited from the other Mac, from Studio, or by hand - so a change to it
  // reaches this page without a reload: the list is read again every few seconds, and when it has
  // changed, the chosen tool's settings are taken from it, as they are when the page opens. The page's
  // own saves come back the same way and change nothing.
  const presetsSeen = useRef<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const r = await api<{ presets: Preset[] }>(PLOTTER_PRESETS);
        const text = JSON.stringify(r.presets);
        if (presetsSeen.current === null) {
          presetsSeen.current = text;
          return;
        }
        if (text === presetsSeen.current) return;
        presetsSeen.current = text;
        setPresets(r.presets);
        const chosen = r.presets.find((p) => p.name === refs.current.activePreset);
        if (chosen) setSettings((prev) => ({ ...prev, ...chosen.settings }));
      } catch {
        /* the next read tries again */
      }
    }, 3000);
    return () => window.clearInterval(timer);
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
    setHiddenLayers([]);
    setInkColors({});
    setPlotOrder(null);
    setLayerLinks([]);
    setHatchSpacing({});
    setPenColors({});
    setPrintLayer(null);
    setLoadedFile(null);
    setSaveState(null);
    setLocalMessage(null);
  }, []);

  // Poll the server for plot progress, carriage state and plotter connection.
  const reloading = useRef(false); // one reopen at a time, however long the poll takes
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    let running = false;
    const poll = async () => {
      if (running) return; // a nudge while a poll is under way: that poll carries on the loop
      running = true;
      try {
        const next = await api<Status>("/api/status");
        if (cancelled) return;
        const { fileName: currentFile, status: prev, lastAction: action } = refs.current;
        setLostContact(false);
        if (!next.file && currentFile) clearDrawing(); // cleared in another window
        if (next.file && !currentFile) {
          // The page was reloaded with a drawing loaded: pick up the choices saved in it.
          // If that fetch fails, leave the drawing unloaded and try again on the next poll. Carrying
          // on with `plot: null` would put the page at 100% at home with nothing hidden, and the
          // first thing the operator touched afterwards would save those defaults over the placement
          // the file actually holds - losing it to a blip rather than to a decision.
          const drawing = await api<{ plot: Plot | null }>("/api/drawing").catch(() => null);
          if (cancelled) return;
          if (!drawing) {
            refs.current.fileName = currentFile; // not loaded after all; the next poll tries again
          } else {
            refs.current.fileName = next.file;
            refs.current.opened = next.file_opened;
            // Opening a page to watch mustn't change what the others show: with shared settings
            // already taken, their paper stands, as their tool and settings do.
            applyPlot(next.file, drawing.plot, Boolean(refs.current.settingsVersion));
            setFileName(next.file);
          }
        }
        // Opened again from somewhere else - Studio's "Open in Plot", another tab, the other Mac -
        // even under the same name: this page shows that opening, with the choices saved in it. The
        // name alone can't tell, and a Studio save followed at once by an open leaves nothing on disk
        // for the staleness check below to catch.
        if (next.file && currentFile && next.file_opened && refs.current.opened !== undefined
          && next.file_opened !== refs.current.opened && !reloading.current) {
          const seen = refs.current.opened;
          refs.current.opened = next.file_opened;
          const drawing = await api<{ plot: Plot | null }>("/api/drawing").catch(() => null);
          if (cancelled) return;
          if (!drawing) {
            refs.current.opened = seen; // try again on the next poll
          } else {
            refs.current.fileName = next.file;
            applyPlot(next.file, drawing.plot);
            setFileName(next.file);
            setDrawingVersion((v) => v + 1); // the artwork and its layers, fetched again
          }
        }
        if (refs.current.opened === undefined) refs.current.opened = next.file_opened ?? null;
        // Changed on disk since it was opened - saved from Studio, or synced from another Mac.
        // Reopening is the same path as opening it by hand, so the drawing, its layers and the
        // choices saved in it all come back from the file rather than being patched piecemeal.
        if (next.drawing_stale && next.file_path && !reloading.current) {
          reloading.current = true;
          try {
            const res = await postJSON<OpenResult>("/api/open", { path: next.file_path });
            refs.current.opened = res.opened; // this reopen is ours
            if (!cancelled) {
              applyPlot(res.name, res.plot ?? null);
              setFileName(res.name);
              // The name hasn't changed, so nothing else would notice. This is what makes the page
              // fetch the artwork and its layers again - the drawing itself is what moved.
              setDrawingVersion((v) => v + 1);
              // Nothing is said about it: ActionBar's status line is switched off (SHOW_STATUS), so
              // there is nowhere for a passing note to go. The drawing changing in front of you is
              // the whole signal for now.
            }
          } catch {
            /* it will still be stale on the next poll, which tries again */
          } finally {
            reloading.current = false;
          }
        }

        // Another open page changed the settings or the tool: show them here too, unless this page
        // has a change of its own on the way, which the others will take up instead.
        if (next.settings_version && next.settings_version !== refs.current.settingsVersion && !refs.current.settingsUnsent) {
          const shared = await api<SharedSettings>("/api/plot-settings").catch(() => null);
          if (cancelled) return;
          if (shared?.settings && !refs.current.settingsUnsent) takeShared(shared);
        }
        // Another open page saved its choices for this drawing - moved it, scaled it, hid a layer,
        // chose an ink: take them up here too. Not over changes of this page's own not yet saved.
        if (refs.current.drawingSaved === undefined) {
          refs.current.drawingSaved = next.drawing_saved ?? null;
        } else if (next.file && next.file === refs.current.fileName && next.drawing_saved
          && next.drawing_saved !== refs.current.drawingSaved && !reloading.current && !refs.current.unsaved) {
          const saved = next.drawing_saved;
          const drawing = await api<{ plot: Plot | null }>("/api/drawing").catch(() => null);
          if (cancelled) return;
          if (drawing && !refs.current.unsaved) {
            refs.current.drawingSaved = saved;
            applyChoices(drawing.plot);
          }
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
      running = false;
      if (!cancelled) timer = window.setTimeout(poll, isBusy(refs.current.status) ? 500 : 2000);
    };
    poll();
    // Studio's "Open in Plot" asks whether a Plot page is open before opening one: this page answers,
    // and looks at the server straight away rather than on its next poll.
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(PLOT_CHANNEL) : null;
    if (channel) {
      channel.onmessage = (e) => {
        if (e.data?.type !== "open-in-plot") return;
        channel.postMessage({ type: "plot-here" });
        window.clearTimeout(timer);
        poll();
        window.focus(); // most browsers won't bring a background tab forward, but some will
      };
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      channel?.close();
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
    const sentHatch = refs.current.hatchSpacing;

    const key = [fileName, drawingVersion, sentScale, sentRotation, JSON.stringify(sentHatch)].join("|");
    if (key !== artworkKey.current) {
      artworkKey.current = key;
      setSimPreview(null); // its pen paths are for the old size or turn
      postJSON<{ svg: string; layers: Layer[]; warnings: string[]; trimmed: boolean }>("/api/artwork", { scale: sentScale, rotation: sentRotation, hatch_spacing: sentHatch })
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
          ...refs.current.plotSettings, scale: sentScale, layers: refs.current.plotLayerIds, rotation: sentRotation, hatch_spacing: sentHatch,
          skip_tiny: refs.current.skipTiny,
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
  }, [fileName, drawingVersion, simulate ? estimateKey : "", scale, simulate ? plotLayerIds?.join("|") : "", rotation, simulate, JSON.stringify(hatchSpacing), skipTiny]);

  /* ---------- Actions ---------- */

  // A drawing was just loaded (opened, imported or uploaded): start it at home, at full size.
  const startNewDrawing = async (name: string, plot: Plot | null) => {
    estimateSeq.current++;
    setEstimate(null);
    setPreview(null);
    setDrawingLayers(null);
    refs.current.fileName = name;
    applyPlot(name, plot);
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
      const res = await api<{ name: string; plot: Plot | null }>("/api/upload", { method: "POST", body: form });
      await startNewDrawing(res.name, res.plot ?? null);
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
  // Files just stacked whose page isn't the size of the first one's: they may not line up, and Plot
  // doesn't move layers - Studio does. Said for as long as that drawing is the one open.
  const [misfits, setMisfits] = useState<{ drawing: string; path: string; files: string[] } | null>(null);
  const shownMisfits = misfits && misfits.drawing === fileName ? misfits : null;

  const openBrowser = () => {
    if (!busy) setBrowserOpen(true);
  };
  const onOpened = (res: OpenResult) => {
    refs.current.opened = res.opened; // this page's own open: nothing for the poll to catch up on
    startNewDrawing(res.name, res.plot ?? null);
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
      await postJSON("/api/plot", { ...settingsFor(plotLayerId), start_x: placement.x, start_y: placement.y, tip_offset_x: tipOffsetFor(plotLayerId), tip_offset_y: tipOffsetYFor(plotLayerId), scale, layers: plotLayerIds, rotation, hatch_spacing: hatchSpacing, skip_tiny: skipTiny });
      setStatus((s) => (s ? { ...s, state: "preparing", message: "", started: false } : s));
    } catch (err) {
      setLocalMessage({ text: (err as Error).message, tone: "error" });
    }
  };

  const resumePlot = async () => {
    setLastAction("plot");
    setLocalMessage(null);
    try {
      // Resume with the settings chosen now (for the stopped layer's tool), so Small paths or speed changes
      // made while stopped apply to the rest of the plot.
      await postJSON("/api/resume", settingsFor(status?.resume?.layer ?? plotLayerId));
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

  // Live speed: the page shows the last speed asked for until the plotter's status catches up, so quick
  // clicks build on each other instead of on a status that's a poll behind.
  const speedAsked = useRef<{ pct: number; at: number } | null>(null);
  const shownSpeed = (serverPct: number) =>
    speedAsked.current && Date.now() - speedAsked.current.at < 3000 ? speedAsked.current.pct : serverPct;
  const setPlotSpeed = async (percent: number) => {
    speedAsked.current = { pct: percent, at: Date.now() };
    setStatus((s) => (s ? { ...s, speed_pct: percent, resume: s.resume ? { ...s.resume, speed_pct: percent } : s.resume } : s));
    try {
      await postJSON("/api/speed", { percent });
      speedAsked.current = { pct: percent, at: Date.now() };
    } catch (err) {
      speedAsked.current = null;
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

  // A drawing saved on Custom whose width and height are one of the sizes is shown as that size, as
  // Studio shows it.
  const paperSizeId = useMemo(() => {
    if (settings.paper_size !== "custom") return settings.paper_size;
    const { paper_w: w, paper_h: h } = settings;
    const match = PAPER_SIZES.find(
      (p) => p.w && p.h && ((Math.abs(p.w - w) < 0.01 && Math.abs(p.h - h) < 0.01) || (Math.abs(p.h - w) < 0.01 && Math.abs(p.w - h) < 0.01)),
    );
    return match?.id ?? "custom";
  }, [settings.paper_size, settings.paper_w, settings.paper_h]);

  const pickPaperSize = (id: string) => {
    const size = PAPER_SIZES.find((p) => p.id === id);
    if (size?.w && size.h) {
      const landscape = settings.paper_w >= settings.paper_h;
      updateSettings({ paper_size: id, paper_w: landscape ? size.h : size.w, paper_h: landscape ? size.w : size.h });
    } else {
      updateSettings({ paper_size: id });
    }
  };

  /* ---------- What's left of the plot in progress ---------- */

  // One of the ways the preview can draw the drawing (see the view below), so it's off unless asked
  // for. The paths are fetched when it's turned on, and again for a new plot.
  const showLeft = view === "progress";
  const [plotPaths, setPlotPaths] = useState<{ version: number; paths: PlotPaths } | null>(null);
  const pathsVersion = status?.plot_paths ?? null;
  useEffect(() => {
    if (!pathsVersion) {
      if (showLeft) setView("outline");
      setPlotPaths(null);
      return;
    }
    if (!showLeft || plotPaths?.version === pathsVersion) return;
    let cancelled = false;
    fetch(`/api/plot-paths?v=${pathsVersion}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("No plot paths"))))
      .then((text) => {
        const paths = parsePlotPaths(text);
        if (!cancelled && paths) setPlotPaths({ version: pathsVersion, paths });
      })
      .catch(() => { if (!cancelled) setView("outline"); });
    return () => { cancelled = true; };
  }, [showLeft, pathsVersion, plotPaths?.version]);
  const shownPlotPaths = showLeft && plotPaths?.version === pathsVersion ? plotPaths.paths : null;
  const liveProgress = status && ["preparing", "plotting", "stopping", "returning", "finished", "stopped", "error"].includes(status.state) && status.started;
  const progressOf = liveProgress ? status : status?.resume;
  const plotFraction = progressOf?.total_mm ? progressOf.done_mm / progressOf.total_mm : 0;

  /* ---------- Presets ---------- */

  const active = presets.find((p) => p.name === activePreset);
  const presetChanged = Boolean(
    active && !PRESET_FIELDS.every((k) => !(k in active.settings) || Math.abs(Number(active.settings[k]) - Number(settings[k] ?? active.settings[k])) < 0.05),
  );
  // A tool is always chosen. With none - none picked yet, the chosen one deleted, or the plotter
  // switched (the list holds only the connected plotter's tools) - the page's own heights are whatever
  // was left over, and on the iDraw they can be the wrong way up, so the buttons do the opposite. So
  // the first tool in the list is chosen. Only its values are taken: nothing is sent to the plotter.
  useEffect(() => {
    if (active || !presets.length) return;
    setActivePreset(presets[0].name);
    updateSettings(presets[0].settings);
  }, [active, presets, updateSettings]);

  /* ---------- A second drawing tool ---------- */

  // Normally one drawing tool covers every layer. The Plus button on the Drawing tool card adds a
  // second, and each layer is then assigned to one of the two by its number. Plotting, the preview's
  // line width and the layer's color menu follow the layer's tool; unassigned layers use the first.
  const secondPreset = secondTool ? presets.find((p) => p.name === secondTool) : undefined;
  // Named on the Settings row, so the pen shows while the card is folded: both, when a drawing mixes two.
  const toolLabel = [active?.name, secondTool].filter(Boolean).join(" + ");
  const usesSecond = (id: string | null) => Boolean(secondTool && id && secondToolLayers.includes(id));
  // Angle compensation: on or off per tool, starting from its preset. Only tools set up tilted have it.
  const [tiltChoice, setTiltChoice] = useState<Record<string, boolean>>({});
  // A tool that is only ever used tilted keeps its compensation whatever the page remembers.
  const tiltOn = (tool: Preset | undefined) =>
    Boolean(tool?.tilt && (tool.tilt.fixed || (tiltChoice[tool.name] ?? tool.tilt.on)));
  // One-way strokes: on or off per tool, starting from its preset. Only soft tips have it.
  const [dragChoice, setDragChoice] = useState<Record<string, boolean>>({});
  const dragOn = (tool: Preset | undefined) =>
    Boolean(tool?.drag && (tool.drag.fixed || (dragChoice[tool.name] ?? tool.drag.on)));
  const paletteFor = (id: string | null) => (usesSecond(id) ? secondPreset : active)?.palette ?? [];

  // A layer named after one of its tool's pens follows that pen: edit a color in the palette and
  // every layer drawn with it catches up in the preview. Nothing is written to the drawing.
  useEffect(() => {
    if (!layerViews.length) return;
    const colors = { ...penColors };
    let changed = false;
    for (const layer of layerViews) {
      if (inkColors[layer.id]) continue; // an ink chosen by hand outranks the layer's name
      const pen = paletteFor(layer.id).find((p) => p.name.trim().toLowerCase() === layer.name.trim().toLowerCase());
      if (pen && layer.ownColor?.toLowerCase() !== pen.color.toLowerCase()) {
        colors[layer.id] = pen.color;
        changed = true;
      }
    }
    if (changed) setPenColors(colors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, layerViews, inkColors]);

  // The ink sliders on the Drawing tool card: the preview follows at once, and the tool keeps the
  // values a moment after the slider stops moving.
  const inkTimer = useRef<number>();
  const setInk = (patch: { ink_opacity?: number; ink_build?: number }) => {
    if (!active) return;
    const name = active.name;
    const merged = { ...active.settings, ...patch };
    setPresets((list) => list.map((p) => (p.name === name ? { ...p, settings: merged } : p)));
    window.clearTimeout(inkTimer.current);
    inkTimer.current = window.setTimeout(() => {
      api(`/api/presets/${encodeURIComponent(name)}?plotter=connected`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      }).catch(() => setLocalMessage({ text: "Couldn't save the ink settings.", tone: "error" }));
    }, 500);
  };

  // The fields on the Drawing tool card (speed, heights, lift and lower rates, tilt offset): the next
  // plot uses a change at once, and the tool keeps it a moment later - the same bargain as the ink
  // sliders above. Every change goes into the tool itself, not just today's plot.
  const toolTimer = useRef<number>();
  const setToolValues = (tool: Preset | undefined, patch: Partial<Settings>, extra: { tiltOffset?: number; barrel?: number } = {}) => {
    // With no tool chosen the HUD shows the page's own settings, so that's where its edits go.
    if (!tool) {
      updateSettings(patch);
      return;
    }
    const name = tool.name;
    const merged = { ...tool.settings, ...patch };
    const tilt = tool.tilt && extra.tiltOffset !== undefined ? { ...tool.tilt, offset_mm: extra.tiltOffset } : tool.tilt;
    const barrel = extra.barrel ?? tool.barrel_mm;
    // The first tool's values are the page's settings; the second tool's are read from its preset.
    if (tool === active) updateSettings(patch);
    setPresets((list) => list.map((p) => (p.name === name ? { ...p, settings: merged, tilt, barrel_mm: barrel } : p)));
    window.clearTimeout(toolTimer.current);
    toolTimer.current = window.setTimeout(() => {
      api(`/api/presets/${encodeURIComponent(name)}?plotter=connected`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...merged, ...(tilt ? { tilt_offset_mm: tilt.offset_mm } : {}), ...(barrel ? { barrel_mm: barrel } : {}) }),
      }).catch(() => setLocalMessage({ text: `Couldn't save the ${name} settings.`, tone: "error" }));
    }, 500);
  };

  // The palette view stands in for the drawing preview while the tool's colors are being worked on.
  // Edits save a moment after the last keystroke, so typing a name isn't a request per letter.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSaving, setPaletteSaving] = useState(false);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const paletteTimer = useRef<number>();
  const savePalette = (palette: PenColor[]) => {
    if (!active) return;
    const tool = active.name;
    setPaletteSaving(true);
    setPaletteError(null);
    window.clearTimeout(paletteTimer.current);
    paletteTimer.current = window.setTimeout(async () => {
      try {
        const r = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(tool)}/palette`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ palette }),
        });
        setPresets(r.presets);
      } catch (err) {
        setPaletteError((err as Error).message);
      } finally {
        setPaletteSaving(false);
      }
    }, 500);
  };

  const tipOffsetFor = (id: string | null) => {
    const tool = usesSecond(id) ? secondPreset : active;
    return tiltOn(tool) ? tool!.tilt!.offset_mm : 0;
  };
  // A fat barrel puts the tip further down the page than the pen the paper is lined up for.
  const tipOffsetYFor = (id: string | null) => barrelOffsetMm((usesSecond(id) ? secondPreset : active)?.barrel_mm);
  // Small paths slows everything that makes tiny marks violent: how hard the carriage starts and stops,
  // how fast it travels and draws, and how hard the pen is raised and lowered. Pen heights don't change.
  const slowForSmallPaths = (s: Settings): Settings => {
    if (!smallPaths) return s;
    const f = 1 - smallPaths / 100;
    const slow = (v: number) => Math.max(1, Math.round(v * f));
    return {
      ...s,
      accel: slow(s.accel),
      speed_pendown: slow(s.speed_pendown),
      speed_penup: slow(s.speed_penup),
      pen_rate_raise: slow(s.pen_rate_raise),
      pen_rate_lower: slow(s.pen_rate_lower),
    };
  };
  const settingsFor = (id: string | null): Settings => {
    const tool = usesSecond(id) ? secondPreset : active;
    return slowForSmallPaths({
      ...(usesSecond(id) && secondPreset ? { ...settings, ...secondPreset.settings } : settings),
      drag_only: dragOn(tool),
    });
  };
  // What the next plot will actually be sent: the tool's preset, the second tool where one
  // is assigned, and any small-paths slow-down already folded in. The readout shows these.
  const plotSettings = settingsFor(plotLayerId);
  refs.current.plotSettings = plotSettings;
  const layerInkBuilds = useMemo(
    () => Object.fromEntries(layerViews.map((l) => [l.id, (usesSecond(l.id) ? secondPreset : active)?.settings.ink_builds])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerViews, secondTool, secondToolLayers, secondPreset, active],
  );
  const layerInkOpaque = useMemo(
    () => Object.fromEntries(layerViews.map((l) => [l.id, (usesSecond(l.id) ? secondPreset : active)?.settings.ink_opaque])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerViews, secondTool, secondToolLayers, secondPreset, active],
  );
  const layerInkOpacity = useMemo(
    () => Object.fromEntries(layerViews.map((l) => [l.id, (usesSecond(l.id) ? secondPreset : active)?.settings.ink_opacity])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerViews, secondTool, secondToolLayers, secondPreset, active],
  );
  const layerInkBuild = useMemo(
    () => Object.fromEntries(layerViews.map((l) => [l.id, (usesSecond(l.id) ? secondPreset : active)?.settings.ink_build])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerViews, secondTool, secondToolLayers, secondPreset, active],
  );
  const layerPenWidths = useMemo(
    () => Object.fromEntries(layerViews.map((l) => [l.id, (usesSecond(l.id) ? secondPreset : active)?.settings.pen_width])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerViews, secondTool, secondToolLayers, secondPreset, active],
  );
  const assignLayerTool = (id: string, second: boolean) => {
    setSecondToolLayers((list) => (second ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id)));
  };

  const applyPreset = (name: string) => {
    const preset = presets.find((p) => p.name === name);
    setActivePreset(preset ? preset.name : null);
    if (preset) {
      updateSettings(preset.settings);
      // A new tool is about to be seated with the sizing block, which only works from the setup height:
      // wherever the clip was left - down after a pen test, or at the last tool's lifted height - the
      // pen ends up seated too low or too high. So the clip goes to the setup height as the tool is
      // picked, with the new tool's settings (this render's are still the old tool's).
      if (plotterReady && !busy) {
        manual("pen_setup", { settings: { ...settings, ...preset.settings } });
        setLocalMessage({ text: `Using “${preset.name}”. The clip is going to the setup height: seat the pen with your sizing block.`, tone: "ok" });
      } else {
        setLocalMessage({ text: `Using “${preset.name}”. Move to setup height before you seat the pen.`, tone: "ok" });
      }
    }
  };

  const savePreset = async (name: string) => {
    name = name.trim();
    if (!name) return false;
    if (presets.some((p) => p.name === name) && name !== activePreset && !window.confirm(`Replace the preset “${name}”?`)) return false;
    try {
      const payload = Object.fromEntries(PRESET_FIELDS.map((k) => [k, settings[k]]));
      const res = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(name)}?plotter=connected`, {
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
    if (!name || !window.confirm(`Delete the preset “${name}”? The first tool in the list will be chosen instead.`)) return;
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
      <Hints />
      <FileBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onOpened={onOpened}
        // Files ticked in the browser open as one drawing, a layer each, or go on top of this one.
        // The server saves the result and opens it, so it arrives like any other opened drawing.
        combine={{
          endpoint: "/api/combine",
          canAdd: Boolean(fileName),
          onCombined: (res) => {
            refs.current.opened = res.opened;
            startNewDrawing(res.name, res.plot ?? null);
            setMisfits(res.mismatched.length && res.path ? { drawing: res.name, path: res.path, files: res.mismatched } : null);
          },
        }}
      />
      <Header plotterFound={Boolean(status?.plotter_found)} severalPlotters={severalPlotters} plotterName={onIdraw ? "iDraw" : undefined} lostContact={lostContact} />

      <main className={styles.layout}>
        <section className={styles.stage} aria-label={paletteOpen ? "Drawing tool colors" : "Drawing preview"}>
          <div className={styles.bedArea}>
            {paletteOpen ? (
              <PaletteEditor
                key={active?.name}
                tool={active}
                paper={settings.paper_color}
                disabled={plotting}
                saving={paletteSaving}
                error={paletteError}
                onChange={savePalette}
              />
            ) : (
            <Bed
              loupe={loupe}
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
              layerOrder={layerOrder}
              penWidthMm={active?.settings.pen_width ?? settings.pen_width}
              inkOpacity={active?.settings.ink_opacity ?? settings.ink_opacity}
              layerInkOpacity={secondTool ? layerInkOpacity : undefined}
              inkBuilds={active?.settings.ink_builds ?? settings.ink_builds}
              inkOpaque={active?.settings.ink_opaque ?? settings.ink_opaque}
              // The tool's own, never one left in the page's settings by the tool chosen before it: a
              // tool without a build-up value has none.
              inkBuild={active ? active.settings.ink_build : settings.ink_build}
              layerInkBuild={secondTool ? layerInkBuild : undefined}
              inkSim={view === "preview"}
              layerInkBuilds={secondTool ? layerInkBuilds : undefined}
              layerInkOpaque={secondTool ? layerInkOpaque : undefined}
              layerPenWidths={secondTool ? layerPenWidths : undefined}
              plotPaths={shownPlotPaths}
              hairlines={view === "outline" || layerMode === "work"}
              plotFraction={plotFraction}
              // The same bar as Studio's, over the same bed: how the drawing is drawn and how close
              // the view sits, and while a plot has paths to show, how far it has got.
              toolbarLeft={
                <PreviewToolbar
                  view={view}
                  onView={setView}
                  canProgress={status?.plot_paths ? true : undefined}
                  zoom={zoom}
                  onZoom={setZoomChoice}
                  canPaper={settings.paper_w > 0 && settings.paper_h > 0}
                  canDrawing={Boolean(fp)}
                  working={updating && fp ? "Updating plot time…" : undefined}
                  loupe={loupe}
                  onLoupe={setLoupe}
                />
              }
            />
            )}
            {!paletteOpen && hudOpen && (
              <SettingsHud
                settings={plotSettings}
                handling={info?.handling ?? []}
                tool={usesSecond(plotLayerId) ? secondTool : activePreset}
                secondTool={usesSecond(plotLayerId) ? null : secondTool}
                smallPaths={smallPaths}
                own={usesSecond(plotLayerId) && secondPreset ? { ...settings, ...secondPreset.settings } : settings}
                preset={usesSecond(plotLayerId) ? secondPreset : active}
                units={settings.units}
                disabled={plotting}
                onToolValues={(patch, extra) => setToolValues(usesSecond(plotLayerId) ? secondPreset : active, patch, extra)}
              />
            )}
          </div>

          {/* What is set less often, in sections that start folded - the same sections as the cards
            beside the preview, rather than rows of their own - set on the page rather than in a card. */}
          {(!paletteOpen || (preview && estimate)) && (
          <div className={styles.lessOften}>
            <div className={`${styles.cardBody} ${controls.cardSections}`}>
              {!paletteOpen && <>
              {/* Where it goes and how it's plotted only mean something once there's a drawing. */}
              {fileName && <>
              <Section title="Drawing position" collapsibleKey="plot-position" defaultOpen={false}>
                <PositionSection
                  placement={placement}
                  minPlacement={minPlace}
                  units={settings.units}
                  disabled={plotting}
                  onChange={(p) => setPlacement(p)}
                  paperX={settings.paper_x}
                  paperY={settings.paper_y}
                  onPaperChange={updateSettings}
                  onCentre={centreOnPaper}
                />
              </Section>

              <Section title="Plot options" collapsibleKey="plot-options" defaultOpen={false}>
                <PlotOptionsSection
                  settings={settings}
                  disabled={plotting}
                  onChange={updateSettings}
                  handling={info?.handling ?? []}
                  skipTiny={skipTiny}
                  onSkipTiny={setSkipTiny}
                  skipped={estimate?.skipped_tiny ?? null}
                />
              </Section>
              </>}

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
              </>}

              <PlotSummary
                estimate={preview ? estimate : null}
                preview={preview}
                units={settings.units}
                rotated={Boolean(fp?.rotated)}
              />
            </div>
          </div>
          )}
        </section>

        <div className={styles.side}>
          <PlotProgress status={status} />
          <ActionBar
            message={actionMessage}
            plotting={plotting}
            stopping={status?.state === "stopping" || status?.state === "returning"}
            canPlot={!busy && Boolean(fileName) && Boolean(preview) && onBed && plotterReady && !needsLayerChoice && !nothingShown}
            plotLabel={!plotterReady ? "Connect the plotter" : nothingShown ? "Show a layer to plot" : needsLayerChoice ? "Choose a layer to plot" : printTarget && plotLayerId ? `Plot ${layerNumber(printTarget.id)} · ${printTarget.name}${printIds.length > 1 ? ` · ${printIds.length} layers` : ""}` : "Plot"}
            preparing={status?.state === "preparing"}
            resume={resume}
            confirmation={confirmation}
            onCancelConfirmation={() => setConfirmation(null)}
            onPlot={startPlot}
            onResume={resumePlot}
            onDiscard={discardResume}
            onStop={stopPlot}
            speedPct={plotting ? shownSpeed(status?.speed_pct ?? 100) : resume ? shownSpeed(resume.speed_pct ?? 100) : null}
            onSpeed={setPlotSpeed}
          />
          {/* The drawing, and what it is plotted on and with: one card, as in Studio. The
            settings fold away together, and each on its own. */}
          <Card variant="flat" className={`${styles.controls} ${styles.fileCard}`}>
            <div className={`${styles.cardBody} ${controls.cardSections}`}>
              <FileSection
                notes={<DrawingNotes notes={notes} className={styles.fileNotes} />}
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
                // Only a drawing that lives in a folder: an uploaded copy has nowhere for Studio to read it from.
                onEditInStudio={status?.file_path ? () => openInStudio(status.file_path!) : undefined}
              />
              {shownMisfits && (
                <div className={styles.misfits} role="status">
                  <p>
                    {`${listOf(shownMisfits.files)} ${shownMisfits.files.length === 1 ? "isn’t" : "aren’t"} on a page the size of the first file’s, so ${shownMisfits.files.length === 1 ? "it" : "they"} may not line up.`}
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => openInStudio(shownMisfits.path)}>
                    Line up in Studio
                  </Button>
                </div>
              )}
              {/* The same Settings, Paper and Drawing tool cards as Studio's. Grid is Studio's alone;
                  the units, and the plotting-only rows of the tool card, are Plot's alone. */}
              {fileName && (
              <SettingsSection collapsibleKey="plot-settings">
                <PaperSection
                  w={settings.paper_w}
                  h={settings.paper_h}
                  sizeId={paperSizeId}
                  units={settings.units}
                  color={settings.paper_color}
                  collapsibleKey="plot-paper"
                  disabled={plotting}
                  onSize={pickPaperSize}
                  // Turned or typed, the paper is named by its size: Custom, unless it is one of the list's.
                  onDimensions={(paper_w, paper_h) => updateSettings({ paper_size: "custom", paper_w, paper_h })}
                  onColor={(paper_color) => updateSettings({ paper_color })}
                  onUnits={(units) => updateSettings({ units })}
                  onFit={fitToPaper}
                />
                <PresetSection
                  label={toolLabel}
                  presets={presets}
                  active={active}
                  secondTool={secondTool}
                  secondLayers={secondToolLayers}
                  layers={layerViews.map((l, i) => ({ id: l.id, number: i + 1, color: l.color }))}
                  inUse={layerMode === "work" && printTarget ? (usesSecond(printTarget.id) ? "second" : "first") : null}
                  onAddSecond={() => setSecondTool("")}
                  onSecondTool={(name) => setSecondTool(name)}
                  onRemoveSecond={() => {
                    setSecondTool(null);
                    setSecondToolLayers([]);
                  }}
                  onAssign={assignLayerTool}
                  smallPaths={smallPaths}
                  onSmallPaths={setSmallPaths}
                  tiltOn={tiltOn}
                  onTilt={(name, on) => setTiltChoice((c) => ({ ...c, [name]: on }))}
                  dragOn={dragOn}
                  onDrag={(name, on) => setDragChoice((c) => ({ ...c, [name]: on }))}
                  paletteOpen={paletteOpen}
                  hudOpen={hudOpen}
                  onHud={() => setHudOpen((open) => !open)}
                  onPalette={() => setPaletteOpen((open) => !open)}
                  onInk={setInk}
                  changed={presetChanged}
                  disabled={plotting}
                  onApply={applyPreset}
                  onSave={savePreset}
                  onDelete={deletePreset}
                />
              </SettingsSection>
              )}
            </div>
          </Card>
          {fileName && layerViews.length > 0 && (
            <Card variant="flat" className={styles.controls}>
              <div className={`${styles.cardBody} ${controls.cardSections}`}>
                <LayersSection
                  mode={layerMode}
                  onMode={setLayerMode}
                  layers={layerViews}
                  target={printLayer}
                  linksOf={(id) => linksOf.get(id) ?? []}
                  onLink={linkLayers}
                  onUnlink={unlinkLayers}
                  // What the next plot draws: the chosen layer and its links, or - in a drawing with only
                  // one layer to plot, where nothing has to be chosen - that layer.
                  printing={printIds.length ? printIds : plottableLayers.length === 1 ? [plottableLayers[0].id] : []}
                  hatchSpacing={hatchSpacing}
                  onHatch={setLayersHatch}
                  printed={status?.printed_layers ?? []}
                  onTarget={setPrintLayer}
                  onVisible={setLayerVisible}
                  paletteFor={paletteFor}
                  toolFor={(id) => (usesSecond(id) ? secondPreset : active)?.name ?? "this tool"}
                  onColor={colorAndNameLayer}
                  onSort={sortLayersByLightness}
                  onResetPrinted={resetPrinted}
                  disabled={plotting}
                />
              </div>
            </Card>
          )}
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
