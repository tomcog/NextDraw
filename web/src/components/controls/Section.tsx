import type { ReactNode } from "react";
import styles from "./controls.module.css";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className={styles.section}>
      <legend className={styles.legend}>
        {action ? (
          <span className={styles.legendRow}>
            <span>{title}</span>
            {action}
          </span>
        ) : title}
      </legend>
      {children}
    </fieldset>
  );
}
