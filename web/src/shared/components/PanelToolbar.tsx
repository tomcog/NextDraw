import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Grid3x3, Image, Layers2, ListOrdered, Move, Pen, Save, SlidersHorizontal, StickyNote, Wrench } from "lucide-react";
import bar from "./PreviewToolbar.module.css";

/** The rail's cards the toolbar shows and hides, in the order they stack. Grid is Studio's; Image and Layers Image's; Queue, and Drawing position, Plot options and Utilities (a toolbar of their own), Plot's (Studio's Layers switch is with its tools). */
const PANELS = {
  file: { label: "File", icon: <Save />, what: "the File card" },
  paper: { label: "Paper", icon: <StickyNote />, what: "the Paper card: what the drawing is plotted on" },
  pen: { label: "Pen", icon: <Pen />, what: "the Pen card: what the drawing is plotted with" },
  grid: { label: "Grid", icon: <Grid3x3 />, what: "the Grid card: what shapes snap to" },
  image: { label: "Image", icon: <Image />, what: "the image's card" },
  layers: { label: "Layers", icon: <Layers2 />, what: "the Layers card: the image's layers, their colors and order" },
  queue: { label: "Queue", icon: <ListOrdered />, what: "the Queue card: the drawings waiting to be plotted" },
  position: { label: "Drawing position", icon: <Move />, what: "the Drawing position card: where the drawing sits on the plotter" },
  options: { label: "Plot options", icon: <SlidersHorizontal />, what: "the Plot options card: how the drawing is plotted" },
  utilities: { label: "Utilities", icon: <Wrench />, what: "the Utilities card: moving the pen and carriage by hand" },
};

export type Panel = keyof typeof PANELS;

/**
 * Shared: which of the rail's cards are out - File, Paper, Pen and whatever is the app's own. Each a
 * switch like Setup's, pressed while its card shows. Under the app switch, in every app.
 */
export function PanelToolbar({ cards, label = "Panels" }: { cards: { key: Panel; on: boolean; toggle: () => void; disabled?: boolean; why?: string }[]; label?: string }) {
  return (
    <span className={bar.row}>
      <Toolbar tone="white" orientation="vertical" aria-label={label}>
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
      </Toolbar>
    </span>
  );
}
