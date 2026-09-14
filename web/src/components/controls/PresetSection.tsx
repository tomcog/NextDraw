import { useState } from "react";
import { Button, InputSelect, InputText } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import { Section } from "./Section";
import type { Preset } from "../../lib/types";

interface Props {
  presets: Preset[];
  active: Preset | undefined;
  changed: boolean;
  disabled: boolean;
  onApply: (name: string) => void;
  onSave: (name: string) => Promise<boolean>;
  onDelete: () => void;
}

// Save / Update / Delete are hidden for now; presets can still be chosen.
const SHOW_PRESET_ACTIONS = false;

export function PresetSection({ presets, active, changed, disabled, onApply, onSave, onDelete }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = async () => {
    if (await onSave(name)) setNaming(false);
  };

  return (
    <Section title="Drawing tool">
      <InputSelect
        label="Drawing tool"
        hideLabel
        value={active?.name ?? ""}
        disabled={disabled || !presets.length}
        onChange={(e) => onApply(e.target.value)}
      >
        <option value="">{presets.length ? "Choose a preset" : "No presets saved yet"}</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name === active?.name && changed ? `${p.name} (changed)` : p.name}
          </option>
        ))}
      </InputSelect>
      {!presets.length && (
        <p className={styles.hint}>Save the heights and speeds that work for a pen, then switch back to them in one click.</p>
      )}

      {SHOW_PRESET_ACTIONS && (naming ? (
        <div className={styles.stack}>
          <InputText
            label="Preset name"
            value={name}
            maxLength={40}
            placeholder="EnerGel"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") setNaming(false);
            }}
          />
          <div className={styles.buttonRow}>
            <Button size="md" variant="primary" disabled={!name.trim()} onClick={save}>Save preset</Button>
            <Button size="md" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className={styles.buttonRow}>
          <Button size="md" variant="secondary" disabled={disabled} onClick={() => { setName(""); setNaming(true); }}>
            Save as new preset
          </Button>
          {active && changed && (
            <Button size="md" variant="secondary" disabled={disabled} onClick={() => onSave(active.name)}>
              {`Update “${active.name}”`}
            </Button>
          )}
          {active && (
            <Button size="md" variant="ghost" tone="danger" disabled={disabled} onClick={onDelete}>Delete</Button>
          )}
        </div>
      ))}
    </Section>
  );
}
