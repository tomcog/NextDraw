import { ButtonRound } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
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
}

/**
 * The quarter turns, drawn in the artboard's own row above the paper rather than down here with the
 * numbers (Tom, 2026-11-24): what they turn is the artboard, so they belong beside its size. The
 * turn is the artboard's alone - the paper always lies with its long edge across the plotter, so
 * there is nothing to turn but the piece on it. Placement only: the drawing is not touched, and a
 * turn set by hand stands even if it then doesn't fit.
 */
export function TurnButtons({ disabled, onTurn }: { disabled: boolean; onTurn: ((dir: 1 | -1) => void) | null }) {
  return (
    <div className={styles.offsetButtons}>
      <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the artboard left" title="Turn the artboard a quarter turn left on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(-1)} />
      <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the artboard right" title="Turn the artboard a quarter turn right on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(1)} />
    </div>
  );
}

/**
 * Plot's Layout: where the artboard starts, measured from the plotter's home corner, and which way
 * round it lies. One thing, and nothing else (Tom, 2026-11-24).
 *
 * Two numbers, and nothing else. It had a margin, a nine-way align picker, a second pair of numbers
 * for where the sheet sits on the bed, a reset button, and a heading over all of it; the turns are
 * above, in the artboard's row. The align picker was a quick way to compute
 * these two numbers and the margin existed only to feed it; the reset was a third way to type what
 * two fields already take. All gone: the numbers are typed, or the artboard dragged in the preview.
 * The turns stay as the override for a piece that wants to lie the other way.
 *
 * Everything here is placement: nothing is written into the drawing, and nothing is resized - a piece
 * too big for the sheet is a red outline and a trip back to Studio.
 */
export function PositionSection({ placement, minPlacement, units, disabled, onChange }: Props) {
  return (
    <div className={styles.position}>
      <div className={styles.offsetRow}>
        {/* X and Y, the plotter's own axes, rather than Across and Down: these are measured from
          its home corner, and that is what the machine calls them (Tom, 2026-11-24). Labelled under
          the box rather than with a word inside it - the suffix takes 4rem of the field's width,
          and three things don't fit across a 220px card that way. */}
        <LengthField label="X pos" mm={placement.x} units={units} min={minPlacement.x} disabled={disabled} onChange={(v) => onChange({ x: v, y: placement.y })} />
        <LengthField label="Y pos" mm={placement.y} units={units} min={minPlacement.y} disabled={disabled} onChange={(v) => onChange({ x: placement.x, y: v })} />
      </div>
    </div>
  );
}
