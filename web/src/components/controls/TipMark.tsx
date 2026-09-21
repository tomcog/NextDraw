import { useEffect, useState } from "react";
import type { Preset } from "../../lib/types";
import styles from "./controls.module.css";

/**
 * The drawing of a tool's tip, shown beside the tool it belongs to. Not every tool has one drawn
 * yet, and a tool that hasn't simply shows nothing rather than a gap or a broken image - so the
 * space it takes is given up when there is nothing to put in it.
 */
export function TipMark({ tool }: { tool: Preset | undefined }) {
  const name = tool?.name ?? "";
  const [missing, setMissing] = useState(false);
  // A different tool is a different drawing: give the new one its chance before hiding it.
  useEffect(() => setMissing(false), [name]);
  if (!name || missing) return null;
  return (
    <img
      className={styles.tipMark}
      src={`/tips/${encodeURIComponent(name)}.svg`}
      alt=""
      aria-hidden
      onError={() => setMissing(true)}
    />
  );
}
