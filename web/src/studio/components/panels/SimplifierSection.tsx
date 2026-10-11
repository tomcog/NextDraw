import { Button, Checkbox, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";

export type SimplifyKey = "mergeShort" | "straighten" | "joinEnds" | "dropTiny";

/** Which simplifications are ticked, and each one's distance in millimetres on the paper. */
export interface SimplifierState {
  on: Record<SimplifyKey, boolean>;
  mm: Record<SimplifyKey, number>;
}

/** Every box clear, every distance back to where it starts: how the card opens, and is left after Simplify. */
export const SIMPLIFIER_START: SimplifierState = {
  on: { mergeShort: false, straighten: false, joinEnds: false, dropTiny: false },
  mm: { mergeShort: 0.1, straighten: 0.05, joinEnds: 0.2, dropTiny: 0.3 },
};

const STEPS: { key: SimplifyKey; label: string; hint: string; max: number; step: number }[] = [
  { key: "mergeShort", label: "Merge short segments", hint: "Drop points closer than this to the last one kept", max: 5, step: 0.05 },
  { key: "straighten", label: "Straighten within", hint: "Drop points that lie within this of the line between their neighbors", max: 5, step: 0.05 },
  { key: "joinEnds", label: "Join close ends", hint: "Carry on, pen down, where one stroke of a path starts within this of where the last one ended", max: 10, step: 0.1 },
  { key: "dropTiny", label: "Drop tiny paths", hint: "Take out strokes whose longest side is under this", max: 20, step: 0.1 },
];

interface Props {
  value: SimplifierState;
  onChange: (value: SimplifierState) => void;
  /** The whole drawing, or only the layer being drawn on. */
  scope: "drawing" | "layer";
  onScope: (scope: "drawing" | "layer") => void;
  layerName: string;
  /** Points in the paths it works on, now and as the page shows them. */
  before: number;
  after: number;
  /** Paths it takes out altogether, having nothing left. */
  removed: number;
  busy: boolean;
  onApply: () => void;
}

/**
 * The Simplifier: the ways to take points out of a drawing, each a box to tick and a distance on the
 * paper, shown on the page as they're set - a distance once it's entered - and made for good only by
 * Simplify, which then clears the card. It works on paths only: an image, a word or a curve is drawn
 * from its numbers.
 */
export function SimplifierSection({ value, onChange, scope, onScope, layerName, before, after, removed, busy, onApply }: Props) {
  const anyOn = Object.values(value.on).some(Boolean);
  const fewer = before - after;
  return (
    <Section title="Simplifier" collapsibleKey="simplifier">
      <SegmentedControl size="sm" variant="dark" aria-label="What to simplify">
        <Segment selected={scope === "drawing"} title="Every path in the drawing" onClick={() => onScope("drawing")}>Whole drawing</Segment>
        <Segment selected={scope === "layer"} title={`Only the paths on ${layerName}, the layer being drawn on`} onClick={() => onScope("layer")}>This layer</Segment>
      </SegmentedControl>
      {STEPS.map(({ key, label, hint, max, step }) => (
        <div key={key}>
          <Checkbox
            checked={value.on[key]}
            label={label}
            title={hint}
            onChange={(e) => onChange({ ...value, on: { ...value.on, [key]: e.target.checked } })}
          />
          {value.on[key] && (
            <NumberField label={label} hideLabel unit="mm" min={0} max={max} step={step} value={value.mm[key]} onChange={(mm) => onChange({ ...value, mm: { ...value.mm, [key]: mm } })} />
          )}
        </div>
      ))}
      <p className={controls.hint}>
        {before === 0
          ? "No paths to simplify here. Images, text and curves are drawn from their settings, not their points."
          : !anyOn
            ? `${before.toLocaleString()} points. Tick a way to simplify to see it on the page.`
            : `${before.toLocaleString()} points → ${after.toLocaleString()}${fewer > 0 ? `, ${Math.round((fewer / before) * 100)}% fewer` : ""}${removed ? `; ${removed.toLocaleString()} ${removed === 1 ? "path" : "paths"} dropped` : ""}. Shown on the page; Simplify keeps it.`}
      </p>
      <Button size="sm" variant="secondary" disabled={busy || !anyOn || (fewer <= 0 && !removed)} onClick={onApply}>
        Simplify
      </Button>
    </Section>
  );
}
