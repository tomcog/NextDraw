import { useState } from "react";
import { Button, ButtonRound, Checkbox, InputText } from "@tomcoggia/ui";
import { Palette, SlidersHorizontal } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import { DrawingToolSection } from "../../../shared/components/controls/DrawingToolSection";
import { Slider } from "../../../shared/components/controls/Slider";
import type { Preset } from "../../../shared/lib/types";

interface Props {
  /** What the Pen row names while folded: the pen. */
  label?: string;
  presets: Preset[];
  active: Preset | undefined;
  changed: boolean;
  disabled: boolean;
  onApply: (name: string) => void;
  onSave: (name: string) => Promise<boolean>;
  onDelete: () => void;
  paletteOpen: boolean; // the palette view stands in for the drawing preview
  hudOpen: boolean; // the tool's settings are showing over the preview, for setting it up
  onHud: () => void;
  onPalette: () => void;
  onInk: (patch: { ink_opacity?: number; ink_build?: number }) => void;
  tiltOn: (tool: Preset | undefined) => boolean;
  onTilt: (toolName: string, on: boolean) => void;
  dragOn: (tool: Preset | undefined) => boolean;
  onDrag: (toolName: string, on: boolean) => void;
}

// Save / Update / Delete are hidden for now; presets can still be chosen.
const SHOW_PRESET_ACTIONS = false;

// Hidden for now: sliders for finding a tool's ink by eye. The values they set still apply to the
// preview - each tool keeps the density and build-up already saved in its preset.
const SHOW_INK_TUNING = false;

export function PresetSection({
  label,
  presets, active, changed, disabled, onApply, onSave, onDelete,
  tiltOn, onTilt, dragOn, onDrag, paletteOpen, onPalette, hudOpen, onHud, onInk,
}: Props) {
  // A tool used at more than one angle keeps its switch. The label gives the angle to set.
  const tiltSwitch = (tool: Preset | undefined) => tool?.tilt && !tool.tilt.fixed && (
      <Checkbox
        size="md"
        label={`Angle compensation ${tool.tilt.angle}°`}
        checked={tiltOn(tool)}
        disabled={disabled}
        title={`The tip of a tilted ${tool.name} lands ${Math.round(tool.tilt.offset_mm * 10) / 10} mm toward home from the carriage; the plot starts that much further out`}
        onChange={(e) => onTilt(tool.name, e.target.checked)}
      />
  );
  // A soft tip that splays when pushed: keep every stroke going away from home along the width.
  const dragSwitch = (tool: Preset | undefined) => tool?.drag && !tool.drag.fixed && (
      <Checkbox
        size="md"
        label="One-way strokes"
        checked={dragOn(tool)}
        disabled={disabled}
        title={`A ${tool.name} is only ever pulled: strokes that would push it are cut and turned around, which adds pen lifts`}
        onChange={(e) => onDrag(tool.name, e.target.checked)}
      />
  );
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = async () => {
    if (await onSave(name)) setNaming(false);
  };

  return (
    // The same card as Studio's (DrawingToolSection); everything else here is Plot's alone, passed in.
    <DrawingToolSection
      tools={presets}
      value={active?.name ?? ""}
      label={label}
      onPick={onApply}
      collapsibleKey="plot-pen"
      // A tool is always chosen once presets load, so this only shows if none is.
      placeholder={presets.length ? "Choose a preset" : "No presets saved yet"}
      changed={changed}
      disabled={disabled}
      under={
        <>
          {tiltSwitch(active)}
          {dragSwitch(active)}
        </>
      }
      action={
        <span className={styles.headerTools}>
          {/* Setting a tool up: its heights, speeds and offsets over the preview, to change while
              watching a test. Put away the rest of the time - plotting with a tool needs none of it. */}
          <ButtonRound
            size="sm"
            icon={<SlidersHorizontal />}
            className={hudOpen ? styles.roundActive : undefined}
            aria-label={`${hudOpen ? "Hide" : "Show"} the pen's settings`}
            aria-pressed={hudOpen}
            title={hudOpen ? "Hide the pen's settings" : "Set up the pen: its heights, speeds and offsets, over the preview"}
            disabled={!presets.length}
            onClick={onHud}
          />
          <ButtonRound
            size="sm"
            icon={<Palette />}
            className={paletteOpen ? styles.roundActive : undefined}
            aria-label={`${paletteOpen ? "Hide" : "Show"} the pen's colors`}
            aria-expanded={paletteOpen}
            title={paletteOpen ? "Back to the drawing" : "The pen's colors: add, name and change them"}
            disabled={!presets.length}
            onClick={onPalette}
          />
        </span>
      }
    >

      {SHOW_INK_TUNING && active && (
        <div className={styles.stack}>
          <Slider
            label="Ink density"
            value={Math.round((active.settings.ink_opacity ?? 1) * 100)}
            min={5}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            disabled={disabled}
            onChange={(v) => onInk({ ink_opacity: v / 100 })}
          />
          {active.settings.ink_builds !== false && (
            <Slider
              label="Build-up where strokes cross"
              value={Math.round((active.settings.ink_build ?? 1) * 100)}
              min={0}
              max={100}
              step={5}
              format={(v) => `${v}%`}
              disabled={disabled}
              onChange={(v) => onInk({ ink_build: v / 100 })}
            />
          )}
        </div>
      )}

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
    </DrawingToolSection>
  );
}
