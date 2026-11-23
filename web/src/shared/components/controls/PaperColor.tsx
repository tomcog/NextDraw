import { useState } from "react";
import { Palette } from "lucide-react";
import styles from "./controls.module.css";

// Common paper colours, plus any colour from the picker. The paper is drawn in this colour whatever
// the app's theme, so light or dark mode never changes how a print looks.
export const PAPER_COLORS = [
  { name: "White", color: "#ffffff" },
  { name: "Kraft", color: "#dcb78e" },
  { name: "Gray", color: "#8f9198" },
  { name: "Black", color: "#1d1d1f" },
];

export const paperColorName = (color: string) => PAPER_COLORS.find((c) => c.color === color)?.name ?? color;

/**
 * The dot in the paper's colour that a card's heading carries, ringed while the colours are out.
 * Shared, so the Artboard card's (Studio and Image) and the Paper card's (Plot) are the one control.
 */
export function PaperDot({ color, open, disabled, onToggle }: {
  color: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const name = paperColorName(color);
  return (
    <button
      type="button"
      className={styles.paperSwatch}
      style={{ background: color }}
      aria-label={`Paper color: ${name}`}
      aria-expanded={open}
      title={open ? "Hide paper colors" : `${name} paper: click for another color`}
      disabled={disabled}
      onClick={onToggle}
    />
  );
}

/** The colours themselves, tucked behind the dot: the list, then any colour from the picker. */
export function PaperColorRow({ color, disabled, onColor }: {
  color: string;
  disabled?: boolean;
  onColor: (color: string) => void;
}) {
  const customColor = !PAPER_COLORS.some((c) => c.color === color);
  // While the picker is up, the chip is the switch of something on screen and wears the action red
  // for it (Tom, 2026-11-23). Kept here rather than in :focus, which the system picker knocks out by
  // taking the window: the input stays the focused element throughout, whoever holds the window.
  //
  // It is NOT a toggle, and deliberately: the picker is the system's own panel, which a page cannot
  // take down - no hidePicker(), and dropping focus leaves it up (tried, 2026-11-23). A second press
  // that greyed the chip would be claiming to have closed something still on screen, so the chip
  // simply follows the field's focus: it goes quiet when you click away.
  const [picking, setPicking] = useState(false);
  return (
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
      <label
        className={styles.paperSwatch}
        data-custom
        data-picking={picking || undefined}
        role="radio"
        aria-checked={customColor}
        title="Pick any surface color"
        style={customColor ? { background: color } : undefined}
      >
        {!customColor && <Palette aria-hidden />}
        <input
          type="color"
          aria-label="Custom paper color"
          value={color}
          disabled={disabled}
          onFocus={() => setPicking(true)}
          onBlur={() => setPicking(false)}
          onChange={(e) => onColor(e.target.value)}
        />
      </label>
    </div>
  );
}
