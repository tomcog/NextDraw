import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Frame, Grid3x3, Image, Layers2, ListOrdered, LocateFixed, Move, Palette, Pen, Save, Shapes, Signature, Slice, SlidersHorizontal, StickyNote, Wrench } from "lucide-react";
import bar from "./PreviewToolbar.module.css";
import { ToolbarIcons } from "./ToolbarIcons";

/** The rail's cards the toolbar shows and hides, in the order they stack. Artboard and Artwork are Studio's and Image's; Grid is Studio's; Image, and Layers and Adjustments (a toolbar of their own), Image's; Queue, Plotter’s marks, and Plot position, Plot options and Utilities (a toolbar of their own), Plot's (Studio's Layers switch is with its tools). `trim`, `blocks` and `signature` are no longer rail buttons of their own - they head the three sections inside the Plotter’s marks card. */
const PANELS = {
  file: { label: "File", icon: <Save />, what: "the File card" },
  pen: { label: "Pen", icon: <Pen />, what: "the Pen card: what the drawing is plotted with" },
  artboard: { label: "Artboard", icon: <Frame />, what: "the Artboard card: the drawing's own size, and the margins the artwork sits inside" },
  artwork: { label: "Artwork", icon: <Shapes />, what: "the Artwork card: turning the artwork, fitting it inside the margins, and its scale" },
  paper: { label: "Paper", icon: <StickyNote />, what: "the Paper card: what the drawing is plotted on" },
  grid: { label: "Grid", icon: <Grid3x3 />, what: "the Grid card: what shapes snap to" },
  image: { label: "Image", icon: <Image />, what: "the image's card" },
  layers: { label: "Layers", icon: <Layers2 />, what: "the Layers card: the image's layers, their colors and order" },
  adjustments: { label: "Adjustments", icon: <SlidersHorizontal />, what: "the Adjustments card: the image's brightness and contrast, and each channel's" },
  queue: { label: "Queue", icon: <ListOrdered />, what: "the Queue card: the drawings waiting to be plotted" },
  position: { label: "Plot position", icon: <Move />, what: "the Plot position card: where the artboard sits on the paper, and the paper on the plotter" },
  options: { label: "Plot options", icon: <SlidersHorizontal />, what: "the Plot options card: how the drawing is plotted" },
  utilities: { label: "Utilities", icon: <Wrench />, what: "the Utilities card: moving the pen and carriage by hand" },
  // Plot's alone, last: these are all drawn when the drawing is plotted, and kept in none of it.
  // One card, because they go on together and come off together, and because they are the three
  // things that grow the box you position on the paper (Tom, 2026-11-24).
  marks: { label: "Plotter’s marks", icon: <LocateFixed />, what: "the Plotter’s marks card: the trim marks, the color blocks and the signature Plot adds to the print" },
  trim: { label: "Trim marks", icon: <Slice />, what: "the trim marks, where the print is cut, round the artboard" },
  blocks: { label: "Color blocks", icon: <Palette />, what: "a block of each ink the print lays down, in the order they go down" },
  signature: { label: "Signature", icon: <Signature />, what: "the initials and the year the print is made" },
};

export type Panel = keyof typeof PANELS;

/** A card's glyph, for its heading: the same as its button here. */
export const panelIcon = (key: Panel) => PANELS[key].icon;

/** A card's switch's tooltip, for an app that puts the switch in a toolbar of its own. */
export const panelTitle = (key: Panel, on: boolean) => `${on ? "Hide" : "Show"} ${PANELS[key].what}`;

/**
 * Shared: which of the rail's cards are out - File, Paper, Pen and whatever is the app's own. Each a
 * switch like Setup's, pressed while its card shows. Under the app switch, in every app.
 */
export function PanelToolbar({ cards, label = "Panels" }: { cards: { key: Panel; on: boolean; toggle: () => void; disabled?: boolean; why?: string }[]; label?: string }) {
  return (
    <span className={bar.row}>
      <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label={label}>
        <SegmentedControl size="sm" variant="dark" actions aria-label={label}>
          {cards.map(({ key, on, toggle, disabled, why }) => (
            <Segment
              key={key}
              aria-pressed={on && !disabled}
              className={on && !disabled ? bar.on : undefined}
              onClick={toggle}
              disabled={disabled}
              icon={PANELS[key].icon}
              title={disabled && why ? `${PANELS[key].label}: ${why}` : `${on ? "Hide" : "Show"} ${PANELS[key].what}`}
              aria-label={`${PANELS[key].label} card`}
            />
          ))}
        </SegmentedControl>
      </Toolbar></ToolbarIcons>
    </span>
  );
}
