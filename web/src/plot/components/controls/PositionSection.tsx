import { ButtonRound } from "@tomcoggia/ui";
import { AlignCenterHorizontal, AlignCenterVertical, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import styles from "../../../shared/components/controls/controls.module.css";
import { LengthField } from "../../../shared/components/controls/LengthField";
import type { Placement, Settings, Units } from "../../../shared/lib/types";

interface Props {
  placement: Placement;
  minPlacement: Placement; // below 0 by the empty margin above and left of the lines
  units: Units;
  disabled: boolean;
  onChange: (p: Placement) => void;
  paperX: number; // mm from home
  paperY: number;
  onPaperChange: (patch: Partial<Settings>) => void;
  onCentre: ((axis: "x" | "y") => void) | null; // null when there's no paper size to centre on
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

// Where the drawing and the paper sit, measured from home. Shown in the collapsed
// "Drawing position" section under the preview.
export function PositionSection({ placement, minPlacement, units, disabled, onChange, paperX, paperY, onPaperChange, onCentre }: Props) {
  return (
    <div className={styles.position}>
      <OffsetPair
        heading="Where the drawing starts, from home (or drag it in the preview)"
        x={placement.x}
        y={placement.y}
        units={units}
        disabled={disabled}
        resetLabel="Reset drawing start to home"
        min={minPlacement}
        onChange={(x, y) => onChange({ x, y })}
        actions={<>
          <ButtonRound
            size="sm"
            icon={<AlignCenterVertical />}
            aria-label="Centre across the paper"
            title="Centre the drawing's lines across the paper"
            disabled={disabled || !onCentre}
            onClick={() => onCentre?.("x")}
          />
          <ButtonRound
            size="sm"
            icon={<AlignCenterHorizontal />}
            aria-label="Centre down the paper"
            title="Centre the drawing's lines down the paper"
            disabled={disabled || !onCentre}
            onClick={() => onCentre?.("y")}
          />
        </>}
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
