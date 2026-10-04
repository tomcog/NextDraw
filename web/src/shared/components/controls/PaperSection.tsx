import { useState } from "react";
import { ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { MoveHorizontal, MoveVertical, Palette, Pipette, RotateCw } from "lucide-react";
import styles from "./controls.module.css";
import { UnitSwitch } from "./UnitSwitch";
import { Section } from "./Section";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";

interface Props {
  /** The paper in mm, as it lies: its width across, its height down. */
  w: number;
  h: number;
  /** One of PAPER_SIZES, or "custom" for a drawing whose paper matches none of them. */
  sizeId: string;
  /** What the sizes are named in. */
  units: Units;
  /** The paper's colour, which the preview is drawn on and the inks are blended with. */
  color: string;
  collapsibleKey: string;
  disabled?: boolean;
  /** A size from the menu. The app keeps the way the paper lies. */
  onSize: (id: string) => void;
  /** A new width and height, in mm: the paper turned. */
  onDimensions: (w: number, h: number) => void;
  onColor: (color: string) => void;
  /** Plot: measure in inches or millimetres. Studio works in inches alone, so it doesn't pass this. */
  onUnits?: (units: Units) => void;
  /** Studio: turn the whole drawing a quarter turn with the paper. Plot turns a drawing elsewhere. */
  onTurnDrawing?: () => void;
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
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits, onTurnDrawing }: Props) {
  const landscape = w >= h;
  // Paper colour rarely changes, so its swatches stay tucked behind the Palette button.
  const [colorsOpen, setColorsOpen] = useState(false);

  // Each size is named in the chosen unit and the way the paper lies (width × height), so the list
  // follows a turn and a change of unit.
  const sizeName = (pw: number, ph: number) => `${fmtLen(pw, units, false)} × ${fmtLen(ph, units)}`;
  const listed = (p: (typeof PAPER_SIZES)[number]) => sizeName(...((landscape ? [p.h, p.w] : [p.w, p.h]) as [number, number]));

  return (
    <Section
      title="Paper"
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      // Folded, the row says what paper the drawing is on, as the Drawing tool row names the tool.
      closedAction={<span className={styles.toolInTitle}>{`${fmtLen(w, units, false)} × ${fmtLen(h, units)}`}</span>}
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
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{listed(p)}</option>)}
          {/* Only the sizes are choices. A drawing whose paper is none of them shows its own size,
              which can't be picked - or typed: the paper is one of the sizes or what the file says. */}
          {sizeId === "custom" && <option value="custom" disabled>{sizeName(w, h)}</option>}
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
        {/* The switch above turns only the paper; this turns the drawing with it. */}
        {onTurnDrawing && (
          <ButtonRound
            size="sm"
            icon={<RotateCw />}
            aria-label="Turn the drawing"
            title="Turn the drawing a quarter turn clockwise, with the paper"
            disabled={disabled}
            onClick={onTurnDrawing}
          />
        )}
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
    </Section>
  );
}
