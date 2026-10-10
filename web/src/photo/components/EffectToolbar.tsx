import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { AudioWaveform, FileText, Image, FingerprintPattern, Hash, LineSquiggle, Signature, Squircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Photo } from "../../shared/lib/drawing/photo";
import bar from "../../shared/components/PreviewToolbar.module.css";

export type Effect = NonNullable<Photo["style"]>;

/**
 * Every way Photo turns a picture into lines, in the order the toolbar stacks them: the tonal ones
 * first, then the ones that trace. Each has its name, its glyph and what it does, for the toolbar's
 * tooltips and the heading of its settings card.
 */
export const EFFECTS: { key: Effect; label: string; icon: ReactNode; about: string }[] = [
  { key: "hatch", label: "Hatching", icon: <Hash />, about: "Lines that cross and fill in as the photo darkens" },
  { key: "waves", label: "Tone lines", icon: <AudioWaveform />, about: "One line along each row, waving harder and tighter where it's darker" },
  { key: "squiggle", label: "Squiggle", icon: <LineSquiggle />, about: "SquiggleDraw's smooth waves, unbroken through white, the rows joinable into one line" },
  { key: "outlines", label: "Outlines", icon: <FingerprintPattern />, about: "The photo traced as contour lines, following its edges and shapes" },
  { key: "centerlines", label: "Centerlines", icon: <Signature />, about: "Each dark stroke of a line drawing drawn once, down its middle, so a ring is one circle" },
  { key: "silhouette", label: "Silhouette", icon: <Squircle />, about: "The line round a shape on white paper - its outline, and each hole in it" },
];

export const effectOf = (photo: Photo): Effect => photo.style ?? "hatch";

/**
 * Photo's left-hand toolbar: one button for each effect, the photo's own pressed. Choosing one draws
 * the whole photo - every layer - that way, and the rail shows that effect's cards. Glyphs only, as
 * a vertical Toolbar draws them; the names are in the tooltips and read out.
 */
export function EffectToolbar({ effect, onEffect, disabled }: { effect?: Effect; onEffect: (effect: Effect) => void; disabled?: boolean }) {
  return (
    <Toolbar tone="white" orientation="vertical" aria-label="Effects">
      <SegmentedControl size="sm" aria-label="Effect">
        {EFFECTS.map((e) => (
          <Segment
            key={e.key}
            selected={e.key === effect}
            icon={e.icon}
            title={`${e.label}: ${e.about}`}
            disabled={disabled}
            onClick={() => e.key !== effect && onEffect(e.key)}
          >
            {e.label}
          </Segment>
        ))}
      </SegmentedControl>
    </Toolbar>
  );
}

/**
 * The toolbar above the effects: which of the rail's cards are out. Each a switch like Setup's, pressed
 * while its card shows: the File card, then the photo's own card.
 */
export function PanelToolbar({ fileCard, onFileCard, infoCard, onInfoCard }: { fileCard: boolean; onFileCard: () => void; infoCard: boolean; onInfoCard: () => void }) {
  return (
    <span className={bar.row}>
      <Toolbar tone="white" orientation="vertical" aria-label="Panels">
        <SegmentedControl size="sm" variant="dark" actions aria-label="Panels">
          <Segment
            aria-pressed={fileCard}
            className={fileCard ? bar.on : undefined}
            onClick={onFileCard}
            icon={<FileText />}
            title={fileCard ? "Hide the File card" : "Show the File card"}
            aria-label="File card"
          />
          <Segment
            aria-pressed={infoCard}
            className={infoCard ? bar.on : undefined}
            onClick={onInfoCard}
            icon={<Image />}
            title={infoCard ? "Hide the photo's card" : "Show the photo's card"}
            aria-label="Photo card"
          />
        </SegmentedControl>
      </Toolbar>
    </span>
  );
}
