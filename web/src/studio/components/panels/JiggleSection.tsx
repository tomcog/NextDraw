import { Button, Checkbox } from "@tomcoggia/ui";
import { Shuffle, Vibrate } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";
import styles from "../../App.module.css";

/** The Jiggle card's numbers, as they're set: millimetres on the paper, degrees, a percent. */
export interface JiggleState {
  mm: number;
  angle: number;
  randomness: number;
  noiseMm: number;
  seed: number;
  /** Jiggle a copy of each layer, leaving the layer as it is: the second pass over the first. */
  copy: boolean;
}

export const JIGGLE_START: JiggleState = { mm: 1, angle: 45, randomness: 10, noiseMm: 0, seed: 1, copy: true };

export const newJiggleSeed = () => Math.floor(Math.random() * 2 ** 31);

interface Props {
  value: JiggleState;
  onChange: (value: JiggleState) => void;
  /** The layers it works on: the targeted ones that are showing. */
  layerName: string;
  /** Strokes on them: what it moves. */
  strokes: number;
  busy: boolean;
  onApply: () => void;
}

/**
 * Jiggle: the strokes of the targeted layers moved a little - all the same way by the distance, each
 * a little differently by the randomness, their points strayed by the noise. Shown on the page as it's
 * set, and made for good by Jiggle; on a copy of each layer, by default, for another pass over it.
 */
export function JiggleSection({ value, onChange, layerName, strokes, busy, onApply }: Props) {
  const set = (patch: Partial<JiggleState>) => onChange({ ...value, ...patch });
  const random = value.randomness > 0 || value.noiseMm > 0;
  return (
    <Section title="Jiggle" icon={<Vibrate />} collapsibleKey="jiggle">
      <div className={styles.fillRow}>
        <NumberField label="Distance" unit="mm" min={0} max={20} step={0.1} value={value.mm} onChange={(mm) => set({ mm })} />
        <NumberField label="Direction" unit="°" min={-180} max={360} step={15} value={value.angle} onChange={(angle) => set({ angle })} />
      </div>
      <div className={styles.fillRow}>
        <NumberField label="Randomness" unit="%" min={0} max={100} step={5} value={value.randomness} onChange={(randomness) => set({ randomness })} />
        <NumberField label="Noise" unit="mm" min={0} max={5} step={0.05} value={value.noiseMm} onChange={(noiseMm) => set({ noiseMm })} />
      </div>
      <p className={controls.hint}>
        Every stroke on {layerName} moves {value.mm} mm at {value.angle}° (0° is right, 90° up). Randomness lets each one
        stray from that by up to its share of the distance; noise moves each point of a path on its own. Shapes, curves and
        text have no points to stray, so they only move.
      </p>
      {random && (
        <Button size="sm" variant="secondary" icon={<Shuffle />} title="Another draw of the randomness and noise, the same amounts" onClick={() => set({ seed: newJiggleSeed() })}>
          Randomizer
        </Button>
      )}
      <Checkbox size="md"
        checked={value.copy}
        label="Jiggle a copy"
        title="Add a jiggled copy of each layer above it, for another pass, and leave the layer itself as it is"
        onChange={(e) => set({ copy: e.target.checked })}
      />
      <Button size="sm" variant="secondary" disabled={busy || !strokes} onClick={onApply}>
        Jiggle
      </Button>
    </Section>
  );
}
