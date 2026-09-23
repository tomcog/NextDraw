import type { Units } from "../../lib/types";
import styles from "./UnitSwitch.module.css";

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
      {/* The rule between them, in the border colour so it follows the theme. */}
      <span className={styles.rule} aria-hidden="true" />
      {option("mm")}
    </span>
  );
}
