import { useRef, useState } from "react";
import { Button, ButtonRound, LayerController } from "@tomcoggia/ui";
import { Check, EllipsisVertical, FilePlus, FolderOpen, ListChecks, ListPlus, SkipForward, Trash2, Undo2 } from "lucide-react";
import styles from "./QueueSection.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { panelIcon } from "../../../shared/components/PanelToolbar";
import { RowMenu } from "../../../shared/components/controls/RowMenu";
import { useRowDrag } from "../../../shared/lib/useRowDrag";
import controls from "../../../shared/components/controls/controls.module.css";
import type { QueueItem } from "../../../shared/lib/types";

interface Props {
  items: QueueItem[];
  /** The queued drawing that's open, if one is. */
  current: QueueItem | null;
  /** The drawing to plot after this one: the first not yet plotted, after the open one. */
  next: QueueItem | null;
  /** The drawing open can be added: it's saved somewhere, and not in the queue already. */
  canAddOpen: boolean;
  disabled: boolean;
  onAddOpen: () => void;
  /** Pick drawings from the folders, to go on the end of the queue. */
  onAddFiles: () => void;
  onOpen: (item: QueueItem) => void;
  onDone: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  onRemoveDone: () => void;
  onMove: (id: string, to: number) => void;
}

// The drawings waiting their turn on the plotter, first at the top. Built from the Layers card's own
// rows: the number is the place in the queue, the box marks the drawing that's open - picking another
// opens it - and the printed mark is a drawing that has plotted. The grip reorders. Nothing is ever
// plotted from here: each drawing wants its own paper, so the next one is opened and waits for Plot.
export function QueueSection({ items, current, next, canAddOpen, disabled, onAddOpen, onAddFiles, onOpen, onDone, onRemove, onRemoveDone, onMove }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuItem = menu ? items.find((i) => i.id === menu.id) : null;
  const { dragging, start } = useRowDrag({
    rows: items.map((i) => i.id),
    rowRefs,
    listRef: list,
    disabled,
    onMove,
  });
  const left = items.filter((i) => !i.done).length;

  return (
    <Section
      title={items.length ? `Queue · ${left} to plot` : "Queue"}
      icon={panelIcon("queue")}
      collapsibleKey="plot-queue"
      action={
        <span className={styles.headerTools}>
          {items.some((i) => i.done) && (
            // Only offered once something has plotted, like the Layers card's printed marks.
            <ButtonRound size="sm" icon={<ListChecks />} aria-label="Remove the plotted drawings"
              title="Take the drawings that have plotted out of the queue"
              disabled={disabled} onClick={onRemoveDone} />
          )}
          <ButtonRound size="sm" icon={<FilePlus />} aria-label="Add the open drawing"
            title={canAddOpen ? "Add the drawing that's open to the end of the queue" : "Open a saved drawing that isn't in the queue to add it"}
            disabled={disabled || !canAddOpen} onClick={onAddOpen} />
          <ButtonRound size="sm" icon={<ListPlus />} aria-label="Add drawings"
            title="Add drawings to the end of the queue: tick them in the order they're to plot"
            disabled={disabled} onClick={onAddFiles} />
          <ButtonRound size="sm" icon={<SkipForward />} aria-label={next ? `Open the next drawing, ${next.name}` : "Open the next drawing"}
            title={next ? `Open the next drawing: ${next.name}` : "Nothing left to plot in the queue"}
            disabled={disabled || !next} onClick={() => next && onOpen(next)} />
        </span>
      }
    >
      {items.length === 0 ? (
        <p className={controls.hint}>No drawings waiting. Add the one that's open, or tick several from the folders.</p>
      ) : (
        <ol className={styles.list} ref={list}>
          {items.map((item, i) => (
            <li
              key={item.id}
              className={styles.row}
              data-dragging={dragging === item.id}
              data-missing={item.missing || undefined}
              ref={(el) => {
                if (el) rowRefs.current.set(item.id, el);
                else rowRefs.current.delete(item.id);
              }}
            >
              <LayerController
                name="queue-open"
                number={i + 1}
                checked={current?.id === item.id}
                printed={item.done}
                hideVisibility
                disabled={disabled || item.missing}
                onChange={() => onOpen(item)}
                aria-label={`Open ${item.name}`}
                title={item.missing ? `Not found in ${item.folder}` : `${item.folder}${item.done ? " · plotted" : ""}`}
                label={item.name}
                handleProps={{
                  "aria-label": `Move ${item.name}`,
                  title: "Drag to change when it plots",
                  disabled: disabled || items.length < 2,
                  onPointerDown: (e) => start(e, item.id),
                }}
              />
              <ButtonRound size="sm" variant="tertiary" icon={<EllipsisVertical />}
                aria-label={`More for ${item.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === item.id}
                title="Open, mark or remove this drawing"
                disabled={disabled}
                onClick={(e) => {
                  const anchor = e.currentTarget;
                  setMenu((open) => (open?.id === item.id ? null : { id: item.id, anchor }));
                }} />
            </li>
          ))}
        </ol>
      )}
      {current?.done && next && (
        // The open drawing has plotted: the next one is a click away, once the paper is changed.
        <div className={styles.nextUp}>
          <p className={controls.hint}>{`Plotted. Next up: ${next.name}.`}</p>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onOpen(next)}>Open next</Button>
        </div>
      )}
      {menu && menuItem && (
        <RowMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          actions={[
            { label: "Open", icon: <FolderOpen />, disabled: menuItem.missing || current?.id === menuItem.id, onSelect: () => onOpen(menuItem) },
            menuItem.done
              ? { label: "Mark as not plotted", icon: <Undo2 />, onSelect: () => onDone(menuItem.id, false) }
              : { label: "Mark as plotted", icon: <Check />, onSelect: () => onDone(menuItem.id, true) },
            { label: "Remove from the queue", icon: <Trash2 />, danger: true, onSelect: () => onRemove(menuItem.id) },
          ]}
        />
      )}
    </Section>
  );
}
