import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { load, save } from "../../lib/storage";
import styles from "./controls.module.css";

interface Props {
  /** A node rather than a string, so a heading can carry a mark - a layer's ink, say - before it. */
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /**
   * Give the title a chevron that folds the card away. A panel of many cards is mostly things you
   * aren't using at this moment, so anything long-lived enough to be worth folding says so, and the
   * choice is remembered under this key.
   */
  collapsibleKey?: string;
  defaultOpen?: boolean;
}

export function Section({ title, action, children, collapsibleKey, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(() =>
    collapsibleKey ? load<boolean>(`studio-open-${collapsibleKey}`) ?? defaultOpen : true,
  );
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (collapsibleKey) save(`studio-open-${collapsibleKey}`, next);
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
    <fieldset className={styles.section} data-collapsed={collapsibleKey ? !open : undefined}>
      <legend className={styles.legend}>
        {action ? (
          <span className={styles.legendRow}>
            {heading}
            {action}
          </span>
        ) : heading}
      </legend>
      {open && children}
    </fieldset>
  );
}
