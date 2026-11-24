import { useState } from "react";
import { Button, ButtonRound } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./controls.module.css";
import { NumberField } from "./NumberField";
import { Section } from "./Section";
import { AlignPicker, useFitAlign } from "./FitControls";
import { panelIcon } from "../PanelToolbar";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";
import type { Margins } from "../../lib/geometry";

/**
 * Shared: the artwork - the strokes themselves - and what is done to them on the artboard: turning
 * them, fitting them inside the margins, and scaling them (2026-11-23).
 *
 * Its own card since the paper left Studio and Image: these are things done to the art, not to the
 * page it sits on. What they fit inside is the artboard's live area - its size less its four
 * margins - so there is no margin of its own here, and no Extra margin: a deeper foot is a bigger
 * number on the Artboard card. Plot keeps these in its Paper card, fitting to the sheet.
 */
export function ArtworkSection({ artboard, margins, units, collapsibleKey, disabled, onTurn, onFit, onFill, onCut, onScale, onAlign }: {
  /** The artboard in mm, which the artwork is fitted inside. */
  artboard: { w: number; h: number };
  /** Its margins in mm: what Fit and Fill leave around the artwork. */
  margins: Margins;
  units: Units;
  collapsibleKey: string;
  disabled?: boolean;
  /** A quarter turn, 1 right or -1 left, about the artwork's middle. The artboard stays as it is. */
  onTurn?: (dir: 1 | -1) => void;
  /** As large as it goes inside the live area, placed as the alignment says. */
  onFit?: (marginsMm: Margins, align: FitAlignArg) => void;
  /** Covering the live area, what's over cropped - the alignment says which part stays. */
  onFill?: (marginsMm: Margins, align: FitAlignArg) => void;
  /**
   * Cut the lines that run outside the margins away, and keep what is left. Its own button since
   * 2026-11-24: Fill used to scale AND cut in one press, so covering the artboard quietly turned a
   * circle into a path, dropped a hatch fill's parameters, and deleted whatever hung over. Scaling
   * is a thing you do all day; cutting is a thing you mean.
   */
  onCut?: (marginsMm: Margins) => void;
  /** Scale the artwork by this percent of the size it is now: 200 doubles it, 50 halves it. */
  onScale?: (percent: number) => void;
  /**
   * The alignment was changed: move the artwork to it, now. The buttons are live - Bottom to Top
   * shifts the artwork up against the top margin as it is pressed - rather than waiting for Fit.
   * Left out, the choice is only remembered, for the next Fit or Fill.
   */
  onAlign?: (marginsMm: Margins, align: FitAlignArg) => void;
}) {
  const [align, keepAlign] = useFitAlign();
  // The percent waits in the box until Apply: scaling is something done to the artwork, not a size
  // it keeps, so the number is an instruction - and it stays typed, to be applied again.
  const [by, setBy] = useState(100);
  // A live area with nothing left of it has nothing to fit into.
  const roomLeft = artboard.w - margins.left - margins.right > 0 && artboard.h - margins.top - margins.bottom > 0;
  const said = `${fmtLen(margins.top, units, false)} / ${fmtLen(margins.right, units, false)} / ${fmtLen(margins.bottom, units, false)} / ${fmtLen(margins.left, units)} margins`;
  return (
    <Section title="Artwork" icon={panelIcon("artwork")} collapsibleKey={collapsibleKey}>
      {/* Turned a quarter on the artboard, which stays as it is; then Fit - as large as the artwork
        goes inside the margins. Artwork of another proportion than the live area fills it only one
        way; the alignment below says where it sits the other way. */}
      <div className={styles.transformRow}>
        <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the artwork left" title="Turn the artwork 90° left about its middle; the artboard stays as it is" disabled={disabled || !onTurn} onClick={() => onTurn?.(-1)} />
        <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the artwork right" title="Turn the artwork 90° right about its middle; the artboard stays as it is" disabled={disabled || !onTurn} onClick={() => onTurn?.(1)} />
        <Button
          size="sm"
          variant="secondary"
          title={roomLeft ? `Fit: scale the artwork as large as it goes inside the ${said}, placed as the alignment says` : "The margins leave no artboard to fit the artwork into"}
          disabled={disabled || !onFit || !roomLeft}
          onClick={() => onFit?.(margins, align)}
        >
          Fit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          title={roomLeft ? `Fill: scale the artwork to cover the artboard inside the ${said} - the alignment says which part sits in view. Nothing is cut; what hangs over shows as the green line outside the red one` : "The margins leave no artboard to fill"}
          disabled={disabled || !onFill || !roomLeft}
          onClick={() => onFill?.(margins, align)}
        >
          Fill
        </Button>
        {/* Destructive, and the only control here that is: a lasting change to the drawing rather
          than a move or a scale. Secondary like the others - it is a normal thing to do when you
          mean it - and the warning is in the words. */}
        <Button
          size="sm"
          variant="secondary"
          // Off unless there is something outside to take away: the caller passes onCut only then,
          // so the button can't be clicked to no effect (Tom, 2026-11-24).
          title={onCut
            ? `Crop artwork: delete the lines that run outside the ${said}. What crosses the edge is trimmed there and becomes a path, and a shape's hatch fill loses its spacing. Undo brings it back; a save does not.`
            : `Crop artwork: nothing is drawn outside the ${said}, so there is nothing to crop`}
          disabled={disabled || !onCut || !roomLeft}
          onClick={() => onCut?.(margins)}
        >
          Crop artwork
        </Button>
      </div>
      {/* Scale by a percent of the size it is now - 200 doubles the artwork, 50 halves it, whatever
        it measured before - and it happens when Apply is pressed, not as the number is typed. Then
        where Fit and Fill put the artwork: across, then down. */}
      <div className={styles.scaleAlignRow}>
        <div className={styles.scaleRow}>
          <NumberField
            label="Scale by"
            unit="%"
            min={1}
            max={10000}
            step={5}
            value={by}
            disabled={disabled || !onScale}
            onChange={setBy}
          />
          <Button
            size="sm"
            variant="secondary"
            title={by === 100 ? "100% is the size it is already" : `Scale the artwork to ${by}% of the size it is now, about its middle`}
            disabled={disabled || !onScale || by === 100}
            onClick={() => onScale?.(by)}
          >
            Apply
          </Button>
        </div>
        <AlignPicker
          align={align}
          inside="artboard"
          disabled={disabled}
          onAlign={(next) => {
            keepAlign(next);
            onAlign?.(margins, next);
          }}
        />
      </div>
    </Section>
  );
}

type FitAlignArg = Parameters<typeof AlignPicker>[0]["align"];
