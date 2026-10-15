import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { load, save } from "../../lib/storage";
import styles from "./controls.module.css";

interface Props {
  /** A node rather than a string, so a heading can carry a mark - a layer's ink, say - before it. */
  title: ReactNode;
  /** The card's glyph before its title: the same one as the toolbar button that shows the card. */
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /**
   * Give the title a chevron that folds the card away. A panel of many cards is mostly things you
   * aren't using at this moment, so anything long-lived enough to be worth folding says so, and the
   * choice is remembered under this key.
   */
  collapsibleKey?: string;
  defaultOpen?: boolean;
  /** Leave the choice unremembered, so the card starts as `defaultOpen` says every time it appears. */
  forget?: boolean;
  /** Hide the action while the section is folded: buttons that only act on what's inside it. */
  actionWhenOpen?: boolean;
  /** What the heading row shows at its end while the section is folded, in place of the action. */
  closedAction?: ReactNode;
  /** Open whatever was chosen, while this is true: something in it that has to be seen - a question. */
  forceOpen?: boolean;
}

export function Section({ title: text, icon, action, children, collapsibleKey, defaultOpen = true, forget = false, actionWhenOpen = false, closedAction, forceOpen = false }: Props) {
  const [chosen, setOpen] = useState(() =>
    collapsibleKey ? (forget ? undefined : load<boolean>(`studio-open-${collapsibleKey}`)) ?? defaultOpen : true,
  );
  const open = chosen || forceOpen;
  // Folded, a card with a glyph is the glyph alone: its name is still there for a screen reader.
  const title = icon ? (
    <span className={styles.iconTitle}>
      {icon}
      {open ? text : <span className={styles.hiddenTitle}>{text}</span>}
    </span>
  ) : text;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (collapsibleKey && !forget) save(`studio-open-${collapsibleKey}`, next);
  };

  const heading = collapsibleKey ? (
    <button type="button" className={styles.sectionToggle} aria-expanded={open} onClick={toggle}>
      <ChevronRight className={styles.sectionChevron} aria-hidden="true" data-open={open} />
      {title}
    </button>
  ) : (
    <span>{title}</span>
  );

  return (
    <fieldset
      className={styles.section}
      data-collapsed={collapsibleKey ? !open : undefined}
      // Folded, the whole section - and, for a card that is one section, the whole card - opens it:
      // anywhere but a control of its own, such as a button in its heading row, which does its own thing.
      onClick={collapsibleKey && !open ? (e) => {
        if (!(e.target as Element).closest("button, a, input, select, textarea, label, [role='menu']")) toggle();
      } : undefined}
    >
      <legend className={styles.legend}>
        {(open || !actionWhenOpen ? action : closedAction) ? (
          <span className={styles.legendRow}>
            {heading}
            {open || !actionWhenOpen ? action : closedAction}
          </span>
        ) : heading}
      </legend>
      {open && children}
    </fieldset>
  );
}
