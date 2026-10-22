import { Card, Checkbox, Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Focus, Scissors, SlidersHorizontal, SquareDashed } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import bar from "../../shared/components/PreviewToolbar.module.css";
import { MOST_BLACK_POINT, type Photo } from "../../shared/lib/drawing/photo";
import styles from "../App.module.css";
import { ToolbarIcons } from "../../shared/components/ToolbarIcons";

/** One separation's plate, as the card lists it: its shape, and its layer's name and ink. */
export interface Channel {
  id: string;
  name: string;
  color: string;
  brightness: number;
  contrast: number;
  blackPoint: number;
}

interface Props {
  /** The image in hand: its whole-image settings are every layer's. */
  photo: Photo;
  /** A separation's plates, top first as the Layers card lists them; none for any other image. */
  channels: Channel[];
  /** The whole image's brightness, contrast and saturation. */
  set: (patch: Partial<Photo>) => void;
  /** One plate's own brightness and contrast, before the whole image's. */
  setChannel: (id: string, patch: { channelBrightness?: number; channelContrast?: number; channelBlackPoint?: number }) => void;
}

/** The black point, as Levels' black slider: tones this dark or darker become full ink, white stays white. */
const blackPoint = (value: number, onChange: (v: number) => void) => (
  <NumberField label="Black" unit="%" min={0} max={MOST_BLACK_POINT} step={5} value={value} onChange={onChange} />
);

/**
 * How light, how contrasty and how colorful the image is read for its lines: the whole image's at
 * the top, every layer alike; then, for separations, each plate's own, put before the whole image's.
 * From -100 to 100, 0 the image as it is: typed, or stepped by 5 with the arrow keys (50 with Shift).
 */
export function AdjustCard({ photo, channels, set, setChannel }: Props) {
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section
          title="Adjustments"
          icon={<SlidersHorizontal />}
          collapsibleKey="photo-adjust"
          actionWhenOpen
          // Folded, the heading says how many channels a separation has: the plates set inside.
          closedAction={channels.length > 0 ? <span className={controls.toolInTitle}>{`${channels.length} ${channels.length === 1 ? "channel" : "channels"}`}</span> : undefined}
        >
          <p className={controls.subheading}>Whole image</p>
          <div className={`${styles.fillRow} ${styles.oneRow}`}>
            <NumberField label="Bright" min={-100} max={100} step={5} value={photo.brightness} onChange={(brightness) => set({ brightness })} />
            <NumberField label="Contrast" min={-100} max={100} step={5} value={photo.contrast} onChange={(contrast) => set({ contrast })} />
            {/* A separation is grayscale: there's no color to saturate. A profile split is made from the colors, so it has. */}
            {(!photo.separation || photo.profile) && <NumberField label="Saturate" min={-100} max={100} step={5} value={photo.saturation ?? 0} onChange={(v) => set({ saturation: v || undefined })} />}
            {/* Separations: tones this dark or darker are full ink, so the shadows punch. */}
            {photo.separation && blackPoint(photo.blackPoint ?? 0, (v) => set({ blackPoint: v || undefined }))}
          </div>
          {/* Black and white is Saturation all the way down: on sets it to -100, off back to the photo's own. */}
          {(!photo.separation || photo.profile) && (
            <Checkbox size="md"
              checked={photo.saturation === -100}
              label="B&W"
              onChange={(e) => set({ saturation: e.target.checked ? -100 : undefined })}
            />
          )}
          {/* Each plate's own, inside Adjustments: folding the card puts these away with it. */}
          {channels.length > 0 && (
          <Section title="Channels" collapsibleKey="photo-adjust-channels" defaultOpen={false}>
            {channels.map((ch) => (
              <div key={ch.id}>
                <p className={controls.subheading}>
                  <span className={styles.bandDot} style={{ background: ch.color }} aria-hidden />
                  {ch.name}
                </p>
                <div className={`${styles.fillRow} ${styles.oneRow}`}>
                  <NumberField label="Bright" min={-100} max={100} step={5} value={ch.brightness} onChange={(v) => setChannel(ch.id, { channelBrightness: v })} />
                  <NumberField label="Contrast" min={-100} max={100} step={5} value={ch.contrast} onChange={(v) => setChannel(ch.id, { channelContrast: v })} />
                  {blackPoint(ch.blackPoint, (v) => setChannel(ch.id, { channelBlackPoint: v }))}
                </div>
              </div>
            ))}
          </Section>
          )}
        </Section>
      </div>
    </Card>
  );
}

/**
 * The Vignette and Mask cards' switches, in a toolbar of their own down the left: each pressed while
 * its card shows. Adjustments' own switch is with Layers'.
 */
export function AdjustToolbar({ vignette, mask, trim, disabled }: { vignette: { on: boolean; toggle: () => void }; mask: { on: boolean; toggle: () => void }; trim: { on: boolean; toggle: () => void }; disabled?: boolean }) {
  return (
    <span className={bar.row}>
      <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label="Vignette, mask and trim marks">
        <SegmentedControl size="sm" variant="dark" actions aria-label="Vignette, mask and trim marks">
          <Segment
            aria-pressed={vignette.on}
            className={vignette.on ? bar.on : undefined}
            onClick={vignette.toggle}
            disabled={disabled}
            icon={<Focus />}
            title={`${vignette.on ? "Hide" : "Show"} the Vignette card: the image darkened toward its edges, or faded toward the paper`}
            aria-label="Vignette card"
          />
          <Segment
            aria-pressed={mask.on}
            className={mask.on ? bar.on : undefined}
            onClick={mask.toggle}
            disabled={disabled}
            icon={<SquareDashed />}
            title={`${mask.on ? "Hide" : "Show"} the Mask card: the image's edges left as paper - a grunge border, a torn edge`}
            aria-label="Mask card"
          />
          <Segment
            aria-pressed={trim.on}
            className={trim.on ? bar.on : undefined}
            onClick={trim.toggle}
            disabled={disabled}
            icon={<Scissors />}
            title={`${trim.on ? "Hide" : "Show"} the Trim marks card: where the print is cut, for the size it's finished at, and the image placed in it`}
            aria-label="Trim marks card"
          />
        </SegmentedControl>
      </Toolbar></ToolbarIcons>
    </span>
  );
}
