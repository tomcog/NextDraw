import { useEffect, useState } from "react";
import { NONE_PEN } from "../../lib/constants";
import type { Preset } from "../../lib/types";
import styles from "./TipMark.module.css";

/**
 * Shared: both apps choose a drawing tool, and the tip it draws with is a fact about the tool
 * rather than about either app.
 *
 * The drawing of a tool's tip, shown beside the tool it belongs to. Not every tool has one drawn
 * yet, and a tool that hasn't simply shows nothing rather than a gap or a broken image - so the
 * space it takes is given up when there is nothing to put in it. None is the one tool that never
 * has a drawing: it stands for a pen the app doesn't know, so there is no tip to draw and no
 * drawing to ask for.
 */
export function TipMark({ tool, onClick }: { tool: Preset | undefined; onClick?: () => void }) {
  const name = tool?.name ?? "";
  const [missing, setMissing] = useState(false);
  // A different tool is a different drawing: give the new one its chance before hiding it.
  useEffect(() => setMissing(false), [name]);
  if (!name || name === NONE_PEN || missing) return null;
  return (
    // The drawing sits inside its box rather than being it: a box of its own can take its height
    // from what it stands beside, where the drawing would instead stretch the row to its own size.
    // Clicked, it does what the menu beside it does, as a bigger target for the same thing. Left out
    // of the tab order and hidden from screen readers, since the menu itself is the control for both.
    <span
      className={styles.tipMark}
      data-clickable={onClick ? true : undefined}
      onClick={onClick}
    >
      <img
        className={styles.tipMarkArt}
        src={`/tips/${encodeURIComponent(name)}.svg`}
        alt=""
        aria-hidden
        onError={() => setMissing(true)}
      />
    </span>
  );
}
