import { useState } from "react";
import { ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { MoveHorizontal, MoveVertical, Palette, Pipette } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { UnitSwitch } from "./UnitSwitch";
import { Section } from "./Section";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";

interface Props {
  /** The paper in mm, as it lies: its width across, its height down. */
  w: number;
  h: number;
  /** One of PAPER_SIZES, or "custom" for a width and height typed in. */
  sizeId: string;
  /** What the sizes are named in. */
  units: Units;
  /** The paper's colour, which the preview is drawn on and the inks are blended with. */
  color: string;
  collapsibleKey: string;
  disabled?: boolean;
  /** A size from the menu. The app keeps the way the paper lies. */
  onSize: (id: string) => void;
  /** A new width and height, in mm: a custom size typed in, or the paper turned. */
  onDimensions: (w: number, h: number) => void;
  onColor: (color: string) => void;
  /** Plot: measure in inches or millimetres. Studio works in inches alone, so it doesn't pass this. */
  onUnits?: (units: Units) => void;
}

// Common paper colours, plus any colour from the picker. The paper is drawn in this colour whatever
// the app's theme, so light or dark mode never changes how a print looks.
const PAPER_COLORS = [
  { name: "White", color: "#ffffff" },
  { name: "Cream", color: "#f4ecd8" },
  { name: "Kraft", color: "#c6a57a" },
  { name: "Gray", color: "#8e9196" },
  { name: "Black", color: "#1d1d1f" },
];

/**
 * Shared: the paper, the same card in both apps - its size, the way it lies, and its colour. What
 * only one app has is passed in by that app, and is simply not there in the other.
 */
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits }: Props) {
  const custom = sizeId === "custom";
  const landscape = w >= h;
  // Paper colour rarely changes, so its swatches stay tucked behind the Palette button.
  const [colorsOpen, setColorsOpen] = useState(false);

  // Each size is named in the chosen unit and the way the paper lies (width × height), so the list
  // follows a turn and a change of unit. Custom shows the size typed in.
  const sizeName = (p: (typeof PAPER_SIZES)[number]) => {
    const [pw, ph] = p.w && p.h ? (landscape ? [p.h, p.w] : [p.w, p.h]) : [w, h];
    const dims = `${fmtLen(pw, units, false)} × ${fmtLen(ph, units)}`;
    return p.w ? dims : `Custom size (${dims})`;
  };

  return (
    <Section
      title="Paper"
      collapsibleKey={collapsibleKey}
      action={
        <ButtonRound
          size="sm"
          icon={<Palette />}
          className={colorsOpen ? styles.roundActive : undefined}
          aria-label="Paper color"
          aria-expanded={colorsOpen}
          title={colorsOpen ? "Hide paper colors" : "Paper color"}
          onClick={() => setColorsOpen((open) => !open)}
        />
      }
    >
      <div className={styles.paperRow}>
        <InputSelect size="md" label="Paper size" hideLabel value={sizeId} disabled={disabled} onChange={(e) => onSize(e.target.value)}>
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{sizeName(p)}</option>)}
        </InputSelect>
        {onUnits && <UnitSwitch units={units} disabled={disabled} onChange={onUnits} />}
        {/* The paper lies one way or the other, never both: a choice of two, like the toolbar's.
            A square sheet lies neither way, so neither is chosen. */}
        <SegmentedControl size="sm" variant="dark" aria-label="Which way the paper lies">
          {[
            { wide: true, icon: <MoveHorizontal />, label: "Landscape", hint: "Landscape: the paper lies on its side" },
            { wide: false, icon: <MoveVertical />, label: "Portrait", hint: "Portrait: the paper stands up" },
          ].map(({ wide, icon, label, hint }) => {
            const on = landscape === wide && w !== h;
            return (
              <Segment
                key={label}
                selected={on}
                icon={icon}
                aria-label={label}
                title={hint}
                disabled={disabled}
                onClick={() => {
                  if (!on) onDimensions(h, w); // already lying that way otherwise
                }}
              />
            );
          })}
        </SegmentedControl>
      </div>

      {colorsOpen && (
        <div className={styles.paperColors} role="radiogroup" aria-label="Paper color">
          {PAPER_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              role="radio"
              aria-checked={color === c.color}
              aria-label={`${c.name} paper`}
              title={`${c.name} paper`}
              className={styles.paperSwatch}
              style={{ background: c.color }}
              disabled={disabled}
              onClick={() => onColor(c.color)}
            />
          ))}
          {(() => {
            const customColor = !PAPER_COLORS.some((c) => c.color === color);
            return (
              <label
                className={styles.paperSwatch}
                data-custom
                role="radio"
                aria-checked={customColor}
                title="Pick any paper color"
                style={customColor ? { background: color } : undefined}
              >
                {!customColor && <Pipette aria-hidden />}
                <input type="color" aria-label="Custom paper color" value={color} disabled={disabled} onChange={(e) => onColor(e.target.value)} />
              </label>
            );
          })()}
        </div>
      )}

      {custom && (
        <div className={styles.row2}>
          <LengthField label="Width" mm={w} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(mm, h)} />
          <LengthField label="Height" mm={h} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(w, mm)} />
        </div>
      )}
    </Section>
  );
}
