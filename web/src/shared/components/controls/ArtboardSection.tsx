import { useState } from "react";
import { Button, ButtonRound } from "@tomcoggia/ui";
import { Lock } from "lucide-react";
import { SizeChooser } from "./SizeChooser";
import { PaperColorRow } from "./PaperColor";
import { panelIcon } from "../PanelToolbar";
import { LengthField } from "./LengthField";
import { Section } from "./Section";
import { fmtLen } from "../../lib/format";
import { marginsAll, MARGIN_SIDES, type Margins } from "../../lib/geometry";
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
 * and where the colour blocks and the signature sit - is just a bigger number for the bottom. Each
 * field takes the place of the edge it insets - top and bottom above and below, left and right
 * beside - so which number is which needs no reading, and the unit is said once, in the heading.
 * Held the same, which is how they start, the other three go and the left field stands for all four,
 * in the place it already had. The fields stand on the card itself: the sheet they used to be set on
 * was a picture of a page, and a picture that isn't a preview earns little (Tom, 2026-11-25).
 */
/**
 * The usual margins, each setting all four at once: the inches of the design, and round millimetres
 * for the same in mm. Named by the number alone - the heading above them says the unit. None at all
 * leads them (Tom, 2026-11-25), which is where a new drawing starts and the quickest way back to it;
 * it is written 0 rather than 0.0, being the one of them that is not a measurement.
 */
const MARGIN_PRESETS: Record<Units, { label: string; mm: number }[]> = {
  in: [0, 0.5, 1, 1.5, 2].map((v) => ({ label: v ? v.toFixed(1) : "0", mm: v * 25.4 })),
  mm: [0, 10, 20, 30, 40].map((v) => ({ label: String(v), mm: v })),
};

/** Whether the four margins are held the same, kept between visits: a way of working, not a fact
 *  about the drawing, so it stays here rather than going into the file. On unless it was turned off:
 *  one number for all four is how a margin is usually set, and four fields are the exception (Tom,
 *  2026-11-25). */
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
  /**
   * The three ways the artboard is changed. Left out, that part of the card is shown but can't be
   * changed: Plot shows the artboard read-only, so you can see what you're plotting without being
   * able to resize the piece there (Tom, 2026-11-23, docs/plot.md).
   */
  onSize?: (w: number, h: number) => void;
  onMargins?: (margins: Margins) => void;
  onColor?: (color: string) => void;
}) {
  // Locked, the four margins are one number: setting any sets them all, and the lock evens them up
  // the moment it goes on (to the top's, the first of the four). Unlocked they stay as they are and
  // each is set on its own again.
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_KEY) !== "false"; } catch { return true; }
  });
  const lock = (on: boolean) => {
    setLocked(on);
    try { localStorage.setItem(LOCK_KEY, String(on)); } catch { /* kept for this visit only */ }
    if (on) onMargins?.(marginsAll(margins.top));
  };
  const side = (which: keyof Margins) => (mm: number) =>
    onMargins?.(locked ? marginsAll(mm) : { ...margins, [which]: mm });
  // Shown but not the user's to change, where the app doesn't offer that change.
  const noSize = disabled || !onSize;
  const noMargins = disabled || !onMargins;
  // One field stands for the four only while they really are one number. A drawing opened with
  // uneven margins under a lock left on from last time still shows all four - the lock evens them
  // when it is turned on or one of them is set, never behind the drawing's back.
  const asOne = locked && MARGIN_SIDES.every((s) => margins[s] === margins.top);
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
      <SizeChooser w={w} h={h} units={units} what="artboard" disabled={noSize} onDimensions={onSize ?? (() => {})} />
      {/* The live area the artwork sits in. A bigger bottom is the usual print convention, and is
        where the colour blocks and the signature go. The heading carries the unit for all four, and
        each field sits on the edge it insets, which is label enough (Figma 165:1111). */}
      <div className={styles.cardGroup}>
      <p className={styles.subheading}>{`Margins (${units === "in" ? "inches" : "mm"})`}</p>
      {/* The usual margins, each setting all four at once (Figma 181:2599). Across the top of the
        fields rather than down beside them (Tom, 2026-11-25): a line of numbers to choose from is
        read along a row, and the fields below keep the width to themselves. */}
      <div className={styles.marginPresets}>
        {MARGIN_PRESETS[units].map(({ label, mm }) => (
          <Button
            key={label}
            size="sm"
            variant="tertiary"
            disabled={noMargins}
            title={mm ? `Every margin ${label} ${units}` : "No margin at all"}
            onClick={() => onMargins?.(marginsAll(mm))}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={styles.marginsRow}>
        {/* The four held the same, at the head of the row (Tom, 2026-11-25): the glyph alone while
            each is its own, the action disc with a white glyph while it holds (Figma
            182:2676/182:2681). */}
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
            disabled={noMargins}
            onClick={() => lock(!locked)}
          />
        </span>
        <div className={styles.marginsAround}>
          {/* Held the same, the four are one number, so three of the fields go and the left one is
            left standing for all of them. It stays where it was, so nothing on the card moves as the
            lock goes on and off (Tom, 2026-11-25). Unlocked, the other three are back at their own
            edges. */}
          {(asOne ? MARGIN_EDGES.filter(({ edge }) => edge === "left") : MARGIN_EDGES).map(({ edge, label }) => (
            <div key={edge} className={styles.marginAt} data-edge={edge}>
              <LengthField
                label={asOne ? "Margins" : label}
                mm={margins[edge]}
                units={units}
                min={0}
                disabled={noMargins}
                unitInLabel={false}
                hideLabel
                onChange={side(edge)}
              />
            </div>
          ))}
        </div>
      </div>
      </div>
      {/* The surface the artwork is made on: the colours out in the open, the one chosen ringed, and
        the palette at the end for any other (Figma 165:1052, 2026-11-23). It was a dot in the
        heading that opened them - a colour this plain to see is quicker to change than to find. */}
      <div className={styles.cardGroup}>
        <p className={styles.subheading}>Surface</p>
        <PaperColorRow color={color} disabled={disabled || !onColor} onColor={onColor ?? (() => {})} />
      </div>
    </Section>
  );
}
