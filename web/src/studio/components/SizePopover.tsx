import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import menu from "../../shared/components/controls/PaletteMenu.module.css";
import { NumberField } from "../../shared/components/controls/NumberField";
import styles from "./SizePopover.module.css";

interface Props {
  anchor: HTMLElement; // the button on the shape's row that opened it
  name: string;
  width: number;
  height: number;
  onSize: (width: number, height: number) => void;
  onClose: () => void;
}

/**
 * A shape's size, typed in. It hangs off the row rather than pushing the list about, and it is only
 * two boxes: a shape is held by its top-left corner, so its width and height are the whole of it.
 */
export function SizePopover({ anchor, name, width, height, onSize, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const gap = 4;
    const top = a.bottom + gap + m.height > window.innerHeight - 8
      ? Math.max(8, a.top - gap - m.height)
      : a.bottom + gap;
    setAt({ left: Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8), top });
  }, [anchor]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      className={`${menu.menu} ${styles.size}`}
      style={at ? { left: at.left, top: at.top } : { opacity: 0 }}
      role="group"
      aria-label={`Size of ${name}`}
    >
      <NumberField
        label="Width"
        unit="in"
        min={0.02}
        step={0.1}
        value={Number(width.toFixed(3))}
        onChange={(w) => onSize(w, height)}
      />
      <NumberField
        label="Height"
        unit="in"
        min={0.02}
        step={0.1}
        value={Number(height.toFixed(3))}
        onChange={(h) => onSize(width, h)}
      />
    </div>,
    document.body,
  );
}
