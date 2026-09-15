import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { InputText } from "@tomcoggia/ui";
import { GripVertical } from "lucide-react";
import styles from "./LayersSection.module.css";
import { Section } from "./Section";
import type { LayerView } from "../../lib/types";

interface Props {
  layers: LayerView[]; // in the chosen order, bottom layer (number 1) first
  disabled: boolean;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, to: number) => void; // to: a position in the chosen order, 0 = bottom
}

// The drawing's layers, listed like Illustrator's Layers panel: the top layer at the top and
// layer 1, the bottom layer, last. Names can be edited in place and rows dragged by their
// handle (or moved with the arrow keys) to reorder.
export function LayersSection({ layers, disabled, onRename, onMove }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const [dragging, setDragging] = useState<{ id: string; pointerId: number } | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);

  // Moving a row can take focus with it; put it back on the handle that was used.
  useEffect(() => {
    if (refocus == null) return;
    handles.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus, layers]);

  const rows = [...layers].reverse();
  const count = layers.length;

  // Positions below are in the chosen order (0 = bottom layer); the list shows them reversed.
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, id: string, position: number) => {
    const to = e.key === "ArrowUp" ? position + 1 : e.key === "ArrowDown" ? position - 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (to < 0 || to >= layers.length) return;
    onMove(id, to);
    setRefocus(id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keeps the moves coming if the pointer leaves the handle
    } catch {
      // not a live pointer (synthetic events); dragging still works while over the handle
    }
    setDragging({ id, pointerId: e.pointerId });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging || e.pointerId !== dragging.pointerId || !listRef.current) return;
    const elements = [...listRef.current.children] as HTMLElement[];
    const from = rows.findIndex((l) => l.id === dragging.id);
    // The row under the pointer: move there once the pointer passes that row's middle.
    let to = from;
    elements.forEach((row, i) => {
      const r = row.getBoundingClientRect();
      if (i < from && e.clientY < r.top + r.height / 2) to = Math.min(to, i);
      if (i > from && e.clientY > r.top + r.height / 2) to = Math.max(to, i);
    });
    if (to !== from) onMove(dragging.id, count - 1 - to);
  };

  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragging && e.pointerId === dragging.pointerId) setDragging(null);
  };

  return (
    <Section title="Layers">
      <ol className={styles.list} ref={listRef}>
        {rows.map((layer, row) => {
          const i = count - 1 - row; // position in the chosen order
          return (
          <li key={layer.id} className={styles.row} data-skipped={layer.skipped} data-dragging={dragging?.id === layer.id}>
            <span className={styles.number}>{i + 1}</span>
            <span
              className={styles.swatch}
              style={layer.color ? { background: layer.color } : undefined}
              data-empty={!layer.color}
              title={layer.colors.length ? layer.colors.join(", ") : "No stroke color"}
            />
            <div className={styles.nameCell}>
              <LayerName layer={layer} position={i} disabled={disabled} onRename={onRename} />
            </div>
            <button
              type="button"
              ref={(el) => {
                if (el) handles.current.set(layer.id, el);
                else handles.current.delete(layer.id);
              }}
              className={styles.handle}
              disabled={disabled || layers.length < 2}
              aria-label={`Move ${layer.name}, now number ${i + 1} of ${layers.length}. Use the up and down arrow keys.`}
              title="Drag to reorder"
              onKeyDown={(e) => onHandleKey(e, layer.id, i)}
              onPointerDown={(e) => onPointerDown(e, layer.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <GripVertical size={16} aria-hidden />
            </button>
          </li>
          );
        })}
      </ol>
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
    <InputText
      className={styles.nameInput}
      label={`Name of layer ${position + 1}`}
      hideLabel
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
