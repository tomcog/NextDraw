import { useState } from "react";
import { Button, ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Pipette, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { UnitSwitch } from "./UnitSwitch";
import { Section } from "./Section";
import { panelIcon } from "../PanelToolbar";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";
import { FIT_CENTERED, type FitAlign } from "../../lib/geometry";

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

/** The paper-orientation icons from the NextDraw Figma file (Frame 5): a page with its
 *  corner folded at the top right, standing up or lying on its side. */
function SheetIcon({ wide = false }: { wide?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {wide ? (
        <>
          <path d="M1 12.7V3C1 2.7239 1.2239 2.5 1.5 2.5H10.6535C10.919 2.5 11.1735 2.6056 11.3611 2.7934L14.7076 6.1449C14.8948 6.3324 15 6.5865 15 6.8515V12.7C15 12.9762 14.7761 13.2 14.4999 13.2H1.5001C1.2239 13.2 1 12.9762 1 12.7Z" />
          <path d="M10.7633 2.7253V6.25C10.7633 6.5261 10.8839 6.6536 11.16 6.6536H14.7392" />
        </>
      ) : (
        <>
          <path d="M3.3 15H13C13.2761 15 13.5 14.7761 13.5 14.5V5.3465C13.5 5.081 13.3944 4.8265 13.2066 4.6389L9.8551 1.2924C9.6676 1.1052 9.4135 1 9.1485 1H3.3C3.0239 1 2.8 1.2239 2.8 1.5001V14.4999C2.8 14.7761 3.0239 15 3.3 15Z" />
          <path d="M13.2747 5.2367H9.75C9.4738 5.2367 9.3464 5.1162 9.3464 4.84V1.2608" />
        </>
      )}
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
  /** Turn the drawing a quarter turn, 1 right or -1 left, about its middle; the paper stays as it lies.
   *  Left out while there is no drawing to turn. */
  onTurnDrawing?: (dir: 1 | -1) => void;
  /** The turn takes the paper with it - landscape to portrait, all on it turned - rather than the drawing alone. */
  turnsPaper?: boolean;
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
export function PaperSection({ w, h, sizeId, units, color, collapsibleKey, disabled, onSize, onDimensions, onColor, onUnits, onTurnDrawing, turnsPaper = false, onFit, onFill }: Props) {
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
  const [margin, setMargin] = useState(paperMarginMm);
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
      icon={panelIcon("paper")}
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
            { wide: true, icon: <SheetIcon wide />, label: "Landscape", hint: "Landscape: the paper lies on its side" },
            { wide: false, icon: <SheetIcon />, label: "Portrait", hint: "Portrait: the paper stands up" },
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
            switch beside its size is what turns the paper - or, where an app says so (Studio), the
            paper and everything on it turned together; then Fit: as big as the paper allows
            inside the margin. A drawing of another proportion than the paper fills it only one way;
            the alignment below says where it sits the other way - centred, or against an edge. */}
        <div className={styles.transformRow}>
          {onTurnDrawing && (
            <>
              <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label={turnsPaper ? "Turn the paper and drawing left" : "Turn the drawing left"} title={turnsPaper ? "Turn the paper and everything on it 90° left: landscape becomes portrait, the drawing still on it as it was" : "Turn the drawing 90° left, on the paper"} disabled={disabled} onClick={() => onTurnDrawing(-1)} />
              <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label={turnsPaper ? "Turn the paper and drawing right" : "Turn the drawing right"} title={turnsPaper ? "Turn the paper and everything on it 90° right: landscape becomes portrait, the drawing still on it as it was" : "Turn the drawing 90° right, on the paper"} disabled={disabled} onClick={() => onTurnDrawing(1)} />
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
