import { Checkbox } from "@tomcoggia/ui";
import styles from "../../../shared/components/controls/controls.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { LengthField } from "../../../shared/components/controls/LengthField";
import { panelIcon } from "../../../shared/components/PanelToolbar";
import { fmtLen } from "../../../shared/lib/format";
import type { TrimMarks, Units } from "../../../shared/lib/types";

interface Props {
  /** The marks this drawing is plotted with, or none. */
  marks: TrimMarks | null;
  units: Units;
  busy: boolean;
  /** Why the marks can't be set, if they can't: said instead of the controls. */
  refused?: string;
  /** The marks on, with these numbers, or off. Kept in Plot's own block in the drawing. */
  onChange: (marks: TrimMarks | null) => void;
}

/** The marks as Plot starts them: a quarter inch long, an eighth of an inch off the corner. */
export const DEFAULT_TRIM: TrimMarks = { length: 6.35, offset: 3.175 };

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
export function TrimMarksSection({ marks, units, busy, refused, onChange }: Props) {
  const reach = marks ? marks.offset + marks.length : 0;
  return (
    <Section title="Trim marks" icon={panelIcon("trim")} collapsibleKey="plot-trim">
      {refused ? <p className={styles.hint}>{refused}</p> : <>
        <Checkbox size="md"
          checked={Boolean(marks)}
          label="On"
          title="Mark the corners where the print is cut, round the artboard: a layer of its own, drawn when the drawing is plotted"
          disabled={busy}
          onChange={(e) => onChange(e.target.checked ? DEFAULT_TRIM : null)}
        />
        {marks && (
          <>
            <div className={styles.pairRow}>
              <div title="How long each mark is">
                <LengthField label="Mark length" mm={marks.length} units={units} min={0.5} disabled={busy} onChange={(v) => onChange({ ...marks, length: v })} />
              </div>
              <div title="How far each mark stands off the artboard's corner, so the cut never shows it: the bleed, as a rule">
                <LengthField label="Offset" mm={marks.offset} units={units} min={0} disabled={busy} onChange={(v) => onChange({ ...marks, offset: v })} />
              </div>
            </div>
            <p className={styles.hint}>
              Drawn round the artboard, reaching {fmtLen(reach, units)} outside it: the sheet needs that much room on every side.
            </p>
          </>
        )}
      </>}
    </Section>
  );
}
