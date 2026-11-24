import { useState } from "react";
import { Button, ButtonRound } from "@tomcoggia/ui";
import { Lock } from "lucide-react";
import { SizeChooser } from "./SizeChooser";
import { PaperColorRow } from "./PaperColor";
import { panelIcon } from "../PanelToolbar";
import { LengthField } from "./LengthField";
import { Section } from "./Section";
import { fmtLen } from "../../lib/format";
import { marginsAll, type Margins } from "../../lib/geometry";
import type { Units } from "../../lib/types";
import styles from "./controls.module.css";

/**
 * Shared: the artboard - the drawing's own size, and the margins that inset it to the live area the
 * artwork is fitted and aligned within (2026-11-22).
 *
 * Not the paper. The artboard is what the piece measures and it travels with the drawing; the paper
 * is the sheet it is eventually plotted on, which is Plot's business. Everything here is in
 * millimetres, as the Paper card is, and shown in whichever units are chosen.
 *
 * The margins are four, not one with an extra on a side: a deeper foot - the usual print convention,
 * and where the colour blocks and the signature sit - is just a bigger number for the bottom. They
 * are set around a sheet rather than listed: top and bottom inside it, left and right beside it, so
 * which number is which needs no reading and the unit is said once, in the heading. The sheet is a
 * picture, not a preview: it keeps its size whatever the artboard measures.
 */
/**
 * The usual margins, each setting all four at once: the inches of the design, and round millimetres
 * for the same in mm. Named by the number alone - the heading above them says the unit.
 */
const MARGIN_PRESETS: Record<Units, { label: string; mm: number }[]> = {
  in: [0.5, 1, 1.5, 2].map((v) => ({ label: v.toFixed(1), mm: v * 25.4 })),
  mm: [10, 20, 30, 40].map((v) => ({ label: String(v), mm: v })),
};

/** Whether the four margins are held the same, kept between visits: a way of working, not a fact
 *  about the drawing, so it stays here rather than going into the file. */
const LOCK_KEY = "nextdraw.marginsLocked";

/** The four margins, each at the edge of the sheet it insets - which is what says which it is. */
const MARGIN_EDGES = [
  { edge: "top", label: "Top" },
  { edge: "bottom", label: "Bottom" },
  { edge: "left", label: "Left" },
  { edge: "right", label: "Right" },
] as const;

export function ArtboardSection({ w, h, margins, units, color, collapsibleKey, disabled, onSize, onMargins, onColor }: {
  /** The artboard in mm, as it lies. */
  w: number;
  h: number;
  /** Its margins in mm: top, right, bottom, left. */
  margins: Margins;
  units: Units;
  /**
   * The ground the artwork is made on, kept with the drawing. It was the Paper card's until the
   * paper left Studio and Image (2026-11-23): it is not a fact about the sheet but the colour the
   * art assumes underneath it - what decides whether white ink reads at all - so it belongs to the
   * page being drawn on. One value, wherever it is set.
   */
  color: string;
  collapsibleKey: string;
  disabled?: boolean;
  onSize: (w: number, h: number) => void;
  onMargins: (margins: Margins) => void;
  onColor: (color: string) => void;
}) {
  // Locked, the four margins are one number: setting any sets them all, and the lock evens them up
  // the moment it goes on (to the top's, the first of the four). Unlocked they stay as they are and
  // each is set on its own again.
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_KEY) === "true"; } catch { return false; }
  });
  const lock = (on: boolean) => {
    setLocked(on);
    try { localStorage.setItem(LOCK_KEY, String(on)); } catch { /* kept for this visit only */ }
    if (on) onMargins(marginsAll(margins.top));
  };
  const side = (which: keyof Margins) => (mm: number) =>
    onMargins(locked ? marginsAll(mm) : { ...margins, [which]: mm });
  return (
    <Section
      title="Artboard"
      icon={panelIcon("artboard")}
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      // Folded, the heading says the size, as the Paper card's does.
      closedAction={<span className={styles.toolInTitle}>{`${fmtLen(w, units, false)} × ${fmtLen(h, units)}`}</span>}
    >
      {/* Its size, from the same list of sizes the Paper card offers, with Custom at the end for a
        width and height of this drawing's own; and which way it lies, which only swaps the two
        numbers - the drawing stays as it is. The artboard carries no size by name: which of the
        list it is, if any, is read from its width and height (SizeChooser). */}
      <SizeChooser w={w} h={h} units={units} what="artboard" disabled={disabled} onDimensions={onSize} />
      {/* The live area the artwork sits in. A bigger bottom is the usual print convention, and is
        where the colour blocks and the signature go. The heading carries the unit for all four, and
        each field sits on the edge it insets, which is label enough (Figma 165:1111). */}
      <div className={styles.cardGroup}>
      <p className={styles.subheading}>{`Margins (${units === "in" ? "inches" : "mm"})`}</p>
      <div className={styles.marginsRow}>
        {/* The usual margins down the left, each setting all four at once (Figma 181:2599). */}
        <div className={styles.marginPresets}>
          {MARGIN_PRESETS[units].map(({ label, mm }) => (
            <Button
              key={label}
              size="sm"
              variant="tertiary"
              disabled={disabled}
              title={`Every margin ${label} ${units}`}
              onClick={() => onMargins(marginsAll(mm))}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className={styles.marginsAround}>
          {MARGIN_EDGES.map(({ edge, label }) => (
            <div key={edge} className={styles.marginAt} data-edge={edge}>
              <LengthField
                label={label}
                mm={margins[edge]}
                units={units}
                min={0}
                disabled={disabled}
                unitInLabel={false}
                hideLabel
                onChange={side(edge)}
              />
            </div>
          ))}
        </div>
        {/* The four held the same, beside them as the design has it: the glyph alone while each is
            its own, the action disc with a white glyph while it holds (Figma 182:2676/182:2681). */}
        <span className={styles.marginLock}>
          <ButtonRound
            size="sm"
            variant={locked ? "primary" : "tertiary"}
            icon={<Lock />}
            aria-pressed={locked}
            aria-label={locked ? "Set each margin on its own" : "Hold the four margins the same"}
            title={locked
              ? "The four margins are held the same: setting one sets them all. Click to set each on its own."
              : "Hold the four margins the same: they even up now, and setting one sets them all"}
            disabled={disabled}
            onClick={() => lock(!locked)}
          />
        </span>
      </div>
      </div>
      {/* The surface the artwork is made on: the colours out in the open, the one chosen ringed, and
        the palette at the end for any other (Figma 165:1052, 2026-11-23). It was a dot in the
        heading that opened them - a colour this plain to see is quicker to change than to find. */}
      <div className={styles.cardGroup}>
        <p className={styles.subheading}>Surface</p>
        <PaperColorRow color={color} disabled={disabled} onColor={onColor} />
      </div>
    </Section>
  );
}
