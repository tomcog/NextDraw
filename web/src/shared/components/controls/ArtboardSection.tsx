import { LieSwitch } from "./LieSwitch";
import { PaperColorRow } from "./PaperColor";
import { panelIcon } from "../PanelToolbar";
import { LengthField } from "./LengthField";
import { Section } from "./Section";
import { fmtLen } from "../../lib/format";
import type { Margins } from "../../lib/geometry";
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
  const side = (which: keyof Margins) => (mm: number) => onMargins({ ...margins, [which]: mm });
  return (
    <Section
      title="Artboard"
      icon={panelIcon("artboard")}
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      // Folded, the heading says the size, as the Paper card's does.
      closedAction={<span className={styles.toolInTitle}>{`${fmtLen(w, units, false)} × ${fmtLen(h, units)}`}</span>}
    >
      {/* Its size, and which way it lies - the Paper card's own control, turning the artboard here
        rather than the paper. It only swaps the two numbers; the drawing stays as it is. */}
      <div className={styles.sizeRow}>
        <LengthField label="Width" mm={w} units={units} min={1} disabled={disabled} onChange={(next) => onSize(next, h)} />
        <LengthField label="Height" mm={h} units={units} min={1} disabled={disabled} onChange={(next) => onSize(w, next)} />
        <LieSwitch w={w} h={h} what="artboard" disabled={disabled} onSwap={() => onSize(h, w)} />
      </div>
      {/* The live area the artwork sits in. A bigger bottom is the usual print convention, and is
        where the colour blocks and the signature go. The heading carries the unit for all four. */}
      <div className={styles.cardGroup}>
      <p className={styles.subheading}>{`Margins (${units === "in" ? "inches" : "mm"})`}</p>
      <div className={styles.marginsAround}>
        <div className={styles.marginSide}>
          <LengthField label="Left" mm={margins.left} units={units} min={0} disabled={disabled} unitInLabel={false} onChange={side("left")} />
        </div>
        {/* The sheet: top and bottom sit on it, at the edges they inset, inside the dashed frame
          that stands for the live area the artwork is fitted and aligned within. */}
        <div className={styles.marginSheet}>
          <span className={styles.marginSheetArea} aria-hidden="true" />
          <LengthField label="Top" mm={margins.top} units={units} min={0} disabled={disabled} unitInLabel={false} onChange={side("top")} />
          <LengthField label="Bottom" mm={margins.bottom} units={units} min={0} disabled={disabled} unitInLabel={false} onChange={side("bottom")} />
        </div>
        <div className={styles.marginSide}>
          <LengthField label="Right" mm={margins.right} units={units} min={0} disabled={disabled} unitInLabel={false} onChange={side("right")} />
        </div>
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
