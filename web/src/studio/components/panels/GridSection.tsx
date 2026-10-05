import { Checkbox } from "@tomcoggia/ui";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";

interface Props {
  snapping: boolean;
  onSnapping: (on: boolean) => void;
  /** What a drag rounds to, in inches. */
  step: number;
  onStep: (inches: number) => void;
}

/** Snapping to a grid: Studio's alone, in the Settings card beside Paper and Drawing tool. */
export function GridSection({ snapping, onSnapping, step, onStep }: Props) {
  return (
    <Section
      title="Grid"
      collapsibleKey="grid"
      actionWhenOpen
      // Folded, the row says whether shapes are snapping, as Paper and Drawing tool say theirs.
      closedAction={snapping ? <span className={controls.toolInTitle}>On</span> : undefined}
    >
      <Checkbox
        checked={snapping}
        label="Snap to the grid"
        title="Round what is drawn, moved and resized to the grid"
        onChange={(e) => onSnapping(e.target.checked)}
      />
      {snapping && (
        <NumberField label="Every" unit="in" min={0.01} max={12} step={0.125} value={step} onChange={onStep} />
      )}
    </Section>
  );
}
