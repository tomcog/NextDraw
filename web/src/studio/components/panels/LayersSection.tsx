import { useRef, useState } from "react";
import { Button, ButtonRound, InputSelect, LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, EllipsisVertical, LayersArrowUp, Merge, Plus, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import { isPalettePen, labelAfter, LABEL_SEPARATOR } from "../../../shared/lib/ink";
import type { Preset } from "../../../shared/lib/types";
import { useRowDrag } from "../../lib/useRowDrag";
import type { Layer } from "../../../shared/lib/drawing/shapes";
import styles from "../../App.module.css";

export type AlignEdge = "left" | "centre" | "right" | "top" | "middle" | "bottom";

interface Props {
  /** Bottom first, the order they're drawn in. Listed top first, the way they stack on the paper. */
  layers: Layer[];
  /** The layer being drawn on. */
  active: Layer | undefined;
  /** Whether there is anything on the active layer: aligning and turning it need something to move. */
  activeHasShapes: boolean;
  /** Whether there is more than one shape in the drawing, so merging lines could do anything. */
  canMerge: boolean;
  /** The drawing tool, whose palette says which layers are its pens. */
  tool: Preset | null;
  busy: boolean;
  /** The layer whose pen menu is open, and whose row menu is, if any. */
  colorMenuId: string | undefined;
  rowMenuId: string | undefined;
  /** The layer whose name is open for typing into, if any. */
  renaming: string | null;
  /** The pen of the layer being renamed, which stays: only the label after it is typed. Null when
   *  the layer names no pen, and the whole name is typed. */
  renamePen?: string | null;
  onSort: () => void;
  onMerge: () => void;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
  onColorMenu: (id: string, anchor: HTMLElement) => void;
  onRowMenu: (id: string, anchor: HTMLElement) => void;
  onRenameType: (id: string, name: string) => void;
  /** Escape: put back the name it had before. */
  onRenameCancel: (id: string) => void;
  /** The name field left: keep what was typed. */
  onRenameDone: (id: string) => void;
  /** A drag to restack is starting: somewhere to take an undo snapshot. */
  onRestackStart: () => void;
  /** Move a layer to a new place in the stack, `to` counted bottom first like `layers`. */
  onRestack: (id: string, to: number) => void;
  /** What the active layer lines up with: another layer's id, or "paper". */
  alignTarget: string;
  /** The layers it can line up with. */
  alignable: Layer[];
  onAlignTarget: (id: string) => void;
  onAlign: (edge: AlignEdge) => void;
  /** Turn the active layer about its middle, in degrees clockwise. */
  onTurn: (deg: number) => void;
}

/**
 * The layers, top first: picking the one to draw on, its pen, hiding, renaming and restacking - and
 * the active layer lined up with another or turned, as one.
 */
export function LayersSection(props: Props) {
  const { layers, active, busy, tool, renaming } = props;
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
  const [turnBy, setTurnBy] = useState(15);

  return (
    <Section
      title="Layers"
      collapsibleKey="layers"
      action={
        <span className={styles.headerTools}>
          {layers.length > 1 && (
            <ButtonRound size="sm" icon={<LayersArrowUp />} aria-label="Sort layers by darkness"
              title="Sort by darkness: the lightest color is layer 1 and drawn first, with darker colors over it"
              disabled={busy} onClick={props.onSort} />
          )}
          {props.canMerge && (
            <ButtonRound size="sm" icon={<Merge />} aria-label="Merge overlapping lines"
              title="Merge overlapping lines: straight lines that run over one another along the same line - a halftone's dashes, a line drawn twice - joined into single strokes, so each bit is drawn once. Looks the same; draws faster"
              disabled={busy} onClick={props.onMerge} />
          )}
          <ButtonRound size="sm" icon={<Plus />} aria-label="Add a layer"
            title="Add a layer: one more color to draw with" disabled={busy} onClick={props.onAdd} />
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
                name="studio-layer"
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
                checked={active?.id === layer.id}
                visible={!layer.hidden}
                onVisibleChange={(visible) => props.onVisible(layer.id, visible)}
                disabled={busy}
                onChange={() => props.onSwitch(layer.id)}
                aria-label={`Draw on layer ${at + 1}, ${layer.name}`}
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
                    onChange={(e) => props.onRenameType(layer.id, e.target.value)}
                    onBlur={() => props.onRenameDone(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") props.onRenameCancel(layer.id);
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                  />
                  </span>
                ) : (
                  // Text, not a field: clicking it draws on that layer. Renaming is asked
                  // for from the kebab, so nothing typed can land in a name by accident.
                  // Green while it is the one being drawn on, like the nib beside it.
                  <span
                    className={layer.id === active?.id
                      ? `${styles.shapeName} ${styles.shapeNameOn}`
                      : styles.shapeName}
                    title="Click to draw on this layer"
                    onClick={() => props.onSwitch(layer.id)}
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
              <ButtonRound size="sm" variant="tertiary" icon={<EllipsisVertical />}
                aria-label={`More for layer ${layer.name}`}
                aria-haspopup="menu"
                aria-expanded={props.rowMenuId === layer.id}
                title="Duplicate, merge or delete this layer"
                disabled={busy}
                onClick={(e) => props.onRowMenu(layer.id, e.currentTarget)} />
            </li>
          );
        })}
      </ul>
      {/* The active layer lined up with another, by the boxes round what's on them. */}
      {active && props.activeHasShapes && (
        <div className={styles.alignRow}>
          <InputSelect size="md" label={`Align ${active.name} to`} value={props.alignTarget} disabled={busy} onChange={(e) => props.onAlignTarget(e.target.value)}>
            {props.alignable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="paper">The paper</option>
          </InputSelect>
          <SegmentedControl size="sm" variant="dark" actions aria-label={`Align ${active.name}`}>
            <Segment icon={<AlignStartVertical />} aria-label="Left edges" title="Left edges: move this layer so its left edge meets the other's" disabled={busy} onClick={() => props.onAlign("left")} />
            <Segment icon={<AlignCenterVertical />} aria-label="Centers" title="Centers: move this layer across so the two are centered on each other" disabled={busy} onClick={() => props.onAlign("centre")} />
            <Segment icon={<AlignEndVertical />} aria-label="Right edges" title="Right edges: move this layer so its right edge meets the other's" disabled={busy} onClick={() => props.onAlign("right")} />
            <Segment icon={<AlignStartHorizontal />} aria-label="Top edges" title="Top edges: move this layer so its top meets the other's" disabled={busy} onClick={() => props.onAlign("top")} />
            <Segment icon={<AlignCenterHorizontal />} aria-label="Middles" title="Middles: move this layer up or down so the two are centered on each other" disabled={busy} onClick={() => props.onAlign("middle")} />
            <Segment icon={<AlignEndHorizontal />} aria-label="Bottom edges" title="Bottom edges: move this layer so its bottom meets the other's" disabled={busy} onClick={() => props.onAlign("bottom")} />
          </SegmentedControl>
          {/* Turned as one, about its middle: a quarter either way, or by an angle typed in,
            clockwise and negative for the other way. */}
          <div className={styles.turnRow}>
            <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label={`Turn ${active.name} left`} title={`Turn ${active.name} 90° left, about its middle`} disabled={busy} onClick={() => props.onTurn(-90)} />
            <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label={`Turn ${active.name} right`} title={`Turn ${active.name} 90° right, about its middle`} disabled={busy} onClick={() => props.onTurn(90)} />
            <NumberField label="Turn by" unit="°" min={-359} max={359} step={1} value={turnBy} disabled={busy} onChange={setTurnBy} />
            <Button size="md" variant="secondary" title={`Turn ${active.name} by ${turnBy}°, clockwise - a negative angle turns it the other way`} disabled={busy || !turnBy} onClick={() => props.onTurn(turnBy)}>Turn</Button>
          </div>
        </div>
      )}
    </Section>
  );
}
