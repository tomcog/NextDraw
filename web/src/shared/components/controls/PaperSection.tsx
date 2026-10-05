import { useState } from "react";
import { Button, ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { MoveHorizontal, MoveVertical, Palette, Pipette, RotateCcw } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { NumberField } from "./NumberField";
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
  /** Studio: turn the whole drawing a quarter turn anticlockwise with the paper. Plot turns a drawing elsewhere. */
  onTurnDrawing?: () => void;
  /** Studio: scale the whole drawing about its middle, by a percent. Plot scales a drawing elsewhere. */
  onScaleDrawing?: (percent: number) => void;
  /** Both apps: scale the drawing to fill the paper less a margin all round (in mm), and centre it.
   *  Left out while there is no drawing to fit. */
  onFit?: (marginMm: number) => void;
}

// Common paper colours, plus any colour from the picker. The paper is drawn in this colour whatever
// the app's theme, so light or dark mode never changes how a print looks.
const MARGIN_KEY = "nextdraw.fitMargin";

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
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits, onTurnDrawing, onScaleDrawing, onFit }: Props) {
  const landscape = w >= h;
  // Paper colour rarely changes, so its swatches stay tucked behind the Palette button.
  const [colorsOpen, setColorsOpen] = useState(false);
  const [scaleBy, setScaleBy] = useState(100);
  // Kept between visits, so the margin a sheet is usually given is the one the button fits to.
  const [margin, setMargin] = useState(() => {
    try {
      const raw = localStorage.getItem(MARGIN_KEY);
      const saved = raw === null ? NaN : Number(raw);
      return saved >= 0 ? saved : 12.7; // half an inch until one is chosen
    } catch {
      return 12.7;
    }
  });
  const keepMargin = (mm: number) => {
    setMargin(mm);
    try { localStorage.setItem(MARGIN_KEY, String(mm)); } catch { /* kept for this visit only */ }
  };
  // A margin that leaves no paper between them has nothing to fit into.
  const roomLeft = w - 2 * margin > 0 && h - 2 * margin > 0;

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
            icon={<RotateCcw />}
            aria-label="Turn the drawing"
            title="Turn the drawing a quarter turn anticlockwise, with the paper"
            disabled={disabled}
            onClick={onTurnDrawing}
          />
        )}
      </div>

      {/* The paper stays the size it is; the drawing grows or shrinks on it, about its own middle. */}
      {onScaleDrawing && (
        <div className={styles.scaleRow}>
          <NumberField label="Scale drawing" unit="%" min={1} max={1000} step={5} value={scaleBy} disabled={disabled} onChange={setScaleBy} />
          <Button
            size="md"
            variant="secondary"
            title={`Scale the whole drawing to ${scaleBy}% about its middle, leaving the paper as it is`}
            disabled={disabled || scaleBy === 100}
            onClick={() => {
              onScaleDrawing(scaleBy);
              setScaleBy(100); // done: the drawing is now 100% of itself
            }}
          >
            Scale
          </Button>
        </div>
      )}

      {/* Fit: as big as the paper allows inside the margin, the drawing's lines centred on it. */}
      <div className={styles.scaleRow}>
        <LengthField label="Margin" mm={margin} units={units} min={0} disabled={disabled} onChange={keepMargin} />
        <Button
          size="md"
          variant="secondary"
          title={roomLeft
            ? `Scale the drawing to fill the paper inside a ${fmtLen(margin, units)} margin, and centre it`
            : "The margin leaves no paper to fit the drawing into"}
          disabled={disabled || !onFit || !roomLeft}
          onClick={() => onFit?.(margin)}
        >
          Fit to paper
        </Button>
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
