import { SizeChooser } from "./SizeChooser";
import { PaperColorShown } from "./PaperColor";
import { Section } from "./Section";
import { panelIcon } from "../PanelToolbar";
import type { Units } from "../../lib/types";

interface Props {
  /** The paper in mm, as it lies: its width across, its height down. */
  w: number;
  h: number;
  /** One of PAPER_SIZES, or "custom" for a width and height of this drawing's own. */
  sizeId: string;
  /** What the sizes are named in: one choice for all three apps (useUnits, and Plot's settings). */
  units: Units;
  collapsibleKey: string;
  disabled?: boolean;
  /** A size from the menu, which always lies with its long edge across the plotter. */
  onSize: (id: string) => void;
  /** A new width and height, in mm: a custom size typed in. */
  onDimensions: (w: number, h: number) => void;
  /**
   * The ground the drawing was made for, shown so you know which sheet to put in. Plot's alone:
   * the colour is the piece's, set in Studio or Image, so it is stated here and not offered
   * (Tom, 2026-11-24). Left out, nothing is said.
   */
  color?: string;
}

/**
 * Plot's paper: the sheet a drawing is plotted on, and nothing else (Tom, 2026-11-23). Everything
 * that was done to the drawing here - its turn, Fit, Fill, Scale - has gone: those change the piece
 * itself, which is Studio's and Image's business, and the Artwork card there already does them. Where
 * the piece lands on this sheet is the Plot position card's.
 *
 * The sheet goes in with its long edge across the plotter, always, so there is no Landscape and
 * Portrait to choose: a size picked from the list lies that way. Studio and Image have no paper at
 * all since 2026-11-23; the ground's colour is set on their Layout card, and stated here so you know
 * which sheet to load.
 */
export function PaperSection({ w, h, sizeId, units, collapsibleKey, disabled, onSize, onDimensions, color }: Props) {
  return (
    <Section
      title="Paper"
      icon={panelIcon("paper")}
      collapsibleKey={collapsibleKey}
      actionWhenOpen
    >
      <SizeChooser
        w={w}
        h={h}
        sizeId={sizeId}
        units={units}
        what="paper"
        canTurn={false}
        disabled={disabled}
        onPick={onSize}
        onDimensions={onDimensions}
      />
      {color && <PaperColorShown color={color} />}
    </Section>
  );
}
