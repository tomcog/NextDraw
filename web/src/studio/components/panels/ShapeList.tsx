import { ButtonRound, LayerController } from "@tomcoggia/ui";
import { EllipsisVertical, Image as ImageIcon, Trash2 } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import controls from "../../../shared/components/controls/controls.module.css";
import { trimNum } from "../../../shared/lib/format";
import { boxOf, shapeName, type Layer, type Shape } from "../../lib/shapes";
import styles from "../../App.module.css";

/** How many shapes are listed by name. A separation's layer is tens of thousands of marks. */
const SHAPE_LIST_LIMIT = 200;

interface Props {
  layer: Layer;
  /** What is on the layer, in drawing order. */
  shapes: Shape[];
  picked: Set<string>;
  busy: boolean;
  /** The shape whose name is open for typing into, if any. */
  renaming: string | null;
  /** The shape whose row menu is open, if any. */
  rowMenuId: string | undefined;
  /** Pick a shape from its row: alone, or added to (or taken out of) the selection with Shift. */
  onPick: (id: string, add: boolean) => void;
  onDeleteAll: () => void;
  onRenameType: (id: string, name: string) => void;
  /** Escape: put back the name it had before. */
  onRenameCancel: (id: string) => void;
  /** The name field left: keep what was typed. */
  onRenameDone: (id: string) => void;
  onRowMenu: (id: string, anchor: HTMLElement) => void;
}

/**
 * The shapes on the active layer, a row each: picking from the list, renaming, and each shape's menu.
 * Only while there is something on the layer: a heading over a line saying there is nothing under
 * it is two lines to say one thing.
 */
export function ShapeList({ layer, shapes, picked, busy, renaming, rowMenuId, onPick, onDeleteAll, onRenameType, onRenameCancel, onRenameDone, onRowMenu }: Props) {
  if (!shapes.length) return null;
  return (
    <Section
      // The layer's ink in front of its name - after the "On", so the dot reads as part
      // of the name rather than as a bullet before the whole heading. A mark to read,
      // not a control: picking the colour is the swatch in the row above.
      title={(
        <>
          On
          <span className={controls.legendDot} style={{ background: layer.color }} aria-hidden />
          {layer.name}
        </>
      )}
      collapsibleKey="shapes-on-layer"
      // Folded each time a layer is picked, and opened only by a click: a layer of hundreds of
      // paths would otherwise unroll them all down the panel just for being chosen.
      key={layer.id}
      defaultOpen={false}
      forget
      action={
        <ButtonRound size="sm" icon={<Trash2 />} aria-label="Delete everything on this layer"
          title="Delete every shape on this layer" disabled={busy} onClick={onDeleteAll} />
      }
    >
      <ul className={styles.shapeList}>
        {shapes.slice(0, SHAPE_LIST_LIMIT).map((sh, i) => {
          const b = boxOf(sh);
          const name = shapeName(sh, i);
          return (
            // The same row a layer has: its number, its name, and the same kebab
            // after it - with the size where a layer keeps its eye.
            <li key={sh.id} className={styles.layerRow}>
              <LayerController
                // A group of its own per row: several shapes can be picked at once,
                // and a browser only ever lets one radio of a group be on.
                name={`studio-shape-${sh.id}`}
                purpose="draw"
                // No numeral: a layer is numbered because it is plotted in that
                // order, and a shape on it isn't. The row still says which it is to a
                // screen reader, below.
                number={null}
                // No swatch: everything on a layer draws in that layer's one ink, and
                // the row right above says which it is.
                hideVisibility
                hideHandle
                // A photo isn't drawn like the other shapes, so its row says so in the box.
                icon={sh.kind === "photo" ? <ImageIcon /> : undefined}
                checked={picked.has(sh.id)}
                aria-label={`Shape ${i + 1}, ${name}`}
                // The click decides, not the box: several shapes can be picked, which
                // a radio would otherwise undo for us. Shift adds one to the selection
                // or takes it out; a plain click picks that shape alone.
                onChange={() => {}}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(sh.id, e.shiftKey);
                }}
                label={
                  <span className={styles.shapeLabel}>
                    {/* The name is text: clicking the row picks the shape, and a field
                      sitting here would take the caret and quietly eat whatever was
                      typed next. Renaming is asked for from the kebab. */}
                    {renaming === sh.id ? (
                      <input
                        className={`${styles.shapeName} ${styles.shapeNameEdit}`}
                        data-renaming
                        value={name}
                        aria-label={`Name of ${name}`}
                        autoFocus
                        disabled={busy}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => onRenameType(sh.id, e.target.value)}
                        onBlur={() => onRenameDone(sh.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") onRenameCancel(sh.id);
                          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <span
                        className={picked.has(sh.id)
                          ? `${styles.shapeName} ${styles.shapeNameOn}`
                          : styles.shapeName}
                        title="Click to pick this shape"
                        onClick={(e) => onPick(sh.id, e.shiftKey)}
                      >
                        {name}
                      </span>
                    )}
                    {/* How big it is, at the end of the row. Numbers alone: the page is
                      inches throughout, and setting them is the kebab's job. */}
                    <span className={styles.shapeSize}>
                      {`${trimNum(b.x1 - b.x0, 2)} × ${trimNum(b.y1 - b.y0, 2)}`}
                    </span>
                  </span>
                }
              />
              <ButtonRound size="sm" variant="tertiary" icon={<EllipsisVertical />}
                aria-label={`More for ${name}`}
                aria-haspopup="menu"
                aria-expanded={rowMenuId === sh.id}
                title="Duplicate, move or delete this shape"
                disabled={busy}
                onClick={(e) => onRowMenu(sh.id, e.currentTarget)} />
            </li>
          );
        })}
        {shapes.length > SHAPE_LIST_LIMIT && (
          // A separation's layer is tens of thousands of marks: a row each would be a list nobody
          // reads, and the slowest thing on the page. They're picked up together instead.
          <li className={styles.empty}>
            {`And ${(shapes.length - SHAPE_LIST_LIMIT).toLocaleString()} more - too many to list. Select all on layer, from the layer’s menu, picks them all.`}
          </li>
        )}
      </ul>
    </Section>
  );
}
