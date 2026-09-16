import { ButtonRound } from "@tomcoggia/ui";
import { Blend } from "lucide-react";
import controls from "./controls/controls.module.css";
import styles from "./InkSimControl.module.css";

interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
}

// Sits at the left end of the width dimension line, opposite the zoom presets. It belongs on the
// preview rather than in the Layers card: what it changes is how the drawing is drawn, not anything
// about a layer.
//
// The label says what is true, not what the button does - "Simulate inks" while it is off, and
// "Simulated inks" once it is on - so the row reads as the state of the preview you are looking at.
export function InkSimControl({ on, onChange }: Props) {
  const label = on ? "Simulated inks" : "Simulate inks";
  return (
    <span className={styles.control}>
      <ButtonRound
        size="sm"
        icon={<Blend />}
        className={on ? controls.roundActive : undefined}
        aria-label={label}
        aria-pressed={on}
        title={
          on
            ? "Showing each tool's ink: how solid it is and how it darkens where strokes cross. Turn it off on a very large drawing - blending every stroke is slow."
            : "Drawing each layer flat. Turn ink simulation on to see how the ink builds up."
        }
        onClick={() => onChange(!on)}
      />
      {/* The button is the control; this repeats it so the row can be clicked anywhere and read at a
          glance. Hidden from the accessibility tree, which already has the button's own label. */}
      <span className={styles.label} aria-hidden="true" onClick={() => onChange(!on)}>
        {label}
      </span>
    </span>
  );
}
