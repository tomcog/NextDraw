import { useState } from "react";
import { Button, ButtonRound, Checkbox, Segment, SegmentedControl } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { NumberField } from "./NumberField";
import { SizeChooser } from "./SizeChooser";
import { Section } from "./Section";
import { panelIcon } from "../PanelToolbar";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";
import { extraMarginSide, FIT_CENTERED, MARGIN_SIDES, type FitAlign, type Margins } from "../../lib/geometry";

/** The fit-alignment icons from the NextDraw Figma file (Frame 3): a 7 × 12 drawing
 *  beside or on a full-height line, turned for each direction. */
function FitIcon({ centered = false, turn = 0 }: { centered?: boolean; turn?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform={turn ? `rotate(${turn} 8 8)` : undefined}>
        <rect x={centered ? 5 : 0.5} y="2.51" width="6" height="11" rx="0.5" stroke="currentColor" strokeWidth="1" />
        <rect x={centered ? 7.5 : 8.5} y="0.01" width="1" height="16" rx="0.5" fill="currentColor" />
      </g>
    </svg>
  );
}

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
  /** A size from the menu. The app keeps the way the paper lies. */
  onSize: (id: string) => void;
  /** A new width and height, in mm: the paper turned, or a custom size typed in. */
  onDimensions: (w: number, h: number) => void;
  /** Turn the paper and everything on it a quarter turn, 1 right or -1 left: landscape to portrait, as a
   *  sheet is turned by hand. Landscape and Portrait never do this: they turn the paper alone. Left out
   *  while there is no drawing to turn. */
  onTurnDrawing?: (dir: 1 | -1) => void;
  /** Scale the drawing to fill the paper less a margin on each side (in mm), placed in the room left
   *  over as `align` says - centred, or against an edge. Left out while there is no drawing to fit. */
  onFit?: (marginsMm: Margins, align: FitAlign) => void;
  /** Scale the drawing to cover the paper less the margins, cropping what's over - a picture by its
   *  crop, lines cut at the margins - the alignment says which part stays. Left out while there is
   *  nothing to fill. */
  onFill?: (marginsMm: Margins, align: FitAlign) => void;
  /** Scale the drawing by this percent of the size it is now: 200 doubles it, 50 halves it. Left
   *  out while there is nothing to scale. */
  onScale?: (percent: number) => void;
}

// Common paper colours, plus any colour from the picker. The paper is drawn in this colour whatever
// the app's theme, so light or dark mode never changes how a print looks.
const MARGIN_KEY = "nextdraw.fitMargin";
const ALIGN_KEY = "nextdraw.fitAlign";
/** Whether one side gets extra margin (once only the bottom could, hence the name). */
const EXTRA_KEY = "nextdraw.fitDeepBottom";
const EXTRA_PERCENT_KEY = "nextdraw.fitExtraPercent";
/** How much more margin the extra side gets, as a percent of the margin, until another is chosen. */
const EXTRA_PERCENT = 25;
const ALIGN_STEPS = [0, 0.5, 1] as const;

/** The margin set in the Paper card, in mm: half an inch until one is chosen. */
export function paperMarginMm(): number {
  try {
    const raw = localStorage.getItem(MARGIN_KEY);
    const saved = raw === null ? NaN : Number(raw);
    return saved >= 0 ? saved : 12.7;
  } catch {
    return 12.7;
  }
}

/**
 * Plot's paper: the sheet a drawing is plotted on - its size, the way it lies - and what is done to
 * the drawing on it: its turn, and fitting it to the sheet. Studio and Image have no paper at all
 * since 2026-11-23, and the ground's colour moved to the Artboard card, which all three apps show:
 * the colour is what the art is made on, not a fact about the sheet.
 */
export function PaperSection({ w, h, sizeId, units, collapsibleKey, disabled, onSize, onDimensions, onTurnDrawing, onFit, onFill, onScale }: Props) {
  const landscape = w >= h;
  // Kept between visits, so the margin a sheet is usually given is the one the button fits to.
  const [margin, setMargin] = useState(paperMarginMm);
  // The percent waits in the box until Apply: scaling is something done to the drawing, not a size
  // it keeps, so the number is an instruction - and it stays typed, to be applied again.
  const [by, setBy] = useState(100);
  const keepMargin = (mm: number) => {
    setMargin(mm);
    try { localStorage.setItem(MARGIN_KEY, String(mm)); } catch { /* kept for this visit only */ }
  };
  // Where the fitted drawing goes in the room left over, kept between visits like the margin.
  const [align, setAlign] = useState<FitAlign>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ALIGN_KEY) ?? "null");
      return ALIGN_STEPS.includes(saved?.x) && ALIGN_STEPS.includes(saved?.y) ? saved : FIT_CENTERED;
    } catch {
      return FIT_CENTERED;
    }
  });
  const keepAlign = (next: FitAlign) => {
    setAlign(next);
    try { localStorage.setItem(ALIGN_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  };
  // Extra margin on one side, a percent of the margin more, for Fit and Fill: the side opposite the
  // alignment (extraMarginSide), so no side of its own to pick. Kept between visits like the margin.
  const [extra, setExtra] = useState(() => {
    try { return localStorage.getItem(EXTRA_KEY) === "true"; } catch { return false; }
  });
  const keepExtra = (on: boolean) => {
    setExtra(on);
    try { localStorage.setItem(EXTRA_KEY, String(on)); } catch { /* kept for this visit only */ }
  };
  const [extraPercent, setExtraPercent] = useState(() => {
    try {
      const raw = localStorage.getItem(EXTRA_PERCENT_KEY);
      const saved = raw === null ? NaN : Number(raw);
      return saved >= 0 ? saved : EXTRA_PERCENT;
    } catch {
      return EXTRA_PERCENT;
    }
  });
  const keepExtraPercent = (pct: number) => {
    setExtraPercent(pct);
    try { localStorage.setItem(EXTRA_PERCENT_KEY, String(pct)); } catch { /* kept for this visit only */ }
  };
  const deeper = margin * (1 + extraPercent / 100);
  const extraOn = extra && extraPercent > 0;
  const extraSide = extraMarginSide(align, landscape);
  const sideMargins = Object.fromEntries(
    MARGIN_SIDES.map((s) => [s, extraOn && s === extraSide ? deeper : margin]),
  ) as unknown as Margins;
  const margins = extraOn ? `${fmtLen(margin, units)} margin, ${fmtLen(deeper, units)} at the ${extraSide}` : `${fmtLen(margin, units)} margin`;
  // A margin that leaves no paper between them has nothing to fit into.
  const roomLeft = w - sideMargins.left - sideMargins.right > 0 && h - sideMargins.top - sideMargins.bottom > 0;

  return (
    <Section
      title="Paper"
      icon={panelIcon("paper")}
      collapsibleKey={collapsibleKey}
      actionWhenOpen
    >
      {/* The size list, which way the sheet lies, and a custom width and height: the Artboard
          card's own control, sizing the paper here. */}
      <SizeChooser
        w={w}
        h={h}
        sizeId={sizeId}
        units={units}
        what="paper"
        disabled={disabled}
        onPick={onSize}
        onDimensions={onDimensions}
      />

      {/* What's done to the drawing on the paper, apart from the paper itself: turning it, and fitting
          it inside a margin. Folds on its own, its choice remembered per app. */}
      <Section title="Drawing transform" collapsibleKey={`${collapsibleKey}-transform`}>
        {/* One row: the drawing turned a quarter on the paper, which stays as it lies, in every app; then Fit: as big as the paper allows
            inside the margin. A drawing of another proportion than the paper fills it only one way;
            the alignment below says where it sits the other way - centred, or against an edge. */}
        <div className={styles.transformRow}>
          <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the drawing left" title="Turn the drawing 90° left about its middle; the paper stays as it lies" disabled={disabled || !onTurnDrawing} onClick={() => onTurnDrawing?.(-1)} />
          <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the drawing right" title="Turn the drawing 90° right about its middle; the paper stays as it lies" disabled={disabled || !onTurnDrawing} onClick={() => onTurnDrawing?.(1)} />
          <div className={styles.marginField}>
            <LengthField label="Margin" mm={margin} units={units} min={0} disabled={disabled} onChange={keepMargin} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            title={roomLeft
              ? `Fit: scale the drawing to fill the paper inside a ${margins}, placed as the alignment below says`
              : "The margin leaves no paper to fit the drawing into"}
            disabled={disabled || !onFit || !roomLeft}
            onClick={() => onFit?.(sideMargins, align)}
          >
            Fit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title={roomLeft
              ? `Fill: scale the drawing to cover the paper inside a ${margins}, cropping what's over - the alignment below says which part stays`
              : "The margin leaves no paper to fill"}
            disabled={disabled || !onFill || !roomLeft}
            onClick={() => onFill?.(sideMargins, align)}
          >
            Fill
          </Button>
        </div>
        {/* Scale, then where Fit and Fill put the drawing: across, then down - one line. */}
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
              title={by === 100 ? "100% is the size it is already" : `Scale the drawing to ${by}% of the size it is now, about its middle`}
              disabled={disabled || !onScale || by === 100}
              onClick={() => onScale?.(by)}
            >
              Apply
            </Button>
          </div>
          <div className={styles.fitAlign}>
            <SegmentedControl size="sm" variant="dark" aria-label="Fit across: left, center or right">
              {[
                { x: 0 as const, icon: <FitIcon />, label: "Left", hint: "Fit against the left margin" },
                { x: 0.5 as const, icon: <FitIcon centered />, label: "Center", hint: "Fit centered across the paper" },
                { x: 1 as const, icon: <FitIcon turn={180} />, label: "Right", hint: "Fit against the right margin" },
              ].map(({ x, icon, label, hint }) => (
                <Segment key={label} selected={align.x === x} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => keepAlign({ ...align, x })} />
              ))}
            </SegmentedControl>
            <SegmentedControl size="sm" variant="dark" aria-label="Fit down: top, middle or bottom">
              {[
                { y: 0 as const, icon: <FitIcon turn={90} />, label: "Top", hint: "Fit against the top margin" },
                { y: 0.5 as const, icon: <FitIcon centered turn={-90} />, label: "Middle", hint: "Fit centered down the paper" },
                { y: 1 as const, icon: <FitIcon turn={-90} />, label: "Bottom", hint: "Fit against the bottom margin" },
              ].map(({ y, icon, label, hint }) => (
                <Segment key={label} selected={align.y === y} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => keepAlign({ ...align, y })} />
              ))}
            </SegmentedControl>
          </div>
        </div>
        <Checkbox size="md"
          checked={extra}
          label="Extra margin"
          title={`Fit and Fill leave more margin on the side across from where the drawing is aligned - the ${extraSide} now: ${fmtLen(deeper, units)} there under a ${fmtLen(margin, units)} margin`}
          disabled={disabled}
          onChange={(e) => keepExtra(e.target.checked)}
        />
        {extra && (
          <div className={styles.extraMargin}>
            <div className={styles.marginField}>
              <NumberField label="Extra" unit="%" min={0} max={400} step={5} value={extraPercent} disabled={disabled} onChange={keepExtraPercent} />
            </div>
          </div>
        )}
      </Section>

    </Section>
  );
}
