import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonRound, Card, InputSelect, InputText } from "@tomcoggia/ui";
import { Circle, FolderOpen, Minus, Ratio, Square, Trash2 } from "lucide-react";
import { FileBrowser, type OpenResult } from "../components/FileBrowser";
import { Section } from "../components/controls/Section";
import controls from "../components/controls/controls.module.css";
import { api, postJSON } from "../lib/api";
import { load, save as remember } from "../lib/storage";
import { PAPER_SIZES } from "../lib/constants";
import { fmtIn } from "../lib/format";
import { Canvas } from "./components/Canvas";
import { StudioHeader } from "./components/StudioHeader";
import { parseDrawing } from "./lib/parse";
import { boxOf, shapeName, type Page, type Shape, type ShapeKind } from "./lib/shapes";
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

const TOOLS: { kind: ShapeKind; label: string; icon: JSX.Element }[] = [
  { kind: "rect", label: "Rectangle", icon: <Square /> },
  { kind: "ellipse", label: "Ellipse", icon: <Circle /> },
  { kind: "line", label: "Line", icon: <Minus /> },
];

// The layer the shapes are written into. Named after a pen, because a layer whose name matches one of
// a tool's pens takes that pen's color when the drawing is opened in Plot (see docs/studio.md).
const LAYER_NAME = "Black";

// The drawing being worked on, remembered so that handing one to Plot - which navigates away - isn't
// the same as losing it. Its own key: Plot's keys share this origin and still carry the old name.
const LAST_FILE_KEY = "studio-last-file";

type Saved = { path: string; folder: string } | null;

export default function App() {
  const [page, setPage] = useState<Page>({ w: 11, h: 8.5 });
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<ShapeKind>("rect");
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("Untitled");
  const [saved, setSaved] = useState<Saved>(null);
  const [busy, setBusy] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  // Marks in the drawing on disk that Studio can't redraw, and the name it was opened under. Saving
  // rewrites a file from the shapes Studio holds, so overwriting that file would delete them.
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

  const addShape = useCallback((shape: Shape) => {
    setShapes((list) => [...list, shape]);
    setSelected(shape.id);
  }, []);

  const removeShape = (id: string) => {
    setShapes((list) => list.filter((s) => s.id !== id));
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
      const svg = buildSvg(shapes, page, LAYER_NAME, sizeId);
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
    setSelected(null);
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

  const setSize = (id: string) => {
    const size = SIZES.find((s) => s.id === id);
    if (!size) return;
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
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            onAdd={addShape}
          />
        </section>

        <div className={styles.side}>
          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <Section
                title="Drawing"
                action={
                  <ButtonRound
                    size="sm"
                    icon={<FolderOpen />}
                    aria-label="Open a drawing"
                    title="Open a drawing to carry on with"
                    disabled={busy}
                    onClick={() => setBrowserOpen(true)}
                  />
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
              </Section>
            </div>
          </Card>

          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <Section
                title="Shapes"
                action={
                  shapes.length ? (
                    <ButtonRound
                      size="sm"
                      icon={<Trash2 />}
                      aria-label="Delete every shape"
                      title="Delete every shape on the page"
                      disabled={busy}
                      onClick={() => {
                        setShapes([]);
                        setSelected(null);
                      }}
                    />
                  ) : undefined
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
                      title={`Draw a ${t.label.toLowerCase()}: drag on the page`}
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
                          onPointerEnter={() => setSelected(s.id)}
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

          <Card variant="flat" className={styles.controls}>
            <div className={styles.cardBody}>
              <Section
                title="Page"
                action={
                  <ButtonRound
                    size="sm"
                    icon={<Ratio />}
                    aria-label="Turn the page"
                    title="Turn the page: swap its width and height"
                    onClick={() => setPage((p) => ({ w: p.h, h: p.w }))}
                  />
                }
              >
                <InputSelect
                  size="md"
                  label="Size"
                  value={sizeId}
                  onChange={(e) => setSize(e.target.value)}
                >
                  {SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </InputSelect>
                <p className={controls.dimensions}>
                  {`${fmtIn(page.w)} × ${fmtIn(page.h)}`}
                </p>
              </Section>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
