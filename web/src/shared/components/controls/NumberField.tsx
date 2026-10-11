import { useEffect, useState } from "react";
import { InputText } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { arrowStep } from "../../lib/format";

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Shown inside the field after the value ("°", "mm", "in"), so the label can stay a plain name. */
  unit?: string;
  hideLabel?: boolean; // the label still names the field for screen readers
  onChange: (value: number) => void;
}

// A plain number box that lets a number be typed before it means anything. Committing every
// keystroke is what breaks a field like this: ".7" passes through "." - which a number input reports
// as "" - and an empty box read as a number is 0, so the value snaps to the minimum and the rest of
// the typing lands on top of whatever that put in the box. So the draft is free text until it's
// committed on blur or Enter, and only then is it clamped; a draft that isn't a number at all leaves
// the value alone. The arrow keys move it one unit, ten with Shift, and commit as they go, so holding
// one still walks the value.
export function NumberField({ label, value, min, max, step = 1, disabled, unit, hideLabel, onChange }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (text: string) => {
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) {
      setDraft(String(value)); // nothing usable typed: put the old value back
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    // Stepping repeatedly in binary floating point drifts (0.7 + 0.1 = 0.7999...); the box shows
    // what was typed, so round the drift away rather than showing it back.
    const next = Number(clamped.toFixed(4));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const field = (
    <InputText
      size="md"
      label={label}
      hideLabel={hideLabel}
      aria-label={unit ? `${label} (${unit})` : undefined}
      style={unit ? { paddingRight: `${0.5 + unit.length * 0.5}rem` } : undefined}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        const by = arrowStep(e);
        if (by !== null) {
          e.preventDefault();
          const current = Number(draft);
          commit(String((Number.isNaN(current) ? value : current) + by));
        }
      }}
    />
  );

  if (!unit) return field;
  return (
    <span className={styles.suffixed}>
      {field}
      <span className={styles.suffix} aria-hidden>{unit}</span>
    </span>
  );
}
