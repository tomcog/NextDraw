import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { ButtonRound, LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Eye, LayersArrowUp, SwatchBook, Trash2, Waypoints, X } from "lucide-react";
import styles from "./LayersSection.module.css";
import { Section } from "./Section";
import { PaletteMenu } from "./PaletteMenu";
import type { LayerNote, LayerView, PenColor } from "../../lib/types";

interface Props {
  mode: "preview" | "work";
  onMode: (mode: "preview" | "work") => void;
  layers: LayerView[]; // in the chosen order, bottom layer (number 1) first
  target: string | null; // id of the layer chosen to print
  printed: string[]; // ids of layers plotted to the end this session
  disabled: boolean;
  onTarget: (id: string) => void;
  paletteFor: (id: string) => PenColor[]; // the colors of the layer's drawing tool; empty: the dot opens nothing
  onColor: (id: string, pen: PenColor) => void;
  onSort: () => void; // reorder lightest (layer 1) to darkest
  onMatch: (() => void) | null; // give each layer its closest pen; null when no layer has a palette to match
  note: LayerNote | null; // after Match to pens or Delete layer, with Undo
  onUndo: () => void;
  onDismissNote: () => void;
  onDelete: (id: string) => void; // delete a layer from the drawing (asked here first)
  onVisible: (id: string, visible: boolean) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, to: number) => void; // to: a position in the chosen order, 0 = bottom
}

interface Drag {
  id: string;
  pointerId: number;
  grabOffset: number; // pointer distance from the row's top when it was picked up
}

const SLIDE_MS = 200;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// The drawing's layers, listed like Illustrator's Layers panel: the top layer at the top and
// layer 1, the bottom layer, last. The box picks the one layer to print; names are edited in
// place; rows are dragged by their grip (or moved with the arrow keys on it) to reorder.
export function LayersSection({ mode, onMode, layers, target, printed, disabled, onTarget, paletteFor, onColor, onSort, onMatch, note, onUndo, onDismissNote, onDelete, onVisible, onRename, onMove }: Props) {
  // In Plot mode the layers hidden in Preview mode leave the list, and the eye goes. Numbers stay the
  // plot-order numbers from the full list.
  const numberOf = new Map(layers.map((l, i) => [l.id, i + 1]));
  const rows = [...layers].reverse().filter((l) => mode === "preview" || !l.hidden);
  const count = layers.length;
  const listRef = useRef<HTMLOListElement>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const lastTops = useRef(new Map<string, number>());
  const pointerY = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuLayer = colorMenu ? layers.find((l) => l.id === colorMenu.id) : null;
  // Delete asks first, in the card: the layer to delete, or null.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Delete is part of Plot mode, where one layer is chosen; leaving it drops the question.
  useEffect(() => setConfirmDelete(null), [mode]);
  const deleting = confirmDelete ? layers.find((l) => l.id === confirmDelete) : null;
  const targetLayer = layers.find((l) => l.id === target);

  // Where the dragged row should sit, in list coordinates: under the pointer, kept inside the list.
  const dragTop = (d: Drag) => {
    const list = listRef.current!;
    const last = items.current.get(rows[rows.length - 1]?.id);
    const max = last ? last.offsetTop : 0;
    return Math.max(0, Math.min(max, pointerY.current - d.grabOffset - list.getBoundingClientRect().top));
  };

  // After every render: rows whose place changed slide from where they were to where they are now
  // (FLIP), and the dragged row stays glued to the pointer wherever the list put it.
  useLayoutEffect(() => {
    const animate = !reducedMotion();
    for (const [id, li] of items.current) {
      const top = li.offsetTop;
      if (drag?.id === id) {
        li.style.transition = "none";
        li.style.transform = `translateY(${dragTop(drag) - top}px)`;
      } else {
        const before = lastTops.current.get(id);
        if (animate && before !== undefined && before !== top) {
          li.style.transition = "none";
          li.style.transform = `translateY(${before - top}px)`;
          void li.offsetHeight; // commit the start position before sliding
          li.style.transition = `transform ${SLIDE_MS}ms ease`;
          li.style.transform = "";
        }
      }
      lastTops.current.set(id, top);
    }
  });

  // Moving a row can take focus with it; put it back on the grip that was used.
  useEffect(() => {
    if (refocus == null) return;
    handles.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus, layers]);

  // Drop: the row glides from under the pointer into its slot.
  const finishDrag = () => {
    setDrag((d) => {
      if (!d) return d;
      const li = items.current.get(d.id);
      if (li) {
        li.style.transition = reducedMotion() ? "none" : `transform ${SLIDE_MS}ms ease`;
        li.style.transform = "";
      }
      return null;
    });
  };

  // End a drag however the pointer is released, even outside the grip or the window.
  useEffect(() => {
    if (!drag) return;
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("blur", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  // Positions below are in the chosen order (0 = bottom layer); the list shows them reversed.
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, id: string, position: number) => {
    const to = e.key === "ArrowUp" ? position + 1 : e.key === "ArrowDown" ? position - 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (to < 0 || to >= count) return;
    onMove(id, to);
    setRefocus(id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    const li = items.current.get(id);
    if (disabled || e.button !== 0 || !li) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keeps the moves coming if the pointer leaves the grip
    } catch {
      // not a live pointer (synthetic events); dragging still works while over the grip
    }
    e.preventDefault();
    pointerY.current = e.clientY;
    setDrag({ id, pointerId: e.pointerId, grabOffset: e.clientY - li.getBoundingClientRect().top });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId || !listRef.current) return;
    pointerY.current = e.clientY;
    const li = items.current.get(drag.id);
    if (!li) return;
    const top = dragTop(drag);
    li.style.transform = `translateY(${top - li.offsetTop}px)`;
    // Rows are one height apart, so the slot under the dragged row's middle is a division away.
    const first = items.current.get(rows[0].id);
    const second = rows[1] ? items.current.get(rows[1].id) : null;
    const pitch = first && second ? second.offsetTop - first.offsetTop : li.offsetHeight;
    const to = Math.max(0, Math.min(rows.length - 1, Math.round(top / pitch)));
    const from = rows.findIndex((l) => l.id === drag.id);
    if (to !== from) onMove(drag.id, numberOf.get(rows[to].id)! - 1);
  };

  return (
    <Section
      title="Layers"
      action={
        <span className={styles.headerTools}>
        {mode === "work" && count > 1 && (
          <ButtonRound
            size="sm"
            icon={<Trash2 />}
            aria-label={targetLayer ? `Delete layer ${targetLayer.name}` : "Delete layer"}
            title={targetLayer ? `Delete “${targetLayer.name}” from the drawing` : "Delete layer: select a layer first"}
            disabled={disabled || !targetLayer}
            onClick={() => targetLayer && setConfirmDelete(targetLayer.id)}
          />
        )}
        {mode === "preview" && onMatch && (
          <ButtonRound
            size="sm"
            icon={<SwatchBook />}
            aria-label="Match layers to pens"
            title="Match to pens: give each layer the closest color from its drawing tool's palette"
            disabled={disabled}
            onClick={onMatch}
          />
        )}
        {mode === "preview" && count > 1 && (
          <ButtonRound
            size="sm"
            icon={<LayersArrowUp />}
            aria-label="Sort layers by darkness"
            title="Sort by darkness: lightest color is layer 1, darker colors stack on top"
            disabled={disabled}
            onClick={onSort}
          />
        )}
        <SegmentedControl size="sm" aria-label="Layers view">
          <Segment selected={mode === "preview"} onClick={() => onMode("preview")} icon={<Eye />} aria-label="Preview" title="Preview: arrange the drawing - show, hide and reorder layers" />
          <Segment selected={mode === "work"} onClick={() => onMode("work")} icon={<Waypoints />} aria-label="Plot" title="Plot: layer by layer - only the layer to print is drawn" />
        </SegmentedControl>
        </span>
      }
    >
      {deleting ? (
        <div className={styles.match} role="alertdialog" aria-label={`Delete layer ${deleting.name}?`}>
          <div className={styles.matchHead}>
            <span>{`Delete layer ${numberOf.get(deleting.id)}, “${deleting.name}”, from the drawing?`}</span>
          </div>
          <div className={styles.confirmRow}>
            <button type="button" className={styles.matchUndo} data-tone="plain" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button type="button" className={styles.matchUndo} data-tone="danger" disabled={disabled} autoFocus
              onClick={() => { setConfirmDelete(null); onDelete(deleting.id); }}>Delete</button>
          </div>
        </div>
      ) : note && (
        <div className={styles.match} role="status">
          <div className={styles.matchHead}>
            <span>{note.title}</span>
            <button type="button" className={styles.matchUndo} disabled={disabled} onClick={onUndo}>Undo</button>
            <ButtonRound size="sm" variant="ghost" icon={<X />} aria-label="Dismiss" title="Keep the change and close this note" onClick={onDismissNote} />
          </div>
          {note.lines.map((line) => (
            <p key={line.text} className={styles.matchNote} data-tone={line.warn ? "warn" : undefined}>{line.text}</p>
          ))}
        </div>
      )}
      <ol className={styles.list} ref={listRef} data-dragging={Boolean(drag)}>
        {rows.map((layer) => {
          const i = numberOf.get(layer.id)! - 1; // position in the chosen order
          return (
            <li
              key={layer.id}
              ref={(el) => {
                if (el) items.current.set(layer.id, el);
                else {
                  items.current.delete(layer.id);
                  lastTops.current.delete(layer.id);
                }
              }}
              className={styles.row}
              data-skipped={layer.skipped}
              data-dragging={drag?.id === layer.id}
            >
              <LayerController
                name="print-layer"
                number={i + 1}
                color={layer.color ?? (paletteFor(layer.id).length ? "transparent" : undefined)}
                swatchProps={paletteFor(layer.id).length ? {
                  "aria-label": `Pen color for ${layer.name}`,
                  "aria-haspopup": "menu",
                  "aria-expanded": colorMenu?.id === layer.id,
                  title: "Choose the pen color",
                  disabled,
                  onClick: (e) => {
                    const anchor = e.currentTarget;
                    setColorMenu((open) => (open?.id === layer.id ? null : { id: layer.id, anchor }));
                  },
                } : undefined}
                checked={target === layer.id}
                printed={printed.includes(layer.id)}
                visible={!layer.hidden}
                hideVisibility={mode === "work"}
                onVisibleChange={(visible) => onVisible(layer.id, visible)}
                disabled={disabled}
                onChange={() => onTarget(layer.id)}
                aria-label={`Print layer ${i + 1}, ${layer.name}`}
                label={<LayerName layer={layer} position={i} disabled={disabled} onRename={onRename} />}
                handleProps={{
                  ref: (el: HTMLButtonElement | null) => {
                    if (el) handles.current.set(layer.id, el);
                    else handles.current.delete(layer.id);
                  },
                  disabled: disabled || count < 2,
                  "aria-label": `Move ${layer.name}, now number ${i + 1} of ${count}. Use the up and down arrow keys.`,
                  title: "Drag to reorder",
                  onKeyDown: (e) => onHandleKey(e, layer.id, i),
                  onPointerDown: (e) => onPointerDown(e, layer.id),
                  onPointerMove,
                } as React.ButtonHTMLAttributes<HTMLButtonElement>}
              />
            </li>
          );
        })}
      </ol>
      {colorMenu && menuLayer && (
        <PaletteMenu
          anchor={colorMenu.anchor}
          palette={paletteFor(menuLayer.id)}
          current={menuLayer.color}
          onPick={(pen) => onColor(menuLayer.id, pen)}
          onClose={() => setColorMenu(null)}
        />
      )}
    </Section>
  );
}

function LayerName({ layer, position, disabled, onRename }: {
  layer: LayerView;
  position: number;
  disabled: boolean;
  onRename: (id: string, name: string) => void;
}) {
  const [draft, setDraft] = useState(layer.name);
  useEffect(() => setDraft(layer.name), [layer.name]);

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(layer.name); // an empty name isn't allowed; keep the current one
      return;
    }
    if (next !== layer.name) onRename(layer.id, next);
    setDraft(next);
  };

  return (
    <input
      aria-label={`Name of layer ${position + 1}`}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(layer.name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
