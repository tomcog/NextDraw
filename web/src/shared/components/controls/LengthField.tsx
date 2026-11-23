import { useEffect, useState } from "react";
import { InputText } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { arrowStep, trimNum } from "../../lib/format";
import type { Units } from "../../lib/types";

interface Props {
  label: string;
  mm: number;
  units: Units;
  min?: number;
  disabled?: boolean;
  /** Short word shown inside the field after the value (e.g. "across"). Hides the label below. */
  suffix?: string;
  /**
   * Leave the unit off the label. For a group of fields whose own heading already says what they
   * are measured in - the artboard's margins, set around a sheet - where repeating it four times
   * says nothing and takes the room the number needs.
   */
  unitInLabel?: boolean;
  /**
   * Draw no label under the field. For the margins set on the sheet, where each field's place -
   * left edge, top edge - says which it is better than a word would (2026-11-23). The label is
   * still the field's name for a screen reader.
   */
  hideLabel?: boolean;
  onChange: (mm: number) => void;
}

// A length stored in mm, shown and typed in the chosen unit. Commits on blur or Enter; the up and
// down arrow keys step it one unit (1 in or 1 mm, ×10 with Shift) and apply straight away.
export function LengthField({ label, mm, units, min, disabled, suffix, unitInLabel = true, hideLabel, onChange }: Props) {
  const show = (v: number) => (units === "in" ? trimNum(v / 25.4, 3) : trimNum(v, 1));
  const [draft, setDraft] = useState(show(mm));
  useEffect(() => setDraft(show(mm)), [mm, units]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (text: string) => {
    const n = Number(text);
    if (text === "" || Number.isNaN(n)) {
      setDraft(show(mm));
      return;
    }
    const next = units === "in" ? n * 25.4 : n;
    onChange(min != null ? Math.max(min, next) : next);
  };

  const input = (
    <InputText
      size="md"
      label={unitInLabel ? `${label} (${units})` : label}
      hideLabel={Boolean(suffix) || hideLabel}
      style={suffix ? { paddingRight: "4rem" } : undefined}
      type="number"
      inputMode="decimal"
      step={units === "in" ? 0.05 : 1}
      min={min}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        const step = arrowStep(e);
        if (step !== null) {
          e.preventDefault();
          const current = Number(draft);
          const next = (Number.isNaN(current) ? Number(show(mm)) : current) + step;
          commit(units === "in" ? next.toFixed(3) : next.toFixed(1));
        }
      }}
    />
  );
  if (!suffix) return input;
  return (
    <div className={styles.suffixed}>
      {input}
      <span className={styles.suffix} aria-hidden="true">{suffix}</span>
    </div>
  );
}
