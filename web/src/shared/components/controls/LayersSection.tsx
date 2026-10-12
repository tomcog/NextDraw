import { useRef, type ReactNode } from "react";
import { ButtonRound, LayerController } from "@tomcoggia/ui";
import { EllipsisVertical, LayersArrowUp, Plus, Sparkles } from "lucide-react";
import { Section } from "./Section";
import { isPalettePen, labelAfter, LABEL_SEPARATOR } from "../../lib/ink";
import type { Preset } from "../../lib/types";
import { useRowDrag } from "../../lib/useRowDrag";
import type { Layer } from "../../lib/drawing/shapes";
import styles from "./LayersSection.module.css";


interface Props {
  /** What goes under the list, folded away with it: the shapes on the layer being drawn on. */
  children?: ReactNode;
  /** Bottom first, the order they're drawn in. Listed top first, the way they stack on the paper. */
  layers: Layer[];
  /** The layer being drawn on. */
  active: Layer | undefined;
  /** Every targeted layer: the one drawn on and any worked on with it. */
  targets: Set<string>;
  /** The drawing tool, whose palette says which layers are its pens. */
  tool: Preset | null;
  busy: boolean;
  /** The layer whose pen menu is open, and whose row menu is, if any. */
  colorMenuId: string | undefined;
  rowMenuId: string | undefined;
  /** The layer whose name is open for typing into, if any. Studio's: Image doesn't rename. */
  renaming?: string | null;
  /** The pen of the layer being renamed, which stays: only the label after it is typed. Null when
   *  the layer names no pen, and the whole name is typed. */
  renamePen?: string | null;
  onSort: () => void;
  /** Studio: one more layer. Image's layers are the image's, made by splitting it. */
  onAdd?: () => void;
  /** Studio: varnish the whole drawing - its silhouette, hatched on the Varnish layer. */
  onVarnish?: () => void;
  /** Target this layer alone, or with `add` put it in with the others or take it out. */
  onSwitch: (id: string, add?: boolean) => void;
  onVisible: (id: string, visible: boolean) => void;
  onColorMenu: (id: string, anchor: HTMLElement) => void;
  /** Studio: duplicate, merge, rename or delete a layer, from the menu at the end of its row. */
  onRowMenu?: (id: string, anchor: HTMLElement) => void;
  onRenameType?: (id: string, name: string) => void;
  /** Escape: put back the name it had before. */
  onRenameCancel?: (id: string) => void;
  /** The name field left: keep what was typed. */
  onRenameDone?: (id: string) => void;
  /** A drag to restack is starting: somewhere to take an undo snapshot. */
  onRestackStart: () => void;
  /** Move a layer to a new place in the stack, `to` counted bottom first like `layers`. */
  onRestack: (id: string, to: number) => void;
  /** Under which the card's folding is remembered. */
  collapsibleKey?: string;
  /** What the row's name tells a hover it does. */
  nameTitle?: string;
  /** What the layers draw: "draw on" in Studio, "set" in Image. */
  verb?: string;
}

/**
 * Shared: the layers, top first, in Studio and Image - picking the one to work on, its pen, hiding and
 * restacking; in Studio also adding, renaming and each row's menu, which it passes in.
 */
export function LayersSection(props: Props) {
  const { layers, busy, tool, renaming } = props;
  const layerList = useRef<HTMLUListElement>(null);
  const layerRows = useRef(new Map<string, HTMLElement>());
  // Layers are shown top-first, the way they stack on the paper; the array holds them bottom-first,
  // the order they're drawn in. So a drop at display position `to` is a move to the mirrored index.
  const { dragging, start } = useRowDrag({
    rows: [...layers].reverse().map((l) => l.id),
    rowRefs: layerRows,
    listRef: layerList,
    disabled: busy,
    onStart: props.onRestackStart,
    onMove: (id, to) => props.onRestack(id, layers.length - 1 - to),
  });

  return (
    <Section
      title="Layers"
      collapsibleKey={props.collapsibleKey ?? "layers"}
      action={
        <span className={styles.headerTools}>
          {layers.length > 1 && (
            <ButtonRound size="sm" icon={<LayersArrowUp />} aria-label="Sort layers by darkness"
              title="Sort by darkness: the lightest color is layer 1 and drawn first, with darker colors over it"
              disabled={busy} onClick={props.onSort} />
          )}
          {props.onVarnish && (
            <ButtonRound size="sm" icon={<Sparkles />} aria-label="Varnish the whole drawing"
              title="Varnish the whole drawing: its silhouette, hatched in glitter gel on the Varnish layer, plotted last"
              disabled={busy || layers.length === 0} onClick={props.onVarnish} />
          )}
          {props.onAdd && (
            <ButtonRound size="sm" icon={<Plus />} aria-label="Add a layer"
              title="Add a layer: one more color to draw with" disabled={busy} onClick={props.onAdd} />
          )}
        </span>
      }
    >
      <ul className={styles.layerList} ref={layerList}>
        {[...layers].reverse().map((layer) => {
          const at = layers.indexOf(layer); // 0 is the bottom layer, as in Plot
          // Struck through when the layer isn't one of this tool's pens by name and colour - the
          // same rule as Plot's Layers card. Only a tool with a palette of its own is asked.
          const notAPen = isPalettePen(layer.name, layer.color, tool?.palette ?? []) === false;
          return (
            <li
              key={layer.id}
              className={styles.layerRow}
              data-dragging={dragging === layer.id}
              ref={(el) => {
                if (el) layerRows.current.set(layer.id, el);
                else layerRows.current.delete(layer.id);
              }}
            >
              <LayerController
                // A group of its own per row, as the paths' are: several layers can be targeted at
                // once, and a browser only ever lets one radio of a group be on.
                name={`layer-${layer.id}`}
                // The layer being drawn on is marked with the target, as Plot marks the one to print.
                // (A "print" row's printed mark needs `printed`, which Studio never passes.)
                purpose="print"
                number={at + 1}
                color={layer.color}
                swatchCut={notAPen}
                swatchProps={{
                  "aria-label": notAPen
                    ? `Color for ${layer.name} - not one of ${tool?.name ?? "the pen"}'s colors by that name`
                    : `Color for ${layer.name}`,
                  "aria-haspopup": "menu",
                  "aria-expanded": props.colorMenuId === layer.id,
                  title: "Choose the color this layer draws with",
                  disabled: busy,
                  onClick: (e) => props.onColorMenu(layer.id, e.currentTarget),
                }}
                checked={props.targets.has(layer.id)}
                visible={!layer.hidden}
                onVisibleChange={(visible) => props.onVisible(layer.id, visible)}
                disabled={busy}
                // The box is a checkbox in all but looks, as a path's is: each click puts this layer
                // in with the targeted ones or takes it out. The name, below, targets it alone.
                onChange={() => {}}
                onClick={() => props.onSwitch(layer.id, true)}
                aria-label={`${props.verb ?? "Draw on"} layer ${at + 1}, ${layer.name}`}
                label={renaming === layer.id ? (
                  <span className={styles.shapeLabel}>
                  {/* The pen stays as it is, in front of the field: it's what says which pen to
                    load, and the label after it is what tells this layer from others in that pen. */}
                  {props.renamePen && <span className={styles.shapeName}>{`${props.renamePen}${LABEL_SEPARATOR}`}</span>}
                  <input
                    className={`${styles.shapeName} ${styles.shapeNameEdit}`}
                    data-renaming
                    value={props.renamePen ? labelAfter(layer.name, props.renamePen) : layer.name}
                    placeholder={props.renamePen ? "Label" : undefined}
                    aria-label={props.renamePen ? `Label of layer ${at + 1}, after ${props.renamePen}` : `Name of layer ${at + 1}`}
                    autoFocus
                    disabled={busy}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => props.onRenameType?.(layer.id, e.target.value)}
                    onBlur={() => props.onRenameDone?.(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") props.onRenameCancel?.(layer.id);
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                  />
                  </span>
                ) : (
                  // Text, not a field: clicking it draws on that layer. Renaming is asked
                  // for from the kebab, so nothing typed can land in a name by accident.
                  // Green while it is the one being drawn on, like the nib beside it.
                  <span
                    className={props.targets.has(layer.id)
                      ? `${styles.shapeName} ${styles.shapeNameOn}`
                      : styles.shapeName}
                    title={props.nameTitle ?? "Click to target this layer alone; Shift-click to target it with the others"}
                    onClick={(e) => props.onSwitch(layer.id, e.shiftKey)}
                  >
                    {layer.name}
                  </span>
                )}
                handleProps={{
                  "aria-label": `Move ${layer.name}`,
                  title: "Drag to restack",
                  disabled: busy || layers.length < 2,
                  onPointerDown: (e) => start(e, layer.id),
                }}
              />
              {props.onRowMenu && (
                <ButtonRound size="sm" variant="tertiary" icon={<EllipsisVertical />}
                  aria-label={`More for layer ${layer.name}`}
                  aria-haspopup="menu"
                  aria-expanded={props.rowMenuId === layer.id}
                  title="Duplicate, merge or delete this layer"
                  disabled={busy}
                  onClick={(e) => props.onRowMenu?.(layer.id, e.currentTarget)} />
              )}
            </li>
          );
        })}
      </ul>
      {props.children}
    </Section>
  );
}
