import { Angle, LineSquiggle } from "lucide-react";
import type { Preset } from "../../lib/types";
import styles from "./controls.module.css";

/**
 * What a tool is always set up for, with nothing to switch: the clip angle it is held at, and
 * whether it may only be pulled. A tool used at more than one angle keeps a switch instead, which
 * is Plot's business - these two are facts about the tool, so both apps say them the same way, from
 * here, rather than each drawing its own badges and drifting apart.
 */
export function ToolNote({ tool }: { tool: Preset | undefined }) {
  const why = [
    ...(tool?.tilt?.fixed ? [`always tilted: set the clip to ${tool.tilt.angle}°`] : []),
    ...(tool?.drag?.fixed ? ["only ever pulled, so strokes that would push it are cut and turned around"] : []),
  ];
  if (!why.length) return null;
  return (
    <p className={styles.tiltNote} title={`This tool is ${why.join("; ")}`}>
      {tool?.tilt?.fixed && (
        <span className={styles.tiltNoteItem}><Angle size={12} aria-hidden />{`Tilt ${tool.tilt.angle}°`}</span>
      )}
      {tool?.drag?.fixed && (
        <span className={styles.tiltNoteItem}><LineSquiggle size={12} aria-hidden />Constrained</span>
      )}
    </p>
  );
}
