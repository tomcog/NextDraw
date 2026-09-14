import { ButtonRound, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Ratio } from "lucide-react";
import styles from "./controls.module.css";
import { LengthField } from "./LengthField";
import { Section } from "./Section";
import { PAPER_SIZES } from "../../lib/constants";
import { fmtLen } from "../../lib/format";
import type { Settings } from "../../lib/types";

interface Props {
  settings: Settings;
  disabled: boolean;
  onPickSize: (id: string) => void;
  onChange: (patch: Partial<Settings>) => void;
}

export function PaperSection({ settings: s, disabled, onPickSize, onChange }: Props) {
  const custom = s.paper_size === "custom";
  const landscape = s.paper_w >= s.paper_h;

  // Each size is named in the chosen unit and in the sheet's current orientation (width × height),
  // so the list reflects Rotate and in/mm. Custom shows the typed size.
  const sizeName = (p: (typeof PAPER_SIZES)[number]) => {
    const [w, h] = p.w && p.h ? (landscape ? [p.h, p.w] : [p.w, p.h]) : [s.paper_w, s.paper_h];
    const dims = `${fmtLen(w, s.units, false)} × ${fmtLen(h, s.units)}`;
    return p.w ? dims : `Custom size (${dims})`;
  };
  return (
    <Section title="Paper">
      <div className={styles.paperHead}>
        <InputSelect label="Paper size" hideLabel value={s.paper_size} disabled={disabled} onChange={(e) => onPickSize(e.target.value)}>
          {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{sizeName(p)}</option>)}
        </InputSelect>
        <div className={styles.unitsGroup}>
          <SegmentedControl size="sm" aria-label="Units">
            <Segment selected={s.units === "in"} disabled={disabled} onClick={() => onChange({ units: "in" })}>in</Segment>
            <Segment selected={s.units === "mm"} disabled={disabled} onClick={() => onChange({ units: "mm" })}>mm</Segment>
          </SegmentedControl>
          <ButtonRound
            size="sm"
            icon={<Ratio />}
            aria-label="Rotate paper"
            title="Rotate paper (swap width and height)"
            disabled={disabled}
            onClick={() => onChange({ paper_w: s.paper_h, paper_h: s.paper_w })}
          />
        </div>
      </div>

      {custom && (
        <div className={styles.row2}>
          <LengthField label="Width" mm={s.paper_w} units={s.units} min={1} disabled={disabled} onChange={(paper_w) => onChange({ paper_w })} />
          <LengthField label="Height" mm={s.paper_h} units={s.units} min={1} disabled={disabled} onChange={(paper_h) => onChange({ paper_h })} />
        </div>
      )}

    </Section>
  );
}
