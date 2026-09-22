import { useEffect, useState } from "react";
import { InputText } from "@tomcoggia/ui";
import styles from "../../../shared/components/controls/controls.module.css";
import { trimNum } from "../../../shared/lib/format";
import type { Units } from "../../../shared/lib/types";

interface Props {
  label: string;
  mm: number;
  units: Units;
  min?: number;
  disabled?: boolean;
  /** Short word shown inside the field after the value (e.g. "across"). Hides the label below. */
  suffix?: string;
  onChange: (mm: number) => void;
}

// A length stored in mm, shown and typed in the chosen unit. Commits on blur or Enter; the up and
// down arrow keys step it (0.05 in or 1 mm, ×10 with Shift) and apply straight away.
export function LengthField({ label, mm, units, min, disabled, suffix, onChange }: Props) {
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
      label={`${label} (${units})`}
      hideLabel={Boolean(suffix)}
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
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const step = (units === "in" ? 0.05 : 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
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
