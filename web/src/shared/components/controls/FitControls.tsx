import { useState } from "react";
import { Segment, SegmentedControl } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { FIT_CENTERED, type FitAlign } from "../../lib/geometry";

/** The fit-alignment icons from the NextDraw Figma file (Frame 3): a 7 × 12 drawing
 *  beside or on a full-height line, turned for each direction. */
export function FitIcon({ centered = false, turn = 0 }: { centered?: boolean; turn?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform={turn ? `rotate(${turn} 8 8)` : undefined}>
        <rect x={centered ? 5 : 0.5} y="2.51" width="6" height="11" rx="0.5" stroke="currentColor" strokeWidth="1" />
        <rect x={centered ? 7.5 : 8.5} y="0.01" width="1" height="16" rx="0.5" fill="currentColor" />
      </g>
    </svg>
  );
}

const ALIGN_KEY = "nextdraw.fitAlign";

/**
 * Where a fitted drawing sits in the room left over - centred, or against an edge. Kept between
 * visits, and shared by every card that fits: the Paper card's, and the Artwork card's.
 */
export function useFitAlign(): [FitAlign, (align: FitAlign) => void] {
  const [align, setAlign] = useState<FitAlign>(() => {
    try {
      const raw = localStorage.getItem(ALIGN_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<FitAlign>) : null;
      const step = (v: unknown) => (v === 0 || v === 0.5 || v === 1 ? v : null);
      const x = step(saved?.x);
      const y = step(saved?.y);
      return x !== null && y !== null ? { x, y } : FIT_CENTERED;
    } catch {
      return FIT_CENTERED;
    }
  });
  return [align, (next: FitAlign) => {
    setAlign(next);
    try { localStorage.setItem(ALIGN_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  }];
}

/** Across, then down: where Fit and Fill put the drawing in the room left over. */
export function AlignPicker({ align, disabled, inside, onAlign }: {
  align: FitAlign;
  disabled?: boolean;
  /** What it is fitted inside, for the tooltips: "paper", "artboard". */
  inside: string;
  onAlign: (align: FitAlign) => void;
}) {
  return (
    <div className={styles.fitAlign}>
      <SegmentedControl size="sm" variant="dark" aria-label="Fit across: left, center or right">
        {[
          { x: 0 as const, icon: <FitIcon />, label: "Left", hint: "Fit against the left margin" },
          { x: 0.5 as const, icon: <FitIcon centered />, label: "Center", hint: `Fit centered across the ${inside}` },
          { x: 1 as const, icon: <FitIcon turn={180} />, label: "Right", hint: "Fit against the right margin" },
        ].map(({ x, icon, label, hint }) => (
          <Segment key={label} selected={align.x === x} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => onAlign({ ...align, x })} />
        ))}
      </SegmentedControl>
      <SegmentedControl size="sm" variant="dark" aria-label="Fit down: top, middle or bottom">
        {[
          { y: 0 as const, icon: <FitIcon turn={90} />, label: "Top", hint: "Fit against the top margin" },
          { y: 0.5 as const, icon: <FitIcon centered turn={-90} />, label: "Middle", hint: `Fit centered down the ${inside}` },
          { y: 1 as const, icon: <FitIcon turn={-90} />, label: "Bottom", hint: "Fit against the bottom margin" },
        ].map(({ y, icon, label, hint }) => (
          <Segment key={label} selected={align.y === y} icon={icon} aria-label={label} title={hint} disabled={disabled} onClick={() => onAlign({ ...align, y })} />
        ))}
      </SegmentedControl>
    </div>
  );
}
