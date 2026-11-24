import { Checkbox } from "@tomcoggia/ui";
import styles from "../../../shared/components/controls/controls.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { panelIcon } from "../../../shared/components/PanelToolbar";
import type { TrimMarks } from "../../../shared/lib/types";

interface Props {
  /** The marks this drawing is plotted with, or none. */
  marks: TrimMarks | null;
  busy: boolean;
  /** Why the marks can't be set, if they can't: said instead of the controls. */
  refused?: string;
  /** The marks on, with these numbers, or off. Kept in Plot's own block in the drawing. */
  onChange: (marks: TrimMarks | null) => void;
}

/**
 * The marks, and the only marks: a quarter inch long, standing a quarter inch off the corner, so
 * they reach half an inch outside the artboard on every side.
 *
 * Not settings. They were two fields, and they are now two numbers (Tom, 2026-11-24): trim marks are
 * the same on every print, and a quarter inch is what a quarter inch is. All the card asks is
 * whether they go down. A drawing saved with other numbers is plotted with these.
 */
export const DEFAULT_TRIM: TrimMarks = { length: 6.35, offset: 6.35 };

/**
 * Trim marks: where the print is cut, for the size it comes out. Plot's card alone - the marks are
 * not part of the drawing. They are drawn round the ARTBOARD when the drawing is plotted, in the copy
 * sent to the plotter and the preview, so the same drawing goes on any sheet with the marks that suit
 * it and the blocks can never go stale. All this card holds is whether they go down and how big they
 * are; where they go follows the artboard.
 *
 * The marks stand outside the artboard, so the sheet has to have that much room around it - the
 * drawing running off the paper is the usual warning, the marks included.
 */
export function TrimMarksSection({ marks, busy, refused, onChange }: Props) {
  return (
    <Section title="Trim marks" icon={panelIcon("trim")} collapsibleKey="plot-trim">
      {refused ? <p className={styles.hint}>{refused}</p> : <>
        <Checkbox size="md"
          checked={Boolean(marks)}
          label="On"
          title="Mark the corners where the print is cut, round the artboard: a quarter-inch mark a quarter inch off each corner, on a layer of its own, drawn when the drawing is plotted"
          disabled={busy}
          onChange={(e) => onChange(e.target.checked ? DEFAULT_TRIM : null)}
        />
      </>}
    </Section>
  );
}
