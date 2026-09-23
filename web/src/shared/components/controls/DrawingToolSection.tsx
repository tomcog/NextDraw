import type { ReactNode } from "react";
import type { Preset } from "../../lib/types";
import styles from "./controls.module.css";
import { Section } from "./Section";
import { ToolPicker } from "./ToolPicker";

interface Props {
  tools: Preset[];
  /** The name of the tool chosen, "" when none is. */
  value: string;
  onPick: (name: string) => void;
  collapsibleKey: string;
  disabled?: boolean;
  /** Plot: the chosen tool's settings have been changed from its preset. */
  changed?: boolean;
  placeholder?: string;
  /** Buttons at the end of the heading: Plot's tool setup and palette. */
  action?: ReactNode;
  /** Plot: this tool is the one the layer about to be plotted is drawn with, so it is ringed. */
  inUse?: boolean;
  /** What belongs to this tool, under it: Plot's angle and one-way switches, and its layers. */
  under?: ReactNode;
  /** Anything after the tool: Plot's second tool, and Chill mode. */
  children?: ReactNode;
}

/**
 * Shared: the drawing tool, the same card in both apps - the marker, its tip, the drawing of the tip
 * and what the tool is always set up for. What only one app has - Plot's setup buttons, the angle
 * and one-way switches, a second tool, Chill mode - is passed in by that app, and simply isn't there
 * in the other.
 */
export function DrawingToolSection({ tools, value, onPick, collapsibleKey, disabled, changed, placeholder, action, inUse, under, children }: Props) {
  return (
    <Section title="Drawing tool" collapsibleKey={collapsibleKey} action={action}>
      <div className={styles.toolBlock} data-in-use={inUse}>
        <ToolPicker
          tools={tools}
          value={value}
          onPick={onPick}
          label="Drawing tool"
          placeholder={placeholder}
          changed={changed}
          disabled={disabled}
        />
        {under}
      </div>
      {children}
    </Section>
  );
}
