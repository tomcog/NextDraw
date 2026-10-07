import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@tomcoggia/ui";
import { ImagePlus } from "lucide-react";
import { DrawingToolSection } from "../shared/components/controls/DrawingToolSection";
import { PaperSection } from "../shared/components/controls/PaperSection";
import { SettingsSection } from "../shared/components/controls/SettingsSection";
import { Section } from "../shared/components/controls/Section";
import controls from "../shared/components/controls/controls.module.css";
import { SetupToolbar } from "../shared/components/PreviewToolbar";
import { StatusBanner } from "../shared/components/StatusBanner";
import { ThemeToggle } from "../shared/components/ThemeToggle";
import { api } from "../shared/lib/api";
import { PAPER_SIZES } from "../shared/lib/constants";
import { load, save as remember } from "../shared/lib/storage";
import type { Preset } from "../shared/lib/types";
import { PhotoHeader } from "./components/PhotoHeader";
import styles from "./App.module.css";

// NextDraw Photo: a photo turned into lines for the tool's pens, saved as an ordinary layered drawing
// that Plot plots and Studio opens. This is the frame - header, rail, paper, drawing tool, the photo
// on the page, Setup - that the conversion moves into from Studio, a piece at a time
// (docs/photo.md).

// Page sizes, in inches, from the list Plot offers, stored width-first as Studio stores them.
const SIZES = PAPER_SIZES.filter((p) => p.w && p.h).map((p) => ({ id: p.id, name: p.name, w: p.w! / 25.4, h: p.h! / 25.4 }));

// This browser's choices, Photo's own: the tool and paper on the plotter for photos needn't be the
// ones Studio was last drawing with.
const TOOL_KEY = "photo-tool";
const PAPER_COLOR_KEY = "photo-paper-color";

interface Picture {
  name: string;
  url: string; // an object URL, let go when another photo replaces it
  w: number;
  h: number;
}

export default function App() {
  const [page, setPage] = useState({ w: 11, h: 8.5 });
  const [paperColor, setPaperColor] = useState(() => load<string>(PAPER_COLOR_KEY) ?? "#ffffff");
  useEffect(() => remember(PAPER_COLOR_KEY, paperColor), [paperColor]);
  const sizeId = useMemo(() => {
    const match = SIZES.find(
      (s) => (Math.abs(s.w - page.w) < 0.01 && Math.abs(s.h - page.h) < 0.01) || (Math.abs(s.h - page.w) < 0.01 && Math.abs(s.w - page.h) < 0.01),
    );
    return match?.id ?? "custom";
  }, [page]);
  const setSize = (id: string) => {
    const size = SIZES.find((s) => s.id === id);
    if (!size) return;
    // Keep the way the paper lies, so choosing a size doesn't also turn it.
    const landscape = page.w >= page.h;
    setPage(landscape ? { w: Math.max(size.w, size.h), h: Math.min(size.w, size.h) } : { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) });
  };

  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const banner = useMemo(() => (message && !message.ok ? { text: message.text, error: true } : null), [message]);

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
      setMessage(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setMessage({ text: `Couldn’t read ${file.name} as a picture.`, ok: false });
    };
    img.src = url;
  };

  const [setupOpen, setSetupOpen] = useState(false);

  const paperSection = (
    <PaperSection
      w={page.w * 25.4}
      h={page.h * 25.4}
      sizeId={sizeId}
      units="in"
      color={paperColor}
      collapsibleKey="photo-paper"
      onSize={setSize}
      onDimensions={(w, h) => setPage({ w: w / 25.4, h: h / 25.4 })}
      onColor={setPaperColor}
    />
  );
  const toolSection = <DrawingToolSection tools={presets} value={toolName} onPick={setToolName} collapsibleKey="photo-pen" />;

  // Setup: getting the drawing tools ready. Calibration moves here from Studio's Setup.
  const setupRail = (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section title="Setup">
          <p className={controls.hint}>Getting the drawing tools ready. The photo stays as it is; the gear goes back to it.</p>
        </Section>
        {toolSection}
        <Section title="Appearance" action={<ThemeToggle />}>
          <p className={controls.hint}>Light or dark. Plot and Studio follow the same choice.</p>
        </Section>
      </div>
    </Card>
  );

  return (
    <div className={styles.app}>
      {/* Problems across the top of the page - never on the preview's rulers. */}
      <StatusBanner message={banner} />
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
        <section className={styles.stage} aria-label="Photo on the page">
          <div className={styles.stageBar}>
            <SetupToolbar open={setupOpen} onToggle={() => setSetupOpen((open) => !open)} />
          </div>
          <div className={styles.paper} style={{ aspectRatio: `${page.w} / ${page.h}`, background: paperColor }}>
            {picture ? (
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
