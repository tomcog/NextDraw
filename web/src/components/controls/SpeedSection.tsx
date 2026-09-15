import { InputSelect } from "@tomcoggia/ui";
import { Section } from "./Section";
import { Slider } from "./Slider";
import type { Handling, Settings } from "../../lib/types";

interface Props {
  settings: Settings;
  handling: Handling[];
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
}

export function SpeedSection({ settings: s, handling, disabled, onChange }: Props) {
  return (
    <Section title="Speed">
      <Slider label="Drawing speed" value={s.speed_pendown} min={1} disabled={disabled} onChange={(v) => onChange({ speed_pendown: v })} />
      <Slider label="Moving speed" value={s.speed_penup} min={1} disabled={disabled} onChange={(v) => onChange({ speed_penup: v })} />
      <Slider label="Acceleration" value={s.accel} min={1} disabled={disabled} onChange={(v) => onChange({ accel: v })} />
      <InputSelect size="md" label="Motion style" value={s.handling} disabled={disabled} onChange={(e) => onChange({ handling: Number(e.target.value) })}>
        {handling.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </InputSelect>
    </Section>
  );
}
