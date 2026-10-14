import { useState } from "react";
import { Button, ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, MoveHorizontal, MoveVertical, Pipette, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { UnitSwitch } from "./UnitSwitch";
import { Section } from "./Section";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";
import { FIT_CENTERED, type FitAlign } from "../../lib/geometry";

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
  /** Turn the drawing a quarter turn, 1 right or -1 left, about its middle; the paper stays as it lies.
   *  Left out while there is no drawing to turn. */
  onTurnDrawing?: (dir: 1 | -1) => void;
  /** Scale the drawing to fill the paper less a margin all round (in mm), placed in the room left
   *  over as `align` says - centred, or against an edge. Left out while there is no drawing to fit. */
  onFit?: (marginMm: number, align: FitAlign) => void;
  /** Image only: scale the picture to cover the paper less the margin, cropping what's over - the
   *  alignment says which part stays. Left out, there's no Fill: a drawing of paths can't be cropped. */
  onFill?: (marginMm: number, align: FitAlign) => void;
}

// Common paper colours, plus any colour from the picker. The paper is drawn in this colour whatever
// the app's theme, so light or dark mode never changes how a print looks.
const MARGIN_KEY = "nextdraw.fitMargin";
const ALIGN_KEY = "nextdraw.fitAlign";
const ALIGN_STEPS = [0, 0.5, 1] as const;

const PAPER_COLORS = [
  { name: "White", color: "#ffffff" },
  { name: "Cream", color: "#f4ecd8" },
  { name: "Kraft", color: "#c6a57a" },
  { name: "Gray", color: "#8e9196" },
  { name: "Black", color: "#1d1d1f" },
];

/**
 * Shared: the paper, the same card in every app - its size, the way it lies and its colour, and the
 * drawing on it: its turn, and fitting it to the paper. Each app does those to the drawing
 * itself, so all three show the same. Every app passes all of it: the card is the same everywhere.
 */
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits, onTurnDrawing, onFit, onFill }: Props) {
  const landscape = w >= h;
  // Custom chosen by hand stays chosen while its width and height are typed, even through a size
  // that happens to be one of the list's on the way. The size belongs to this drawing alone: it is
  // never added to the list.
  const [typing, setTyping] = useState(false);
  const custom = typing || sizeId === "custom";
  const colorName = PAPER_COLORS.find((c) => c.color === color)?.name ?? color;
  // Paper colour rarely changes, so its swatches stay tucked behind the dot in its colour.
  const [colorsOpen, setColorsOpen] = useState(false);
  // Kept between visits, so the margin a sheet is usually given is the one the button fits to.
  const [margin, setMargin] = useState(() => {
    try {
      const raw = localStorage.getItem(MARGIN_KEY);
      const saved = raw === null ? NaN : Number(raw);
      return saved >= 0 ? saved : 12.7; // half an inch until one is chosen
    } catch {
      return 12.7;
    }
  });
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
  // A margin that leaves no paper between them has nothing to fit into.
  const roomLeft = w - 2 * margin > 0 && h - 2 * margin > 0;

  // Each size is named in the chosen unit and the way the paper lies (width × height), so the list
  // follows a turn and a change of unit.
  const sizeName = (pw: number, ph: number) => `${fmtLen(pw, units, false)} × ${fmtLen(ph, units)}`;
  const listed = (p: (typeof PAPER_SIZES)[number]) => sizeName(...((landscape ? [p.h, p.w] : [p.w, p.h]) as [number, number]));

  return (
    <Section
      title="Paper"
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      // Folded, the row says what paper the drawing is on - its size, and a dot in its color - as the
      // Drawing tool row names the tool.
      closedAction={
        <span className={styles.paperClosed}>
          <span className={styles.toolInTitle}>{`${fmtLen(w, units, false)} × ${fmtLen(h, units)}`}</span>
          <span className={styles.paperSwatch} style={{ background: color }} role="img" aria-label={`${colorName} paper`} title={`${colorName} paper`} />
        </span>
      }
      // Open, the dot is the paper's color, and opens the colors to choose another.
      action={
        <button
          type="button"
          className={styles.paperSwatch}
          style={{ background: color }}
          aria-label={`Paper color: ${colorName}`}
          aria-expanded={colorsOpen}
          title={colorsOpen ? "Hide paper colors" : `${colorName} paper: click for another color`}
          onClick={() => setColorsOpen((open) => !open)}
        />
      }
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
        {/* The paper lies one way or the other, never both: a choice of two, like the toolbar's.
            A square sheet lies neither way, so neither is chosen. */}
        <SegmentedControl size="sm" variant="dark" aria-label="Which way the paper lies">
          {[
            { wide: true, icon: <MoveHorizontal />, label: "Landscape", hint: "Landscape: the paper lies on its side" },
            { wide: false, icon: <MoveVertical />, label: "Portrait", hint: "Portrait: the paper stands up" },
          ].map(({ wide, icon, label, hint }) => {
            const on = landscape === wide && w !== h;
            return (
              <Segment
                key={label}
                selected={on}
                icon={icon}
                aria-label={label}
                title={hint}
                disabled={disabled}
                onClick={() => {
                  if (!on) onDimensions(h, w); // already lying that way otherwise
                }}
              />
            );
          })}
        </SegmentedControl>
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
        {/* One row: the drawing turned a quarter about its own middle - the paper stays as it is, the
            switch beside its size is what turns the paper - then Fit: as big as the paper allows
            inside the margin. A drawing of another proportion than the paper fills it only one way;
            the alignment below says where it sits the other way - centred, or against an edge. */}
        <div className={styles.transformRow}>
          {onTurnDrawing && (
            <>
              <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the drawing left" title="Turn the drawing 90° left, on the paper" disabled={disabled} onClick={() => onTurnDrawing(-1)} />
              <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the drawing right" title="Turn the drawing 90° right, on the paper" disabled={disabled} onClick={() => onTurnDrawing(1)} />
            </>
          )}
          <div className={styles.marginField}>
            <LengthField label="Margin" mm={margin} units={units} min={0} disabled={disabled} onChange={keepMargin} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            title={roomLeft
              ? `Fit: scale the drawing to fill the paper inside a ${fmtLen(margin, units)} margin, placed as the alignment below says`
              : "The margin leaves no paper to fit the drawing into"}
            disabled={disabled || !onFit || !roomLeft}
            onClick={() => onFit?.(margin, align)}
          >
            Fit
          </Button>
          {onFill && (
            <Button
              size="sm"
              variant="secondary"
              title={roomLeft
                ? `Fill: scale the image to cover the paper inside a ${fmtLen(margin, units)} margin, cropping what's over - the alignment below says which part stays`
                : "The margin leaves no paper to fill"}
              disabled={disabled || !roomLeft}
              onClick={() => onFill(margin, align)}
            >
              Fill
            </Button>
          )}
        </div>
        {onFit && (
          <div className={styles.fitAlign}>
            <SegmentedControl size="sm" variant="dark" aria-label="Fit across: left, center or right">
              {[
                { x: 0 as const, icon: <AlignHorizontalJustifyStart />, label: "Left", hint: "Fit against the left margin" },
                { x: 0.5 as const, icon: <AlignHorizontalJustifyCenter />, label: "Center", hint: "Fit centered across the paper" },
                { x: 1 as const, icon: <AlignHorizontalJustifyEnd />, label: "Right", hint: "Fit against the right margin" },
              ].map(({ x, icon, label, hint }) => (
                <Segment key={label} selected={align.x === x} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => keepAlign({ ...align, x })} />
              ))}
            </SegmentedControl>
            <SegmentedControl size="sm" variant="dark" aria-label="Fit down: top, middle or bottom">
              {[
                { y: 0 as const, icon: <AlignVerticalJustifyStart />, label: "Top", hint: "Fit against the top margin" },
                { y: 0.5 as const, icon: <AlignVerticalJustifyCenter />, label: "Middle", hint: "Fit centered down the paper" },
                { y: 1 as const, icon: <AlignVerticalJustifyEnd />, label: "Bottom", hint: "Fit against the bottom margin" },
              ].map(({ y, icon, label, hint }) => (
                <Segment key={label} selected={align.y === y} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => keepAlign({ ...align, y })} />
              ))}
            </SegmentedControl>
          </div>
        )}
      </Section>

      {colorsOpen && (
        <div className={styles.paperColors} role="radiogroup" aria-label="Paper color">
          {PAPER_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              role="radio"
              aria-checked={color === c.color}
              aria-label={`${c.name} paper`}
              title={`${c.name} paper`}
              className={styles.paperSwatch}
              style={{ background: c.color }}
              disabled={disabled}
              onClick={() => onColor(c.color)}
            />
          ))}
          {(() => {
            const customColor = !PAPER_COLORS.some((c) => c.color === color);
            return (
              <label
                className={styles.paperSwatch}
                data-custom
                role="radio"
                aria-checked={customColor}
                title="Pick any paper color"
                style={customColor ? { background: color } : undefined}
              >
                {!customColor && <Pipette aria-hidden />}
                <input type="color" aria-label="Custom paper color" value={color} disabled={disabled} onChange={(e) => onColor(e.target.value)} />
              </label>
            );
          })()}
        </div>
      )}
    </Section>
  );
}
