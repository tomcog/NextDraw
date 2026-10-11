import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { FileText, Grid3x3, Image, Pen, StickyNote } from "lucide-react";
import bar from "./PreviewToolbar.module.css";

/** The rail's cards the toolbar shows and hides, in the order they stack. Grid is Studio's, Image Image's. */
const PANELS = {
  file: { label: "File", icon: <FileText />, what: "the File card" },
  paper: { label: "Paper", icon: <StickyNote />, what: "the Paper card: what the drawing is plotted on" },
  pen: { label: "Pen", icon: <Pen />, what: "the Pen card: what the drawing is plotted with" },
  grid: { label: "Grid", icon: <Grid3x3 />, what: "the Grid card: what shapes snap to" },
  image: { label: "Image", icon: <Image />, what: "the image's card" },
};

export type Panel = keyof typeof PANELS;

/**
 * Shared: which of the rail's cards are out - File, Paper, Pen and whatever is the app's own. Each a
 * switch like Setup's, pressed while its card shows. Under the app switch, in every app.
 */
export function PanelToolbar({ cards }: { cards: { key: Panel; on: boolean; toggle: () => void }[] }) {
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
