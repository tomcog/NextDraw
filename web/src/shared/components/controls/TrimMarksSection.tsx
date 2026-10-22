import { Button, Checkbox, InputSelect } from "@tomcoggia/ui";
import { Section } from "./Section";
import { LengthField } from "./LengthField";
import { panelIcon } from "../PanelToolbar";
import styles from "./controls.module.css";
import type { Trim } from "../../lib/drawing/parametric";
import { boxOf, type Page, type Shape } from "../../lib/drawing/shapes";
import { TRIM_SIZES, trimOffPaper, trimSizeIdOf } from "../../lib/drawing/trimMarks";
import type { Units } from "../../lib/types";

type Box = { x0: number; y0: number; x1: number; y1: number };

interface Props {
  /** The drawing's trim marks, or none yet. */
  trim: (Shape & { curve: Trim }) | undefined;
  /** What's drawn, but the marks: placed in the trim. Null with nothing drawn. */
  drawing: Box | null;
  page: Page;
  units: Units;
  busy: boolean;
  /** Why the marks can't be changed here, if they can't: said instead of the controls. */
  refused?: string;
  /** Where the fold is remembered: each app its own. */
  collapsibleKey: string;
  /** Marks on - a layer of their own, round the drawing - or off, the layer gone. */
  onOn: (on: boolean) => void;
  /** The trim itself, in inches on the page: its size and where it sits. */
  setBox: (box: Box) => void;
  setMarks: (curve: Trim) => void;
  /** Everything drawn but the marks moved by this much, in inches. */
  moveDrawing: (dx: number, dy: number) => void;
}

/**
 * Trim marks, the same in Image, Studio and Plot: the size the print is cut to once it's drawn, where
 * that sits on the paper, and where the drawing sits in it. The marks are a layer of the drawing,
 * drawn from these numbers every time one changes; Plot plots them like any layer. Lengths are in the
 * Paper card's units; places are from the paper's top left corner, and the drawing's from the trim's.
 */
export function TrimMarksSection({ trim, drawing, page, units, busy, refused, collapsibleKey, onOn, setBox, setMarks, moveDrawing }: Props) {
  const b = trim ? boxOf(trim) : null;
  const w = b ? b.x1 - b.x0 : 0;
  const h = b ? b.y1 - b.y0 : 0;
  // The trim at this size, keeping its middle.
  const resize = (nw: number, nh: number) => {
    if (!b || !(nw > 0) || !(nh > 0)) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    setBox({ x0: cx - nw / 2, y0: cy - nh / 2, x1: cx + nw / 2, y1: cy + nh / 2 });
  };
  const moveTo = (x: number, y: number) => b && setBox({ x0: x, y0: y, x1: x + w, y1: y + h });
  const mm = (inches: number) => inches * 25.4;
  return (
    <Section title="Trim marks" icon={panelIcon("trim")} collapsibleKey={collapsibleKey}>
      {refused ? <p className={styles.hint}>{refused}</p> : <>
      <Checkbox size="md"
        checked={Boolean(trim)}
        label="On"
        title="Mark the corners where the print is cut, for the size it's finished at: a layer of its own"
        disabled={busy}
        onChange={(e) => onOn(e.target.checked)}
      />
      {trim && b && (
        <>
          <div className={styles.trimFields}>
            <InputSelect
              size="md"
              label="Trim size"
              value={trimSizeIdOf(w, h)}
              disabled={busy}
              title="The size the print is cut to"
              onChange={(e) => {
                const size = TRIM_SIZES.find((s) => s.id === e.target.value);
                if (!size) return;
                // The way the trim lies now: a landscape trim stays landscape.
                const [short, long] = [Math.min(size.w, size.h), Math.max(size.w, size.h)];
                if (w > h) resize(long, short);
                else resize(short, long);
              }}
            >
              {TRIM_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="custom">Custom</option>
            </InputSelect>
            <Button size="sm" variant="secondary" disabled={busy} title="Turn the trim: its width and height the other way round, about its middle" onClick={() => resize(h, w)}>
              Turn
            </Button>
          </div>
          <div className={styles.trimFields}>
            <LengthField label="Width" mm={mm(w)} units={units} min={2.5} disabled={busy} onChange={(v) => resize(v / 25.4, h)} />
            <LengthField label="Height" mm={mm(h)} units={units} min={2.5} disabled={busy} onChange={(v) => resize(w, v / 25.4)} />
          </div>
          <p className={styles.hint}>The trim on the paper, from its top left corner</p>
          <div className={styles.trimFields}>
            <LengthField label="Left" mm={mm(b.x0)} units={units} disabled={busy} onChange={(v) => moveTo(v / 25.4, b.y0)} />
            <LengthField label="Top" mm={mm(b.y0)} units={units} disabled={busy} onChange={(v) => moveTo(b.x0, v / 25.4)} />
          </div>
          <div className={styles.trimFields}>
            <Button size="sm" variant="secondary" disabled={busy} title="Put the trim in the middle of the paper, the drawing staying where it is" onClick={() => moveTo((page.w - w) / 2, (page.h - h) / 2)}>
              Center on paper
            </Button>
            <Button size="sm" variant="secondary" disabled={busy || !drawing} title="Put the trim round the middle of the drawing, the drawing staying where it is" onClick={() => drawing && moveTo((drawing.x0 + drawing.x1 - w) / 2, (drawing.y0 + drawing.y1 - h) / 2)}>
              Center on drawing
            </Button>
          </div>
          {drawing && (
            <>
              <p className={styles.hint}>The drawing in the trim, from the trim's top left corner</p>
              <div className={styles.trimFields}>
                <LengthField label="Left" mm={mm(drawing.x0 - b.x0)} units={units} disabled={busy} onChange={(v) => moveDrawing(v / 25.4 - (drawing.x0 - b.x0), 0)} />
                <LengthField label="Top" mm={mm(drawing.y0 - b.y0)} units={units} disabled={busy} onChange={(v) => moveDrawing(0, v / 25.4 - (drawing.y0 - b.y0))} />
              </div>
              <div className={styles.trimFields}>
                <Button size="sm" variant="secondary" disabled={busy} title="Move the drawing to the middle of the trim, the trim staying where it is" onClick={() => moveDrawing((b.x0 + b.x1 - drawing.x0 - drawing.x1) / 2, (b.y0 + b.y1 - drawing.y0 - drawing.y1) / 2)}>
                  Center drawing
                </Button>
              </div>
            </>
          )}
          <div className={styles.trimFields}>
            <div title="How long each mark is">
              <LengthField label="Mark length" mm={trim.curve.length} units={units} min={0.5} disabled={busy} onChange={(v) => setMarks({ ...trim.curve, length: v })} />
            </div>
            <div title="How far each mark stands off the trim's corner, so the cut never shows it: the bleed, as a rule">
              <LengthField label="Offset" mm={trim.curve.offset} units={units} min={0} disabled={busy} onChange={(v) => setMarks({ ...trim.curve, offset: v })} />
            </div>
          </div>
          {trimOffPaper(trim, page) && <p className={styles.hint}>Some marks run off the paper and won't be drawn whole. Make the trim smaller, move it, or shorten the marks.</p>}
        </>
      )}
      </>}
    </Section>
  );
}
