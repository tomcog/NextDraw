import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@tomcoggia/ui";
// Separations into many plates are solved off the page (importing this turns it on).
import "../shared/lib/drawing/separationWorker";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { FileSection } from "../shared/components/controls/FileSection";
import { FileToolbar } from "../shared/components/FileToolbar";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { FileBrowser, type OpenResult } from "../shared/components/FileBrowser";
import { HistoryToolbar, type View } from "../shared/components/PreviewToolbar";
import { AppSwitch } from "../shared/components/AppSwitch";
import { StatusBanner } from "../shared/components/StatusBanner";
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
import { photoMarks, placeOnPage, plateSetOf, stemWithoutPlate, type Photo } from "../shared/lib/drawing/photo";
import { boxOf, newLayerId, type Layer, type Page, type Shape } from "../shared/lib/drawing/shapes";
import { useDrawingFile } from "../shared/lib/drawing/useDrawingFile";
import { usePhotoRead, usePhotosRead } from "../shared/lib/drawing/usePhotoRead";
import { photoActions } from "./lib/photoActions";
import { ConvertStage, type ConvertView } from "./components/ConvertStage";
import { EffectToolbar, effectOf, type Effect } from "./components/EffectToolbar";
import { PanelToolbar } from "../shared/components/PanelToolbar";
import { LayersSection } from "../shared/components/controls/LayersSection";
import { PaletteMenu } from "../shared/components/controls/PaletteMenu";
import { lightness } from "../shared/lib/color";
import { dropWork, keepWork, loadWork, type Work } from "./lib/workInProgress";
import { PhotoCard } from "./components/PhotoCard";
import { PhotoHeader } from "./components/PhotoHeader";
import { GENERAL_PEN } from "./lib/generalPen";
import { folderOf, inksOf, separationFiles, type Inks } from "./lib/separationFolder";
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
// The pen starts at None - general colors, no preset - so this key is new with that choice, and
// a pen remembered from before it doesn't stand in for it.
const TOOL_KEY = "photo-pen-preset";
const PAPER_COLOR_KEY = "photo-paper-color";
const LAST_FILE_KEY = "photo-last-file";

const NO_SHAPES: Shape[] = [];
const NO_FILLS: Fill[] = [];

// A new drawing's one layer, as in Studio: a photo put in is matched to the tool's pens from there.
const firstLayer = (): Layer => ({ id: newLayerId(), name: "Black", color: "#262626" });

/** What waits on the question about unsaved work: a new drawing, photos opened, or a file opened. */
type Next = { kind: "new" } | { kind: "photos"; files: File[]; skipped?: string[]; found?: Inks } | { kind: "open"; res: OpenResult };

export default function App() {
  const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
  const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
  useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
  const sizeId = useMemo(() => sizeIdOf(page), [page]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean; progress?: boolean }>({ text: "", ok: true });
  // A snapshot just saved: said at the top, with the ways on from it, until something else is said.
  const [snapped, setSnapped] = useState<{ name: string; path: string } | null>(null);
  useEffect(() => setSnapped(null), [message]);
  const banner = useMemo(
    () => (message.text && (!message.ok || message.progress)
      ? { text: message.text, error: !message.ok, working: message.progress }
      : snapped
        ? {
          text: `Snapshot saved: ${snapped.name}`,
          brand: true,
          id: snapped.path,
          actions: [
            { label: "Open in Studio", onClick: () => void openInStudio(snapped.path) },
            { label: "Open in Plot", onClick: () => void file.openInPlot(snapped.path) },
          ],
        }
        : null),
    [message, snapped], // eslint-disable-line react-hooks/exhaustive-deps
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
  // And the Layers card, last: the image's layers, which one is being set, their colors and order.
  const [layersCard, setLayersCard] = useState(() => load<boolean>("photo-layers-card") ?? true);
  useEffect(() => remember("photo-layers-card", layersCard), [layersCard]);

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
          // None stays None; a pen that's gone falls back to it.
          setToolName((current) => (list.some((t) => t.name === current) ? current : ""));
        })
        .catch(() => {});
    read();
    const timer = window.setInterval(read, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [plotterOnUsb]);
  // The preset chosen, or with None, the general pen: print's colors, any of which a layer can swap
  // for a color of its own.
  const preset = presets.find((t) => t.name === toolName) ?? null;
  const tool = preset ?? GENERAL_PEN;
  const penWidthMm = tool.settings.pen_width ?? 0.5;

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
    const wanted = new Set(shapes.map((s) => s.font ?? "").filter(Boolean));
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

  // All of the photo's layers, bottom first, each in its pen: the lines it comes out as, together.
  const convertBox = chosen ? boxOf(chosen) : null;
  const convertParts = useMemo(
    () =>
      chosen
        ? layers.flatMap((l) =>
            shapes
              // A layer hidden in the Layers card is left out of the lines, so the rest can be judged without it.
              .filter((sh) => !l.hidden && sh.layerId === l.id && sh.kind === "photo" && sh.photo && (sh.id === chosen.id || (chosen.photo!.group && sh.photo.group === chosen.photo!.group)))
              .map((sh) => ({ photo: sh.photo!, color: l.color, name: l.name })),
          )
        : [],
    [shapes, layers, chosen],
  );
  usePhotoRead(chosen?.photo?.src);
  // And every other layer's picture: separations are a picture each.
  usePhotosRead(convertParts.map((part) => part.photo.src));
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

  // Which layers are targeted in the Layers card: where a layer's settings go. Each target toggles on
  // its own - all, some or none. Kept as the layers turned off, so every layer, a new one included,
  // starts targeted, as settings went to every layer before.
  const [untargeted, setUntargeted] = useState<Set<string>>(() => new Set());
  const targets = useMemo(() => new Set(layers.map((l) => l.id).filter((id) => !untargeted.has(id))), [layers, untargeted]);
  // The chosen photo's layers, bottom first.
  const photoLayerIds = chosen?.photo
    ? layers.filter((l) => shapes.some((sh) => sh.layerId === l.id && sh.kind === "photo" && (sh.id === chosen.id || (chosen.photo!.group && sh.photo?.group === chosen.photo!.group)))).map((l) => l.id)
    : [];

  const addShape = useCallback((shape: Shape) => {
    record();
    setShapes((list) => [...list, shape]);
    pick(shape.id);
  }, [record, pick]);

  const {
    addPhoto, addSeparations, switchPhotoMode, setKeyLayer, splitPhoto, splitPhotoByColor, splitPhotoBestFit, bestPens,
    placePhoto, photoScale, setPhotoScale, setPhotoMargin, replacePhoto, turnPhoto, setPhotoOf, setEdgeMask, setAngles, photoStem, splitPhotoCmyk, setPlatePen, setLayerColor,
    splitAroundPaper, setPaperTone,
  } = photoActions({
    chosen, shapes, setShapes, layers, setLayers, active, setActiveLayer, page, tool,
    spacingMm: tool?.hatch?.spacing_mm ?? 1.5, targets, paper: paperColor, record, addShape, pick, setMessage, setBusy,
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
  const [pendingPhotos, setPendingPhotos] = useState<{ files: File[]; skipped: string[]; found?: Inks } | null>(null);
  const startPhotos = (files: File[], skipped: string[] = [], found?: Inks) => {
    newDrawing();
    // A new photo is first seen as it is, before any effect: the first view in the bar.
    setConvertView("picture");
    file.setName(files.length > 1 || skipped.length ? stemWithoutPlate(files[0].name, tool.palette, folderOf(files[0])) : files[0].name.replace(/\.[^.]+$/, ""));
    setPendingPhotos({ files, skipped, found });
  };
  useEffect(() => {
    if (!pendingPhotos || shapes.length) return;
    const { files, skipped, found } = pendingPhotos;
    setPendingPhotos(null);
    // From a folder, even one file is a separation: its name said its ink.
    if (files.length > 1 || skipped.length) addSeparations(files, skipped, found);
    else addPhoto(files[0]);
  }, [pendingPhotos, shapes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A drawing opened to carry on with: one with a photo in it. Anything else is Studio's to edit.
  const openDrawing = useCallback((res: OpenResult) => {
    const drawing = parseDrawing(res.svg ?? "");
    if (!drawing.shapes.some((s) => s.kind === "photo")) {
      setMessage({ text: `${res.name} has no image in it. Studio is where it’s edited.`, ok: false });
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
    else if (next.kind === "photos") startPhotos(next.files, next.skipped, next.found);
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
    if (where && !(await openInStudio(where.path))) setMessage({ text: "The browser didn’t open Studio’s tab: allow pop-ups for this page.", ok: false });
  };

  // ---- The rail ----

  // The file browser, open to pick a drawing.
  const [browsing, setBrowsing] = useState<"drawing" | null>(null);

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
  // A pen chosen by hand: the photo's colors are chosen again from its palette - each plate, or each
  // color group - once the new pen is in place, so no layer is left in a color the pen doesn't have.
  // Not when a drawing opens with its own pen: that keeps the colors it was saved with.
  const penPicked = useRef(false);
  const pickPen = (name: string) => {
    if (name !== toolName) penPicked.current = true;
    setToolName(name);
  };
  useEffect(() => {
    if (!penPicked.current) return;
    penPicked.current = false;
    const photo = chosen?.photo;
    if (!photo || photo.separation) return;
    if (photo.plate && photo.plates) splitPhotoCmyk({}, plateSetOf(photo.plates));
    else if (photo.ink && photo.regions) {
      if (photo.fitPaper) splitPhotoBestFit(inks);
      else splitPhotoByColor(inks);
    } else if (photo.side) {
      // Split around the paper: each band's pen chosen again, from the new pen's darker and lighter colors.
      const members = photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group) : [chosen!];
      splitAroundPaper({ dark: members.filter((sh) => sh.photo?.side === "dark").length, light: members.filter((sh) => sh.photo?.side === "light").length, paperTone: photo.paperTone });
    }
  }, [toolName]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolSection = <DrawingToolSection tools={presets} value={toolName} onPick={pickPen} none="None" collapsibleKey="photo-pen" disabled={busy} />;

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
    Promise.all(counts.map((n) => bestPens(n, Boolean(chosen.photo!.fitPairs))))
      .then((found) => {
        if (mine !== asked.current) return;
        const out = found.flatMap((best, i) => (best?.errors.length ? [{ pens: counts[i], err: best.errors[best.errors.length - 1] }] : []));
        setEstimates(out.length ? out : undefined);
      })
      .catch(() => mine === asked.current && setEstimates(undefined));
  }, [chosen?.photo?.src, chosen?.photo?.brightness, chosen?.photo?.contrast, chosen?.photo?.fitPaper, chosen?.photo?.fitPairs, chosen?.photo?.spacingMm, chosen?.photo?.levels, convertRead, inks, tool, paperColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Layers card: the image's layers top first, the one being set ringed. Clicking one sets it;
  // its swatch opens the pen's colors (any color, with no preset); the eye hides it from the lines;
  // dragging restacks, which is the order they plot in - and with opaque ink, which shows on top.
  const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const pickCustomColor = (id: string, near: HTMLElement) => {
    setCustomFor(id);
    const input = colorInput.current;
    if (!input) return;
    // The picker opens where its input is, so the input goes to the layer's swatch first.
    const at = near.getBoundingClientRect();
    input.style.left = `${at.left}px`;
    input.style.top = `${at.bottom}px`;
    input.value = layers.find((l) => l.id === id)?.color ?? "#808080";
    input.click();
  };
  const pickLayer = (id: string) => {
    const group = chosen?.photo?.group;
    const on = shapes.find((sh) => sh.layerId === id && sh.kind === "photo" && sh.photo && (group ? sh.photo.group === group : sh.id === chosen?.id));
    if (on) pick(on.id);
    setActiveLayer(id);
  };
  const layersSection = chosen?.photo && layersCard ? (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <LayersSection
          collapsibleKey="photo-layer-list"
          verb="Set"
          nameTitle="Click to target this layer alone; its target beside it turns it on or off with the others"
          layers={layers}
          active={active}
          targets={targets}
          tool={preset}
          busy={busy}
          colorMenuId={colorMenu?.id}
          rowMenuId={undefined}
          onSort={() => {
            record();
            // Lightest at the bottom, drawn first, darker over it.
            setLayers((list) => [...list].sort((a, b) => (lightness(b.color) ?? 0) - (lightness(a.color) ?? 0)));
          }}
          onSwitch={(id, add) => {
            if (!add) {
              // The name: this layer alone, its settings shown.
              setUntargeted(new Set(layers.map((l) => l.id).filter((l) => l !== id)));
              pickLayer(id);
              return;
            }
            // The target: this one on or off, the others as they are. Turned on, its settings show;
            // turned off while showing, another targeted layer's do, if there is one.
            const on = !targets.has(id);
            setUntargeted((was) => {
              const next = new Set(was);
              if (on) next.delete(id);
              else next.add(id);
              return next;
            });
            if (on) pickLayer(id);
            else if (active?.id === id) {
              const other = photoLayerIds.find((l) => l !== id && targets.has(l));
              if (other) pickLayer(other);
            }
          }}
          onVisible={(id, visible) => setLayers((list) => list.map((l) => (l.id === id ? { ...l, hidden: !visible } : l)))}
          onColorMenu={(id, anchor) => setColorMenu((open) => (open?.id === id ? null : { id, anchor }))}
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
  ) : null;

  // The chosen photo's card: how it's turned into lines.
  const photoCard = chosen?.photo ? (
    <PhotoCard
      shape={chosen as Shape & { photo: Photo }}
      // The photo's own name, without the band or color a layer of it adds.
      title={photoStem().name}
      shapes={shapes}
      busy={busy}
      targeted={photoLayerIds.filter((id) => targets.has(id)).length}
      layerCount={photoLayerIds.length}
      shownName={active?.name ?? ""}
      estimates={estimates}
      palette={tool?.palette ?? []}
      anyColor={!preset}
      penWidthMm={penWidthMm}
      infoCard={infoCard}
      effectCards={effectCards}
      layersCard={layersSection}
      scale={(() => {
        const { b, fitW } = photoScale(chosen);
        return Math.round(((b.x1 - b.x0) / fitW) * 100);
      })()}
      actions={{
        turn: turnPhoto,
        replace: replacePhoto,
        setEdgeMask,
        switchMode: switchPhotoMode,
        set: setPhotoOf,
        split: splitPhoto,
        splitByColor: splitPhotoByColor,
        splitBestFit: (count) => splitPhotoBestFit(count),
        setPairs: (on) => splitPhotoBestFit(inks, {}, on),
        setKeyLayer,
        place: placePhoto,
        setMargin: setPhotoMargin,
        setScale: setPhotoScale,
        setAngles,
        splitCmyk: (set) => splitPhotoCmyk({}, set),
        setPlatePen,
        setColor: setLayerColor,
        splitAround: (dark, light) => splitAroundPaper({ dark, light, paperTone: chosen.photo?.side ? chosen.photo.paperTone : undefined }),
        setPaperTone,
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
              collapsibleKey="photo-file"
              name={file.name}
              onName={file.setName}
              saved={file.saved}
              dirty={file.dirty}
              hasShapes={shapes.length > 0}
              busy={busy}
              confirm={confirmBlock}
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
              <p className={controls.hint}>No image yet. Open one to turn it into lines: a new drawing, named after it.</p>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => photoInput.current?.click()}>
                Open an image
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
  const railOut = Boolean(fileCard || paperCard || penCard || confirmNext || infoCard || (chosen?.photo && (effectCards || layersCard)));

  const setEffect = (effect: Effect) => {
    setEffectCards(true);
    const style = effect === "hatch" ? undefined : effect;
    if (effect === "silhouette" && chosen?.photo?.group && !chosen.photo.separation) splitPhoto(1, { style });
    else setPhotoOf({ style });
  };


  return (
    <div className={styles.app}>
      {/* Problems, and what's under way, across the top of the page - never on the preview's rulers. */}
      <StatusBanner message={banner} />
      <FileBrowser
        open={browsing !== null}
        endpoint="/api/studio/read"
        onClose={() => setBrowsing(null)}
        onOpened={(res) => ask({ kind: "open", res })}
      />
      <PhotoHeader plotterFound={plotterFound} />
      {/* A layer's colors, from its swatch in the Layers card: the pen's, and any color besides. */}
      {colorMenu && (
        <PaletteMenu
          anchor={colorMenu.anchor}
          palette={tool.palette ?? []}
          current={layers.find((l) => l.id === colorMenu.id)?.color ?? null}
          onPick={(pen) => {
            setLayerColor(pen.color, undefined, colorMenu.id, pen.name);
            setColorMenu(null);
          }}
          onCustom={() => {
            pickCustomColor(colorMenu.id, colorMenu.anchor);
            setColorMenu(null);
          }}
          onClose={() => setColorMenu(null)}
        />
      )}
      <input
        ref={colorInput}
        type="color"
        className={styles.hiddenPicker}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => customFor && setLayerColor(e.target.value.toLowerCase(), undefined, customFor)}
      />
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
          {/* What's done with whole drawings, opening down: the File card keeps Save. */}
          <FileToolbar
      busy={busy}
            hasShapes={shapes.length > 0}
            onOpen={() => setBrowsing("drawing")}
            onOpenPhotos={async (files) => {
              if (!files.length) return;
              if (files.length === 1) return ask({ kind: "photos", files });
              // Several at once are separations: each one's ink is read from its name, Claude asked
              // for the names this app doesn't know.
              setMessage({ text: "Reading the inks from the file names…", ok: true, progress: true });
              const found = await inksOf(files, tool.palette ?? []);
              setMessage({ text: "", ok: true });
              ask({ kind: "photos", files, found });
            }}
            onOpenFolder={async (files) => {
              setMessage({ text: "Reading the inks from the file names…", ok: true, progress: true });
              const { use, skipped, ...found } = await separationFiles(files, tool.palette ?? []);
              setMessage({ text: "", ok: true });
              if (use.length) ask({ kind: "photos", files: use, skipped, found });
              else setMessage({ text: "There are no images in that folder", ok: false });
            }}
            onNew={() => ask({ kind: "new" })}
            onEditInStudio={editInStudio}
            onSendToPlot={file.sendToPlot}
            onSnapshot={async () => {
              const res = await file.snapshot();
              if (res) setSnapped({ name: res.name.replace(/\.svg$/i, ""), path: res.path });
            }}
          />
          <PanelToolbar
            cards={[
              { key: "file", on: fileCard, toggle: () => setFileCard((on) => !on) },
              { key: "paper", on: paperCard, toggle: () => setPaperCard((on) => !on) },
              { key: "pen", on: penCard, toggle: () => setPenCard((on) => !on) },
              { key: "image", on: infoCard, toggle: () => setInfoCard((on) => !on) },
              { key: "layers", on: layersCard, toggle: () => setLayersCard((on) => !on) },
            ]}
          />
          <EffectToolbar effect={chosen?.photo ? effectOf(chosen.photo) : undefined} onEffect={setEffect} onAgain={() => setEffectCards((on) => !on)} disabled={!chosen?.photo || busy} />
          {chosen?.photo && <HistoryToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} disabled={busy} />}
        </div>
        <section className={styles.stage} aria-label="Image conversion">
          {chosen?.photo && convertBox ? (
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
                noPreset: !preset,
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
                style={{ aspectRatio: `${page.w} / ${page.h}`, background: paperColor }}
              >
                <button type="button" className={styles.stageEmpty} onClick={() => photoInput.current?.click()}>
                  Open an image to start
                </button>
              </div>
            </>
          )}
        </section>

        {railOut && <div className={styles.side}>{mainRail}</div>}
      </main>
    </div>
  );
}
