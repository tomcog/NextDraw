import { fmtIn } from "../lib/format";
import styles from "./SettingsHud.module.css";
import type { Handling, Settings } from "../lib/types";

interface Props {
  settings: Settings;    // the settings as they would be sent to the plotter, small paths included
  handling: Handling[];
  tool: string | null;   // the drawing tool preset in use
  secondTool: string | null;
  smallPaths: number | null; // percent slower for tiny marks, or null when off
}

// The same words the Path order chooser uses, so the readout and the control agree.
const PATH_ORDER: Record<number, string> = {
  4: "Keep the file’s order",
  0: "Join paths that touch",
  1: "Reorder paths to save time",
  2: "Reorder and reverse paths",
};

// A speed setting is a percent of the handling mode's own ceiling, and every mode has a different
// one - so the same number means a different speed in each. Both are shown: what the machine will
// actually do, and the setting it came from.
const speedText = (percent: number, ceilingInS: number | undefined) =>
  ceilingInS === undefined ? `${percent}` : `${fmtIn((percent / 100) * ceilingInS)}/s`;

const speedMM = (percent: number, ceilingInS: number | undefined) =>
  ceilingInS === undefined ? null : `${Math.round((percent / 100) * ceilingInS * 25.4)} mm/s`;

export function SettingsHud({ settings: s, handling, tool, secondTool, smallPaths }: Props) {
  const mode = handling.find((h) => h.id === s.handling);
  const rows: [string, string, string?][] = [
    ["Tool", secondTool ? `${tool ?? "—"} + ${secondTool}` : tool ?? "—"],
    ["Drawing", speedText(s.speed_pendown, mode?.speed_in_s), speedMM(s.speed_pendown, mode?.speed_in_s) ?? undefined],
    ["Travel", speedText(s.speed_penup, mode?.speed_up_in_s), speedMM(s.speed_penup, mode?.speed_up_in_s) ?? undefined],
    ["Motion", mode?.name ?? `Mode ${s.handling}`, mode ? `${mode.steps_per_in} steps/in` : undefined],
    ["Acceleration", String(s.accel)],
    ["Pen", `${s.pen_pos_down} down / ${s.pen_pos_up} up`],
    ["Paths", PATH_ORDER[s.reordering] ?? String(s.reordering)],
  ];
  if (smallPaths) rows.push(["Small paths", `${smallPaths}% slower`]);

  return (
    <dl className={styles.hud} aria-label="Printing settings">
      {rows.map(([label, value, note]) => (
        <div className={styles.row} key={label}>
          <dt className={styles.label}>{label}</dt>
          <dd className={styles.value}>
            {value}
            {note && <span className={styles.note}>{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
