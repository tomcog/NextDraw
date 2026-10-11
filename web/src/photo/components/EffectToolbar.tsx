import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { AudioWaveform, FileText, Image, Pen, StickyNote, FingerprintPattern, Hash, Signature, Squircle, ZodiacAquarius } from "lucide-react";
import type { ReactNode } from "react";
import type { Photo } from "../../shared/lib/drawing/photo";
import bar from "../../shared/components/PreviewToolbar.module.css";

export type Effect = NonNullable<Photo["style"]>;

/**
 * Every way Photo turns a picture into lines, in the order the toolbar stacks them: the tonal ones
 * first, then the ones that trace. Each has its name, its glyph and what it does, for the toolbar's
 * tooltips and the heading of its settings card. A retired effect still draws, and still has its
 * card, for drawings saved with it, but has no button unless the photo is drawn that way.
 */
export const EFFECTS: { key: Effect; label: string; icon: ReactNode; about: string; retired?: boolean }[] = [
  { key: "hatch", label: "Hatching", icon: <Hash />, about: "Lines that cross and fill in as the photo darkens" },
  { key: "waves", label: "Tone lines", icon: <AudioWaveform />, about: "One line along each row, waving harder and tighter where it's darker", retired: true }, // Squiggle, lifting in white, does it
  { key: "squiggle", label: "Squiggle", icon: <ZodiacAquarius />, about: "SquiggleDraw's smooth waves, unbroken through white, the rows joinable into one line" },
  { key: "outlines", label: "Outlines", icon: <FingerprintPattern />, about: "The photo traced as contour lines, following its edges and shapes" },
  { key: "centerlines", label: "Centerlines", icon: <Signature />, about: "Each dark stroke of a line drawing drawn once, down its middle, so a ring is one circle" },
  { key: "silhouette", label: "Silhouette", icon: <Squircle />, about: "The line round a shape on white paper - its outline, and each hole in it" },
];

export const effectOf = (photo: Photo): Effect => photo.style ?? "hatch";

/**
 * Photo's left-hand toolbar: one button for each effect, the photo's own pressed. Choosing one draws
 * the whole photo - every layer - that way, and the rail shows that effect's cards; clicking the
 * pressed one again puts its cards away, or brings them back, so the canvas can take their room. Glyphs only, as
 * a vertical Toolbar draws them; the names are in the tooltips and read out.
 */
export function EffectToolbar({ effect, onEffect, onAgain, disabled }: { effect?: Effect; onEffect: (effect: Effect) => void; onAgain: () => void; disabled?: boolean }) {
  return (
    <Toolbar tone="white" orientation="vertical" aria-label="Effects">
      <SegmentedControl size="sm" aria-label="Effect">
        {EFFECTS.filter((e) => !e.retired || e.key === effect).map((e) => (
          <Segment
            key={e.key}
            selected={e.key === effect}
            icon={e.icon}
            title={e.key === effect ? `${e.label}: ${e.about}. Click again to show or hide its cards` : `${e.label}: ${e.about}`}
            disabled={disabled}
            onClick={() => (e.key === effect ? onAgain() : onEffect(e.key))}
          >
            {e.label}
          </Segment>
        ))}
      </SegmentedControl>
    </Toolbar>
  );
}

/** The rail's cards the toolbar above the effects shows and hides, in the order they stack. */
const PANELS = {
  file: { label: "File", icon: <FileText />, what: "the File card" },
  paper: { label: "Paper", icon: <StickyNote />, what: "the Paper card: what the drawing is plotted on" },
  pen: { label: "Pen", icon: <Pen />, what: "the Pen card: what the drawing is plotted with" },
  image: { label: "Photo", icon: <Image />, what: "the photo's card" },
};

/**
 * The toolbar above the effects: which of the rail's cards are out - File, Paper, Pen and the
 * photo's own. Each a switch like Setup's, pressed while its card shows.
 */
export function PanelToolbar({ cards }: { cards: { key: keyof typeof PANELS; on: boolean; toggle: () => void }[] }) {
  return (
    <span className={bar.row}>
      <Toolbar tone="white" orientation="vertical" aria-label="Panels">
        <SegmentedControl size="sm" variant="dark" actions aria-label="Panels">
          {cards.map(({ key, on, toggle }) => (
            <Segment
              key={key}
              aria-pressed={on}
              className={on ? bar.on : undefined}
              onClick={toggle}
              icon={PANELS[key].icon}
              title={`${on ? "Hide" : "Show"} ${PANELS[key].what}`}
              aria-label={`${PANELS[key].label} card`}
            />
          ))}
        </SegmentedControl>
      </Toolbar>
    </span>
  );
}
