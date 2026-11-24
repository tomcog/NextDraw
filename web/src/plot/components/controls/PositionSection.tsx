import { ButtonRound } from "@tomcoggia/ui";
import { RotateCcw, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import { LengthField } from "../../../shared/components/controls/LengthField";
import type { Placement, Units } from "../../../shared/lib/types";

interface Props {
  /** The artboard's own corner, in mm from the plotter's home. */
  placement: Placement;
  minPlacement: Placement; // below 0 by the empty margin above and left of the lines
  units: Units;
  disabled: boolean;
  onChange: (p: Placement) => void;
  /** A quarter turn of the artboard on the sheet, 1 right or -1 left. Placement only: the drawing is
   *  not touched, and a turn set by hand stands even if it then doesn't fit. */
  onTurn: ((dir: 1 | -1) => void) | null;
}

/**
 * Plot's Layout: where the artboard starts, measured from the plotter's home corner, and which way
 * round it lies. One thing, and nothing else (Tom, 2026-11-24).
 *
 * It had a margin, a nine-way align picker and a second pair of numbers for where the sheet sits on
 * the bed. The align picker was a quick way to compute these two numbers and the margin existed only
 * to feed it; both are gone, and the numbers are typed or the artboard dragged in the preview. The
 * turns stay as the override for a piece that wants to lie the other way.
 *
 * Everything here is placement: nothing is written into the drawing, and nothing is resized - a piece
 * too big for the sheet is a red outline and a trip back to Studio.
 */
export function PositionSection({ placement, minPlacement, units, disabled, onChange, onTurn }: Props) {
  const home = placement.x === 0 && placement.y === 0;
  return (
    <div className={styles.position}>
      {/* The turn is the artboard's alone: the paper always lies with its long edge across the
        plotter, so there is nothing to turn but the piece on it. */}
      <div className={styles.transformRow}>
        <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the artboard left" title="Turn the artboard a quarter turn left on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(-1)} />
        <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the artboard right" title="Turn the artboard a quarter turn right on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(1)} />
      </div>
      <div className={styles.offsetGroup}>
        <h3 className={styles.subheading}>Where the artboard starts, from the plotter’s home (or drag it in the preview)</h3>
        <div className={styles.offsetRow}>
          <LengthField label="Across" suffix="across" mm={placement.x} units={units} min={minPlacement.x} disabled={disabled} onChange={(v) => onChange({ x: v, y: placement.y })} />
          <LengthField label="Down" suffix="down" mm={placement.y} units={units} min={minPlacement.y} disabled={disabled} onChange={(v) => onChange({ x: placement.x, y: v })} />
          <div className={styles.offsetButtons}>
            <ButtonRound
              size="sm"
              icon={<RotateCcw />}
              aria-label="Put the artboard at the plotter’s home"
              title="Put the artboard at the plotter’s home"
              disabled={disabled || home}
              onClick={() => onChange({ x: 0, y: 0 })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
