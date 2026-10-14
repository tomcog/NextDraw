import { Button, Card, Checkbox } from "@tomcoggia/ui";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import type { Photo } from "../../shared/lib/drawing/photo";
import { VIGNETTE_DEFAULTS, VIGNETTE_FIELDS } from "../../shared/lib/drawing/vignette";
import styles from "../App.module.css";

interface Props {
  /** The image in hand: its vignette is every layer's. */
  photo: Photo;
  /** The whole image's settings. */
  set: (patch: Partial<Photo>) => void;
}

/**
 * The image darkened toward its edges - or faded toward the paper - before any effect reads it, so
 * every layer draws it. On or off, its numbers kept either way; Reset puts them back to the start.
 */
export function VignetteCard({ photo, set }: Props) {
  const v = photo.vignette ?? { ...VIGNETTE_DEFAULTS, off: true };
  const on = !v.off;
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section title="Vignette" collapsibleKey="photo-vignette">
          <div className={styles.fillRow}>
            <Checkbox size="md"
              checked={on}
              label="On"
              title="Darken the image toward its edges before the effect draws it"
              onChange={(e) => set({ vignette: { ...v, off: e.target.checked ? undefined : true } })}
            />
            <Button size="sm" variant="secondary" disabled={!on} title="Put the numbers back to where they start" onClick={() => set({ vignette: { ...VIGNETTE_DEFAULTS } })}>
              Reset
            </Button>
          </div>
          <div className={styles.fillRow}>
            {VIGNETTE_FIELDS.map((f) => (
              <div key={f.key} title={f.about}>
                <NumberField label={f.label} unit={f.unit} min={f.min} max={f.max} step={f.step} disabled={!on} value={v[f.key]} onChange={(n) => set({ vignette: { ...v, [f.key]: n } })} />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Card>
  );
}
