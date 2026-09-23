import type { ReactNode } from "react";
import { Section } from "./Section";

/**
 * Shared: the Settings group in the File card, the same in both apps - what the drawing is made on and
 * with, folding as one and each part on its own. The tool is named on the Drawing tool row, while
 * that is folded. The parts are the app's: Paper and Drawing tool in both, the grid in Studio alone.
 */
export function SettingsSection({ collapsibleKey, children }: { collapsibleKey: string; children: ReactNode }) {
  return (
    <Section
      title="Settings"
      collapsibleKey={collapsibleKey}
    >
      {children}
    </Section>
  );
}
