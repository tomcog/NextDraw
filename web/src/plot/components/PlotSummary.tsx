import styles from "./PlotSummary.module.css";
import { Section } from "../../shared/components/controls/Section";
import { fmtDistance, fmtDuration, fmtLen } from "../../shared/lib/format";
import type { Preview } from "../../shared/lib/preview";
import type { Estimate, Units } from "../../shared/lib/types";

interface Props {
  estimate: Estimate | null;
  preview: Preview | null;
  units: Units;
  rotated: boolean;
}

// The "Show pen-up moves" toggle and line key are hidden for now; pen-up moves stay visible.
const SHOW_LEGEND = false;

// Legend and plot facts. Notes about the drawing are in DrawingNotes.
export function PlotSummary({ estimate, preview, units, rotated }: Props) {
  return (
    <>
      {estimate && preview && (
        <>
          {SHOW_LEGEND && <div className={styles.legend}>
            <span className={styles.key} data-kind="down">Drawing</span>
            <span className={styles.key} data-kind="up">Pen up</span>
          </div>}

          <Section title="Last drawing" collapsibleKey="plot-last" defaultOpen={false}>
            <dl className={styles.facts}>
              <div><dt>Plot time</dt><dd>{fmtDuration(estimate.estimate_s)}</dd></div>
              <div><dt>Line drawn</dt><dd>{fmtDistance(estimate.pendown_m)}</dd></div>
              <div><dt>Pen lifts</dt><dd>{estimate.pen_lifts.toLocaleString()}</dd></div>
              <div>
                <dt>Drawing size</dt>
                <dd title={rotated ? "Turned sideways to fit the plotter" : undefined}>
                  {`${fmtLen(preview.widthIn * 25.4, units, false)} × ${fmtLen(preview.heightIn * 25.4, units)}`}
                </dd>
              </div>
            </dl>
          </Section>
        </>
      )}

    </>
  );
}
