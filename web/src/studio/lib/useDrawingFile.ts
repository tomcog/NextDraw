import { useCallback, useEffect, useRef, useState } from "react";
import { LAST_FOLDER_KEY, type CombineResult, type OpenResult } from "../../shared/components/FileBrowser";
import { postJSON } from "../../shared/lib/api";
import { APP_URL } from "../../shared/lib/apps";
import { PLOT_CHANNEL } from "../../shared/lib/constants";
import { save as remember } from "../../shared/lib/storage";
import type { StrokeFont } from "./font";
import type { Fill } from "./hatch";
import type { Layer, Page, Shape } from "./shapes";
import { buildSvg, cleanFileName } from "./svg";

// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
export const LAST_FILE_KEY = "studio-last-file";

/** Where the drawing was last saved, or read from: the file, and its folder as the File card says it. */
export type Saved = { path: string; folder: string } | null;

/** The drawing as it was last read from or written to a file: what "no changes to save" means. */
type OnDisk = { shapes: Shape[]; fills: Fill[]; layers: Layer[]; page: Page; name: string };

type Message = { text: string; ok: boolean; progress?: boolean };

interface Options {
  shapes: Shape[];
  fills: Fill[];
  layers: Layer[];
  page: Page;
  /** What goes into the file besides the drawing: its paper size, its tool, and the fonts its text is in. */
  sizeId: string;
  toolName: string;
  fonts: Record<string, StrokeFont>;
  setBusy: (busy: boolean) => void;
  setMessage: (message: Message) => void;
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
 * The file a drawing lives in: its name, where it is saved, whether anything on screen isn't, and
 * saving and sending it to Plot. Whoever opens or starts a drawing says so with opened, combined or
 * started, so the file's side of it follows; the drawing itself is the app's.
 */
export function useDrawingFile({ shapes, fills, layers, page, sizeId, toolName, fonts, setBusy, setMessage }: Options) {
  const [name, setName] = useState("Untitled");
  const [saved, setSaved] = useState<Saved>(null);
  // Where a drawing that has never been saved will be: files stacked into one are saved next to the
  // first of them, not in the shared folder a new drawing goes to. Null means the server's default.
  const [saveTo, setSaveTo] = useState<string | null>(null);
  // Marks in the drawing on disk that Studio can't redraw, and the name it was opened under. Saving
  // rewrites a file from the shapes Studio holds, so overwriting that file would delete them.
  const [foreign, setForeign] = useState(0);
  const [openedAs, setOpenedAs] = useState<string | null>(null);
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

  /** Something not in the drawing's shapes changed that the file holds - its tool - so it wants saving. */
  const touch = useCallback(() => setDirty(true), []);

  /** A drawing read from a file: that file is where it lives, and nothing on screen is new yet. */
  const opened = useCallback((res: OpenResult, drawing: Omit<OnDisk, "name"> & { unsupported: number }) => {
    const base = res.name.replace(/\.svg$/i, "");
    setName(base);
    setSaved({ path: res.path, folder: res.folder });
    setSaveTo(null);
    setForeign(drawing.unsupported);
    setOpenedAs(res.name);
    remember(LAST_FILE_KEY, res.path);
    // What's on screen is what's in the file, so there's nothing new to write yet.
    markClean({ shapes: drawing.shapes, fills: drawing.fills, layers: drawing.layers, page: drawing.page, name: base });
  }, [markClean]);

  /**
   * Files stacked into one drawing. Opened, they are a new drawing not yet saved, which saves next to
   * the first of them; added, they go on top of this one, which stays the file it was.
   */
  const combined = useCallback((res: CombineResult, unsupported: number) => {
    if (!res.added) {
      setName(res.name.replace(/\.svg$/i, ""));
      setSaved(null);
      setSaveTo(res.folder_path ?? null);
      setOpenedAs(null);
      remember(LAST_FILE_KEY, null); // nothing on disk to pick up again yet
      onDisk.current = null; // on screen and nowhere else: there is something to save
    }
    setForeign((was) => (res.added ? was : 0) + unsupported);
  }, []);

  /**
   * A new drawing that isn't in a file yet. Given what it starts as, that is taken as nothing to save
   * - an empty page isn't unsaved work; without, it is new work to be saved.
   */
  const started = useCallback((newName: string, clean?: Omit<OnDisk, "name">) => {
    setName(newName);
    setSaved(null);
    setSaveTo(null);
    setForeign(0);
    setOpenedAs(null);
    remember(LAST_FILE_KEY, null); // don't reopen the old drawing next time Studio starts
    if (clean) markClean({ ...clean, name: newName });
    else setDirty(true);
  }, [markClean]);

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
  const sendToPlot = async () => {
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

  return { name, setName, saved, dirty, touch, opened, combined, started, save, sendToPlot };
}
