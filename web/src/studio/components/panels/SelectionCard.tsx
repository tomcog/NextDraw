import type { ReactNode } from "react";
import { Button, ButtonRound, Card } from "@tomcoggia/ui";
import { PaintRoller } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import styles from "../../App.module.css";

interface Props {
  /** How many shapes are picked, and how many of them can be hatched. */
  count: number;
  fillable: number;
  busy: boolean;
  /** Whether there is a copied fill to paste. */
  canPaste: boolean;
  onJoin: () => void;
  onPaste: () => void;
  /** The fill's settings, set for every one of them at once. */
  fillPanel: ReactNode;
}

/** Several shapes picked: joined into one, or hatched all at once. */
export function SelectionCard({ count, fillable, busy, canPaste, onJoin, onPaste, fillPanel }: Props) {
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={styles.cardBody}>
        <Section title={`${count} shapes`} collapsibleKey="selection">
          <Button size="md" variant="secondary" onClick={onJoin}>Join into one shape</Button>
          <p className={styles.empty}>
            They become one path, drawn in as many strokes as they had marks, and move, scale
            and turn together from then on.
          </p>
        </Section>
        {fillable > 0 && (
          // Hatch them all at once: set here, every one of them gets the same fill.
          <Section
            title={fillable === count ? "Hatch" : `Hatch ${fillable} of them`}
            collapsibleKey="selection-fill"
            action={canPaste ? (
              <ButtonRound
                size="sm"
                icon={<PaintRoller />}
                aria-label="Paste fill"
                title="Paste fill: give every one of them the fill you copied, in place of their own"
                disabled={busy}
                onClick={onPaste}
              />
            ) : undefined}
          >
            {fillPanel}
          </Section>
        )}
      </div>
    </Card>
  );
}
