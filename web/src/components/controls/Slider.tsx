import { useEffect, useId, useState } from "react";
import { InputText } from "@tomcoggia/ui";
import styles from "./controls.module.css";

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string; // show the value this way beside the label, instead of a number box
  disabled?: boolean;
  onChange: (value: number) => void;
}

// A range slider with a number box. The component library has no slider, so the range is native,
// styled with the library's tokens; the number box is the library's InputText.
export function Slider({ label, value, min = 0, max = 100, step = 1, format, disabled, onChange }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (text: string) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(text) || 0)));
    setDraft(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <div className={styles.slider} data-readout={Boolean(format)}>
      <label htmlFor={id} className={styles.sliderLabel}>
        {label}
        {format && <span className={styles.sliderReadout}>{format(value)}</span>}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {!format && <InputText
        size="md"
        className={styles.sliderNumber}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      />}
    </div>
  );
}
