import { useRef, type ReactNode } from "react";
import { Button, InputSelect } from "@tomcoggia/ui";
import type { Preset } from "../../lib/types";
import { TipMark } from "./TipMark";
import { ToolNote } from "./ToolNote";
import styles from "./ToolPicker.module.css";

interface Props {
  /** The tools to offer. Plot's second tool leaves out the first. */
  tools: Preset[];
  /** The name of the tool chosen, "" when none is. */
  value: string;
  onPick: (name: string) => void;
  label: string;
  /** Shown in the menu while nothing is chosen. */
  placeholder?: string;
  /** Plot: the chosen tool's settings have been changed from its preset. */
  changed?: boolean;
  /** Beside the menu, at the end of its row: Plot's button that takes the second tool away. */
  action?: ReactNode;
  disabled?: boolean;
}

/**
 * Shared: both apps choose a drawing tool, and choose it the same way - the marker from a menu, then
 * its tip from a row of buttons under it, beside a drawing of the tip, with what the tool is always
 * set up for said underneath.
 *
 * The menu lists markers, not tips: a marker that comes with more than one tip is one line with a
 * row of tips under it, rather than a line per tip. A marker with no tips of its own is its own entry
 * and shows no row. The name of a tool is still the whole of it - the family is only how the menu is
 * grouped - so what is picked here is what a drawing, or a plot, records.
 */
export function ToolPicker({ tools, value, onPick, label, placeholder, changed, action, disabled }: Props) {
  const familyOf = (t: Preset) => t.family ?? t.name;
  const families = tools.reduce<{ name: string; tips: Preset[] }[]>((list, t) => {
    const at = list.find((f) => f.name === familyOf(t));
    if (at) at.tips.push(t);
    else list.push({ name: familyOf(t), tips: [t] });
    return list;
  }, []);
  const tool = tools.find((t) => t.name === value);
  const family = tool ? familyOf(tool) : "";
  const tips = families.find((f) => f.name === family)?.tips ?? [];
  // A drawing can name a tool this Mac has no preset for. It is still the tool chosen, so it stays
  // in the menu rather than the menu quietly showing another.
  const missing = value && !tool ? value : "";
  // The tip's drawing opens the menu too: it's the biggest thing in the card, and what it shows is
  // what the menu chooses. Where a browser can't open a menu for a click it didn't get, the menu is
  // focused instead, ready for the arrow keys.
  const select = useRef<HTMLSelectElement>(null);
  const openMenu = () => {
    const el = select.current;
    if (!el || el.disabled) return;
    el.focus();
    try {
      el.showPicker();
    } catch {
      // focused is as far as this browser goes
    }
  };

  const menu = (
    <InputSelect
      ref={select}
      size="md"
      label={label}
      hideLabel
      value={missing || family}
      disabled={disabled || !tools.length}
      // Changing marker keeps the tip you were on where the new one has that tip too - a Fine is a
      // Fine - and otherwise takes its first.
      onChange={(e) => {
        const picked = families.find((f) => f.name === e.target.value)?.tips ?? [];
        const same = picked.find((t) => t.variant && t.variant === tool?.variant);
        const next = (same ?? picked[0])?.name;
        if (next) onPick(next);
      }}
    >
      {!family && !missing && <option value="">{placeholder ?? "Choose a tool"}</option>}
      {missing && <option value={missing}>{`${missing} (not on this Mac)`}</option>}
      {families.map((f) => (
        <option key={f.name} value={f.name}>
          {f.name === family && changed ? `${f.name} (changed)` : f.name}
        </option>
      ))}
    </InputSelect>
  );

  return (
    <>
      {/* The tip's own drawing, in front of the marker and the tips it belongs to: it stands as tall
        as they do together, since it is what both of them name. */}
      <div className={styles.toolPick}>
        <TipMark tool={tool} onClick={disabled || !tools.length ? undefined : openMenu} />
        <div className={styles.toolPickMain}>
          {action ? <div className={styles.menuRow}>{menu}{action}</div> : menu}
          {tips.length <= 1 && (
            // A marker with one tip keeps the row's space all the same, so its pen is drawn the same
            // size as every other's and the cards line up. Held open by a button that isn't there
            // rather than by a measurement, which would go stale the moment the row's own size changed.
            <div className={styles.tips} aria-hidden>
              <Button size="sm" variant="ghost" tabIndex={-1} className={styles.tipRowHold}>&nbsp;</Button>
            </div>
          )}
          {tips.length > 1 && (
            <div className={styles.tips} role="group" aria-label="Tip">
              {tips.map((t) => (
                <Button
                  key={t.name}
                  size="sm"
                  variant={t.name === value ? "primary" : "ghost"}
                  aria-pressed={t.name === value}
                  title={`${t.variant}: draws a ${t.settings.pen_width ?? "?"} mm line`}
                  disabled={disabled}
                  onClick={() => onPick(t.name)}
                >
                  {t.variant}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* What the tool is always set up for - how wide it draws, the clip angle, and one-way strokes:
        facts about the tool rather than about either app, which say what to do before drawing. */}
      <ToolNote tool={tool} />
    </>
  );
}
