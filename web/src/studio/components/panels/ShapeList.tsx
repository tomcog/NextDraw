import { useState } from "react";
import { Button, ButtonRound, LayerController } from "@tomcoggia/ui";
import { useTargetPaint } from "../../../shared/lib/useTargetPaint";
import { EllipsisVertical, Image as ImageIcon, MousePointer2, RotateCcwSquare, RotateCwSquare, Shapes, Trash2 } from "lucide-react";
import { NumberField } from "../../../shared/components/controls/NumberField";
import { Section } from "../../../shared/components/controls/Section";
import controls from "../../../shared/components/controls/controls.module.css";
import { groupLabel, groupsOf, shapeName, type Layer, type Shape } from "../../../shared/lib/drawing/shapes";
import styles from "../../App.module.css";

/** How many rows are listed by name. A separation's layer is tens of thousands of marks. */
const SHAPE_LIST_LIMIT = 200;

interface Props {
  /** The targeted layers, in the order they stack: one, or several worked on as one. */
  layers: Layer[];
  /** What is on them, in drawing order. */
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
  /** Pick every path on the layer: one fill setting for all of a Varnish layer's masks, or a whole
   *  layer to drag. */
  onSelectAll: () => void;
  /** The paths hidden from view in Studio - not from the file, or the plot - by their row's eye. */
  hidden: Set<string>;
  onVisible: (ids: string[], visible: boolean) => void;
  /** Turn everything on the layer about its middle, in degrees clockwise. */
  /** Turn the layers as one. Absent for the Varnish layer, which is only ever filled. */
  onTurn?: (deg: number) => void;
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
export function ShapeList({ layers, shapes, picked, busy, renaming, rowMenuId, onPick, onDeleteAll, onSelectAll, hidden, onVisible, onTurn, onRenameType, onRenameCancel, onRenameDone, onRowMenu, onGroupMenu }: Props) {
  const [turnBy, setTurnBy] = useState(15);
  const rows = rowsOf(shapes);
  // Press a row's box, or its eye, and drag down the list to do the same to every row passed over:
  // pick or let go, show or hide. A shape's row stands for all its paths, and is picked through the
  // first of them, as its box is.
  const rowById = new Map(rows.map((row) => (row.kind === "shape"
    ? [row.id, { pick: row.members[0].id, ids: row.members.map((m) => m.id) }]
    : [row.shape.id, { pick: row.shape.id, ids: [row.shape.id] }])));
  const paint = useTargetPaint([
    {
      control: "label",
      isOn: (id) => !!rowById.get(id)?.ids.every((one) => picked.has(one)),
      toggle: (id) => { const row = rowById.get(id); if (row) onPick(row.pick, true); },
    },
    {
      control: "button[aria-pressed]",
      isOn: (id) => !rowById.get(id)?.ids.every((one) => hidden.has(one)),
      toggle: (id) => {
        const row = rowById.get(id);
        if (row) onVisible(row.ids, row.ids.every((one) => hidden.has(one)));
      },
      // Option-click an eye: this one shown, every other path on the list hidden.
      solo: (id) => {
        const row = rowById.get(id);
        if (!row) return;
        onVisible([...rowById.values()].filter((r) => r !== row).flatMap((r) => r.ids), false);
        onVisible(row.ids, true);
      },
    },
  ], busy);
  if (!shapes.length) return null;
  // One layer is named; several, worked on as one, are said by their dots alone.
  const one = layers.length === 1 ? layers[0] : null;
  const what = one ? one.name : "the targeted layers";
  return (
    <Section
      // The layer's ink in front of its name: the card is the paths on that layer, and says so by
      // naming it. Several layers targeted at once show their dots alone, in stacking order. A mark
      // to read, not a control: picking the colour is the layer's swatch.
      title={(
        <>
          {one ? (
            <>
              <span className={controls.legendDot} style={{ background: one.color }} aria-hidden />
              {one.name}
            </>
          ) : (
            // The names are in the dots' tooltip, and read out, rather than spelled along the heading.
            <span className={controls.legendDots} role="img" aria-label={layers.map((l) => l.name).join(", ")} title={layers.map((l) => l.name).join(", ")}>
              {layers.map((l) => <span key={l.id} className={controls.legendDot} style={{ background: l.color }} />)}
            </span>
          )}
        </>
      )}
      collapsibleKey="shapes-on-layer"
      // Open each time a layer is picked: its turn tools are there to use. The Paths under them are
      // what stays folded, so a layer of hundreds doesn't unroll them all just for being chosen.
      key={layers.map((l) => l.id).join("|")}
      forget
      action={
        <span className={styles.headerTools}>
          <ButtonRound size="sm" icon={<MousePointer2 />} aria-label={`Select everything on ${one ? "this layer" : "these layers"}`}
            title={`Select every path on ${one ? "this layer" : "the targeted layers"}`} disabled={busy} onClick={onSelectAll} />
          <ButtonRound size="sm" icon={<Trash2 />} aria-label={`Delete everything on ${one ? "this layer" : "these layers"}`}
            title={`Delete every path on ${one ? "this layer" : "the targeted layers"}`} disabled={busy} onClick={onDeleteAll} />
        </span>
      }
    >
      {/* The layer turned as one, about its middle: a quarter either way, or by an angle typed in,
        clockwise and negative for the other way. */}
      {onTurn && <div className={styles.turnRow}>
        <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label={`Turn ${what} left`} title={`Turn ${what} 90° left, about their middle`} disabled={busy} onClick={() => onTurn(-90)} />
        <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label={`Turn ${what} right`} title={`Turn ${what} 90° right, about their middle`} disabled={busy} onClick={() => onTurn(90)} />
        <NumberField label="Turn by" unit="°" min={-359} max={359} step={1} value={turnBy} disabled={busy} onChange={setTurnBy} />
        <Button size="md" variant="secondary" title={`Turn ${what} by ${turnBy}°, clockwise - a negative angle turns it the other way`} disabled={busy || !turnBy} onClick={() => onTurn(turnBy)}>Turn</Button>
      </div>}
      {/* The layer's card holds its paths under a heading of their own, a row each, folded to start
        with - a layer of hundreds of paths would otherwise unroll them all - and folded again when
        another layer is picked, as the card is. */}
      <div className={styles.pathsSection}>
      <Section title="Paths" collapsibleKey="paths-on-layer" defaultOpen={false} forget>
      <ul className={styles.shapeList} {...paint.listProps}>
        {rows.slice(0, SHAPE_LIST_LIMIT).map((row) => {
          // A shape stands for its paths: one row, its own name, the box round all of them, and its
          // own menu. Picking it picks every one of its paths.
          const group = row.kind === "shape";
          const sh = group ? row.members[0] : row.shape;
          const id = group ? row.id : sh.id;
          const ids = group ? row.members.map((m) => m.id) : [sh.id];
          const shown = !ids.every((id) => hidden.has(id));
          const name = group ? groupLabel(row.members, row.index) : shapeName(sh, row.index);
          const on = group ? row.members.every((m) => picked.has(m.id)) : picked.has(sh.id);
          return (
            // The same row a layer has: its number, its name, and the same kebab
            // after it - with the size where a layer keeps its eye.
            <li key={id} className={styles.layerRow} {...paint.rowProps(id)}>
              <LayerController
                // A group of its own per row: several shapes can be picked at once,
                // and a browser only ever lets one radio of a group be on.
                name={`studio-shape-${id}`}
                // Picked, a path's box shows the target, as the layer it's on does.
                purpose="print"
                // No numeral: a layer is numbered because it is plotted in that
                // order, and a shape on it isn't. The row still says which it is to a
                // screen reader, below.
                number={null}
                // No swatch: everything on a layer draws in that layer's one ink, and
                // the row right above says which it is.
                // The eye hides the path from view here, as a layer's eye does its layer: the file
                // and the plot keep it.
                visible={shown}
                onVisibleChange={(v) => onVisible(ids, v)}
                noun={group ? "shape" : "path"}
                hideHandle
                // A photo isn't drawn like the paths, so its row says so in the box.
                // A shape made of several paths says so the same way.
                icon={group ? <Shapes /> : sh.kind === "photo" ? <ImageIcon /> : undefined}
                checked={on}
                aria-label={group ? `Shape ${row.index + 1}, ${name}, ${row.members.length} paths` : `Path ${row.index + 1}, ${name}`}
                // The box is a checkbox in all but looks: each click puts this path (or
                // shape) into the selection or takes it out, so any number can be picked
                // from the list without Shift. The click decides, not the radio, which
                // would otherwise let only one be on. Option-click picks it alone, the others
                // let go - as the name, below, does, and as a layer's box does. No
                // preventDefault: undoing the browser's click after React has set the box
                // would leave it showing the click before.
                onChange={() => {}}
                onClick={(e) => onPick(sh.id, !e.altKey)}
                title={`Click to pick this ${group ? "shape" : "path"} too, or let it go - drag down to do the same to every one you pass; Option-click to pick it alone`}
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
      </div>
    </Section>
  );
}
