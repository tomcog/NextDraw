import { useEffect, useRef, useState } from "react";
import { Button, ButtonRound, Card, InputText } from "@tomcoggia/ui";
import { Plus, Trash2 } from "lucide-react";
import styles from "./PaletteEditor.module.css";
import { lightness } from "../lib/color";
import type { PenColor, Preset } from "../lib/types";

interface Props {
  tool: Preset | undefined;
  disabled: boolean;
  saving: boolean;
  error: string | null;
  onChange: (palette: PenColor[]) => void; // saved for the tool, a moment after the last edit
}

const NEW_COLOR = "#7a7a7a";

// Darkest first, so the lightest ends up at the bottom, as everywhere else colors are listed.
const byDarkness = (pens: PenColor[]) =>
  [...pens].sort((a, b) => (lightness(a.color) ?? Infinity) - (lightness(b.color) ?? Infinity));

// The pen colors of the chosen drawing tool, in place of the drawing preview: the colors a palette
// menu offers and Match to pens picks from. Edits save themselves; there's nothing to press.
export function PaletteEditor({ tool, disabled, saving, error, onChange }: Props) {
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
        <p>Choose a drawing tool to give it a palette.</p>
      </div>
    );
  }

  return (
    <div className={styles.root} aria-label={`Palette for ${tool.name}`}>
      <header className={styles.head}>
        <h2 className={styles.title}>{tool.name}</h2>
        <span className={styles.count} role="status">
          {error ? error : saving ? "Saving…" : colors.length ? `${colors.length} ${colors.length === 1 ? "color" : "colors"}` : "No colors yet"}
        </span>
      </header>

      {colors.length === 0 ? (
        <div className={styles.empty}>
          <p>This tool has no palette. Add the colors you own, and they'll be offered for every layer drawn with it.</p>
          <Button size="md" onClick={add} disabled={disabled}>Add the first color</Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {colors.map((pen, i) => (
            <Card key={i} variant="flat" className={styles.card}>
              <label className={styles.swatch} style={{ background: pen.color }}>
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
                    variant="ghost"
                    icon={<Trash2 />}
                    aria-label={`Delete ${pen.name}`}
                    title={`Delete ${pen.name} from this palette`}
                    disabled={disabled}
                    onClick={() => edit(colors.filter((_, at) => at !== i))}
                  />
                </div>
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
