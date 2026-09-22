import { Angle, Brush, LineSquiggle } from "lucide-react";
import type { Preset } from "../../lib/types";
import styles from "./controls.module.css";

/**
 * What a tool is always set up for, with nothing to switch: how wide it draws, the clip angle it is
 * held at, and whether it may only be pulled. A tool used at more than one angle keeps a switch
 * instead, which is Plot's business - these are facts about the tool, so both apps say them the same
 * way, from here, rather than each drawing its own badges and drifting apart.
 *
 * A tool whose width has never been measured says nothing about it, rather than showing the number
 * the preview falls back to: an unmeasured tip is a thing to go and measure, not a 0.7 mm one.
 */
export function ToolNote({ tool }: { tool: Preset | undefined }) {
  const widthMm = tool?.settings?.pen_width;
  const why = [
    ...(tool?.tilt?.fixed ? [`always tilted: set the clip to ${tool.tilt.angle}°`] : []),
    ...(tool?.drag?.fixed ? ["only ever pulled, so strokes that would push it are cut and turned around"] : []),
  ];
  if (!why.length && widthMm == null) return null;
  return (
    <p className={styles.tiltNote} {...(why.length ? { title: `This tool is ${why.join("; ")}` } : {})}>
      {/* The width leads: it is the one number you measure a drawing against, and the rest of the
          row is what to set up before drawing at all. */}
      {widthMm != null && (
        <span className={styles.tiltNoteItem} title={`Draws a ${widthMm} mm line`}>
          <LineSquiggle size={12} aria-hidden />{`${widthMm} mm`}
        </span>
      )}
      {tool?.tilt?.fixed && (
        <span className={styles.tiltNoteItem}><Angle size={12} aria-hidden />{`Tilt ${tool.tilt.angle}°`}</span>
      )}
      {tool?.drag?.fixed && (
        <span className={styles.tiltNoteItem}><Brush size={12} aria-hidden />Brush tip</span>
      )}
    </p>
  );
}
