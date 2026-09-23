import type { ReactNode } from "react";
import styles from "./controls.module.css";
import { Section } from "./Section";

/**
 * Shared: the Settings group in the File card, the same in both apps - what the drawing is made on and
 * with, folding as one and each part on its own. The tool is named on its row, because the row is
 * what still shows when the group is folded, which is when knowing the pen matters most. The parts
 * are the app's: Paper and Drawing tool in both, the grid in Studio alone.
 */
export function SettingsSection({ tool, collapsibleKey, children }: { tool: string; collapsibleKey: string; children: ReactNode }) {
  return (
    <Section
      title="Settings"
      action={tool ? <span className={styles.toolInTitle}>{tool}</span> : undefined}
      collapsibleKey={collapsibleKey}
    >
      {children}
    </Section>
  );
}
