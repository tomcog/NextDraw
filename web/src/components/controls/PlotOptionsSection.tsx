import { Checkbox, InputSelect, InputText } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import type { Settings } from "../../lib/types";

interface Props {
  settings: Settings;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
  handling: { id: number; name: string }[]; // the NextDraw software's handling modes
}

const clampInt = (text: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(text) || min)));

// Plot options, shown in the collapsed "Plot options" section under the preview.
export function PlotOptionsSection({ settings: s, disabled, onChange, handling }: Props) {
  return (
    <div className={styles.plotOptions}>
      <div className={styles.row2}>
        <InputText
          label="Copies"
          type="number"
          min={1}
          max={100}
          value={s.copies}
          disabled={disabled}
          onChange={(e) => onChange({ copies: clampInt(e.target.value, 1, 100) })}
        />
        {s.copies > 1 && (
          <InputText
            label="Wait between copies (s)"
            type="number"
            min={0}
            max={3600}
            value={s.page_delay}
            disabled={disabled}
            onChange={(e) => onChange({ page_delay: clampInt(e.target.value, 0, 3600) })}
          />
        )}
      </div>
      {handling.length > 0 && (
        <InputSelect label="Handling mode" value={s.handling} disabled={disabled} onChange={(e) => onChange({ handling: Number(e.target.value) })}>
          {handling.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </InputSelect>
      )}
      <InputSelect label="Path order" value={s.reordering} disabled={disabled} onChange={(e) => onChange({ reordering: Number(e.target.value) })}>
        {/* Least to most change. Each of 0-2 includes the one before; 4 turns everything off. */}
        <option value={4}>Keep the file’s order</option>
        <option value={0}>Join paths that touch</option>
        <option value={1}>Reorder paths to save time</option>
        <option value={2}>Reorder and reverse paths</option>
      </InputSelect>
      <Checkbox size="md" label="Return home when finished" checked={s.return_home} disabled={disabled} onChange={(e) => onChange({ return_home: e.target.checked })} />
      <Checkbox size="md" label="Remove hidden lines" checked={s.hiding} disabled={disabled} onChange={(e) => onChange({ hiding: e.target.checked })} />
      <Checkbox size="md" label="Randomize where closed shapes start" checked={s.random_start} disabled={disabled} onChange={(e) => onChange({ random_start: e.target.checked })} />
    </div>
  );
}
