import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Hints.module.css";

/**
 * The app's tooltips, shown sooner than the browser shows its own.
 *
 * A browser waits about a second before a `title` appears and doesn't let a page say otherwise, and
 * a second is a long time in a row of round buttons that are nothing but icons. So this takes the
 * job over: it watches for a hover anywhere in the page, takes the element's `title` off it (which
 * is what stops the browser's own tooltip appearing), and puts the text up itself after `delay`.
 * The title goes back the moment the pointer leaves, so nothing is lost for anything that reads the
 * page rather than looks at it - and every `title` already written is a tooltip without being
 * changed.
 */
export function Hints({ delay = 500 }: { delay?: number }) {
  const [hint, setHint] = useState<{ text: string; at: DOMRect } | null>(null);
  // The element whose title is currently held, so it can always be given back.
  const held = useRef<{ el: Element; title: string } | null>(null);
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const give = () => {
      if (held.current) held.current.el.setAttribute("title", held.current.title);
      held.current = null;
    };
    const hide = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      give();
      setHint(null);
    };
    const show = (el: Element) => {
      const title = el.getAttribute("title");
      if (!title) return;
      hide();
      held.current = { el, title };
      el.removeAttribute("title"); // the browser's own tooltip is off the table from here
      timer.current = window.setTimeout(() => {
        // Gone from the page, or no longer where it was: nothing to point at.
        if (!el.isConnected) return hide();
        setHint({ text: title, at: el.getBoundingClientRect() });
      }, delay);
    };

    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title]");
      if (!el) return;
      if (held.current?.el === el) return; // already holding this one
      show(el);
    };
    const out = (e: PointerEvent) => {
      const el = held.current?.el;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return; // still inside it
      hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title]");
      if (el) show(el);
    };

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    // A tooltip is about what hasn't happened yet: pressing, typing or moving the page ends it.
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [delay]);

  if (!hint) return null;
  // Under what it is about, pushed back onto the page if it would hang off an edge, and above it
  // when there is no room below.
  const width = box.current?.offsetWidth ?? 0;
  const height = box.current?.offsetHeight ?? 0;
  const gap = 6;
  const below = hint.at.bottom + gap;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, hint.at.top - gap - height) : below;
  const left = Math.min(
    Math.max(8, hint.at.left + hint.at.width / 2 - width / 2),
    Math.max(8, window.innerWidth - width - 8),
  );
  return createPortal(
    <div ref={box} className={styles.hint} style={{ left, top }} role="tooltip">
      {hint.text}
    </div>,
    document.body,
  );
}
