import { ButtonRound } from "@tomcoggia/ui";
import { RotateCcw } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import { LengthField } from "./LengthField";
import type { Placement, Settings, Units } from "../../../shared/lib/types";

interface Props {
  placement: Placement;
  units: Units;
  disabled: boolean;
  onChange: (p: Placement) => void;
  paperX: number; // mm from home
  paperY: number;
  onPaperChange: (patch: Partial<Settings>) => void;
}

interface PairProps {
  heading: string;
  x: number;
  y: number;
  units: Units;
  disabled: boolean;
  resetLabel: string;
  min?: number; // leave out to allow negative values
  onChange: (x: number, y: number) => void;
}

// A heading, Across and Down fields, and a round button that sets both back to 0.
function OffsetPair({ heading, x, y, units, disabled, resetLabel, min, onChange }: PairProps) {
  return (
    <div className={styles.offsetGroup}>
      <h3 className={styles.subheading}>{heading}</h3>
      <div className={styles.offsetRow}>
        <LengthField label="Across" suffix="across" mm={x} units={units} min={min} disabled={disabled} onChange={(v) => onChange(v, y)} />
        <LengthField label="Down" suffix="down" mm={y} units={units} min={min} disabled={disabled} onChange={(v) => onChange(x, v)} />
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
  );
}

// Where the drawing and the paper sit, measured from home. Shown in the collapsed
// "Drawing position" section under the preview.
export function PositionSection({ placement, units, disabled, onChange, paperX, paperY, onPaperChange }: Props) {
  return (
    <div className={styles.position}>
      <OffsetPair
        heading="Where the drawing starts, from home (or drag it in the preview)"
        x={placement.x}
        y={placement.y}
        units={units}
        disabled={disabled}
        resetLabel="Reset drawing start to home"
        min={0}
        onChange={(x, y) => onChange({ x, y })}
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
