import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, InputText } from "@tomcoggia/ui";
import { ImagePlus, Save, Send } from "lucide-react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { SettingsSection } from "../shared/components/controls/SettingsSection";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { FileBrowser, type OpenResult } from "../shared/components/FileBrowser";
import { SetupToolbar } from "../shared/components/PreviewToolbar";
import { StatusBanner } from "../shared/components/StatusBanner";
import { ThemeToggle } from "../shared/components/ThemeToggle";
import { api } from "../shared/lib/api";
import { PAPER_SIZES } from "../shared/lib/constants";
import { load, save as remember } from "../shared/lib/storage";
import type { Preset } from "../shared/lib/types";
import { loadFont, type StrokeFont } from "../shared/lib/drawing/font";
import type { Fill } from "../shared/lib/drawing/hatch";
import { parseDrawing } from "../shared/lib/drawing/parse";
import type { Layer, Page, Shape } from "../shared/lib/drawing/shapes";
import { buildSvg } from "../shared/lib/drawing/svg";
import { fitText } from "../shared/lib/drawing/text";
import { useDrawingFile } from "../shared/lib/drawing/useDrawingFile";
import { calibrationSheet } from "./lib/calibration";
import { pairsSheet } from "./lib/penPairs";
import { readCalibration, readingProblems, sheetLayout } from "./lib/calibrationRead";
import { CalibrationSection } from "./components/CalibrationSection";
import { PhotoHeader } from "./components/PhotoHeader";
import styles from "./App.module.css";

// NextDraw Photo: a photo turned into lines for the tool's pens, saved as an ordinary layered drawing
// that Plot plots and Studio opens. So far it holds the frame - header, rail, paper, drawing tool, the
// photo on the page - and Setup's calibration, moved here from Studio. The conversion follows, a piece
// at a time (docs/photo.md).

// Page sizes, in inches, from the list Plot offers, stored width-first as Studio stores them.
const SIZES = PAPER_SIZES.filter((p) => p.w && p.h).map((p) => ({ id: p.id, name: p.name, w: p.w! / 25.4, h: p.h! / 25.4 }));
const sizeIdOf = (page: Page) =>
  SIZES.find((s) => (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) || (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01))?.id ?? "custom";

// This browser's choices, Photo's own: the tool and paper on the plotter for photos needn't be the
// ones Studio was last drawing with.
const TOOL_KEY = "photo-tool";
const PAPER_COLOR_KEY = "photo-paper-color";

// The words on a calibration sheet, in the font every sheet so far has been made in.
const SHEET_FONT = "EMSOsmotron";

interface Picture {
  name: string;
  url: string; // an object URL, let go when another photo replaces it
  w: number;
  h: number;
}

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

export default function App() {
  const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
  const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
  useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
  const sizeId = useMemo(() => sizeIdOf(page), [page]);
  const setSize = (id: string) => {
    const size = SIZES.find((s) => s.id === id);
    if (!size) return;
    // Keep the way the paper lies, so choosing a size doesn't also turn it.
    const landscape = page.w >= page.h;
    setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
  };

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

  // The photo being worked on. Only shown for now: turning it into lines comes over from Studio next.
  const [picture, setPicture] = useState<Picture | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const openPhoto = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPicture((was) => {
        if (was) URL.revokeObjectURL(was.url);
        return { name: file.name.replace(/\.[^.]+$/, ""), url, w: img.naturalWidth, h: img.naturalHeight };
      });
      setMessage({ text: "", ok: true });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setMessage({ text: `Couldn’t read ${file.name} as a picture.`, ok: false });
    };
    img.src = url;
  };

  const [setupOpen, setSetupOpen] = useState(false);

  // Calibration. The sheet's words are fitted to the stroke font they'll be drawn in, so it's loaded
  // before a sheet can be made.
  const [sheetFont, setSheetFont] = useState<StrokeFont | null>(null);
  useEffect(() => {
    loadFont(SHEET_FONT)
      .then(setSheetFont)
      .catch(() => setMessage({ text: `Couldn’t load the font ${SHEET_FONT} the sheets are written in.`, ok: false }));
  }, []);
  const fonts = useMemo<Record<string, StrokeFont>>(() => {
    const loaded: Record<string, StrokeFont> = {};
    if (sheetFont) loaded[SHEET_FONT] = sheetFont;
    return loaded;
  }, [sheetFont]);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const file = useDrawingFile({
    shapes: sheet?.shapes ?? NO_SHAPES,
    fills: sheet?.fills ?? NO_FILLS,
    layers: sheet?.layers ?? NO_LAYERS,
    page: sheet?.page ?? page,
    sizeId: sizeIdOf(sheet?.page ?? page),
    toolName,
    fonts,
    setBusy,
    setMessage,
  });

  // A new sheet, or one opened, replaces one with unsaved changes only after asking, as Studio asks.
  type Next = "calibration" | "pairs" | OpenResult;
  const [confirmNew, setConfirmNew] = useState<Next | null>(null);
  const makeSheet = (kind: "calibration" | "pairs") => {
    setConfirmNew(null);
    if (!tool || !sheetFont) return;
    const made = kind === "calibration" ? calibrationSheet(tool, page, SHEET_FONT) : pairsSheet(tool, page, SHEET_FONT);
    if ("error" in made) {
      setMessage({ text: made.error, ok: false });
      return;
    }
    setSheet({ shapes: made.shapes.map((sh) => (sh.kind === "text" ? fitText(sh, sheetFont) : sh)), fills: made.fills, layers: made.layers, page });
    file.started(`${tool.name} ${kind === "calibration" ? "calibration" : "pen pairs"}`); // a new sheet to be saved and plotted
    setMessage({ text: "", ok: true });
  };
  const newSheet = (kind: "calibration" | "pairs") => {
    if (sheet && file.dirty) setConfirmNew(kind);
    else makeSheet(kind);
  };

  // A sheet saved before, opened to read a photo of it - in the tool it was saved for.
  const [browserOpen, setBrowserOpen] = useState(false);
  const openSheet = (res: OpenResult) => {
    setConfirmNew(null);
    const drawing = parseDrawing(res.svg ?? "");
    if (!sheetLayout(drawing.shapes)) {
      setMessage({ text: `${res.name} isn’t a calibration sheet: it has no corner marks and named patches.`, ok: false });
      return;
    }
    setSheet({ shapes: drawing.shapes, fills: drawing.fills, layers: drawing.layers, page: drawing.page });
    setPage(drawing.page);
    file.opened(res, drawing);
    if (drawing.tool && presets.some((t) => t.name === drawing.tool)) setToolName(drawing.tool);
    setMessage({ text: "", ok: true });
  };

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
      setMessage(problems.length ? { text: `Read ${count} pens, but ${problems.join(" ")}`, ok: false } : { text: `Read ${count} pens into ${tool.name}`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const penWidthMm = tool?.settings.pen_width ?? 0.5;
  const sheetImage = useMemo(
    () => (sheet ? sheetPicture(buildSvg(sheet.shapes, sheet.fills, sheet.layers, sheet.page, { paperSizeId: sizeIdOf(sheet.page), toolName, fonts }), penWidthMm) : null),
    [sheet, toolName, fonts, penWidthMm],
  );

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
      onDimensions={(w, h) => setPage({ w: w / 25.4, h: h / 25.4 })}
      onColor={setPaperColor}
    />
  );
  const toolSection = <DrawingToolSection tools={presets} value={toolName} onPick={setToolName} collapsibleKey="photo-pen" disabled={busy} />;

  const goOn = (next: Next) => (typeof next === "string" ? makeSheet(next) : openSheet(next));
  const confirmBlock = confirmNew && (
    <div className={styles.confirm} role="alertdialog" aria-label={typeof confirmNew === "string" ? "Make a new sheet" : `Open ${confirmNew.name}`}>
      <p>{file.saved ? `“${file.name}” has` : "This sheet has"} changes that aren’t saved.</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (await file.save()) goOn(confirmNew);
          }}
        >
          {typeof confirmNew === "string" ? "Save, then make new" : `Save, then open ${confirmNew.name}`}
        </Button>
        <Button size="sm" tone="danger" variant="secondary" onClick={() => goOn(confirmNew)}>
          {typeof confirmNew === "string" ? "Discard and make new" : `Discard and open ${confirmNew.name}`}
        </Button>
        <Button size="sm" variant="tertiary" onClick={() => setConfirmNew(null)}>
          Keep this sheet
        </Button>
      </div>
    </div>
  );

  // The sheet in hand: what it's called and where it is, saving it, and sending it to Plot.
  const sheetFile = sheet && (
    <>
      <InputText size="md" label="Sheet name" hideLabel value={file.name} disabled={busy} onChange={(e) => file.setName(e.target.value)} />
      <p className={controls.fileWhere} title={file.saved?.path ?? undefined}>
        {file.saved ? file.saved.folder : "Not saved yet"}
      </p>
      <div className={styles.actions}>
        <Button size="sm" icon={<Save />} disabled={busy || !file.dirty} onClick={() => file.save()}>
          Save
        </Button>
        <Button size="sm" variant="secondary" icon={<Send />} disabled={busy} onClick={file.sendToPlot}>
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
          <p className={controls.hint}>Getting the drawing tools ready. The photo stays as it is; the gear goes back to it.</p>
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
          onNewSheet={() => newSheet("calibration")}
          onNewPairs={() => newSheet("pairs")}
          onOpenSheet={() => setBrowserOpen(true)}
          sheetFile={sheetFile}
          onReadPhoto={readSheetPhoto}
          confirm={confirmBlock}
        />
        <Section title="Appearance" action={<ThemeToggle />}>
          <p className={controls.hint}>Light or dark. Plot and Studio follow the same choice.</p>
        </Section>
      </div>
    </Card>
  );

  // In Setup the stage shows the sheet, on its own paper; otherwise the photo, on the paper chosen.
  const shownPage = setupOpen && sheet ? sheet.page : page;

  return (
    <div className={styles.app}>
      {/* Problems, and what's under way, across the top of the page - never on the preview's rulers. */}
      <StatusBanner message={banner} />
      <FileBrowser
        open={browserOpen}
        endpoint="/api/studio/read"
        onClose={() => setBrowserOpen(false)}
        onOpened={(res) => (sheet && file.dirty ? setConfirmNew(res) : openSheet(res))}
      />
      <PhotoHeader plotterFound={plotterFound} />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          openPhoto(e.target.files?.[0]);
          e.target.value = ""; // so the same photo can be opened again
        }}
      />

      <main className={styles.layout}>
        <section className={styles.stage} aria-label={setupOpen ? "Calibration sheet" : "Photo on the page"}>
          <div className={styles.stageBar}>
            <SetupToolbar open={setupOpen} onToggle={() => setSetupOpen((open) => !open)} />
          </div>
          <div className={styles.paper} style={{ aspectRatio: `${shownPage.w} / ${shownPage.h}`, background: paperColor }}>
            {setupOpen ? (
              sheetImage ? (
                <img className={styles.sheet} src={sheetImage} alt={file.name} />
              ) : (
                <p className={styles.empty}>Make or open a sheet to see it here</p>
              )
            ) : picture ? (
              <img className={styles.picture} src={picture.url} alt={picture.name} />
            ) : (
              <button type="button" className={styles.empty} onClick={() => photoInput.current?.click()}>
                Open a photo to start
              </button>
            )}
          </div>
        </section>

        <div className={styles.side}>
          {setupOpen ? setupRail : (
            <Card variant="flat" className={styles.controls}>
              <div className={`${styles.cardBody} ${controls.cardSections}`}>
                <Section title="Photo">
                  <p className={controls.hint}>{picture ? `${picture.name}, ${picture.w} × ${picture.h} px` : "No photo open yet"}</p>
                  <Button size="sm" variant="secondary" icon={<ImagePlus />} onClick={() => photoInput.current?.click()}>
                    {picture ? "Open another photo" : "Open a photo"}
                  </Button>
                </Section>
                <SettingsSection collapsibleKey="photo-settings">
                  {paperSection}
                  {toolSection}
                </SettingsSection>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
