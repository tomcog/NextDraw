import { useRef, useState } from "react";
import { ToolPicker } from "../../../shared/components/controls/ToolPicker";
import { Button, ButtonRound, Checkbox, InputText } from "@tomcoggia/ui";
import { CirclePlus, Palette, SlidersHorizontal, X } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import { DrawingToolSection } from "../../../shared/components/controls/DrawingToolSection";
import { Slider } from "./Slider";
import type { Preset } from "../../../shared/lib/types";

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
  inUse: "first" | "second" | null; // layer by layer, the tool of the layer chosen to print
  onAddSecond: () => void;
  onSecondTool: (name: string) => void;
  onRemoveSecond: () => void;
  onAssign: (id: string, second: boolean) => void;
  paletteOpen: boolean; // the palette view stands in for the drawing preview
  hudOpen: boolean; // the tool's settings are showing over the preview, for setting it up
  onHud: () => void;
  onPalette: () => void;
  onInk: (patch: { ink_opacity?: number; ink_build?: number }) => void;
  smallPaths: number | null; // percent slower, or null when off
  onSmallPaths: (percent: number | null) => void;
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
  presets, active, changed, disabled, onApply, onSave, onDelete,
  secondTool, secondLayers, layers, inUse, onAddSecond, onSecondTool, onRemoveSecond, onAssign,
  smallPaths, onSmallPaths, tiltOn, onTilt, dragOn, onDrag, paletteOpen, onPalette, hudOpen, onHud, onInk,
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
  // Turning Chill mode back on returns to the last amount chosen.
  const lastSlow = useRef(smallPaths ?? 50);
  if (smallPaths !== null) lastSlow.current = smallPaths;
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
    // The same card as Studio's (DrawingToolSection); everything else here is Plot's alone, passed in.
    <DrawingToolSection
      tools={presets}
      value={active?.name ?? ""}
      onPick={onApply}
      collapsibleKey="plot-pen"
      // A tool is always chosen once presets load, so this only shows if none is.
      placeholder={presets.length ? "Choose a preset" : "No presets saved yet"}
      changed={changed}
      disabled={disabled}
      inUse={inUse === "first"}
      under={
        <>
          {tiltSwitch(active)}
          {dragSwitch(active)}
          {mixed && layers.length > 0 && chips(false)}
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
            aria-label={`${hudOpen ? "Hide" : "Show"} the drawing tool's settings`}
            aria-pressed={hudOpen}
            title={hudOpen ? "Hide the tool's settings" : "Set up the tool: its heights, speeds and offsets, over the preview"}
            disabled={!presets.length}
            onClick={onHud}
          />
          <ButtonRound
            size="sm"
            icon={<Palette />}
            className={paletteOpen ? styles.roundActive : undefined}
            aria-label={`${paletteOpen ? "Hide" : "Show"} the drawing tool's colors`}
            aria-expanded={paletteOpen}
            title={paletteOpen ? "Back to the drawing" : "The tool's colors: add, name and change them"}
            disabled={!presets.length}
            onClick={onPalette}
          />
        </span>
      }
    >

      {mixed && (
        <div className={styles.toolBlock} data-in-use={inUse === "second"}>
          <ToolPicker
            tools={presets.filter((p) => p.name !== active?.name)}
            value={secondTool ?? ""}
            onPick={onSecondTool}
            label="Second drawing tool"
            placeholder="Choose a preset"
            disabled={disabled}
            action={
              <ButtonRound size="sm" variant="ghost" icon={<X />} aria-label="Remove the second drawing tool" title="Remove the second tool; its layers go back to the first" disabled={disabled} onClick={onRemoveSecond} />
            }
          />
          {tiltSwitch(presets.find((p) => p.name === secondTool))}
          {dragSwitch(presets.find((p) => p.name === secondTool))}
          {layers.length > 0 && chips(true)}
        </div>
      )}
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

      <div className={styles.smallPaths}>
        <div className={styles.smallPathsRow}>
        <Checkbox
          size="md"
          label="Chill mode"
          checked={smallPaths !== null}
          disabled={disabled}
          title="For drawings full of tiny marks: slows acceleration, travel and drawing speed, and pen lifts, so the plotter doesn't shake"
          onChange={(e) => onSmallPaths(e.target.checked ? lastSlow.current : null)}
        />
        {!mixed && (
          <ButtonRound
            size="sm"
            icon={<CirclePlus />}
            aria-label="Add a second drawing tool"
            title="Add another preset, for a drawing that mixes pens"
            disabled={disabled || !presets.length}
            onClick={onAddSecond}
          />
        )}
        </div>
        {smallPaths !== null && (
          // Shown as the share of the tool's speed that's kept (right is faster); stored as how much slower.
          <Slider
            label="Speed"
            value={100 - smallPaths}
            min={10}
            max={90}
            step={5}
            format={(v) => `${v}%`}
            disabled={disabled}
            onChange={(v) => onSmallPaths(100 - v)}
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
    </DrawingToolSection>
  );
}
