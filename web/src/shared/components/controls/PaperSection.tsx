import { useState } from "react";
import { Button, ButtonRound, Checkbox, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { NumberField } from "./NumberField";
import { UnitSwitch } from "./UnitSwitch";
import { LieSwitch } from "./LieSwitch";
import { PaperColorRow, PaperDot } from "./PaperColor";
import { Section } from "./Section";
import { panelIcon } from "../PanelToolbar";
import { PAPER_SIZES } from "../../lib/constants";
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
  /** What the sizes are named in. */
  units: Units;
  /** The paper's colour, which the preview is drawn on and the inks are blended with. */
  color: string;
  collapsibleKey: string;
  disabled?: boolean;
  /** A size from the menu. The app keeps the way the paper lies. */
  onSize: (id: string) => void;
  /** A new width and height, in mm: the paper turned, or a custom size typed in. */
  onDimensions: (w: number, h: number) => void;
  onColor: (color: string) => void;
  /** Measure in inches or millimetres: one choice for all three apps (useUnits, and Plot's settings). */
  onUnits: (units: Units) => void;
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
  /** Image: how big the picture is drawn, as a percent of the size its file says it is. Left out, the
   *  field reads 100 and scales the drawing by a percent of its size now, then reads 100 again. */
  scale?: number;
  /** Draw it at that percent - of its file's size with `scale`, of its size now without. Left out
   *  while there is nothing to scale. */
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
 * Shared: the paper, the same card in every app - its size, the way it lies and its colour, and the
 * drawing on it: its turn, and fitting it to the paper. Each app does those to the drawing
 * itself, so all three show the same. Every app passes all of it: the card is the same everywhere.
 */
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits, onTurnDrawing, onFit, onFill, scale, onScale }: Props) {
  const landscape = w >= h;
  // Custom chosen by hand stays chosen while its width and height are typed, even through a size
  // that happens to be one of the list's on the way. The size belongs to this drawing alone: it is
  // never added to the list.
  const [typing, setTyping] = useState(false);
  const custom = typing || sizeId === "custom";
  // Paper colour rarely changes, so its swatches stay tucked behind the dot in its colour.
  const [colorsOpen, setColorsOpen] = useState(false);
  // Kept between visits, so the margin a sheet is usually given is the one the button fits to.
  const [margin, setMargin] = useState(paperMarginMm);
  // Scaling by a percent of the size now: the field starts again at 100 once it's done.
  const [scaleRound, setScaleRound] = useState(0);
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

  // Each size is named in the chosen unit and the way the paper lies (width × height), so the list
  // follows a turn and a change of unit.
  const sizeName = (pw: number, ph: number) => `${fmtLen(pw, units, false)} × ${fmtLen(ph, units)}`;
  const listed = (p: (typeof PAPER_SIZES)[number]) => sizeName(...((landscape ? [p.h, p.w] : [p.w, p.h]) as [number, number]));

  return (
    <Section
      title="Paper"
      icon={panelIcon("paper")}
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      // Folded, the row says what size paper the drawing is on, as the Drawing tool row names the
      // tool. Its color only shows open.
      closedAction={
        <span className={styles.paperClosed}>
          <span className={styles.toolInTitle}>{`${fmtLen(w, units, false)} × ${fmtLen(h, units)}`}</span>
        </span>
      }
      // Open, the dot is the paper's color, and opens the colors to choose another.
      action={<PaperDot color={color} open={colorsOpen} disabled={disabled} onToggle={() => setColorsOpen((open) => !open)} />}
    >
      <div className={styles.paperRow}>
        <InputSelect
          size="md"
          label="Paper size"
          hideLabel
          value={custom ? "custom" : sizeId}
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value;
            setTyping(id === "custom");
            if (id !== "custom") onSize(id); // Custom starts from the paper as it is
          }}
        >
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{listed(p)}</option>)}
          {/* Its width and height are in the fields below, so the menu needn't repeat them. */}
          <option value="custom">{custom ? "Custom" : "Custom size…"}</option>
        </InputSelect>
        <UnitSwitch units={units} disabled={disabled} onChange={onUnits} />
        {/* Only the paper turns, as it lies on the plotter: the drawing stays as it is. The Drawing
            transform's turn buttons turn the drawing alone, never the paper. */}
        <LieSwitch w={w} h={h} what="paper" disabled={disabled} onSwap={() => onDimensions(h, w)} />
      </div>

      {custom && (
        <div className={styles.paperCustom}>
          <LengthField label="Width" mm={w} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(mm, h)} />
          <LengthField label="Height" mm={h} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(w, mm)} />
        </div>
      )}

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
          <NumberField
            key={scaleRound}
            label="Scale"
            unit="%"
            min={1}
            max={10000}
            step={5}
            value={scale ?? 100}
            disabled={disabled || !onScale}
            onChange={(percent) => {
              onScale?.(percent);
              if (scale === undefined) setScaleRound((n) => n + 1);
            }}
          />
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

      {colorsOpen && <PaperColorRow color={color} disabled={disabled} onColor={onColor} />}
    </Section>
  );
}
