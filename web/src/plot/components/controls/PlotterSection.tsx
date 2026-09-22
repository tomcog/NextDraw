import { InputSelect } from "@tomcoggia/ui";
import { Section } from "../../../shared/components/controls/Section";
import type { PlotterModel, Settings } from "../../../shared/lib/types";

interface Props {
  settings: Settings;
  models: PlotterModel[];
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
}

export function PlotterSection({ settings, models, disabled, onChange }: Props) {
  return (
    <Section title="Plotter">
      <InputSelect size="md" label="Model" value={settings.model} disabled={disabled} onChange={(e) => onChange({ model: Number(e.target.value) })}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </InputSelect>
    </Section>
  );
}
