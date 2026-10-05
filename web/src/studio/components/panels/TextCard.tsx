import { Card, InputSelect, InputTextarea } from "@tomcoggia/ui";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import type { Shape } from "../../lib/shapes";
import styles from "../../App.module.css";

type TextPatch = Partial<Pick<Shape, "text" | "font" | "tracking" | "leading">>;

interface Props {
  /** The chosen shape, which is text. */
  shape: Shape;
  /** The single-stroke fonts on this Mac. */
  fonts: string[];
  onChange: (patch: TextPatch) => void;
}

/** The chosen text: what it says, the font it is set in, and its spacing. */
export function TextCard({ shape, fonts, onChange }: Props) {
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={styles.cardBody}>
        <Section title="Text" collapsibleKey="text">
          <InputTextarea
            size="md"
            label="Words"
            rows={2}
            autoResize
            value={shape.text ?? ""}
            maxLength={500}
            // Enter starts a new line here rather than doing anything to the drawing.
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ text: e.target.value })}
          />
          <InputSelect
            size="md"
            label="Font"
            value={shape.font ?? ""}
            disabled={!fonts.length}
            onChange={(e) => onChange({ font: e.target.value })}
          >
            {!fonts.length && <option value="">No fonts on this Mac</option>}
            {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
          </InputSelect>
          <div className={styles.fillRow}>
            <NumberField
              label="Letter spacing"
              unit="%"
              step={1}
              min={-20}
              max={200}
              value={shape.tracking ?? 0}
              onChange={(tracking) => onChange({ tracking })}
            />
            <NumberField
              label="Line spacing"
              unit="×"
              step={0.1}
              min={0.2}
              max={10}
              value={shape.leading ?? 1}
              onChange={(leading) => onChange({ leading })}
            />
          </div>
          <p className={styles.empty}>
            Drag a corner to set how tall the letters are. Letter spacing is a share of that
            height, so it stays put as the text is resized.
          </p>
        </Section>
      </div>
    </Card>
  );
}
