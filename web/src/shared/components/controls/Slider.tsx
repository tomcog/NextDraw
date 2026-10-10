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
  /** Decimal places to keep. Whole numbers by default, which is what most of these settings are. */
  decimals?: number;
  disabled?: boolean;
  /**
   * A setting that goes both ways from a middle - brightness, contrast - whose track is coloured from
   * the middle out to the dot, rather than from the left end. The middle is where the dot sits at rest.
   */
  centered?: boolean;
  onChange: (value: number) => void;
}

// Shared: a range slider with a number box (or, given `format`, its value beside the label). The
// component library has no slider, so the range is native, styled with the library's tokens; the
// number box is the library's InputText.
export function Slider({ label, value, min = 0, max = 100, step = 1, format, decimals = 0, disabled, centered, onChange }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (text: string) => {
    const round = (v: number) => Number(v.toFixed(decimals));
    const n = Math.min(max, Math.max(min, round(Number(text) || 0)));
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
        style={(() => {
          const at = ((value - min) / (max - min)) * 100;
          // Coloured from the left end to the dot, or - centered - from the middle to the dot.
          return centered
            ? { ["--from" as string]: `${Math.min(50, at)}%`, ["--fill" as string]: `${Math.max(50, at)}%` }
            : { ["--fill" as string]: `${at}%` };
        })()}
        onChange={(e) => onChange(Number(Number(e.target.value).toFixed(decimals)))}
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
