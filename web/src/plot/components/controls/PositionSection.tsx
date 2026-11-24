import { useState } from "react";
import { ButtonRound } from "@tomcoggia/ui";
import { RotateCcw, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import type { ReactNode } from "react";
import styles from "../../../shared/components/controls/controls.module.css";
import { AlignPicker, useFitAlign } from "../../../shared/components/controls/FitControls";
import { LengthField } from "../../../shared/components/controls/LengthField";
import type { FitAlign } from "../../../shared/lib/geometry";
import type { Placement, Settings, Units } from "../../../shared/lib/types";

/** The margin the align picker insets the artboard by, in mm: half an inch until one is set. One
 *  number for all four sides - a deeper foot is the artboard's own margin now, set in Studio. */
const MARGIN_KEY = "nextdraw.plotMargin";

function savedMargin(): number {
  try {
    const raw = localStorage.getItem(MARGIN_KEY);
    const saved = raw === null ? NaN : Number(raw);
    return saved >= 0 ? saved : 12.7;
  } catch {
    return 12.7;
  }
}

interface Props {
  placement: Placement;
  minPlacement: Placement; // below 0 by the empty margin above and left of the lines
  units: Units;
  disabled: boolean;
  onChange: (p: Placement) => void;
  paperX: number; // mm from home
  paperY: number;
  onPaperChange: (patch: Partial<Settings>) => void;
  /** Put the artboard where the align picker says, inside the paper less this margin (mm). Left out
   *  while there is no paper, or no drawing to place on it. */
  onPlace: ((align: FitAlign, marginMm: number) => void) | null;
  /** A quarter turn of the artboard on the sheet, 1 right or -1 left. Placement only: the drawing is
   *  not touched, and a turn set by hand stands even if it then doesn't fit. */
  onTurn: ((dir: 1 | -1) => void) | null;
}

interface PairProps {
  heading: string;
  x: number;
  y: number;
  units: Units;
  disabled: boolean;
  resetLabel: string;
  min?: { x: number; y: number }; // leave out to allow any value
  onChange: (x: number, y: number) => void;
  actions?: ReactNode; // round buttons before the reset one
}

// A heading, Across and Down fields, and a round button that sets both back to 0.
function OffsetPair({ heading, x, y, units, disabled, resetLabel, min, onChange, actions }: PairProps) {
  return (
    <div className={styles.offsetGroup}>
      <h3 className={styles.subheading}>{heading}</h3>
      <div className={styles.offsetRow}>
        <LengthField label="Across" suffix="across" mm={x} units={units} min={min?.x} disabled={disabled} onChange={(v) => onChange(v, y)} />
        <LengthField label="Down" suffix="down" mm={y} units={units} min={min?.y} disabled={disabled} onChange={(v) => onChange(x, v)} />
        <div className={styles.offsetButtons}>
          {actions}
          <ButtonRound
            size="sm"
            icon={<RotateCcw />}
            aria-label={resetLabel}
            title={resetLabel}
            disabled={disabled || (x === 0 && y === 0)}
            onClick={() => onChange(0, 0)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Plot position: where the piece lands on the sheet, and nothing about the piece itself (Tom,
 * 2026-11-23, docs/plot.md). The artboard turned on the sheet, put against an edge or centred inside
 * a margin, or placed by hand from the paper's own corner; and under that, where the sheet itself
 * sits on the bed.
 *
 * Everything here is placement: nothing is written into the drawing, and nothing is resized - a piece
 * too big for the sheet is a red outline and a trip back to Studio.
 */
export function PositionSection({ placement, minPlacement, units, disabled, onChange, paperX, paperY, onPaperChange, onPlace, onTurn }: Props) {
  const [align, keepAlign] = useFitAlign();
  const [margin, setMargin] = useState(savedMargin);
  const keepMargin = (mm: number) => {
    setMargin(mm);
    try { localStorage.setItem(MARGIN_KEY, String(mm)); } catch { /* kept for this visit only */ }
  };
  return (
    <div className={styles.position}>
      {/* The artboard turned, and the margin the align picker leaves round it. The turn is the
        artboard's alone: the paper always lies with its long edge across the plotter. */}
      <div className={styles.transformRow}>
        <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the artboard left" title="Turn the artboard a quarter turn left on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(-1)} />
        <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the artboard right" title="Turn the artboard a quarter turn right on the sheet. The drawing itself is not changed." disabled={disabled || !onTurn} onClick={() => onTurn?.(1)} />
        <div className={styles.marginField}>
          <LengthField label="Margin" mm={margin} units={units} min={0} disabled={disabled} onChange={keepMargin} />
        </div>
      </div>
      {/* Pressed, it moves the artboard there and then - the piece keeps its size, so there is no Fit
        to wait for. Against an edge is against the margin; in the middle ignores it. */}
      <AlignPicker
        align={align}
        inside="paper"
        disabled={disabled || !onPlace}
        onAlign={(next) => {
          keepAlign(next);
          onPlace?.(next, margin);
        }}
      />
      <OffsetPair
        heading="Where the artboard starts, from the paper’s corner (or drag it in the preview)"
        x={placement.x - paperX}
        y={placement.y - paperY}
        units={units}
        disabled={disabled}
        resetLabel="Put the artboard in the paper’s corner"
        min={{ x: minPlacement.x - paperX, y: minPlacement.y - paperY }}
        onChange={(x, y) => onChange({ x: x + paperX, y: y + paperY })}
      />
      <OffsetPair
        heading="Where the paper’s corner sits, from home"
        x={paperX}
        y={paperY}
        units={units}
        disabled={disabled}
        resetLabel="Reset paper corner to home"
        onChange={(paper_x, paper_y) => onPaperChange({ paper_x, paper_y })}
      />
    </div>
  );
}
