import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./PaletteMenu.module.css";
import { lightness } from "../../lib/color";
import type { PenColor } from "../../lib/types";

interface Props {
  anchor: HTMLElement; // the color dot that opened it
  palette: PenColor[];
  current: string | null; // the layer's color now, to mark in the list
  /** The color the drawing gives this layer, offered as a way back when an ink has been chosen. */
  own?: string | null;
  onPick: (pen: PenColor) => void;
  onClose: () => void;
  /** Offer any colour at all, from the system colour picker, after the pens. Called on the click. */
  onCustom?: () => void;
}

// The drawing tool's pen colors, opened from a layer's color dot. Arrow keys move through the list,
// Enter picks, Escape or a click elsewhere closes, and focus goes back to the dot.
export function PaletteMenu({ anchor, palette: pens, current, own, onPick, onClose, onCustom }: Props) {
  // Darkest at the top, lightest at the bottom, the way the layers themselves stack. Colors that
  // can't be read keep their place at the end.
  const palette = useMemo(
    () => [...pens].sort((a, b) => (lightness(a.color) ?? Infinity) - (lightness(b.color) ?? Infinity)),
    [pens],
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Below the dot, or above it when there isn't room; kept on screen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const gap = 6;
    let top = a.bottom + gap;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - gap - m.height);
    const left = Math.min(Math.max(8, a.left - 8), window.innerWidth - m.width - 8);
    setPosition({ left, top });
  }, [anchor]);

  useEffect(() => {
    const start = Math.max(0, palette.findIndex((p) => p.color.toLowerCase() === current?.toLowerCase()));
    items.current[start]?.focus();
    const away = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    onClose();
    anchor.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.current.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const count = palette.length + (onCustom ? 1 : 0);
      const next = (i + (e.key === "ArrowDown" ? 1 : -1) + count) % count;
      items.current[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items.current[e.key === "Home" ? 0 : palette.length - (onCustom ? 0 : 1)]?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label="Pen colors"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onKeyDown={onKeyDown}
    >
      {/* Only once an ink has actually been swapped in - otherwise it's a row that does nothing. */}
      {own && current?.toLowerCase() !== own.toLowerCase() && (
        <button
          type="button"
          role="menuitem"
          className={`${styles.item} ${styles.revert}`}
          onClick={() => {
            onPick({ name: "", color: own });
            close();
          }}
        >
          <span className={styles.dot} style={{ background: own }} aria-hidden />
          The drawing’s own
        </button>
      )}
      {palette.map((pen, i) => {
        const selected = pen.color.toLowerCase() === current?.toLowerCase();
        return (
          <button
            key={pen.name}
            ref={(el) => { items.current[i] = el; }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={styles.item}
            data-selected={selected}
            onClick={() => {
              onPick(pen);
              close();
            }}
          >
            <span className={styles.dot} style={{ background: pen.color }} aria-hidden />
            {pen.name}
          </button>
        );
      })}
      {onCustom && (
        <button
          type="button"
          role="menuitem"
          ref={(el) => { items.current[palette.length] = el; }}
          className={`${styles.item} ${styles.custom}`}
          onClick={() => {
            onCustom(); // first, while this click still counts as the gesture that opens the picker
            onClose();
          }}
        >
          <span className={`${styles.dot} ${styles.customDot}`} aria-hidden />
          Other colour…
        </button>
      )}
    </div>,
    document.body,
  );
}
