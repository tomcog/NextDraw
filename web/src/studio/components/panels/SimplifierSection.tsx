import { Button, Checkbox, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Shuffle, Spline } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";
import type { PruneMode } from "../../lib/shapeEdits";

export type SimplifyKey = "mergeShort" | "straighten" | "joinEnds" | "dropTiny";

/** Which simplifications are ticked, and each one's distance in millimetres on the paper. */
export interface SimplifierState {
  on: Record<SimplifyKey, boolean>;
  mm: Record<SimplifyKey, number>;
  /** Prune: one stroke out of every `every` taken out, picked as `mode` says, a shuffle drawn from `seed`. */
  prune: { on: boolean; every: number; mode: PruneMode; seed: number };
  /** Straight lines lying along one another joined into the strokes they look like. */
  merge: boolean;
}

/** Every box clear, every distance back to where it starts: how the card opens, and is left after Simplify. */
export const SIMPLIFIER_START: SimplifierState = {
  on: { mergeShort: false, straighten: false, joinEnds: false, dropTiny: false },
  mm: { mergeShort: 0.1, straighten: 0.05, joinEnds: 0.2, dropTiny: 0.3 },
  prune: { on: false, every: 2, mode: "even", seed: 0 },
  merge: false,
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
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export function SimplifierSection({ value, onChange, scope, onScope, layerName, before, after, removed, busy, onApply }: Props) {
  const anyOn = Object.values(value.on).some(Boolean) || value.prune.on || value.merge;
  const prune = (patch: Partial<SimplifierState["prune"]>) => onChange({ ...value, prune: { ...value.prune, ...patch } });
  const fewer = before - after;
  return (
    <Section title={<span className={controls.iconTitle}><Spline />Simplifier</span>} collapsibleKey="simplifier">
      <SegmentedControl size="sm" variant="dark" aria-label="What to simplify">
        <Segment selected={scope === "drawing"} title="Every path in the drawing" onClick={() => onScope("drawing")}>Whole drawing</Segment>
        <Segment selected={scope === "layer"} title={`Only the paths on ${layerName}`} onClick={() => onScope("layer")}>This layer</Segment>
      </SegmentedControl>
      {/* Merge has no distance: lines are on the same line or they aren't. */}
      <Checkbox size="md"
        checked={value.merge}
        label="Merge overlapping lines"
        title="Straight lines that run over one another along the same line - a halftone's dashes, a line drawn twice - joined into single strokes, so each bit is drawn once"
        onChange={(e) => onChange({ ...value, merge: e.target.checked })}
      />
      {STEPS.map(({ key, label, hint, max, step }) => (
        <div key={key}>
          <Checkbox size="md"
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
      {/* Prune: thins the strokes themselves, one in every N on each layer. Evenly takes every Nth line
        across the page; Shuffled one line at random from each N; Random any one in N. The Randomizer
        picks another set for the last two. Unticked, it goes back to Evenly. */}
      <div>
        <Checkbox size="md"
          checked={value.prune.on}
          label="Prune paths"
          title="Take out one stroke in every so many: 2 takes out half, 3 a third"
          onChange={(e) => prune({ on: e.target.checked, mode: "even" })}
        />
        {value.prune.on && (
          <>
            <NumberField label="1 out of every" min={2} max={100} step={1} value={value.prune.every} onChange={(every) => prune({ every: Math.round(every) })} />
            <SegmentedControl size="sm" variant="dark" aria-label="Which strokes go">
              <Segment selected={value.prune.mode === "even"} title="Every Nth line across the page: half the lines of a hatching at 2, every other one" onClick={() => prune({ mode: "even" })}>Evenly</Segment>
              <Segment selected={value.prune.mode === "blocks"} title="One line at random out of each N side by side: the same share everywhere, a looser rhythm" onClick={() => prune({ mode: "blocks", seed: newSeed() })}>Shuffled</Segment>
              <Segment selected={value.prune.mode === "random"} title="Any one stroke in N, picked freely: it can thin one place more than another" onClick={() => prune({ mode: "random", seed: newSeed() })}>Random</Segment>
            </SegmentedControl>
            {value.prune.mode !== "even" && (
              <Button size="sm" variant="secondary" icon={<Shuffle />} title="Pick another set of strokes to take out, the same way" onClick={() => prune({ seed: newSeed() })}>
                Randomizer
              </Button>
            )}
          </>
        )}
      </div>
      {/* Only the count: what there is, and once anything is ticked, what it comes to. */}
      <p className={controls.hint}>
        {anyOn ? `${before.toLocaleString()} → ${after.toLocaleString()} points` : `${before.toLocaleString()} points`}
      </p>
      <Button size="sm" variant="secondary" disabled={busy || !anyOn || (fewer <= 0 && !removed)} onClick={onApply}>
        Simplify
      </Button>
    </Section>
  );
}
