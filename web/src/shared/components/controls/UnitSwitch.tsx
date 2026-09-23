import type { Units } from "../../lib/types";
import styles from "./UnitSwitch.module.css";
import rule from "./unit-rule.svg";

interface Props {
  units: Units;
  onChange: (units: Units) => void;
  disabled?: boolean;
}

/**
 * NextDraw's own, not the library's: inches or millimetres as two words with a rule between them, the
 * one in use in the brand colour. Figma: component-library 788:653. A switch this small, sitting in the
 * paper's row beside the size, reads as a setting rather than a control to reach for.
 */
export function UnitSwitch({ units, onChange, disabled }: Props) {
  const option = (value: Units) => (
    <button
      type="button"
      role="radio"
      aria-checked={units === value}
      className={styles.unit}
      disabled={disabled}
      onClick={() => onChange(value)}
    >
      {value}
    </button>
  );
  return (
    <span className={styles.switch} role="radiogroup" aria-label="Units">
      {option("in")}
      {/* The rule as the design draws it: a 12-wide line, stood on its end. */}
      <span className={styles.rule} aria-hidden="true">
        <img src={rule} alt="" width={12} height={1} />
      </span>
      {option("mm")}
    </span>
  );
}
