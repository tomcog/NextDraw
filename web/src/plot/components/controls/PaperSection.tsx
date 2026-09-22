import { useState } from "react";
import { ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Palette, Pipette, Ratio } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import { LengthField } from "./LengthField";
import { Section } from "../../../shared/components/controls/Section";
import { PAPER_SIZES } from "../../../shared/lib/constants";
import { fmtLen } from "../../../shared/lib/format";
import type { Settings } from "../../../shared/lib/types";

interface Props {
  settings: Settings;
  disabled: boolean;
  onPickSize: (id: string) => void;
  onChange: (patch: Partial<Settings>) => void;
}

// Common paper colors, plus any color from the picker. The paper is drawn in this color on the
// preview whatever the app's theme, so light or dark mode never changes how a print looks.
const PAPER_COLORS = [
  { name: "White", color: "#ffffff" },
  { name: "Cream", color: "#f4ecd8" },
  { name: "Kraft", color: "#c6a57a" },
  { name: "Gray", color: "#8e9196" },
  { name: "Black", color: "#1d1d1f" },
];

export function PaperSection({ settings: s, disabled, onPickSize, onChange }: Props) {
  const custom = s.paper_size === "custom";
  const landscape = s.paper_w >= s.paper_h;
  // Paper color rarely changes, so its swatches stay tucked behind the Palette button.
  const [colorsOpen, setColorsOpen] = useState(false);

  // Each size is named in the chosen unit and in the sheet's current orientation (width × height),
  // so the list reflects Rotate and in/mm. Custom shows the typed size.
  const sizeName = (p: (typeof PAPER_SIZES)[number]) => {
    const [w, h] = p.w && p.h ? (landscape ? [p.h, p.w] : [p.w, p.h]) : [s.paper_w, s.paper_h];
    const dims = `${fmtLen(w, s.units, false)} × ${fmtLen(h, s.units)}`;
    return p.w ? dims : `Custom size (${dims})`;
  };
  return (
    <Section
      title="Paper"
      action={
        <ButtonRound
          size="sm"
          icon={<Palette />}
          className={colorsOpen ? styles.roundActive : undefined}
          aria-label="Paper color"
          aria-expanded={colorsOpen}
          aria-controls="paper-colors"
          title={colorsOpen ? "Hide paper colors" : "Paper color"}
          onClick={() => setColorsOpen((open) => !open)}
        />
      }
    >
      <div className={styles.paperHead}>
        <InputSelect size="md" label="Paper size" hideLabel value={s.paper_size} disabled={disabled} onChange={(e) => onPickSize(e.target.value)}>
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{sizeName(p)}</option>)}
        </InputSelect>
        <div className={styles.unitsGroup}>
          <SegmentedControl size="sm" aria-label="Units">
            <Segment selected={s.units === "in"} disabled={disabled} onClick={() => onChange({ units: "in" })}>in</Segment>
            <Segment selected={s.units === "mm"} disabled={disabled} onClick={() => onChange({ units: "mm" })}>mm</Segment>
          </SegmentedControl>
          <ButtonRound
            size="sm"
            icon={<Ratio />}
            aria-label="Rotate paper"
            title="Rotate paper (swap width and height)"
            disabled={disabled}
            onClick={() => onChange({ paper_w: s.paper_h, paper_h: s.paper_w })}
          />
        </div>
      </div>

      {colorsOpen && <div id="paper-colors" className={styles.paperColors} role="radiogroup" aria-label="Paper color">
        {PAPER_COLORS.map((c) => (
          <button
            key={c.color}
            type="button"
            role="radio"
            aria-checked={s.paper_color === c.color}
            aria-label={`${c.name} paper`}
            title={`${c.name} paper`}
            className={styles.paperSwatch}
            style={{ background: c.color }}
            disabled={disabled}
            onClick={() => onChange({ paper_color: c.color })}
          />
        ))}
        {(() => {
          const customColor = !PAPER_COLORS.some((c) => c.color === s.paper_color);
          return (
            <label
              className={styles.paperSwatch}
              data-custom
              role="radio"
              aria-checked={customColor}
              title="Pick any paper color"
              style={customColor ? { background: s.paper_color } : undefined}
            >
              {!customColor && <Pipette aria-hidden />}
              <input
                type="color"
                aria-label="Custom paper color"
                value={s.paper_color}
                disabled={disabled}
                onChange={(e) => onChange({ paper_color: e.target.value })}
              />
            </label>
          );
        })()}
      </div>}

      {custom && (
        <div className={styles.row2}>
          <LengthField label="Width" mm={s.paper_w} units={s.units} min={1} disabled={disabled} onChange={(paper_w) => onChange({ paper_w })} />
          <LengthField label="Height" mm={s.paper_h} units={s.units} min={1} disabled={disabled} onChange={(paper_h) => onChange({ paper_h })} />
        </div>
      )}

    </Section>
  );
}
