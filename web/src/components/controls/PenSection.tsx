import { Button } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { Section } from "./Section";
import { Slider } from "./Slider";
import type { Settings } from "../../lib/types";

interface Props {
  settings: Settings;
  disabled: boolean;
  busy: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onSetupHeight: () => void;
  onTest: () => void;
}

export function PenSection({ settings: s, disabled, busy, onChange, onSetupHeight, onTest }: Props) {
  return (
    <Section title="Pen">
      <Slider label="Height when drawing" value={s.pen_pos_down} disabled={disabled} onChange={(v) => onChange({ pen_pos_down: v })} />
      <Slider label="Height when lifted (while moving)" value={s.pen_pos_up} disabled={disabled} onChange={(v) => onChange({ pen_pos_up: v })} />
      <Slider label="Pen setup height (for mounting a pen)" value={s.pen_setup} disabled={disabled} onChange={(v) => onChange({ pen_setup: v })} />
      <p className={styles.hint}>Move the holder to the setup height, then mount the pen with your sizing block.</p>
      <div className={styles.buttonRow}>
        <Button size="md" variant="secondary" disabled={busy} onClick={onSetupHeight}>Move to setup height</Button>
        <Button size="md" variant="secondary" disabled={busy} onClick={onTest}>Test pen heights</Button>
      </div>
      <details className={styles.more}>
        <summary>Lift and lower speed</summary>
        <Slider label="Lowering speed" value={s.pen_rate_lower} min={1} disabled={disabled} onChange={(v) => onChange({ pen_rate_lower: v })} />
        <Slider label="Raising speed" value={s.pen_rate_raise} min={1} disabled={disabled} onChange={(v) => onChange({ pen_rate_raise: v })} />
      </details>
    </Section>
  );
}
