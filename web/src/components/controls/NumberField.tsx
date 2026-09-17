import { useEffect, useState } from "react";
import { InputText } from "@tomcoggia/ui";

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

// A plain number box that lets a number be typed before it means anything. Committing every
// keystroke is what breaks a field like this: ".7" passes through "." - which a number input reports
// as "" - and an empty box read as a number is 0, so the value snaps to the minimum and the rest of
// the typing lands on top of whatever that put in the box. So the draft is free text until it's
// committed on blur or Enter, and only then is it clamped; a draft that isn't a number at all leaves
// the value alone. The arrow keys commit as they step, so holding one still walks the value.
export function NumberField({ label, value, min, max, step = 1, disabled, onChange }: Props) {
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

  return (
    <InputText
      size="md"
      label={label}
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
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const by = step * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
          const current = Number(draft);
          commit(String((Number.isNaN(current) ? value : current) + by));
        }
      }}
    />
  );
}
