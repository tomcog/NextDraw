import type { ReactNode } from "react";
import { Button, ButtonRound, Card } from "@tomcoggia/ui";
import { PaintRoller } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import controls from "../../../shared/components/controls/controls.module.css";
import styles from "../../App.module.css";

interface Props {
  /** How many paths are picked, and how many of them can be hatched. */
  count: number;
  fillable: number;
  busy: boolean;
  /** What the one shape picked is called, when what's picked is exactly one shape. */
  shapeName?: string;
  /** Whether what's picked can be made one shape: two or more paths, all on one layer. */
  canGroup: boolean;
  /** Whether any of what's picked is a shape that can be taken apart again. */
  canUngroup: boolean;
  /** Whether there is a copied fill to paste. */
  canPaste: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onJoin: () => void;
  onPaste: () => void;
  /** The fill's settings, set for every one of them at once. */
  fillPanel: ReactNode;
}

/** Several paths picked: kept together as one shape, joined into one path, or hatched all at once. */
export function SelectionCard({ count, fillable, busy, shapeName, canGroup, canUngroup, canPaste, onGroup, onUngroup, onJoin, onPaste, fillPanel }: Props) {
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={styles.cardBody}>
        <Section title={shapeName ? `${shapeName} · ${count} paths` : `${count} paths`} collapsibleKey="selection">
          <div className={controls.buttonRow}>
            {canGroup && <Button size="md" variant="secondary" disabled={busy} onClick={onGroup}>Group into one shape</Button>}
            {canUngroup && <Button size="md" variant="secondary" disabled={busy} onClick={onUngroup}>Ungroup</Button>}
            <Button size="md" variant="secondary" disabled={busy} onClick={onJoin}>Join into one path</Button>
          </div>
          <p className={styles.empty}>
            A shape keeps its paths as they are and is picked, moved and sized as one. Joined, they
            become one path, drawn in as many strokes as they had marks.
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
