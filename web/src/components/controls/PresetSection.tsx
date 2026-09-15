import { useEffect, useState } from "react";
import { Button, ButtonRound, Checkbox, InputSelect, InputText } from "@tomcoggia/ui";
import { Plus, X } from "lucide-react";
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
  secondTool: string | null; // null: one tool for the whole drawing; "" added but not chosen
  secondLayers: string[]; // ids of the layers that use the second tool
  layers: { id: string; number: number; color: string | null }[];
  inUse: "first" | "second" | null; // in Plot mode, the tool of the layer chosen to print
  onAddSecond: () => void;
  onSecondTool: (name: string) => void;
  onRemoveSecond: () => void;
  onAssign: (id: string, second: boolean) => void;
  smallPaths: number | null; // percent slower, or null when off
  onSmallPaths: (percent: number | null) => void;
}

// Save / Update / Delete are hidden for now; presets can still be chosen.
const SHOW_PRESET_ACTIONS = false;

export function PresetSection({
  presets, active, changed, disabled, onApply, onSave, onDelete,
  secondTool, secondLayers, layers, inUse, onAddSecond, onSecondTool, onRemoveSecond, onAssign,
  smallPaths, onSmallPaths,
}: Props) {
  const [slowDraft, setSlowDraft] = useState(String(smallPaths ?? 50));
  useEffect(() => setSlowDraft(String(smallPaths ?? 50)), [smallPaths]);
  const commitSlow = (text: string) => {
    const n = Math.round(Number(text));
    if (!text || Number.isNaN(n)) return setSlowDraft(String(smallPaths ?? 50));
    const next = Math.max(10, Math.min(90, n));
    setSlowDraft(String(next));
    if (smallPaths !== null && next !== smallPaths) onSmallPaths(next);
  };
  const mixed = secondTool !== null;
  // Layer number chips under each tool: a layer belongs to exactly one, so turning a chip on under one
  // tool takes it off the other.
  const chips = (second: boolean) => (
    <div className={styles.layerChips} role="group" aria-label={second ? "Layers using the second tool" : "Layers using the first tool"}>
      {[...layers].sort((a, b) => a.number - b.number).map((l) => {
        const on = secondLayers.includes(l.id) === second;
        return (
          <button
            key={l.id}
            type="button"
            className={styles.layerChip}
            aria-pressed={on}
            title={`Layer ${l.number}`}
            disabled={disabled || (second && !secondTool)}
            onClick={() => { if (!on) onAssign(l.id, second); }}
          >
            {l.color && <span className={styles.layerChipDot} style={{ background: l.color }} aria-hidden />}
            {l.number}
          </button>
        );
      })}
    </div>
  );

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = async () => {
    if (await onSave(name)) setNaming(false);
  };

  return (
    <Section
      title="Drawing tool"
      action={!mixed ? (
        <ButtonRound size="sm" icon={<Plus />} aria-label="Add a second drawing tool" title="Add another preset, for a drawing that mixes pens" disabled={disabled || !presets.length} onClick={onAddSecond} />
      ) : undefined}
    >
      <div className={styles.toolBlock} data-in-use={inUse === "first"}>
      <InputSelect
        size="md"
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
      {mixed && layers.length > 0 && chips(false)}
      </div>

      {mixed && (
        <div className={styles.toolBlock} data-in-use={inUse === "second"}>
          <div className={styles.toolRow}>
            <InputSelect
              size="md"
              label="Second drawing tool"
              hideLabel
              value={secondTool ?? ""}
              disabled={disabled}
              onChange={(e) => onSecondTool(e.target.value)}
            >
              <option value="">Choose a preset</option>
              {presets.filter((p) => p.name !== active?.name).map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
              {secondTool && !presets.some((p) => p.name === secondTool) && <option value={secondTool}>{`${secondTool} (not on this Mac)`}</option>}
            </InputSelect>
            <ButtonRound size="sm" variant="ghost" icon={<X />} aria-label="Remove the second drawing tool" title="Remove the second tool; its layers go back to the first" disabled={disabled} onClick={onRemoveSecond} />
          </div>
          {layers.length > 0 && chips(true)}
        </div>
      )}
      <div className={styles.smallPaths}>
        <Checkbox
          size="md"
          label="Chill-out mode"
          checked={smallPaths !== null}
          disabled={disabled}
          title="For drawings full of tiny marks: slows acceleration, travel and drawing speed, and pen lifts, so the plotter doesn't shake"
          onChange={(e) => onSmallPaths(e.target.checked ? Number(slowDraft) || 50 : null)}
        />
        {smallPaths !== null && (
          <InputText
            size="md"
            className={styles.slowField}
            label="Slower by (%)"
            type="number"
            inputMode="numeric"
            min={10}
            max={90}
            step={5}
            value={slowDraft}
            disabled={disabled}
            onChange={(e) => setSlowDraft(e.target.value)}
            onBlur={(e) => commitSlow(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitSlow((e.target as HTMLInputElement).value); }}
          />
        )}
      </div>

      {!presets.length && (
        <p className={styles.hint}>Save the heights and speeds that work for a pen, then switch back to them in one click.</p>
      )}

      {SHOW_PRESET_ACTIONS && (naming ? (
        <div className={styles.stack}>
          <InputText
            size="md"
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
