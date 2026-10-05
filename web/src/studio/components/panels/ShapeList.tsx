import { ButtonRound, LayerController } from "@tomcoggia/ui";
import { EllipsisVertical, Image as ImageIcon, Shapes, Trash2 } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import controls from "../../../shared/components/controls/controls.module.css";
import { trimNum } from "../../../shared/lib/format";
import { boxAround, boxOf, groupLabel, groupsOf, shapeName, type Layer, type Shape } from "../../lib/shapes";
import styles from "../../App.module.css";

/** How many rows are listed by name. A separation's layer is tens of thousands of marks. */
const SHAPE_LIST_LIMIT = 200;

interface Props {
  layer: Layer;
  /** What is on the layer, in drawing order. */
  shapes: Shape[];
  picked: Set<string>;
  busy: boolean;
  /** The path or shape whose name is open for typing into, if any: a path by its id, a shape by its group's. */
  renaming: string | null;
  /** The path or shape whose row menu is open, if any. */
  rowMenuId: string | undefined;
  /** Pick a path from its row: alone, or (`add`) put into or taken out of the selection - which the
   *  row's box always does, and its name with Shift. A shape's row picks the first of its paths,
   *  which picks the whole shape. */
  onPick: (id: string, add: boolean) => void;
  onDeleteAll: () => void;
  onRenameType: (id: string, name: string) => void;
  /** Escape: put back the name it had before. */
  onRenameCancel: (id: string) => void;
  /** The name field left: keep what was typed. */
  onRenameDone: (id: string) => void;
  onRowMenu: (id: string, anchor: HTMLElement) => void;
  /** The menu of a shape made of several paths, by its group id. */
  onGroupMenu: (groupId: string, anchor: HTMLElement) => void;
}

/** A row of the list: one path, or one shape standing for the several paths it is made of. */
type Row = { kind: "path"; shape: Shape; index: number } | { kind: "shape"; id: string; members: Shape[]; index: number };

/** The layer's paths as rows, each shape's paths as the one row, where the first of them is. */
function rowsOf(shapes: Shape[]): Row[] {
  const groups = groupsOf(shapes);
  const rows: Row[] = [];
  const listed = new Set<string>();
  shapes.forEach((sh, i) => {
    const members = sh.group ? groups.get(sh.group) : undefined;
    if (!members) {
      rows.push({ kind: "path", shape: sh, index: i });
    } else if (!listed.has(sh.group!)) {
      listed.add(sh.group!);
      rows.push({ kind: "shape", id: sh.group!, members, index: listed.size - 1 });
    }
  });
  return rows;
}

/**
 * The shapes on the active layer, a row each: picking from the list, renaming, and each shape's menu.
 * Only while there is something on the layer: a heading over a line saying there is nothing under
 * it is two lines to say one thing.
 */
export function ShapeList({ layer, shapes, picked, busy, renaming, rowMenuId, onPick, onDeleteAll, onRenameType, onRenameCancel, onRenameDone, onRowMenu, onGroupMenu }: Props) {
  if (!shapes.length) return null;
  const rows = rowsOf(shapes);
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
          title="Delete every path on this layer" disabled={busy} onClick={onDeleteAll} />
      }
    >
      <ul className={styles.shapeList}>
        {rows.slice(0, SHAPE_LIST_LIMIT).map((row) => {
          // A shape stands for its paths: one row, its own name, the box round all of them, and its
          // own menu. Picking it picks every one of its paths.
          const group = row.kind === "shape";
          const sh = group ? row.members[0] : row.shape;
          const id = group ? row.id : sh.id;
          const b = group ? boxAround(row.members) : boxOf(sh);
          const name = group ? groupLabel(row.members, row.index) : shapeName(sh, row.index);
          const on = group ? row.members.every((m) => picked.has(m.id)) : picked.has(sh.id);
          return (
            // The same row a layer has: its number, its name, and the same kebab
            // after it - with the size where a layer keeps its eye.
            <li key={id} className={styles.layerRow}>
              <LayerController
                // A group of its own per row: several shapes can be picked at once,
                // and a browser only ever lets one radio of a group be on.
                name={`studio-shape-${id}`}
                purpose="draw"
                // No numeral: a layer is numbered because it is plotted in that
                // order, and a shape on it isn't. The row still says which it is to a
                // screen reader, below.
                number={null}
                // No swatch: everything on a layer draws in that layer's one ink, and
                // the row right above says which it is.
                hideVisibility
                hideHandle
                // A photo isn't drawn like the paths, so its row says so in the box.
                // A shape made of several paths says so the same way.
                icon={group ? <Shapes /> : sh.kind === "photo" ? <ImageIcon /> : undefined}
                checked={on}
                aria-label={group ? `Shape ${row.index + 1}, ${name}, ${row.members.length} paths` : `Path ${row.index + 1}, ${name}`}
                // The box is a checkbox in all but looks: each click puts this path (or
                // shape) into the selection or takes it out, so any number can be picked
                // from the list without Shift. The click decides, not the radio, which
                // would otherwise let only one be on. The name, below, picks it alone. No
                // preventDefault: undoing the browser's click after React has set the box
                // would leave it showing the click before.
                onChange={() => {}}
                onClick={() => onPick(sh.id, true)}
                label={
                  <span className={styles.shapeLabel}>
                    {/* The name is text: clicking the row picks the shape, and a field
                      sitting here would take the caret and quietly eat whatever was
                      typed next. Renaming is asked for from the kebab. */}
                    {renaming === id ? (
                      <input
                        className={`${styles.shapeName} ${styles.shapeNameEdit}`}
                        data-renaming
                        value={name}
                        aria-label={`Name of ${name}`}
                        autoFocus
                        disabled={busy}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => onRenameType(id, e.target.value)}
                        onBlur={() => onRenameDone(id)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") onRenameCancel(id);
                          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <span
                        className={on
                          ? `${styles.shapeName} ${styles.shapeNameOn}`
                          : styles.shapeName}
                        title={group ? `Click to pick this shape: ${row.members.length} paths` : "Click to pick this path"}
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
                aria-expanded={rowMenuId === id}
                title={group ? "Ungroup, duplicate, move or delete this shape" : "Duplicate, move or delete this path"}
                disabled={busy}
                onClick={(e) => (group ? onGroupMenu(id, e.currentTarget) : onRowMenu(sh.id, e.currentTarget))} />
            </li>
          );
        })}
        {rows.length > SHAPE_LIST_LIMIT && (
          // A separation's layer is tens of thousands of marks: a row each would be a list nobody
          // reads, and the slowest thing on the page. They're picked up together instead.
          <li className={styles.empty}>
            {`And ${(rows.length - SHAPE_LIST_LIMIT).toLocaleString()} more - too many to list. Select all on layer, from the layer’s menu, picks them all.`}
          </li>
        )}
      </ul>
    </Section>
  );
}
