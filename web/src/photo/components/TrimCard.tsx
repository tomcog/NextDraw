import { Button, Card, Checkbox, InputSelect } from "@tomcoggia/ui";
import { Scissors } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import { LengthField } from "../../shared/components/controls/LengthField";
import controls from "../../shared/components/controls/controls.module.css";
import type { Trim } from "../../shared/lib/drawing/parametric";
import { boxOf, type Page, type Shape } from "../../shared/lib/drawing/shapes";
import { TRIM_SIZES, trimSizeIdOf } from "../../shared/lib/drawing/trimMarks";
import type { Units } from "../../shared/lib/types";
import styles from "../App.module.css";

type Box = { x0: number; y0: number; x1: number; y1: number };

interface Props {
  /** The drawing's trim marks, or none yet. */
  trim: (Shape & { curve: Trim }) | undefined;
  /** The image's box on the page, in inches: what's placed in the trim. */
  image: Box;
  page: Page;
  units: Units;
  busy: boolean;
  /** Any mark past the paper's edge, where it can't be drawn. */
  offPaper: boolean;
  /** Marks on - a layer of their own, round the image - or off, the layer gone. */
  onOn: (on: boolean) => void;
  /** The trim itself, in inches on the page: its size and where it sits. */
  setBox: (box: Box) => void;
  setMarks: (curve: Trim) => void;
  /** The image moved by this much, in inches, within the trim. */
  moveImage: (dx: number, dy: number) => void;
}

/**
 * Trim marks: the size the print is cut to once it's drawn, and where the image sits in it. The marks
 * are a layer of the drawing, drawn from these numbers every time they change - Plot plots them like
 * any layer, and Studio can set them too. All lengths are the Paper card's units; positions are from
 * the paper's top left corner, and the image's from the trim's.
 */
export function TrimCard({ trim, image, page, units, busy, offPaper, onOn, setBox, setMarks, moveImage }: Props) {
  const on = Boolean(trim);
  const b = trim ? boxOf(trim) : null;
  const w = b ? b.x1 - b.x0 : 0;
  const h = b ? b.y1 - b.y0 : 0;
  const sizeId = b ? trimSizeIdOf(w, h) : "custom";
  // The trim at this size, keeping its middle.
  const resize = (nw: number, nh: number) => {
    if (!b || !(nw > 0) || !(nh > 0)) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    setBox({ x0: cx - nw / 2, y0: cy - nh / 2, x1: cx + nw / 2, y1: cy + nh / 2 });
  };
  const moveTo = (x: number, y: number) => b && setBox({ x0: x, y0: y, x1: x + w, y1: y + h });
  const mm = (inches: number) => inches * 25.4;
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section title="Trim marks" icon={<Scissors />} collapsibleKey="photo-trim">
          <div className={styles.fillRow}>
            <Checkbox size="md"
              checked={on}
              label="On"
              title="Mark the corners where the print is cut, for the size it's finished at: a layer of its own"
              disabled={busy}
              onChange={(e) => onOn(e.target.checked)}
            />
          </div>
          {trim && b && (
            <>
              <div className={styles.fillRow}>
                <InputSelect
                  size="md"
                  label="Trim size"
                  value={sizeId}
                  disabled={busy}
                  title="The size the print is cut to"
                  onChange={(e) => {
                    const size = TRIM_SIZES.find((s) => s.id === e.target.value);
                    if (!size) return;
                    // The way the trim lies now: a landscape trim stays landscape.
                    const wide = w > h;
                    resize(wide ? Math.max(size.w, size.h) : Math.min(size.w, size.h), wide ? Math.min(size.w, size.h) : Math.max(size.w, size.h));
                  }}
                >
                  {TRIM_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="custom">Custom</option>
                </InputSelect>
                <Button size="sm" variant="secondary" disabled={busy} title="Turn the trim: its width and height the other way round, about its middle" onClick={() => resize(h, w)}>
                  Turn
                </Button>
              </div>
              <div className={styles.fillRow}>
                <LengthField label="Width" mm={mm(w)} units={units} min={2.5} disabled={busy} onChange={(v) => resize(v / 25.4, h)} />
                <LengthField label="Height" mm={mm(h)} units={units} min={2.5} disabled={busy} onChange={(v) => resize(w, v / 25.4)} />
              </div>
              <p className={styles.empty}>The trim on the paper, from its top left corner</p>
              <div className={styles.fillRow}>
                <LengthField label="Left" mm={mm(b.x0)} units={units} disabled={busy} onChange={(v) => moveTo(v / 25.4, b.y0)} />
                <LengthField label="Top" mm={mm(b.y0)} units={units} disabled={busy} onChange={(v) => moveTo(b.x0, v / 25.4)} />
              </div>
              <div className={styles.fillRow}>
                <Button size="sm" variant="secondary" disabled={busy} title="Put the trim in the middle of the paper, the image staying where it is" onClick={() => moveTo((page.w - w) / 2, (page.h - h) / 2)}>
                  Center on paper
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} title="Put the trim round the middle of the image, the image staying where it is" onClick={() => moveTo((image.x0 + image.x1 - w) / 2, (image.y0 + image.y1 - h) / 2)}>
                  Center on image
                </Button>
              </div>
              <p className={styles.empty}>The image in the trim, from the trim's top left corner</p>
              <div className={styles.fillRow}>
                <LengthField label="Left" mm={mm(image.x0 - b.x0)} units={units} disabled={busy} onChange={(v) => moveImage(v / 25.4 - (image.x0 - b.x0), 0)} />
                <LengthField label="Top" mm={mm(image.y0 - b.y0)} units={units} disabled={busy} onChange={(v) => moveImage(0, v / 25.4 - (image.y0 - b.y0))} />
              </div>
              <div className={styles.fillRow}>
                <Button size="sm" variant="secondary" disabled={busy} title="Move the image to the middle of the trim, the trim staying where it is" onClick={() => moveImage((b.x0 + b.x1 - image.x0 - image.x1) / 2, (b.y0 + b.y1 - image.y0 - image.y1) / 2)}>
                  Center image
                </Button>
              </div>
              <div className={styles.fillRow}>
                <div title="How long each mark is">
                  <LengthField label="Mark length" mm={trim.curve.length} units={units} min={0.5} disabled={busy} onChange={(v) => setMarks({ ...trim.curve, length: v })} />
                </div>
                <div title="How far each mark stands off the trim's corner, so the cut never shows it: the bleed, as a rule">
                  <LengthField label="Offset" mm={trim.curve.offset} units={units} min={0} disabled={busy} onChange={(v) => setMarks({ ...trim.curve, offset: v })} />
                </div>
              </div>
              {offPaper && <p className={controls.hint}>Some marks run off the paper and won't be drawn whole. Make the trim smaller, move it, or shorten the marks.</p>}
            </>
          )}
        </Section>
      </div>
    </Card>
  );
}
