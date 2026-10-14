import { Card, Checkbox, Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Focus, SlidersHorizontal } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import bar from "../../shared/components/PreviewToolbar.module.css";
import { MOST_BLACK_POINT, type Photo } from "../../shared/lib/drawing/photo";
import styles from "../App.module.css";

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
  <NumberField label="Black point" unit="%" min={0} max={MOST_BLACK_POINT} step={5} value={value} onChange={onChange} />
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
        <Section title="Adjustments" collapsibleKey="photo-adjust">
          <p className={controls.subheading}>Whole image</p>
          <div className={`${styles.fillRow} ${styles.oneRow}`}>
            <NumberField label="Brightness" min={-100} max={100} step={5} value={photo.brightness} onChange={(brightness) => set({ brightness })} />
            <NumberField label="Contrast" min={-100} max={100} step={5} value={photo.contrast} onChange={(contrast) => set({ contrast })} />
            {/* A separation is grayscale: there's no color to saturate. A profile split is made from the colors, so it has. */}
            {(!photo.separation || photo.profile) && <NumberField label="Saturation" min={-100} max={100} step={5} value={photo.saturation ?? 0} onChange={(v) => set({ saturation: v || undefined })} />}
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
        </Section>
        {channels.length > 0 && (
          <Section title="Channels" collapsibleKey="photo-adjust-channels">
            {channels.map((ch) => (
              <div key={ch.id}>
                <p className={controls.subheading}>
                  <span className={styles.bandDot} style={{ background: ch.color }} aria-hidden />
                  {ch.name}
                </p>
                <div className={`${styles.fillRow} ${styles.oneRow}`}>
                  <NumberField label="Brightness" min={-100} max={100} step={5} value={ch.brightness} onChange={(v) => setChannel(ch.id, { channelBrightness: v })} />
                  <NumberField label="Contrast" min={-100} max={100} step={5} value={ch.contrast} onChange={(v) => setChannel(ch.id, { channelContrast: v })} />
                  {blackPoint(ch.blackPoint, (v) => setChannel(ch.id, { channelBlackPoint: v }))}
                </div>
              </div>
            ))}
          </Section>
        )}
      </div>
    </Card>
  );
}

/**
 * The Adjustments and Vignette cards' switches, in a toolbar of their own down the left: each pressed
 * while its card shows.
 */
export function AdjustToolbar({ on, toggle, vignette, disabled }: { on: boolean; toggle: () => void; vignette: { on: boolean; toggle: () => void }; disabled?: boolean }) {
  return (
    <span className={bar.row}>
      <Toolbar tone="white" orientation="vertical" aria-label="Adjustments">
        <SegmentedControl size="sm" variant="dark" actions aria-label="Adjustments">
          <Segment
            aria-pressed={on}
            className={on ? bar.on : undefined}
            onClick={toggle}
            disabled={disabled}
            icon={<SlidersHorizontal />}
            title={`${on ? "Hide" : "Show"} the Adjustments card: the image's brightness and contrast, and each channel's`}
            aria-label="Adjustments card"
          />
          <Segment
            aria-pressed={vignette.on}
            className={vignette.on ? bar.on : undefined}
            onClick={vignette.toggle}
            disabled={disabled}
            icon={<Focus />}
            title={`${vignette.on ? "Hide" : "Show"} the Vignette card: the image darkened toward its edges, or faded toward the paper`}
            aria-label="Vignette card"
          />
        </SegmentedControl>
      </Toolbar>
    </span>
  );
}
