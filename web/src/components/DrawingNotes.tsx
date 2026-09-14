import { useEffect, useId, useRef, useState } from "react";
import { ButtonRound } from "@tomcoggia/ui";
import styles from "./DrawingNotes.module.css";

// A solid caution triangle with the exclamation mark cut out. lucide-react has only the outline version.
function SolidCaution() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10.27 3.99a2 2 0 0 1 3.46 0l8.02 13.9A2 2 0 0 1 20.02 21H3.98a2 2 0 0 1-1.73-3.11z M11 8.5h2v5.75h-2z M12 16.25a1.25 1.25 0 1 0 0 2.5a1.25 1.25 0 1 0 0-2.5z"
      />
    </svg>
  );
}

// A yellow caution button in the top-right corner of the File card, shown only when there's advisory text:
// placement notes, the NextDraw software's warnings, and messages from the plotter. Clicking it opens a callout.
export function DrawingNotes({ notes, className }: { notes: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const calloutId = useId();

  useEffect(() => {
    if (!notes.length) setOpen(false);
  }, [notes.length]);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!notes.length) return null;
  const label = `${notes.length} ${notes.length === 1 ? "note" : "notes"} about this drawing`;

  return (
    <div ref={root} className={[styles.root, className].filter(Boolean).join(" ")}>
      <ButtonRound
        className={styles.button}
        size="md"
        variant="ghost"
        icon={<SolidCaution />}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={calloutId}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div id={calloutId} className={styles.callout} role="dialog" aria-label="Notes about this drawing">
          <ul className={styles.list}>
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
