import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

// Dragging a row to a new place in a list, with the movement shown rather than just done: the row
// you're holding follows the pointer, and the rows it displaces slide out of its way.
//
// The slide is FLIP - after each render, a row whose position changed is put back where it was and
// then released, so the browser animates the difference. Without it a reorder is a jump: the list is
// correct but you have to re-read it to see what happened, which is the thing that makes drag-sorting
// feel unreliable.
//
// Lifted out of Plot's Layers card when Plot stopped reordering layers, so Studio (which does) keeps
// the behaviour instead of inheriting a plainer version of it.

const SLIDE_MS = 200;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

interface Options {
  /** Row ids in the order they're displayed, top first. */
  rows: string[];
  /** Each row's element, keyed by id. The caller fills this from its `ref` callbacks. */
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  listRef: React.RefObject<HTMLElement>;
  disabled?: boolean;
  /** Called as the row passes another, with the position it's moved to in the displayed order. */
  onMove: (id: string, to: number) => void;
  /** Called once when a drag begins - somewhere to take an undo snapshot. */
  onStart?: () => void;
}

export function useRowDrag({ rows, rowRefs, listRef, disabled, onMove, onStart }: Options) {
  const [dragging, setDragging] = useState<string | null>(null);
  const grabOffset = useRef(0); // pointer distance from the row's top when it was picked up
  const pointerY = useRef(0);
  const lastTops = useRef(new Map<string, number>());
  const live = useRef({ rows, onMove });
  live.current = { rows, onMove };

  // Where the held row should sit, in list coordinates: under the pointer, kept inside the list.
  const dragTop = () => {
    const list = listRef.current;
    const last = rowRefs.current.get(live.current.rows[live.current.rows.length - 1]);
    if (!list) return 0;
    const max = last ? last.offsetTop : 0;
    return Math.max(0, Math.min(max, pointerY.current - grabOffset.current - list.getBoundingClientRect().top));
  };

  // After every render, not just when the order changes: a row can also move because another row
  // appeared, or because the list itself resized.
  useLayoutEffect(() => {
    const animate = !reducedMotion();
    for (const [id, el] of rowRefs.current) {
      const top = el.offsetTop;
      if (dragging === id) {
        el.style.transition = "none";
        el.style.transform = `translateY(${dragTop() - top}px)`;
      } else {
        const before = lastTops.current.get(id);
        if (animate && before !== undefined && before !== top) {
          el.style.transition = "none";
          el.style.transform = `translateY(${before - top}px)`;
          void el.offsetHeight; // commit the start position before sliding
          el.style.transition = `transform ${SLIDE_MS}ms ease`;
          el.style.transform = "";
        }
      }
      lastTops.current.set(id, top);
    }
  });

  // The drop: the held row glides from under the pointer into its slot rather than snapping there.
  const finish = () => {
    setDragging((id) => {
      if (id) {
        const el = rowRefs.current.get(id);
        if (el) {
          el.style.transition = reducedMotion() ? "none" : `transform ${SLIDE_MS}ms ease`;
          el.style.transform = "";
        }
      }
      return null;
    });
  };

  // A drag ends however the pointer goes away - released outside the list, cancelled, or the window
  // losing focus - so a row can't be left stuck to a pointer that isn't there.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      pointerY.current = e.clientY;
      const { rows: shown, onMove: moveTo } = live.current;
      const els = shown.map((id) => rowRefs.current.get(id)).filter(Boolean) as HTMLElement[];
      if (els.length < 2) return;
      const pitch = els[1].offsetTop - els[0].offsetTop || els[0].offsetHeight;
      const top = dragTop() + (listRef.current?.getBoundingClientRect().top ?? 0);
      // The slot under the held row's middle is a division away; rows are one pitch apart.
      const to = Math.max(0, Math.min(shown.length - 1, Math.round((top - els[0].getBoundingClientRect().top) / pitch)));
      const from = shown.indexOf(dragging);
      if (to !== from) moveTo(dragging, to);
      else setDragging(dragging); // re-render so the held row follows the pointer
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const start = (e: ReactPointerEvent, id: string) => {
    if (disabled || rows.length < 2) return;
    e.preventDefault();
    const el = rowRefs.current.get(id);
    grabOffset.current = el ? e.clientY - el.getBoundingClientRect().top : 0;
    pointerY.current = e.clientY;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // not a live pointer (synthetic events); the drag still works while it's over the list
    }
    onStart?.();
    setDragging(id);
  };

  return { dragging, start };
}
