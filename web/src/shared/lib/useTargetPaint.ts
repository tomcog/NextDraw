import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/** One kind of switch a row carries - its target box, its eye - and how to read and flip it. */
export interface PaintSwitch {
  /** Finds the switch from inside a row: what a press has to land on to start a stroke. */
  control: string;
  isOn: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Option-click: this row's switch on and every other row's off - an eye shows its row alone. */
  solo?: (id: string) => void;
}

/**
 * Press a switch in a row - its target box, or its eye - and drag down the list: the same switch on
 * every row the pointer passes over is put the way the first one went, on if pressing it turned it
 * on, off if off. So a run of layers or paths is targeted, let go, shown or hidden in one stroke.
 * Rows already that way are left alone.
 *
 * The list carries `listProps`; each row's `<li>` carries `rowProps(id)`. Only a press on a switch
 * starts a stroke, so a row's name, swatch, kebab and drag handle keep their own clicks. Once one
 * has started, the whole row counts, so the stroke needn't keep to the narrow column of switches.
 * Rows are found under the pointer rather than by entering them, which is what lets a finger do it
 * too: a touch keeps every event on the element it started on.
 *
 * The press does the first row's flip itself, so the click the browser sends after it is caught at
 * the list and dropped before the switch sees it. A click from the keyboard has no press before it,
 * and still flips. Option-click is left to the row (it targets one alone), as is anything but the
 * main button.
 */
export function useTargetPaint(switches: PaintSwitch[], disabled = false) {
  // The latest of each, read while a stroke is under way: the props change under it as rows flip.
  const latest = useRef(switches);
  latest.current = switches;
  const swallowClick = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const target = e.target as HTMLElement;
    const at = latest.current.findIndex((sw) => target.closest(sw.control));
    if (at < 0) return;
    const control = target.closest(latest.current[at].control)!;
    const row = control.closest<HTMLElement>("[data-paint-id]");
    if (!row || !e.currentTarget.contains(row) || isDisabled(control)) return;
    const first = row.dataset.paintId!;
    const on = !latest.current[at].isOn(first);
    const visited = new Set([first]);
    const list = e.currentTarget;
    const rows = () => Array.from(list.querySelectorAll<HTMLElement>("[data-paint-id]"));
    let last = rows().indexOf(row);
    // No text selection, and no focus jump, while the pointer is dragged down the rows.
    e.preventDefault();
    latest.current[at].toggle(first);
    swallowClick.current = true;

    const paint = (over: HTMLElement) => {
      const id = over.dataset.paintId;
      if (!id || visited.has(id)) return;
      visited.add(id);
      const sw = latest.current[at];
      const its = over.querySelector(sw.control);
      if (!its || isDisabled(its)) return;
      if (sw.isOn(id) !== on) sw.toggle(id);
    };
    // Every row from the last one reached to the one under the pointer: a quick stroke sends a move
    // only every so often, and would otherwise jump the rows between two of them.
    const reach = (ev: PointerEvent) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-paint-id]");
      if (!over || !list.contains(over)) return;
      const all = rows();
      const to = all.indexOf(over);
      if (to < 0) return;
      const step = to >= last ? 1 : -1;
      for (let i = last; i !== to + step; i += step) if (all[i]) paint(all[i]);
      last = to;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === e.pointerId) reach(ev);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (ev.type === "pointerup") reach(ev);
      stop.current?.();
    };
    stop.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop.current = null;
      // The click comes straight after the pointer is let up, if it comes at all - a stroke that
      // ends on another row sends none - so the flag can't be left waiting for it.
      setTimeout(() => { swallowClick.current = false; }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // Caught on the way down, before the switch: stopped so its handler doesn't flip it back, and its
  // default prevented so a box's <label> doesn't pass the click on to its input either.
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    // Option-click on a switch that can go solo: that, and not the switch's own flip.
    if (e.altKey && !swallowClick.current && !disabled) {
      const target = e.target as HTMLElement;
      const sw = latest.current.find((s) => s.solo && target.closest(s.control));
      const row = sw && target.closest(sw.control)!.closest<HTMLElement>("[data-paint-id]");
      if (sw && row && e.currentTarget.contains(row)) {
        e.stopPropagation();
        e.preventDefault();
        sw.solo!(row.dataset.paintId!);
        return;
      }
    }
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return {
    listProps: { onPointerDown, onClickCapture },
    rowProps: (id: string) => ({ "data-paint-id": id }),
  };
}

/** A box is disabled through its input; an eye is a button of its own. */
function isDisabled(control: Element): boolean {
  const input = control.matches("input, button") ? control : control.querySelector("input, button");
  return !!input?.matches(":disabled");
}
