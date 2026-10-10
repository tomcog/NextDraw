import { useEffect, useRef, useState } from "react";
import { Button, ButtonRound, Card, InputText } from "@tomcoggia/ui";
import { Plus, Trash2 } from "lucide-react";
import styles from "./PaletteEditor.module.css";
import { hexToHsl, hslToHex, lightness, onPaper } from "../../shared/lib/color";
import type { PenColor, Preset } from "../../shared/lib/types";

interface Props {
  tool: Preset | undefined;
  paper: string; // the paper's color, for showing how each ink lands on it
  disabled: boolean;
  saving: boolean;
  error: string | null;
  onChange: (palette: PenColor[]) => void; // saved for the tool, a moment after the last edit
}

const NEW_COLOR = "#7a7a7a";

// Darkest first, so the lightest ends up at the bottom, as everywhere else colors are listed.
const HSL_FIELDS = [
  { label: "Hue", min: undefined, max: undefined }, // wraps round: up from 359 is 0
  { label: "Sat", min: 0, max: 100 },
  { label: "Light", min: 0, max: 100 },
] as const;

/**
 * A colour as hue, saturation and lightness, each a whole number the up and down arrows step by one -
 * the browser's own picker can't be told to open on HSL, or to step like that. What's typed is kept
 * as typed: read back from the hex it makes, a hue stepped on a near-grey would round back to where
 * it was and never move. It is read afresh only when the colour changes some other way.
 */
function HslFields({ color, name, disabled, onChange }: { color: string; name: string; disabled: boolean; onChange: (hex: string) => void }) {
  const fromHex = (hex: string) => (hexToHsl(hex) ?? [0, 0, 0]).map(String);
  const [text, setText] = useState<string[]>(() => fromHex(color));
  const typed = text.map(Number);
  const shown = text.every((t) => t.trim() !== "" && Number.isFinite(Number(t))) ? hslToHex(typed[0], typed[1], typed[2]) : null;
  useEffect(() => {
    if (shown !== color.toLowerCase()) setText(fromHex(color));
  }, [color]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = (at: number, raw: string) => {
    const next = [...text];
    next[at] = raw;
    const n = Math.round(Number(raw));
    if (raw.trim() !== "" && Number.isFinite(n)) {
      next[at] = String(at === 0 ? ((n % 360) + 360) % 360 : Math.min(100, Math.max(0, n)));
    }
    setText(next);
    if (next.every((t) => t.trim() !== "" && Number.isFinite(Number(t)))) {
      onChange(hslToHex(Number(next[0]), Number(next[1]), Number(next[2])));
    }
  };

  return (
    <div className={styles.hslRow}>
      {HSL_FIELDS.map((f, at) => (
        <InputText
          key={f.label}
          size="md"
          type="number"
          inputMode="numeric"
          step={1}
          min={f.min}
          max={f.max}
          label={f.label}
          aria-label={`${f.label === "Sat" ? "Saturation" : f.label === "Light" ? "Lightness" : "Hue"} of ${name}`}
          className={styles.hslField}
          value={text[at]}
          disabled={disabled}
          onChange={(e) => type(at, e.target.value)}
        />
      ))}
    </div>
  );
}

const byDarkness = (pens: PenColor[]) =>
  [...pens].sort((a, b) => (lightness(a.color) ?? Infinity) - (lightness(b.color) ?? Infinity));

// The pen colors of the chosen drawing tool, in place of the drawing preview: the colors a palette
// menu offers and Match to pens picks from. Edits save themselves; there's nothing to press.
export function PaletteEditor({ tool, paper, disabled, saving, error, onChange }: Props) {
  // Each swatch is shown as it plots: the ink at this tool's density, over the paper. The file's own
  // value stays in the field beside it, so a color can be chosen to land where you want it.
  const density = tool?.settings.ink_opacity ?? 1;
  const plotted = (color: string) => (density < 1 ? onPaper(color, density, paper) : color);
  // Edits live here while they're being typed, so a save on its way doesn't fight the fields. The
  // order settles when the palette opens: re-sorting mid-edit would slide a card out from under the
  // cursor as its color changed. A color added now waits at the end until the palette is opened again.
  const [colors, setColors] = useState<PenColor[]>(() => byDarkness(tool?.palette ?? []));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setColors(byDarkness(tool?.palette ?? []));
  }, [tool?.name, tool?.palette]);

  const edit = (next: PenColor[]) => {
    editing.current = true;
    setColors(next);
    onChange(next);
  };
  const change = (i: number, patch: Partial<PenColor>) => edit(colors.map((c, at) => (at === i ? { ...c, ...patch } : c)));
  const add = () => edit([...colors, { name: `Color ${colors.length + 1}`, color: NEW_COLOR }]);

  if (!tool) {
    return (
      <div className={styles.empty}>
        <p>Choose a pen to give it a palette.</p>
      </div>
    );
  }

  return (
    <div className={styles.root} aria-label={`Palette for ${tool.name}`}>
      <header className={styles.head}>
        <h2 className={styles.title}>{tool.name}</h2>
        <span className={styles.count} role="status">
          {error ? error : saving ? "Saving…"
            : density < 1 ? `Shown as they plot, at ${Math.round(density * 100)}% ink. The corner is the file's own color.`
            : colors.length ? `${colors.length} ${colors.length === 1 ? "color" : "colors"}` : "No colors yet"}
        </span>
      </header>

      {colors.length === 0 ? (
        <div className={styles.empty}>
          <p>This pen has no palette. Add the colors you own, and they'll be offered for every layer drawn with it.</p>
          <Button size="md" onClick={add} disabled={disabled}>Add the first color</Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {colors.map((pen, i) => (
            <Card key={i} variant="flat" className={styles.card}>
              <label className={styles.swatch} style={{ background: plotted(pen.color) }} data-ink={density < 1 || undefined}>
                <span className={styles.raw} style={{ background: pen.color }} aria-hidden />
                <span className={styles.hidden}>{`Color of ${pen.name}`}</span>
                <input
                  type="color"
                  className={styles.picker}
                  value={pen.color}
                  disabled={disabled}
                  onChange={(e) => change(i, { color: e.target.value })}
                />
              </label>
              <div className={styles.fields}>
                <InputText
                  size="md"
                  label={`Name of color ${i + 1}`}
                  hideLabel
                  value={pen.name}
                  disabled={disabled}
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <div className={styles.hexRow}>
                  <InputText
                    size="md"
                    label={`Hex value of ${pen.name}`}
                    hideLabel
                    className={styles.hex}
                    value={pen.color}
                    disabled={disabled}
                    onChange={(e) => {
                      const value = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                      change(i, { color: value.slice(0, 7) });
                    }}
                  />
                  <ButtonRound
                    size="sm"
                    variant="tertiary"
                    icon={<Trash2 />}
                    aria-label={`Delete ${pen.name}`}
                    title={`Delete ${pen.name} from this palette`}
                    disabled={disabled}
                    onClick={() => edit(colors.filter((_, at) => at !== i))}
                  />
                </div>
                <HslFields color={pen.color} name={pen.name} disabled={disabled} onChange={(hex) => change(i, { color: hex })} />
              </div>
            </Card>
          ))}
          <button type="button" className={styles.addCard} disabled={disabled} onClick={add} title="Add a color to this palette">
            <Plus aria-hidden />
            Add a color
          </button>
        </div>
      )}
    </div>
  );
}
