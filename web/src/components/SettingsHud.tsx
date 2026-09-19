import type { ReactNode } from "react";
import { barrelOffsetMm } from "../lib/constants";
import { fmtIn, trimNum } from "../lib/format";
import { NumberField } from "./controls/NumberField";
import styles from "./SettingsHud.module.css";
import type { Handling, Preset, Settings, Units } from "../lib/types";

interface Props {
  settings: Settings;    // the settings as they would be sent to the plotter, small paths included
  own: Settings;         // the same before small paths slows them: the tool's own values, which the fields set
  handling: Handling[];
  tool: string | null;   // the drawing tool preset in use
  preset: Preset | undefined; // that tool, for its tilt offset
  secondTool: string | null;
  smallPaths: number | null; // percent slower for tiny marks, or null when off
  units: Units;
  disabled: boolean;
  /** Change the tool: the next plot uses it at once, and the preset keeps it. */
  onToolValues: (patch: Partial<Settings>, extra?: { tiltOffset?: number; barrel?: number }) => void;
}

// The same words the Path order chooser uses, so the readout and the control agree.
const PATH_ORDER: Record<number, string> = {
  4: "Keep the file’s order",
  0: "Join paths that touch",
  1: "Reorder paths to save time",
  2: "Reorder and reverse paths",
};

// The Inkscape extension's names for pen lift and lower rates (its .inx files), so a number here can
// be matched to the choice made there.
const RATE_NAMES: Record<number, string> = { 100: "Maximum", 50: "Standard", 25: "Slow", 12: "Very slow", 6: "Dead slow" };

// A speed setting is a percent of the handling mode's own ceiling, and every mode has a different
// one - so the same number means a different speed in each. Both are shown: what the machine will
// actually do, and the setting it came from.
const speedText = (percent: number, ceilingInS: number | undefined) =>
  ceilingInS === undefined ? `${percent}` : `${fmtIn((percent / 100) * ceilingInS)}/s`;

const speedMM = (percent: number, ceilingInS: number | undefined) =>
  ceilingInS === undefined ? null : `${Math.round((percent / 100) * ceilingInS * 25.4)} mm/s`;

export function SettingsHud({ settings: s, own, handling, tool, preset, secondTool, smallPaths, units, disabled, onToolValues }: Props) {
  const mode = handling.find((h) => h.id === s.handling);
  // Chill mode slows what's sent; the field keeps the tool's own number and the note says what goes out.
  const slowed = (key: keyof Settings) => (s[key] !== own[key] ? `${s[key]} in Chill mode` : undefined);

  const field = (label: string, key: "speed_pendown" | "pen_pos_down" | "pen_pos_up" | "pen_rate_lower" | "pen_rate_raise", min: number) => (
    <span className={styles.field}>
      <NumberField
        label={label}
        hideLabel
        value={own[key]}
        min={min}
        max={100}
        disabled={disabled}
        onChange={(v) => onToolValues({ [key]: Math.round(v) })}
      />
    </span>
  );
  const rateNote = (key: "pen_rate_lower" | "pen_rate_raise") =>
    [RATE_NAMES[own[key]], slowed(key)].filter(Boolean).join(" · ") || undefined;

  const rows: [string, ReactNode, string?][] = [
    ["Tool", secondTool ? `${tool ?? "—"} + ${secondTool}` : tool ?? "—"],
    ["Drawing", field("Drawing speed", "speed_pendown", 1),
      [speedText(s.speed_pendown, mode?.speed_in_s), speedMM(s.speed_pendown, mode?.speed_in_s), slowed("speed_pendown")].filter(Boolean).join(" · ")],
    ["Travel", speedText(s.speed_penup, mode?.speed_up_in_s), speedMM(s.speed_penup, mode?.speed_up_in_s) ?? undefined],
    ["Motion", mode?.name ?? `Mode ${s.handling}`, mode ? `${mode.steps_per_in} steps/in` : undefined],
    ["Acceleration", String(s.accel)],
    ["Pen down", field("Pen height when drawing", "pen_pos_down", 0)],
    ["Pen up", field("Pen height when lifted", "pen_pos_up", 0)],
    ["Lowering", field("Pen lowering rate", "pen_rate_lower", 1), rateNote("pen_rate_lower")],
    ["Raising", field("Pen raising rate", "pen_rate_raise", 1), rateNote("pen_rate_raise")],
  ];
  if (preset?.tilt) {
    // Measured in mm; typed in the page's units like every other length.
    const perUnit = units === "in" ? 25.4 : 1;
    rows.push(["Tilt offset", (
      <span className={styles.field}>
        <NumberField
          label={`Tilt offset (${units})`}
          hideLabel
          value={Number(trimNum(preset.tilt.offset_mm / perUnit, units === "in" ? 3 : 1))}
          min={0}
          max={100 / perUnit}
          step={units === "in" ? 0.01 : 0.5}
          disabled={disabled}
          onChange={(v) => onToolValues({}, { tiltOffset: v * perUnit })}
        />
      </span>
    ), `${units} · clip at ${preset.tilt.angle}°`]);
  }
  if (preset) {
    // Measured with calipers where the clip holds the pen, so always in mm.
    const down = barrelOffsetMm(preset.barrel_mm);
    rows.push(["Barrel", (
      <span className={styles.field}>
        <NumberField
          label="Barrel width (mm)"
          hideLabel
          value={preset.barrel_mm ?? 0}
          min={0}
          max={60}
          step={0.1}
          disabled={disabled}
          onChange={(v) => { if (v > 0) onToolValues({}, { barrel: v }); }}
        />
      </span>
    ), !preset.barrel_mm ? "mm · not measured"
      : Math.abs(down) < 0.005 ? "mm · no offset"
      : `mm · tip ${trimNum(Math.abs(down), 2)} mm ${down > 0 ? "lower" : "higher"}`]);
  }
  rows.push(["Paths", PATH_ORDER[s.reordering] ?? String(s.reordering)]);
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
