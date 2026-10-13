import type { ReactNode } from "react";
import { Section } from "./Section";
import controls from "./controls.module.css";

interface Props {
  /** The drawing's name, shown in the heading while the card is folded. Null with no drawing. */
  fileName: string | null;
  /** Under which the card's being folded or open is remembered: one per app. */
  collapsibleKey: string;
  /** The heading's buttons, at its right; put away while the card is folded, as every card's are. */
  action: ReactNode;
  children: ReactNode;
  /** Open while true, however it was left: a question in it is waiting to be answered. */
  forceOpen?: boolean;
}

/**
 * Shared: the File card in every app - its heading, folding, and the drawing named in red while it's
 * folded, as Paper names its size and Pen its tool. What's in it is FileSection's, the same in every
 * app: the drawing's name, where it's saved, and Save.
 */
export function FileCard({ fileName, collapsibleKey, action, children, forceOpen }: Props) {
  return (
    <Section
      title="File"
      collapsibleKey={collapsibleKey}
      actionWhenOpen
      closedAction={fileName ? <span className={controls.fileInTitle} title={fileName}>{fileName}</span> : undefined}
      action={action}
      forceOpen={forceOpen}
    >
      {children}
    </Section>
  );
}
