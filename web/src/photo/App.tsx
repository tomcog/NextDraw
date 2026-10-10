import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, InputText } from "@tomcoggia/ui";
import { Save, Send } from "lucide-react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { FileSection } from "../shared/components/controls/FileSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { FileBrowser, type OpenResult } from "../shared/components/FileBrowser";
import { HistoryToolbar, SetupToolbar, type View } from "../shared/components/PreviewToolbar";
import { AppSwitch } from "../shared/components/AppSwitch";
import { StatusBanner } from "../shared/components/StatusBanner";
import { ThemeToggle } from "../shared/components/ThemeToggle";
import { api } from "../shared/lib/api";
import { openInStudio } from "../shared/lib/apps";
import { PAPER_SIZES } from "../shared/lib/constants";
import { load, save as remember } from "../shared/lib/storage";
import type { Info, PlotterModel, Preset } from "../shared/lib/types";
import type { Zoom } from "../shared/components/BedCanvas";
import { DEFAULT_SETTINGS } from "../shared/lib/constants";
import { useHistory } from "../shared/lib/useHistory";
import { loadFont, type StrokeFont } from "../shared/lib/drawing/font";
import type { Fill } from "../shared/lib/drawing/hatch";
import { parseDrawing } from "../shared/lib/drawing/parse";
import { photoMarks, placeOnPage, stemWithoutPlate, type Photo } from "../shared/lib/drawing/photo";
import { boxOf, newLayerId, shapeName, type Layer, type Page, type Shape } from "../shared/lib/drawing/shapes";
import { buildSvg } from "../shared/lib/drawing/svg";
import { fitText } from "../shared/lib/drawing/text";
import { useDrawingFile } from "../shared/lib/drawing/useDrawingFile";
import { usePhotoRead } from "../shared/lib/drawing/usePhotoRead";
import { calibrationSheet } from "./lib/calibration";
import { pairsSheet } from "./lib/penPairs";
import { readCalibration, readingProblems, sheetLayout } from "./lib/calibrationRead";
import { photoActions } from "./lib/photoActions";
import { CalibrationSection } from "./components/CalibrationSection";
import { ConvertStage, type ConvertView } from "./components/ConvertStage";
import { EffectToolbar, PanelToolbar, effectOf, type Effect } from "./components/EffectToolbar";
import { dropWork, keepWork, loadWork, type Work } from "./lib/workInProgress";
import { PhotoCard } from "./components/PhotoCard";
import { PhotoHeader } from "./components/PhotoHeader";
import styles from "./App.module.css";

// NextDraw Photo: a photo turned into lines for the tool's pens, saved as an ordinary layered drawing
// that Plot plots and Studio opens. Image conversion and calibration both moved here from Studio
// (docs/photo.md). A photo drawing is Studio's drawing model, shared: Photo holds the whole drawing -
// anything Studio added to it too, which it saves back untouched - and works on its photos.

// Page sizes, in inches, from the list Plot offers, stored width-first as Studio stores them.
const SIZES = PAPER_SIZES.filter((p) => p.w && p.h).map((p) => ({ id: p.id, name: p.name, w: p.w! / 25.4, h: p.h! / 25.4 }));
const sizeIdOf = (page: Page) =>
  SIZES.find((s) => (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) || (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01))?.id ?? "custom";

// This browser's choices, Photo's own: the tool and paper on the plotter for photos needn't be the
// ones Studio was last drawing with. The drawing worked on last is picked up again on return.
const TOOL_KEY = "photo-tool";
const PAPER_COLOR_KEY = "photo-paper-color";
const LAST_FILE_KEY = "photo-last-file";

// The words on a calibration sheet, in the font every sheet so far has been made in.
const SHEET_FONT = "EMSOsmotron";

// A new drawing's one layer, as in Studio: a photo put in is matched to the tool's pens from there.
const firstLayer = (): Layer => ({ id: newLayerId(), name: "Black", color: "#262626" });

/** A calibration or pen pairs sheet: an ordinary drawing, made or opened here. */
interface Sheet {
  shapes: Shape[];
  fills: Fill[];
  layers: Layer[];
  page: Page;
}

const NO_SHAPES: Shape[] = [];
const NO_FILLS: Fill[] = [];
const NO_LAYERS: Layer[] = [];

/**
 * The sheet as the stage shows it: the file that will be saved, its lines drawn at the pen's width,
 * without the unplotted layer of shapes the hatching was made from.
 */
function sheetPicture(svg: string, penWidthMm: number): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  doc.getElementById("studio-sources")?.remove();
  for (const el of doc.querySelectorAll("[stroke-width]")) el.setAttribute("stroke-width", String(penWidthMm / 25.4));
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
}

/** What waits on the question about unsaved work: a new drawing, photos opened, or a file opened. */
type Next = { kind: "new" } | { kind: "photos"; files: File[] } | { kind: "open"; res: OpenResult };

export default function App() {
  const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
  const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
  useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
  const sizeId = useMemo(() => sizeIdOf(page), [page]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean; progress?: boolean }>({ text: "", ok: true });
  const banner = useMemo(
    () => (message.text && (!message.ok || message.progress) ? { text: message.text, error: !message.ok, working: message.progress } : null),
    [message],
  );

  // Whether a plotter is on USB, for the header and the tool list - asked now and then, as Studio does.
  const [plotterFound, setPlotterFound] = useState<boolean | null>(null);
  const [plotterOnUsb, setPlotterOnUsb] = useState<string | null>(null);
  useEffect(() => {
    const ask = () =>
      api<{ plotter_found: boolean; plotter: string | null }>("/api/status")
        .then((st) => {
          setPlotterFound(Boolean(st.plotter_found));
          setPlotterOnUsb(st.plotter ?? null);
        })
        .catch(() => {
          setPlotterFound(false);
          setMessage({ text: "Can’t reach the server. Is server.py running?", ok: false });
        });
    ask();
    const timer = window.setInterval(ask, 5000);
    return () => window.clearInterval(timer);
  }, []);

  // The drawing tools, read as Studio reads them: the plugged-in plotter's, or all of them, again
  // every few seconds and taken only when the shared presets file has changed.
  const [presets, setPresets] = useState<Preset[]>([]);
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  // Whether the rail's top card - File, the conversion summary and Settings - is out. Out unless hidden.
  const [fileCard, setFileCard] = useState(() => load<boolean>("photo-file-card") ?? true);
  useEffect(() => remember("photo-file-card", fileCard), [fileCard]);
  // The Paper and Pen cards under it: what the drawing is made on, and with.
  const [paperCard, setPaperCard] = useState(() => load<boolean>("photo-paper-card") ?? true);
  useEffect(() => remember("photo-paper-card", paperCard), [paperCard]);
  const [penCard, setPenCard] = useState(() => load<boolean>("photo-pen-card") ?? true);
  useEffect(() => remember("photo-pen-card", penCard), [penCard]);
  // And the photo's own card, under it: turning, brightness and contrast, size on the page.
  const [infoCard, setInfoCard] = useState(() => load<boolean>("photo-info-card") ?? true);
  useEffect(() => remember("photo-info-card", infoCard), [infoCard]);
  // And the effect's cards - its own and Layers - put away by clicking its button in the toolbar again.
  const [effectCards, setEffectCards] = useState(() => load<boolean>("photo-effect-cards") ?? true);
  useEffect(() => remember("photo-effect-cards", effectCards), [effectCards]);

  const [toolName, setToolName] = useState<string>(() => load<string>(TOOL_KEY) ?? "");
  useEffect(() => remember(TOOL_KEY, toolName), [toolName]);
  const presetsSeen = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      api<{ presets: Preset[] }>("/api/presets?plotter=connected")
        .then(({ presets: list }) => {
          const text = JSON.stringify(list);
          if (cancelled || text === presetsSeen.current) return;
          presetsSeen.current = text;
          setPresets(list);
          setToolName((current) => (list.some((t) => t.name === current) ? current : list[0]?.name ?? ""));
        })
        .catch(() => {});
    read();
    const timer = window.setInterval(read, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [plotterOnUsb]);
  const tool = presets.find((t) => t.name === toolName) ?? null;
  const penWidthMm = tool?.settings.pen_width ?? 0.5;

  // ---- The photo drawing ----

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [layers, setLayers] = useState<Layer[]>(() => [firstLayer()]);
  const [activeLayer, setActiveLayer] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const pick = useCallback((id: string | null) => setSelected(id), []);

  // Undo over whole copies of the drawing, as in Studio.
  const snapshot = useMemo(() => ({ shapes, fills, layers, page }), [shapes, fills, layers, page]);
  const restore = useCallback((next: typeof snapshot) => {
    setShapes(next.shapes);
    setFills(next.fills);
    setLayers(next.layers);
    setPage(next.page);
  }, []);
  const { record, undo, redo, clear: clearHistory, canUndo, canRedo } = useHistory(snapshot, restore);

  // The stroke fonts any words in the drawing are in - Studio's, kept when it's saved again.
  const [fonts, setFonts] = useState<Record<string, StrokeFont>>({});
  useEffect(() => {
    const wanted = new Set([SHEET_FONT, ...shapes.map((s) => s.font ?? "")].filter(Boolean));
    for (const name of wanted) {
      if (fonts[name]) continue;
      loadFont(name)
        .then((loaded) => setFonts((all) => ({ ...all, [name]: loaded })))
        .catch(() => {});
    }
  }, [shapes, fonts]);

  // Whether the unsaved work on screen is kept in the browser as it stands, so a reload loses nothing
  // and needn't be asked about (see workInProgress.ts).
  const [kept, setKept] = useState(false);
  const file = useDrawingFile({ shapes, fills, layers, page, sizeId, toolName, fonts, setBusy, setMessage, lastFileKey: LAST_FILE_KEY, holdOnLeave: !kept });

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

  const setSize = (id: string) => {
    const size = SIZES.find((s) => s.id === id);
    if (!size) return;
    record();
    // Keep the way the paper lies, so choosing a size doesn't also turn it.
    const landscape = page.w >= page.h;
    setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
  };

  // The photo being converted: the one picked, or the first in the drawing.
  const firstPhoto = shapes.find((s) => s.kind === "photo" && s.photo) ?? null;
  const picked = selected ? shapes.find((s) => s.id === selected && s.kind === "photo" && s.photo) ?? null : null;
  const chosen = picked ?? firstPhoto;
  const active = (chosen ? layers.find((l) => l.id === chosen.layerId) : undefined) ?? layers.find((l) => l.id === activeLayer) ?? layers[0];
  const onActive = shapes.filter((sh) => sh.layerId === active?.id);

  // All of the photo's layers, bottom first, each in its pen: the lines it comes out as, together.
  const convertBox = chosen ? boxOf(chosen) : null;
  const convertParts = useMemo(
    () =>
      chosen
        ? layers.flatMap((l) =>
            shapes
              .filter((sh) => sh.layerId === l.id && sh.kind === "photo" && sh.photo && (sh.id === chosen.id || (chosen.photo!.group && sh.photo.group === chosen.photo!.group)))
              .map((sh) => ({ photo: sh.photo!, color: l.color, name: l.name })),
          )
        : [],
    [shapes, layers, chosen],
  );
  usePhotoRead(chosen?.photo?.src);
  const convertMarks = convertBox ? convertParts.map((part) => photoMarks(part.photo, convertBox.x1 - convertBox.x0, convertBox.y1 - convertBox.y0)) : [];
  const convertRead = convertMarks.length > 0 && convertMarks.every(Boolean);
  const [convertView, setConvertView] = useState<ConvertView>("picture");
  // The bed the photo is shown on, and how close the view sits on it - Studio's and Plot's zooms and loupe.
  const [model, setModel] = useState<PlotterModel | undefined>();
  useEffect(() => {
    api<Info>("/api/info")
      .then((info) => setModel(info.models.find((m) => m.id === DEFAULT_SETTINGS.model) ?? info.models[0]))
      .catch(() => {});
  }, []);
  // How the lines are drawn - Outline or Preview, as in Studio and Plot - and how close the view sits.
  const [view, setView] = useState<View>("outline");
  const [zoom, setZoom] = useState<Zoom>("paper");
  const [loupe, setLoupe] = useState(false);

  // Whether a photo's settings go to all its layers at once - the whole drawing, as they do unless
  // "Set each layer on its own" is ticked - or to the layer being set.
  const [photoAll, setPhotoAll] = useState(true);

  const addShape = useCallback((shape: Shape) => {
    record();
    setShapes((list) => [...list, shape]);
    pick(shape.id);
  }, [record, pick]);

  const {
    addPhoto, addSeparations, setSeparationPlate, switchPhotoMode, setKeyLayer, splitPhoto, splitPhotoByColor, splitPhotoBestFit, bestPens,
    placePhoto, photoScale, setPhotoScale, setPhotoMargin, replacePhoto, turnPhoto, setPhotoOf, setAngles,
  } = photoActions({
    chosen, shapes, setShapes, layers, setLayers, active, setActiveLayer, page, tool,
    spacingMm: tool?.hatch?.spacing_mm ?? 1.5, all: photoAll, paper: paperColor, record, addShape, pick, setMessage, setBusy,
  });

  // A new, empty drawing on the paper as it is.
  const newDrawing = useCallback(() => {
    const only = [firstLayer()];
    setShapes(NO_SHAPES);
    setFills(NO_FILLS);
    setLayers(only);
    setActiveLayer(only[0].id);
    setSelected(null);
    clearHistory();
    file.started("Untitled", { shapes: NO_SHAPES, fills: NO_FILLS, layers: only, page });
  }, [clearHistory, file, page]);

  // Photos opened: a new drawing named after them, and the photo put in once it's in place - one
  // photo, or several separations (…_C, …_M, …_Y, …_K) for a layer each.
  const [pendingPhotos, setPendingPhotos] = useState<File[] | null>(null);
  const startPhotos = (files: File[]) => {
    newDrawing();
    // A new photo is first seen as it is, before any effect: the first view in the bar.
    setConvertView("picture");
    file.setName(files.length > 1 ? stemWithoutPlate(files[0].name) : files[0].name.replace(/\.[^.]+$/, ""));
    setPendingPhotos(files);
  };
  useEffect(() => {
    if (!pendingPhotos || shapes.length) return;
    const files = pendingPhotos;
    setPendingPhotos(null);
    if (files.length > 1) addSeparations(files);
    else addPhoto(files[0]);
  }, [pendingPhotos, shapes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A drawing opened to carry on with: one with a photo in it. Anything else is Studio's to edit.
  const openDrawing = useCallback((res: OpenResult) => {
    const drawing = parseDrawing(res.svg ?? "");
    if (!drawing.shapes.some((s) => s.kind === "photo")) {
      setMessage({ text: `${res.name} has no photo in it. Studio is where it’s edited.`, ok: false });
      return;
    }
    setPage(drawing.page);
    setShapes(drawing.shapes);
    setFills(drawing.fills);
    setLayers(drawing.layers);
    setActiveLayer(drawing.layers[0]?.id ?? "");
    setSelected(null);
    clearHistory();
    file.opened(res, drawing);
    const saved = drawing.tool;
    if (saved) setToolName((current) => (presetsRef.current.length && !presetsRef.current.some((t) => t.name === saved) ? current : saved));
    setMessage(
      drawing.unsupported
        ? { text: `${drawing.unsupported} ${drawing.unsupported === 1 ? "mark" : "marks"} in ${res.name} can’t be redrawn here, and saving would drop ${drawing.unsupported === 1 ? "it" : "them"}`, ok: false }
        : { text: "", ok: true },
    );
  }, [clearHistory, file]);

  // Unsaved work kept from before a reload, put back as it was: the drawing, its file, the photo picked.
  const resumeWork = useCallback((work: Work) => {
    setPage(work.page);
    setShapes(work.shapes);
    setFills(work.fills);
    setLayers(work.layers);
    setActiveLayer(work.activeLayer);
    setSelected(work.selected);
    clearHistory();
    file.resumed(work.file);
  }, [clearHistory, file]);

  // On starting: a drawing handed over in the address - Studio's "Save and open in Photo" - or else
  // unsaved work kept from before a reload, or else the one worked on here last. The address is put
  // back as it was, so reloading doesn't open it again. Until this has run, nothing is kept or dropped.
  const startedUp = useRef(false);
  const workReady = useRef(false);
  useEffect(() => {
    if (startedUp.current) return;
    startedUp.current = true;
    const handed = new URLSearchParams(window.location.search).get("open");
    if (handed) window.history.replaceState(null, "", window.location.pathname);
    const openLast = () => {
      workReady.current = true;
      const last = handed ?? load<string>(LAST_FILE_KEY);
      if (!last) return;
      api<OpenResult>(`/api/studio/read?path=${encodeURIComponent(last)}`)
        .then(openDrawing)
        .catch((err) => setMessage({ text: handed ? (err as Error).message : "Couldn’t reopen the last drawing. Use Open… to pick it up.", ok: false }));
    };
    if (handed) return openLast();
    loadWork()
      .then((work) => {
        if (!work?.shapes.length) return openLast();
        resumeWork(work);
        workReady.current = true;
      })
      .catch(openLast);
  }, [openDrawing, resumeWork]);

  // Keep the drawing in the browser while it has unsaved changes, a moment after each change; forget
  // it once it's saved or started afresh. A write overtaken by a later change doesn't count as kept.
  const keeping = useRef(0);
  useEffect(() => {
    if (!workReady.current) return;
    const mine = ++keeping.current;
    if (!file.dirty || !shapes.length) {
      dropWork().catch(() => {});
      return;
    }
    setKept(false);
    const timer = window.setTimeout(() => {
      keepWork({ shapes, fills, layers, page, file: file.fileState, activeLayer, selected })
        .then(() => mine === keeping.current && setKept(true))
        .catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [shapes, fills, layers, page, file.dirty, file.fileState.name, file.fileState.saved, activeLayer, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Replacing a drawing with unsaved changes asks first, as Studio does.
  const [confirmNext, setConfirmNext] = useState<Next | null>(null);
  const goOn = (next: Next) => {
    setConfirmNext(null);
    if (next.kind === "new") newDrawing();
    else if (next.kind === "photos") startPhotos(next.files);
    else openDrawing(next.res);
  };
  const ask = (next: Next) => (file.dirty && shapes.length ? setConfirmNext(next) : goOn(next));
  const confirmBlock = confirmNext && (
    <div className={styles.confirm} role="alertdialog" aria-label="Replace this drawing">
      <p>{file.saved ? `“${file.name}” has` : "This drawing has"} changes that aren’t saved.</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (await file.save()) goOn(confirmNext);
          }}
        >
          Save, then carry on
        </Button>
        <Button size="sm" tone="danger" variant="secondary" onClick={() => goOn(confirmNext)}>
          Discard and carry on
        </Button>
        <Button size="sm" variant="tertiary" onClick={() => setConfirmNext(null)}>
          Keep editing
        </Button>
      </div>
    </div>
  );

  const editInStudio = async () => {
    const where = file.dirty || !file.saved ? await file.save() : file.saved;
    if (where) openInStudio(where.path);
  };

  // ---- Setup: calibration ----

  const [setupOpen, setSetupOpen] = useState(false);
  const sheetFont = fonts[SHEET_FONT] ?? null;
  const sheetFonts = useMemo(() => {
    const loaded: Record<string, StrokeFont> = {};
    if (sheetFont) loaded[SHEET_FONT] = sheetFont;
    return loaded;
  }, [sheetFont]);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const sheetFile = useDrawingFile({
    shapes: sheet?.shapes ?? NO_SHAPES,
    fills: sheet?.fills ?? NO_FILLS,
    layers: sheet?.layers ?? NO_LAYERS,
    page: sheet?.page ?? page,
    sizeId: sizeIdOf(sheet?.page ?? page),
    toolName,
    fonts: sheetFonts,
    setBusy,
    setMessage,
  });

  // A new sheet, or one opened, replaces one with unsaved changes only after asking.
  type NextSheet = "calibration" | "pairs" | OpenResult;
  const [confirmSheet, setConfirmSheet] = useState<NextSheet | null>(null);
  const makeSheet = (kind: "calibration" | "pairs") => {
    setConfirmSheet(null);
    if (!tool || !sheetFont) return;
    const made = kind === "calibration" ? calibrationSheet(tool, page, SHEET_FONT) : pairsSheet(tool, page, SHEET_FONT);
    if ("error" in made) {
      setMessage({ text: made.error, ok: false });
      return;
    }
    setSheet({ shapes: made.shapes.map((sh) => (sh.kind === "text" ? fitText(sh, sheetFont) : sh)), fills: made.fills, layers: made.layers, page });
    sheetFile.started(`${tool.name} ${kind === "calibration" ? "calibration" : "color pairs"}`); // a new sheet to be saved and plotted
    setMessage({ text: "", ok: true });
  };
  const openSheet = (res: OpenResult) => {
    setConfirmSheet(null);
    const drawing = parseDrawing(res.svg ?? "");
    if (!sheetLayout(drawing.shapes)) {
      setMessage({ text: `${res.name} isn’t a calibration sheet: it has no corner marks and named patches.`, ok: false });
      return;
    }
    setSheet({ shapes: drawing.shapes, fills: drawing.fills, layers: drawing.layers, page: drawing.page });
    sheetFile.opened(res, drawing);
    if (drawing.tool && presets.some((t) => t.name === drawing.tool)) setToolName(drawing.tool);
    setMessage({ text: "", ok: true });
  };
  const goOnSheet = (next: NextSheet) => (typeof next === "string" ? makeSheet(next) : openSheet(next));
  const askSheet = (next: NextSheet) => (sheet && sheetFile.dirty ? setConfirmSheet(next) : goOnSheet(next));

  // A photo of the plotted sheet, read back into the tool's preset: each pen as it really came out.
  // Only into the tool the sheet is of: one marker's colours read into another would overwrite them.
  const layout = useMemo(() => (sheet ? sheetLayout(sheet.shapes) : null), [sheet]);
  const sheetPens = useMemo(() => [...new Set(layout?.patches.map((p) => p.pen) ?? [])], [layout]);
  const strangers = sheetPens.filter((pen) => !(tool?.palette ?? []).some((p) => p.name === pen));
  const sheetIsTool = Boolean(layout && tool && sheetPens.length && !strangers.length);
  const readSheetPhoto = async (photo: File | undefined) => {
    if (!photo || !layout || !tool || !sheetIsTool) return;
    setBusy(true);
    setMessage({ text: `Reading ${photo.name}…`, ok: true, progress: true });
    try {
      const calibration = await readCalibration(photo, layout, paperColor);
      const res = await api<{ presets: Preset[] }>(`/api/presets/${encodeURIComponent(tool.name)}/calibration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calibration),
      });
      setPresets(res.presets);
      const problems = readingProblems(calibration);
      const count = Object.keys(calibration.pens).length;
      setMessage(problems.length ? { text: `Read ${count} colors, but ${problems.join(" ")}`, ok: false } : { text: `Read ${count} colors into ${tool.name}`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const sheetImage = useMemo(
    () => (sheet ? sheetPicture(buildSvg(sheet.shapes, sheet.fills, sheet.layers, sheet.page, { paperSizeId: sizeIdOf(sheet.page), toolName, fonts: sheetFonts }), penWidthMm) : null),
    [sheet, toolName, sheetFonts, penWidthMm],
  );

  // ---- The rail ----

  // One file browser, for whichever is being opened: a photo drawing, or a calibration sheet.
  const [browsing, setBrowsing] = useState<"drawing" | "sheet" | null>(null);

  const paperSection = (
    <PaperSection
      w={page.w * 25.4}
      h={page.h * 25.4}
      sizeId={sizeId}
      units="in"
      color={paperColor}
      collapsibleKey="photo-paper"
      disabled={busy}
      onSize={setSize}
      onDimensions={(w, h) => {
        record();
        setPage({ w: w / 25.4, h: h / 25.4 });
      }}
      onColor={setPaperColor}
    />
  );
  const toolSection = <DrawingToolSection tools={presets} value={toolName} onPick={setToolName} collapsibleKey="photo-pen" disabled={busy} />;

  const confirmSheetBlock = confirmSheet && (
    <div className={styles.confirm} role="alertdialog" aria-label={typeof confirmSheet === "string" ? "Make a new sheet" : `Open ${confirmSheet.name}`}>
      <p>{sheetFile.saved ? `“${sheetFile.name}” has` : "This sheet has"} changes that aren’t saved.</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (await sheetFile.save()) goOnSheet(confirmSheet);
          }}
        >
          {typeof confirmSheet === "string" ? "Save, then make new" : `Save, then open ${confirmSheet.name}`}
        </Button>
        <Button size="sm" tone="danger" variant="secondary" onClick={() => goOnSheet(confirmSheet)}>
          {typeof confirmSheet === "string" ? "Discard and make new" : `Discard and open ${confirmSheet.name}`}
        </Button>
        <Button size="sm" variant="tertiary" onClick={() => setConfirmSheet(null)}>
          Keep this sheet
        </Button>
      </div>
    </div>
  );

  // The sheet in hand: what it's called and where it is, saving it, and sending it to Plot.
  const sheetControls = sheet && (
    <>
      <InputText size="md" label="Sheet name" hideLabel value={sheetFile.name} disabled={busy} onChange={(e) => sheetFile.setName(e.target.value)} />
      <p className={controls.fileWhere} title={sheetFile.saved?.path ?? undefined}>
        {sheetFile.saved ? sheetFile.saved.folder : "Not saved yet"}
      </p>
      <div className={styles.actions}>
        <Button size="sm" icon={<Save />} disabled={busy || !sheetFile.dirty} onClick={() => sheetFile.save()}>
          Save
        </Button>
        <Button size="sm" variant="secondary" icon={<Send />} disabled={busy} onClick={sheetFile.sendToPlot}>
          Send to Plot
        </Button>
      </div>
    </>
  );

  // Setup: getting the drawing tools ready - calibrating their pens on the paper chosen here.
  const setupRail = (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section title="Setup">
          <p className={controls.hint}>Getting the pens ready. The photo stays as it is; the gear goes back to it.</p>
        </Section>
        {paperSection}
        {toolSection}
        <CalibrationSection
          tool={tool}
          toolName={toolName}
          busy={busy || !sheetFont}
          sheetOpen={Boolean(layout)}
          sheetIsTool={sheetIsTool}
          strangers={strangers}
          onNewSheet={() => askSheet("calibration")}
          onNewPairs={() => askSheet("pairs")}
          onOpenSheet={() => setBrowsing("sheet")}
          sheetFile={sheetControls}
          onReadPhoto={readSheetPhoto}
          confirm={confirmSheetBlock}
        />
        <Section title="Appearance" action={<ThemeToggle />}>
          <p className={controls.hint}>Light or dark. Plot and Studio follow the same choice.</p>
        </Section>
      </div>
    </Card>
  );

  // Split by best fit: how near the best pens come to the photo, with one fewer and one more than it
  // has, so what another pen buys can be seen. An estimate from a sample of the photo's pixels, each
  // at the share of paper that suits it best - the predicted print says what the hatching really makes.
  // Worked out off the page; a newer question's answer replaces an older one's, whichever comes first.
  const inks = chosen?.photo?.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group && !sh.photo?.key).length : 1;
  const [estimates, setEstimates] = useState<{ pens: number; err: number }[] | undefined>(undefined);
  const asked = useRef(0);
  useEffect(() => {
    const mine = ++asked.current;
    if (!chosen?.photo?.fitPaper || !convertRead) {
      setEstimates(undefined);
      return;
    }
    const counts = [inks - 1, inks, inks + 1].filter((n) => n >= 1 && n <= (tool?.palette?.length ?? 0));
    Promise.all(counts.map((n) => bestPens(n, Boolean(chosen.photo!.fitPairs), Boolean(chosen.photo!.fineSteps))))
      .then((found) => {
        if (mine !== asked.current) return;
        const out = found.flatMap((best, i) => (best?.errors.length ? [{ pens: counts[i], err: best.errors[best.errors.length - 1] }] : []));
        setEstimates(out.length ? out : undefined);
      })
      .catch(() => mine === asked.current && setEstimates(undefined));
  }, [chosen?.photo?.src, chosen?.photo?.brightness, chosen?.photo?.contrast, chosen?.photo?.fitPaper, chosen?.photo?.fitPairs, chosen?.photo?.fineSteps, chosen?.photo?.spacingMm, chosen?.photo?.levels, convertRead, inks, tool, paperColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chosen photo's card: how it's turned into lines.
  const photoCard = chosen?.photo ? (
    <PhotoCard
      shape={chosen as Shape & { photo: Photo }}
      title={shapeName(chosen, onActive.indexOf(chosen))}
      shapes={shapes}
      layers={layers}
      busy={busy}
      all={photoAll}
      onAll={setPhotoAll}
      estimates={estimates}
      infoCard={infoCard}
      effectCards={effectCards}
      scale={(() => {
        const { b, fitW } = photoScale(chosen);
        return Math.round(((b.x1 - b.x0) / fitW) * 100);
      })()}
      actions={{
        turn: turnPhoto,
        replace: replacePhoto,
        setPlate: setSeparationPlate,
        switchMode: switchPhotoMode,
        set: setPhotoOf,
        split: splitPhoto,
        splitByColor: splitPhotoByColor,
        splitBestFit: (count) => splitPhotoBestFit(count),
        setPairs: (on) => splitPhotoBestFit(inks, {}, on),
        setFine: (on) => splitPhotoBestFit(inks, {}, undefined, on),
        setKeyLayer,
        place: placePhoto,
        setMargin: setPhotoMargin,
        setScale: setPhotoScale,
        setAngles,
        pickBand: (id, layerId) => {
          pick(id);
          setActiveLayer(layerId);
        },
      }}
    />
  ) : null;

  const photoInput = useRef<HTMLInputElement>(null);
  const mainRail = (
    <>
      {/* Out while it's asking about unsaved work too, even put away: the question is asked in it. */}
      {(fileCard || confirmNext) && (
        <Card variant="flat" className={styles.controls}>
          <div className={`${styles.cardBody} ${controls.cardSections}`}>
            <FileSection
              name={file.name}
              onName={file.setName}
              saved={file.saved}
              dirty={file.dirty}
              hasShapes={shapes.length > 0}
              busy={busy}
              confirm={confirmBlock}
              onOpen={() => setBrowsing("drawing")}
              onOpenPhotos={(files) => files.length && ask({ kind: "photos", files })}
              onNew={() => ask({ kind: "new" })}
              onEditInStudio={editInStudio}
              onSendToPlot={file.sendToPlot}
              onSave={() => file.save()}
            />
          </div>
        </Card>
      )}
      {/* What the drawing is made on, and with: each its own card, shown or hidden from the toolbar. */}
      {paperCard && (
        <Card variant="flat" className={styles.controls}>
          <div className={`${styles.cardBody} ${controls.cardSections}`}>{paperSection}</div>
        </Card>
      )}
      {penCard && (
        <Card variant="flat" className={styles.controls}>
          <div className={`${styles.cardBody} ${controls.cardSections}`}>{toolSection}</div>
        </Card>
      )}
      {photoCard}
      {/* The image card with no photo yet: the way to open one, where its settings will be. */}
      {!chosen?.photo && infoCard && (
        <Card variant="flat" className={styles.controls}>
          <div className={`${styles.cardBody} ${controls.cardSections}`}>
            <Section title="Image">
              <p className={controls.hint}>No photo yet. Open one to turn it into lines: a new drawing, named after it.</p>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => photoInput.current?.click()}>
                Open a photo
              </Button>
            </Section>
          </div>
        </Card>
      )}
    </>
  );

  // The toolbar's effect is the whole photo's. Silhouette has no tones or colours to split by, so a
  // split photo comes back together as one layer drawn that way; separations keep a plate each.
  // Whether the rail has any card to show; with none, the stage takes its width.
  const railOut = Boolean(setupOpen || fileCard || paperCard || penCard || confirmNext || infoCard || (chosen?.photo && effectCards));

  const setEffect = (effect: Effect) => {
    setEffectCards(true);
    const style = effect === "hatch" ? undefined : effect;
    if (effect === "silhouette" && chosen?.photo?.group && !chosen.photo.separation) splitPhoto(1, { style });
    else setPhotoOf({ style });
  };

  // The way to Setup, at the bottom of the toolbars down the left.
  const setupToolbar = <SetupToolbar open={setupOpen} onToggle={() => setSetupOpen((open) => !open)} orientation="vertical" />;

  return (
    <div className={styles.app}>
      {/* Problems, and what's under way, across the top of the page - never on the preview's rulers. */}
      <StatusBanner message={banner} />
      <FileBrowser
        open={browsing !== null}
        endpoint="/api/studio/read"
        onClose={() => setBrowsing(null)}
        onOpened={(res) => (browsing === "sheet" ? askSheet(res) : ask({ kind: "open", res }))}
      />
      <PhotoHeader plotterFound={plotterFound} />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        multiple
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) ask({ kind: "photos", files });
          e.target.value = ""; // so the same photo can be opened again
        }}
      />

      {/* With every card put away the rail has nothing to show, and the stage takes its width. */}
      <main className={styles.layout} data-rail={railOut ? undefined : "none"}>
        <div className={styles.tools}>
          <AppSwitch current="photo" orientation="vertical" />
          <PanelToolbar
            cards={[
              { key: "file", on: fileCard, toggle: () => setFileCard((on) => !on) },
              { key: "paper", on: paperCard, toggle: () => setPaperCard((on) => !on) },
              { key: "pen", on: penCard, toggle: () => setPenCard((on) => !on) },
              { key: "image", on: infoCard, toggle: () => setInfoCard((on) => !on) },
            ]}
          />
          <EffectToolbar effect={!setupOpen && chosen?.photo ? effectOf(chosen.photo) : undefined} onEffect={setEffect} onAgain={() => setEffectCards((on) => !on)} disabled={setupOpen || !chosen?.photo || busy} />
          {!setupOpen && chosen?.photo && <HistoryToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} disabled={busy} />}
          {setupToolbar}
        </div>
        <section className={styles.stage} aria-label={setupOpen ? "Calibration sheet" : "Image conversion"}>
          {!setupOpen && chosen?.photo && convertBox ? (
            <ConvertStage
              photo={chosen.photo}
              box={convertBox}
              page={page}
              paperColor={paperColor}
              model={model}
              zoom={zoom}
              onZoom={setZoom}
              loupe={loupe}
              onLoupe={setLoupe}
              parts={convertParts}
              ink={{
                penWidthMm,
                opacity: tool?.settings.ink_opacity ?? 1,
                build: tool?.settings.ink_build ?? 1,
                builds: tool?.settings.ink_builds !== false,
                opaque: tool?.settings.ink_opaque === true,
              }}
              view={view}
              onView={setView}
              show={convertView}
              onShow={setConvertView}
            />
          ) : (
            <>
              <div
                className={styles.paper}
                style={{ aspectRatio: setupOpen && sheet ? `${sheet.page.w} / ${sheet.page.h}` : `${page.w} / ${page.h}`, background: paperColor }}
              >
                {setupOpen ? (
                  sheetImage ? (
                    <img className={styles.sheet} src={sheetImage} alt={sheetFile.name} />
                  ) : (
                    <p className={styles.stageEmpty}>Make or open a sheet to see it here</p>
                  )
                ) : (
                  <button type="button" className={styles.stageEmpty} onClick={() => photoInput.current?.click()}>
                    Open a photo to start
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {railOut && <div className={styles.side}>{setupOpen ? setupRail : mainRail}</div>}
      </main>
    </div>
  );
}
