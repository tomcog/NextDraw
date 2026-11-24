import { useState } from "react";
import { InputSelect } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { LieSwitch } from "./LieSwitch";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Units } from "../../lib/types";

/** The listed size a width and height are, whichever way round they lie, or "custom" for neither.
 *  In mm, loosely enough that a size written to a file in inches and read back is still itself:
 *  no two of the list are within a millimetre of each other. */
export function sizeIdFor(w: number, h: number) {
  const match = PAPER_SIZES.find(
    (p) => (Math.abs(p.w - w) < 0.05 && Math.abs(p.h - h) < 0.05) || (Math.abs(p.h - w) < 0.05 && Math.abs(p.w - h) < 0.05),
  );
  return match?.id ?? "custom";
}

/**
 * Shared: how a size is chosen - the Paper card's control, and the Artboard card's (2026-11-23).
 * The list of sizes with Custom at its end, which way it lies, and, for a custom size, the width
 * and height it is typed into. One control, so a sheet and an artboard are picked the same way.
 *
 * Each size is named in the chosen unit and the way the thing lies (width × height), so the list
 * follows a turn. A size chosen by hand is this drawing's alone and is never added to the list;
 * Custom stays chosen while its numbers are typed, even through a size that happens to be one of
 * the list's on the way.
 */
export function SizeChooser({ w, h, sizeId, units, what, canTurn = true, disabled, onPick, onDimensions }: {
  /** The thing's width and height in mm, as it lies. */
  w: number;
  h: number;
  /** The size it is saved as, where the app keeps one (Plot's paper). Worked out from the width and
   *  height when it is left out, which is what the artboard - carried in the drawing - does. */
  sizeId?: string;
  units: Units;
  /** What is being sized, for the labels: "paper", "artboard". */
  what: string;
  /**
   * Whether which way it lies is the user's to choose. Plot's paper goes in with its long edge
   * across the plotter, always (Tom, 2026-11-23): no switch, and a size picked from the list lies
   * that way whatever the sheet before it was. A width and height typed in are taken as typed.
   */
  canTurn?: boolean;
  disabled?: boolean;
  /** A size chosen from the list, where the app keeps its name. Left out, the width and height go
   *  through onDimensions instead, keeping the way it lies. */
  onPick?: (id: string) => void;
  /** A new width and height in mm: a size chosen, the thing turned, or a custom size typed in. */
  onDimensions: (w: number, h: number) => void;
}) {
  // Which way round the list is named, and the way a size picked from it lies: as this one lies, or
  // long edge across where that is not the user's to change.
  const landscape = canTurn ? w >= h : true;
  const [typing, setTyping] = useState(false);
  const custom = typing || (sizeId ?? sizeIdFor(w, h)) === "custom";

  const pick = (id: string) => {
    setTyping(id === "custom");
    if (id === "custom") return; // Custom starts from the size as it is
    if (onPick) {
      onPick(id);
      return;
    }
    const size = PAPER_SIZES.find((p) => p.id === id);
    // The size as it is chosen lies the way this one already does - or long edge across, where which
    // way it lies is not the user's to choose.
    if (size) onDimensions(landscape ? size.h : size.w, landscape ? size.w : size.h);
  };

  const listed = (p: (typeof PAPER_SIZES)[number]) => {
    const [pw, ph] = (landscape ? [p.h, p.w] : [p.w, p.h]) as [number, number];
    return `${fmtLen(pw, units, false)} × ${fmtLen(ph, units)}`;
  };

  return (
    <>
      <div className={styles.sizeRow}>
        <InputSelect
          size="md"
          label={`${what.charAt(0).toUpperCase()}${what.slice(1)} size`}
          hideLabel
          value={custom ? "custom" : (sizeId ?? sizeIdFor(w, h))}
          disabled={disabled}
          onChange={(e) => pick(e.target.value)}
        >
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{listed(p)}</option>)}
          {/* Its width and height are in the fields below, so the menu needn't repeat them. */}
          <option value="custom">{custom ? "Custom" : "Custom size…"}</option>
        </InputSelect>
        {/* Only the thing itself turns: the drawing on it stays as it is. */}
        {canTurn && <LieSwitch w={w} h={h} what={what} disabled={disabled} onSwap={() => onDimensions(h, w)} />}
      </div>

      {custom && (
        <div className={styles.paperCustom}>
          <LengthField label="Width" mm={w} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(mm, h)} />
          <LengthField label="Height" mm={h} units={units} min={1} disabled={disabled} onChange={(mm) => onDimensions(w, mm)} />
        </div>
      )}
    </>
  );
}
