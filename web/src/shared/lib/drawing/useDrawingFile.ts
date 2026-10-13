import { useCallback, useEffect, useRef, useState } from "react";
import { LAST_FOLDER_KEY, type CombineResult } from "../../components/FileBrowser";
import { api, postJSON } from "../api";
import { goToApp, whenLeaving, type AppName } from "../apps";
import { save as remember } from "../storage";
import type { StrokeFont } from "./font";
import type { Fill } from "./hatch";
import type { Layer, Page, Shape } from "./shapes";
import { buildSvg, cleanFileName } from "./svg";
import { snapshotName, snapshotShapes } from "./snapshot";

/** Where the drawing was last saved, or read from: the file, and its folder as the File card says it. */
export type Saved = { path: string; folder: string } | null;

/**
 * The drawing as it was last read from or written to somewhere: what "no changes" means. Touches
 * count the changes the file holds that aren't in its shapes - its tool.
 */
type Snapshot = { shapes: Shape[]; fills: Fill[]; layers: Layer[]; page: Page; name: string; touches: number };

/** What an app hands over of a drawing it has just put on screen. */
type Drawing = { shapes: Shape[]; fills: Fill[]; layers: Layer[]; page: Page };

type Message = { text: string; ok: boolean; progress?: boolean };

/**
 * The current drawing, as the server hands it over (/api/current, or /api/open?svg=1): the one
 * drawing all three apps work on. Its SVG, the file it lives in if it has one, and the editors' side
 * of it - whether it has changes not saved, where a first save goes, marks they can't redraw.
 */
export interface Current {
  empty?: boolean;
  name: string;
  path: string | null;
  folder: string | null;
  svg: string;
  opened: string;
  edited: string | null;
  dirty: boolean;
  save_to: string | null;
  foreign: number;
}

/**
 * The file's side of a drawing as it stands: its name, where it was saved, where a first save goes,
 * and what guards overwriting a file it only partly understood.
 */
export type FileState = { name: string; saved: Saved; saveTo: string | null; foreign: number; openedAs: string | null };

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
  /**
   * Put this drawing on screen: on starting, and whenever it was changed or replaced in another app
   * or window. The app reads its SVG into shapes and calls loaded() with them - or, empty, there is
   * no current drawing and the app starts a blank one with started().
   */
  onCurrent: (current: Current) => void;
  /**
   * Before the current drawing is picked up on starting: put back work kept in this browser from
   * before there was one, if there is any. True when it did, and the current drawing is left be.
   */
  beforeStart?: () => Promise<boolean>;
}

const fileOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folderPathOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const same = (a: Snapshot | null, b: Snapshot) =>
  a !== null && a.shapes === b.shapes && a.fills === b.fills && a.layers === b.layers && a.page === b.page && a.name === b.name && a.touches === b.touches;

/**
 * The file a drawing lives in, and the one current drawing all three apps share. Whoever opens or
 * starts a drawing says so with loaded, combined or started, so the file's side of it follows; the
 * drawing itself is the app's.
 *
 * Every change is sent to the current drawing on the server a moment after it's made, so Plot shows
 * it and going to another app takes it along - but only Save writes the file. Changes made elsewhere
 * - in Plot, the other editor, another window - come back through onCurrent while nothing here is
 * waiting to be sent.
 */
export function useDrawingFile({ shapes, fills, layers, page, sizeId, toolName, fonts, setBusy, setMessage, onCurrent, beforeStart }: Options) {
  const [name, setName] = useState("Untitled");
  const [saved, setSaved] = useState<Saved>(null);
  // Where a drawing that has never been saved will be: files stacked into one are saved next to the
  // first of them, not in the shared folder a new drawing goes to. Null means the server's default.
  const [saveTo, setSaveTo] = useState<string | null>(null);
  // Marks in the drawing on disk that the editors can't redraw, and the name it was opened under.
  // Saving rewrites a file from the shapes held here, so overwriting that file would delete them.
  const [foreign, setForeign] = useState(0);
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  // Anything drawn since the last save has to be written again before it's in the file. State
  // rather than a ref, because the Save button is disabled while it's false and so has to re-render
  // when it changes.
  const [dirty, setDirty] = useState(false);
  const [touches, setTouches] = useState(0);

  // What the file on disk was written from. Every edit replaces one of these arrays and leaves the
  // rest alone, so comparing them by identity answers "is there anything to save" in a few pointer
  // comparisons - no deep compare of every path on every drag.
  const onDisk = useRef<Snapshot | null>(null);
  const now = (): Snapshot => ({ shapes, fills, layers, page, name, touches });
  const nowRef = useRef(now);
  nowRef.current = now;

  // Asking the question here, rather than raising a flag on a change and lowering it after a save,
  // is what makes the answer reliable: a save can rename the drawing and an open lands in its own
  // good time, and this doesn't care which order any of that happens in.
  useEffect(() => {
    setDirty(!same(onDisk.current, now()));
  }, [shapes, fills, layers, page, name, touches]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by whoever just read or wrote the file, with the very values that went to disk.
  const markClean = useCallback((written: Snapshot) => {
    onDisk.current = written;
    setDirty(false);
  }, []);

  /** Something not in the drawing's shapes changed that the file holds - its tool - so it wants saving. */
  const touch = useCallback(() => setTouches((n) => n + 1), []);

  // ---- Sending changes to the current drawing ----

  // The current drawing on the server, as this page knows it: which opening it is (null: none yet -
  // a blank page, or a new drawing not sent yet), which edit, and whether it has changes not saved.
  const base = useRef<string | null>(null);
  const edited = useRef<string | null>(null);
  const serverDirty = useRef(false);
  // What the server has: nothing to send while the drawing is still that.
  const sent = useRef<Snapshot | null>(null);
  // Started up: the current drawing has been picked up, so changes from here on are this page's.
  const [ready, setReady] = useState(false);
  // Changes not on the server yet: waiting a moment, being sent, or refused for now.
  // State for the page to show; the ref says it the moment it changes, for leaving straight after.
  const [unsent, setUnsentState] = useState(false);
  const unsentRef = useRef(false);
  const setUnsent = useCallback((value: boolean) => {
    unsentRef.current = value;
    setUnsentState(value);
  }, []);
  // Another drawing was opened elsewhere while this one had changes not sent: they stay here, and
  // Save writes them to a file of their own.
  const conflict = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const sending = useRef<Promise<void> | null>(null);

  // What a send needs that changes with every render.
  const latest = useRef<{ svg: () => string; file: FileState }>({ svg: () => "", file: {} as FileState });
  latest.current = {
    svg: () => buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, fonts }),
    file: { name, saved, saveTo, foreign, openedAs },
  };
  // Whether the drawing differs from its file, asked at the moment: the dirty state lags a render
  // behind a change, and a change judged by it would be taken for nothing new.
  const differsFromFile = (drawing: Snapshot) => !same(onDisk.current, drawing);

  const send = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (conflict.current) return;
    const drawing = nowRef.current();
    if (same(sent.current, drawing)) {
      setUnsent(false);
      return;
    }
    const { svg, file } = latest.current;
    const isDirty = differsFromFile(drawing);
    try {
      const res = await postJSON<{ opened: string; edited: string }>("/api/current", {
        svg: svg(),
        name: cleanFileName(file.name),
        base: base.current,
        dirty: isDirty,
        save_to: file.saveTo,
        foreign: file.foreign,
        // A new opening that already belongs to a file: work put back from before.
        ...(base.current === null && file.saved ? { path: file.saved.path } : {}),
      });
      base.current = res.opened;
      edited.current = res.edited;
      serverDirty.current = isDirty;
      sent.current = drawing;
      setUnsent(!same(drawing, nowRef.current()));
    } catch (err) {
      const refusal = (err as { body?: { busy?: boolean; conflict?: boolean } }).body;
      if (refusal?.conflict) {
        conflict.current = true;
        setMessage({ text: "Another drawing was opened in another app or window. This one’s changes are only here now: Save keeps them in a file of their own.", ok: false });
      } else if (refusal?.busy) {
        setMessage({ text: "Plot is drawing. Changes here reach it once it has finished.", ok: false });
      }
      // Anything else - the server away for a moment - is tried again by the poll below.
    }
  }, [setMessage, setUnsent]);

  const sendNow = useCallback(() => {
    const run = send().finally(() => {
      if (sending.current === run) sending.current = null;
    });
    sending.current = run;
    return run;
  }, [send]);

  /** Send whatever is waiting, now, and wait for it: before going to another app, or saving. */
  const flush = useCallback(async () => {
    if (sending.current) await sending.current;
    if (!conflict.current && (timer.current !== undefined || unsentRef.current)) await sendNow();
  }, [sendNow]);

  // A moment after each change - not every frame of a drag - the drawing goes to the server. Only
  // when there's something it hasn't got: a drawing just opened, unchanged, is there as its file
  // has it, and a blank page is no drawing at all.
  useEffect(() => {
    if (!ready || conflict.current) return;
    const drawing = now();
    if (same(sent.current, drawing)) {
      setUnsent(false);
      return;
    }
    if ((!differsFromFile(drawing) && !serverDirty.current) || (base.current === null && !shapes.length)) {
      sent.current = drawing;
      setUnsent(false);
      return;
    }
    setUnsent(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void sendNow();
    }, 500);
  }, [ready, shapes, fills, layers, page, name, touches]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving with changes not sent - a reload, a closed tab - asks first, in the browser's own words.
  // Asked of the ref at that moment, so going to another app straight after sending doesn't ask.
  useEffect(() => {
    const hold = (e: BeforeUnloadEvent) => {
      if (unsentRef.current || conflict.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, []);

  // Going to another app sends what's waiting first. Refused for now - Plot drawing - the page stays.
  useEffect(() => whenLeaving(async () => {
    await flush();
    return conflict.current || unsentRef.current
      ? "This drawing’s latest changes haven’t reached the other apps yet. Wait for Plot to finish, or save them."
      : null;
  }), [flush]);

  // ---- Picking up the current drawing ----

  const onCurrentRef = useRef(onCurrent);
  onCurrentRef.current = onCurrent;

  /** The current drawing, put on screen by the app. */
  const take = useCallback((current: Current) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    base.current = current.empty ? null : current.opened;
    edited.current = current.empty ? null : current.edited;
    serverDirty.current = Boolean(current.dirty);
    conflict.current = false;
    onCurrentRef.current(current);
  }, []);

  // On starting: the current drawing, whichever app it was last in - or, first, work kept in this
  // browser from before there was one, which the app puts back and which is then sent as its own.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resumed = beforeStart ? await beforeStart().catch(() => false) : false;
      if (cancelled) return;
      if (!resumed) {
        try {
          const current = await api<Current>("/api/current");
          if (cancelled) return;
          take(current);
        } catch {
          if (!cancelled) setMessage({ text: "Can’t reach the server. Is server.py running?", ok: false });
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Changed or replaced somewhere else - Plot opened another file, the other Mac, another window:
  // picked up here, unless this page has changes of its own on the way, which go over it instead.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let poll: number | undefined;
    const look = async () => {
      try {
        if (conflict.current) return;
        if (unsentRef.current || sending.current) {
          // Refused for a moment - Plot drawing, the server away: tried again.
          if (unsentRef.current && !sending.current && timer.current === undefined) await sendNow();
          return;
        }
        const st = await api<{ file: string | null; file_opened: string | null; file_edited: string | null }>("/api/status");
        if (cancelled || unsentRef.current || sending.current) return;
        const theirs = st.file ? st.file_opened : null;
        if (theirs === base.current && (theirs === null || st.file_edited === edited.current)) return;
        const current = await api<Current>("/api/current");
        if (cancelled || unsentRef.current || sending.current) return;
        take(current);
      } catch {
        // The server away for a moment: looked at again on the next round.
      } finally {
        if (!cancelled) poll = window.setTimeout(look, 2000);
      }
    };
    poll = window.setTimeout(look, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(poll);
    };
  }, [ready, sendNow, take]);

  // ---- The file's side ----

  /**
   * The current drawing, read and on screen: the file it lives in, if any, and whether it has changes
   * not saved. Given the very arrays the app put on screen, so nothing is taken for a change.
   */
  const loaded = useCallback((current: Current, drawing: Drawing & { unsupported: number }) => {
    const stem = current.name.replace(/\.svg$/i, "");
    setName(stem);
    setSaved(current.path ? { path: current.path, folder: current.folder ?? "" } : null);
    setSaveTo(current.save_to);
    // Once edited, the current drawing holds only what an editor could redraw; the marks it couldn't
    // are still in the file, and still guard it.
    setForeign(current.dirty ? current.foreign : drawing.unsupported);
    setOpenedAs(current.path ? fileOf(current.path) : null);
    const shown = { ...drawing, name: stem, touches };
    sent.current = shown;
    setUnsent(false);
    if (current.dirty) {
      onDisk.current = null;
      setDirty(true);
    } else {
      markClean(shown);
    }
  }, [markClean, touches]);

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
      base.current = null; // a new drawing: sent as one, in place of the current
      onDisk.current = null; // on screen and nowhere else: there is something to save
    }
    setForeign((was) => (res.added ? was : 0) + unsupported);
  }, []);

  /**
   * A new drawing that isn't in a file yet, in place of the current one. Given what it starts as, that
   * is taken as nothing to save - an empty page isn't unsaved work; without, it is new work to be saved.
   */
  const started = useCallback((newName: string, clean?: Drawing) => {
    setName(newName);
    setSaved(null);
    setSaveTo(null);
    setForeign(0);
    setOpenedAs(null);
    conflict.current = false;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    // No current drawing until something is drawn: Plot shows none, rather than the one replaced.
    if (base.current !== null) api("/api/current", { method: "DELETE" }).catch(() => {});
    base.current = null;
    edited.current = null;
    serverDirty.current = false;
    if (clean) {
      const blank = { ...clean, name: newName, touches };
      markClean(blank);
      sent.current = blank;
    } else {
      onDisk.current = null;
      setDirty(true);
    }
  }, [markClean, touches]);

  /**
   * Unsaved work kept in the browser from before there was one current drawing, put back: the file it
   * belongs to, as it was, and - since none of it is on disk - all of it still to save. Sent as a new
   * current drawing, still belonging to that file.
   */
  const resumed = useCallback((state: FileState) => {
    setName(state.name);
    setSaved(state.saved);
    setSaveTo(state.saveTo);
    setForeign(state.foreign);
    setOpenedAs(state.openedAs);
    base.current = null;
    onDisk.current = null;
    setDirty(true);
  }, []);

  /** A file made the current drawing, handed back to be put on screen. Null when it couldn't be, said. */
  const openPath = useCallback(async (path: string): Promise<Current | null> => {
    try {
      return await postJSON<Current>("/api/open?svg=1", { path });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
      return null;
    }
  }, [setMessage]);

  /** A file made the current drawing and put on screen here. */
  const open = useCallback(async (path: string) => {
    const current = await openPath(path);
    if (current) take(current);
    return Boolean(current);
  }, [openPath, take]);

  // Write the drawing into its file, or a new one. Returns where it landed, or null on failure.
  const save = async (): Promise<Saved> => {
    if (!shapes.length) {
      setMessage({ text: "Draw something first", ok: false });
      return null;
    }
    // A drawing only partly understood here is written back from the shapes it holds, which would
    // drop the rest. Saving a copy is allowed; overwriting the original is not.
    if (foreign > 0 && cleanFileName(name) === openedAs) {
      setMessage({
        text: `${openedAs} has ${foreign} ${foreign === 1 ? "mark" : "marks"} that can’t be redrawn here. Give it another name to save a copy.`,
        ok: false,
      });
      return null;
    }
    setBusy(true);
    try {
      // To the current drawing first, so the file is saved from what Plot shows, with Plot's choices.
      const apart = conflict.current;
      if (!apart) await flush();
      const drawing = now();
      const svg = buildSvg(shapes, fills, layers, page, { paperSizeId: sizeId, toolName, fonts });
      // Only the drawing's own file is written over. A drawing never saved, or saved under a new name,
      // that lands on a name already taken is numbered by the server instead - a new drawing is named
      // after its picture, and two pictures can share a name.
      const ownFile = saved !== null && openedAs !== null && cleanFileName(name) === cleanFileName(openedAs);
      const res = await postJSON<{ name: string; path: string; folder: string; edited: string | null }>("/api/studio/save", {
        name: cleanFileName(name),
        svg,
        replace: ownFile,
        // Next to the file that was opened, so a drawing opened from the Desktop is saved back to the
        // Desktop. A drawing never saved goes to the server's default, the shared iCloud folder.
        ...(saved ? { folder: folderPathOf(saved.path) } : saveTo ? { folder: saveTo } : {}),
        ...(!apart && base.current !== null ? { current: base.current } : {}),
      });
      const where = { path: res.path, folder: res.folder };
      const savedName = res.name.replace(/\.svg$/i, "");
      setName(savedName);
      setSaved(where);
      setSaveTo(null);
      // What's on disk now is exactly what's held here, whatever the file used to contain.
      setForeign(0);
      setOpenedAs(res.name);
      remember(LAST_FOLDER_KEY, folderPathOf(res.path));
      const written = { ...drawing, name: savedName };
      markClean(written);
      if (res.edited) {
        edited.current = res.edited;
        serverDirty.current = false;
        sent.current = written;
      }
      const asked = cleanFileName(name);
      setMessage({
        text: res.name.toLowerCase() === asked.toLowerCase()
          ? `Saved to ${res.folder}`
          : `Saved as ${savedName} in ${res.folder}: there was already a drawing called ${asked.replace(/\.svg$/i, "")}`,
        ok: true,
      });
      // Saved apart from the current drawing, which another app had replaced: this file is the
      // current drawing now, so the apps agree again.
      if (apart) await open(res.path);
      return where;
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * A snapshot: the drawing as it stands, its image layers baked into the lines they draw now, saved
   * as a new file beside it - or in the shared folder, before it's saved - for carrying on with as
   * plain paths, or plotting as it is. The drawing itself is left as it was: not saved, not renamed,
   * its images still the images. Returns where the snapshot landed, or null.
   */
  const snapshot = async (): Promise<{ name: string; path: string; folder: string } | null> => {
    if (!shapes.length) {
      setMessage({ text: "Draw something first", ok: false });
      return null;
    }
    setBusy(true);
    try {
      const svg = buildSvg(snapshotShapes(shapes), fills, layers, page, { paperSizeId: sizeId, toolName, fonts });
      return await postJSON<{ name: string; path: string; folder: string }>("/api/studio/save", {
        name: cleanFileName(snapshotName(name)),
        svg,
        ...(saved ? { folder: folderPathOf(saved.path) } : saveTo ? { folder: saveTo } : {}),
      });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Another app, on this drawing - changes not saved included - in this tab. */
  const goTo = async (app: AppName) => {
    const refused = await goToApp(app);
    if (refused) setMessage({ text: refused, ok: false });
  };

  /**
   * A saved file - a snapshot - made the current drawing and shown in another app. What's on screen
   * here is left behind: the caller has asked about anything not saved.
   */
  const openIn = async (app: AppName, path: string) => {
    const current = await openPath(path);
    if (!current) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (sending.current) await sending.current.catch(() => {});
    base.current = current.opened;
    edited.current = current.edited;
    conflict.current = false;
    sent.current = nowRef.current();
    setUnsent(false);
    await goTo(app);
  };

  const fileState: FileState = { name, saved, saveTo, foreign, openedAs };

  return { name, setName, saved, dirty, unsent, touch, loaded, combined, started, resumed, fileState, save, snapshot, open, goTo, openIn };
}
