import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import menu from "../../../shared/components/controls/PaletteMenu.module.css";
import styles from "./RowMenu.module.css";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  /** Destroys something: drawn in the danger colour, and kept last. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  anchor: HTMLElement; // the kebab button that opened it
  actions: RowAction[];
  onClose: () => void;
}

// The actions for one row of a list - a layer, a shape - behind its kebab button. Built like the pen
// menu (PaletteMenu): below the button, or above it when there isn't room; arrow keys move, Enter
// picks, Escape or a click elsewhere closes, and focus goes back to the button.
export function RowMenu({ anchor, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const gap = 4;
    let top = a.bottom + gap;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - gap - m.height);
    // Right edges lined up: the button sits at the end of its row.
    const left = Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8);
    setPosition({ left, top });
  }, [anchor]);

  useEffect(() => {
    items.current.find((b) => b && !b.disabled)?.focus();
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
    const live = items.current.filter((b): b is HTMLButtonElement => Boolean(b && !b.disabled));
    const i = live.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      live[(i + (e.key === "ArrowDown" ? 1 : -1) + live.length) % live.length]?.focus();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={menu.menu}
      role="menu"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onKeyDown={onKeyDown}
    >
      {actions.map((action, i) => (
        <button
          key={action.label}
          ref={(el) => { items.current[i] = el; }}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          className={`${menu.item} ${styles.item}`}
          data-danger={action.danger || undefined}
          onClick={() => {
            close();
            action.onSelect();
          }}
        >
          {action.icon && <span className={styles.icon} aria-hidden>{action.icon}</span>}
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
