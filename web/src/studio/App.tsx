import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonRound, Card, Checkbox, InputSelect, InputText } from "@tomcoggia/ui";
import { Circle, FolderOpen, Grid2x2, Minus, MousePointer2, Ratio, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { FileBrowser, type OpenResult } from "../components/FileBrowser";
import { Section } from "../components/controls/Section";
import controls from "../components/controls/controls.module.css";
import { api, postJSON } from "../lib/api";
import { load, save as remember } from "../lib/storage";
import { PAPER_SIZES } from "../lib/constants";
import { fmtIn } from "../lib/format";
import { Canvas, type Tool } from "./components/Canvas";
import { StudioHeader } from "./components/StudioHeader";
import { canFill, newFillId, type Fill } from "./lib/hatch";
import { parseDrawing } from "./lib/parse";
import { boxOf, shapeName, type Page, type Shape } from "./lib/shapes";
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
];

// The layer the shapes are written into. Named after a pen, because a layer whose name matches one of
// a tool's pens takes that pen's color when the drawing is opened in Plot (see docs/studio.md).
const LAYER_NAME = "Black";

// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
const LAST_FILE_KEY = "studio-last-file";

// Undo keeps whole copies of the drawing rather than a list of changes: a drawing is a handful of
// shapes, so a copy costs nothing, and there's no way for a replayed change to go wrong.
interface Snapshot {
  shapes: Shape[];
  fills: Fill[];
  page: Page;
}
const HISTORY_LIMIT = 60;

type Saved = { path: string; folder: string } | null;

export default function App() {
  const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [pageOpen, setPageOpen] = useState(false);
  // A tool's measured hatch numbers are the sensible starting point for a new fill, and they live in
  // Plot's presets rather than being invented here.
  const [defaults, setDefaults] = useState({ angle: 45, spacingMm: 1.5 });
  const [tool, setTool] = useState<Tool>("rect");
  const [selected, setSelected] = useState<string | null>(null);
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
  }, [shapes, page, name]);

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
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), { shapes, fills, page }]);
    setFuture([]);
  }, [shapes, fills, page]);

  const step = useCallback(
    (from: Snapshot[], to: Snapshot[], setFrom: typeof setPast, setTo: typeof setFuture, take: "last" | "first") => {
      if (!from.length) return;
      const next = take === "last" ? from[from.length - 1] : from[0];
      setFrom(take === "last" ? from.slice(0, -1) : from.slice(1));
      setTo([{ shapes, fills, page }, ...to].slice(0, HISTORY_LIMIT));
      setShapes(next.shapes);
      setFills(next.fills);
      setPage(next.page);
      // A shape that isn't there any more can't stay selected, or its handles would hang in the air.
      setSelected((id) => (next.shapes.some((s) => s.id === id) ? id : null));
    },
    [shapes, fills, page],
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
    setShapes((list) => [...list, shape]);
    setSelected(shape.id);
    setTool("select"); // what you want next is nearly always to nudge the thing you just drew
  }, [record]);

  const updateShape = useCallback((shape: Shape) => {
    setShapes((list) => list.map((s) => (s.id === shape.id ? shape : s)));
  }, []);

  const removeShape = (id: string) => {
    record();
    setShapes((list) => list.filter((s) => s.id !== id));
    setFills((list) => list.filter((f) => f.shapeId !== id));
    setSelected((current) => (current === id ? null : current));
  };

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
      const svg = buildSvg(shapes, fills, page, LAYER_NAME, sizeId);
      const res = await postJSON<{ name: string; path: string; folder: string }>("/api/studio/save", {
        name: cleanFileName(name),
        svg,
      });
      const where = { path: res.path, folder: res.folder };
      setName(res.name.replace(/\.svg$/i, ""));
      setSaved(where);
      // What's on disk now is exactly what Studio holds, whatever the file used to contain.
      setForeign(0);
      setOpenedAs(res.name);
      remember(LAST_FILE_KEY, res.path);
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

  // Save if there's anything new, then hand the drawing to Plot and go there. Plot picks up whatever
  // drawing is loaded when its page opens, so nothing has to be passed in the URL.
  const openInPlot = async () => {
    const where = dirty.current || !saved ? await save() : saved;
    if (!where) return;
    setBusy(true);
    try {
      await postJSON("/api/open", { path: where.path });
      window.location.href = "/";
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
      setBusy(false);
    }
  };

  const openDrawing = useCallback((res: OpenResult, note: (n: number) => string) => {
    const drawing = parseDrawing(res.svg ?? "");
    setPage(drawing.page);
    setShapes(drawing.shapes);
    setFills(drawing.fills);
    setSelected(null);
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
        await api("/api/info");
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

  useEffect(() => {
    api<{ presets: { hatch?: { angle?: number; spacing_mm?: number } }[] }>("/api/presets")
      .then(({ presets }) => {
        const measured = presets.find((t) => t.hatch?.spacing_mm);
        if (measured?.hatch) {
          setDefaults({ angle: measured.hatch.angle ?? 45, spacingMm: measured.hatch.spacing_mm! });
        }
      })
      .catch(() => {}); // no presets is not a reason to stop; the fallback numbers stand
  }, []);

  const chosen = shapes.find((s) => s.id === selected) ?? null;
  // In order, so the first is the hatch and the second is the cross-hatch laid over it.
  const chosenFills = chosen ? fills.filter((f) => f.shapeId === chosen.id) : [];

  const newFill = (angle: number): Fill => ({
    id: newFillId(),
    shapeId: chosen!.id,
    angle,
    spacingMm: defaults.spacingMm,
    scale: 100,
  });

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

  const setOutline = (on: boolean) => {
    if (!chosen) return;
    record();
    setShapes((list) => list.map((s) => (s.id === chosen.id ? { ...s, outline: on } : s)));
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

      <main className={styles.layout}>
        <section className={styles.stage} aria-label="Drawing page">
          <Canvas
            page={page}
            shapes={shapes}
            fills={fills}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
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
                      icon={<Grid2x2 />}
                      className={pageOpen ? controls.roundActive : undefined}
                      aria-label="Page size"
                      aria-pressed={pageOpen}
                      title={`Page size: ${fmtIn(page.w)} × ${fmtIn(page.h)}`}
                      onClick={() => setPageOpen((v) => !v)}
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

                {pageOpen && (
                  <div className={styles.pageRow}>
                    <InputSelect size="md" label="Page size" value={sizeId} onChange={(e) => setSize(e.target.value)}>
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
                )}
              </Section>
            </div>
          </Card>

          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <Section
                title="Shapes"
                action={
                  <span className={styles.headerTools}>
                    <ButtonRound
                      size="sm"
                      icon={<Undo2 />}
                      aria-label="Undo"
                      title="Undo the last change"
                      disabled={busy || !past.length}
                      onClick={undo}
                    />
                    <ButtonRound
                      size="sm"
                      icon={<Redo2 />}
                      aria-label="Redo"
                      title="Redo the change just undone"
                      disabled={busy || !future.length}
                      onClick={redo}
                    />
                  {shapes.length ? (
                    <ButtonRound
                      size="sm"
                      icon={<Trash2 />}
                      aria-label="Delete every shape"
                      title="Delete every shape on the page"
                      disabled={busy}
                      onClick={() => {
                        record();
                        setShapes([]);
                        setFills([]);
                        setSelected(null);
                      }}
                    />
                  ) : null}
                  </span>
                }
              >
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

                {shapes.length === 0 ? (
                  <p className={styles.empty}>Drag on the page to draw one.</p>
                ) : (
                  <ul className={styles.shapeList}>
                    {shapes.map((s, i) => {
                      const b = boxOf(s);
                      return (
                        <li
                          key={s.id}
                          className={styles.shapeRow}
                          data-selected={s.id === selected}
                        >
                          <button
                            type="button"
                            className={styles.shapePick}
                            onClick={() => setSelected(s.id)}
                          >
                            <span>{shapeName(s, i)}</span>
                            <span className={styles.shapeSize}>
                              {`${fmtIn(b.x1 - b.x0)} × ${fmtIn(b.y1 - b.y0)}`}
                            </span>
                          </button>
                          <ButtonRound
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 />}
                            aria-label={`Delete ${shapeName(s, i)}`}
                            onClick={() => removeShape(s.id)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </div>
          </Card>

          {chosen && canFill(chosen) && (
            <Card variant="flat" className={styles.controls}>
              <div className={styles.cardBody}>
                <Section title="Fill">
                  <Checkbox
                    checked={chosenFills.length > 0}
                    label="Hatch this shape"
                    onChange={(e) => setFillAt(0, e.target.checked ? newFill(defaults.angle) : null)}
                  />
                  {chosenFills.map((fill, i) => (
                    <div key={fill.id} className={styles.fillRow}>
                      <InputText
                        size="md"
                        label={i === 0 ? "Angle (°)" : "Cross angle (°)"}
                        type="number"
                        step={5}
                        value={String(fill.angle)}
                        onChange={(e) => setFillAt(i, { ...fill, angle: Number(e.target.value) || 0 })}
                      />
                      <InputText
                        size="md"
                        label="Spacing (mm)"
                        type="number"
                        step={0.1}
                        min={0.05}
                        value={String(fill.spacingMm)}
                        onChange={(e) =>
                          setFillAt(i, { ...fill, spacingMm: Math.max(0.05, Number(e.target.value) || 0.05) })
                        }
                      />
                    </div>
                  ))}
                  {chosenFills.length > 0 && (
                    <Checkbox
                      checked={chosenFills.length > 1}
                      label="Cross-hatch"
                      onChange={(e) =>
                        // A second pass square to the first, which is what makes it read as a mesh
                        // rather than as two hatchings that happen to share a shape.
                        setFillAt(1, e.target.checked ? newFill((chosenFills[0].angle + 90) % 180) : null)
                      }
                    />
                  )}
                  <Checkbox
                    checked={chosen.outline !== false}
                    label="Draw the outline too"
                    onChange={(e) => setOutline(e.target.checked)}
                  />
                  <p className={styles.empty}>
                    {chosen.outline === false
                      ? "Only the hatching is plotted. The shape stays in the file so the fill can be changed."
                      : "Spacing is what it measures on the paper, so it holds at any plot size."}
                  </p>
                </Section>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
