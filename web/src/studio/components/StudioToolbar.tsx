import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Eye, EyeDashed, Grid3x3, ImageIcon, Redo2, StickyNote, Undo2 } from "lucide-react";
import type { Zoom } from "../../shared/components/Bed";

/** How the drawing is drawn: its paths as thin lines, or the ink they will make. */
export type View = "outline" | "preview";

interface Props {
  view: View;
  onView: (view: View) => void;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  canDrawing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
}

/**
 * Everything that is true of what is being LOOKED AT, in one bar over the page: what has just been
 * done to the drawing, how it is drawn, and how close the view sits. Figma: the `Toolbar` frame
 * (44:360), which is three groups at a 16 gap inside a 4 inset.
 *
 * Studio's own, not shared with Plot. Plot's preview answers to a plot in progress - what is left to
 * draw, how long it has taken - and those belong beside its zoom rather than in a bar of view
 * settings. When Plot wants this shape it should take the Toolbar and compose its own groups.
 *
 * Three SegmentedControls, as the mock draws them, each keeping the library's own grey well against
 * the white bar. Nothing here overrides the components.
 *
 * Worth knowing rather than worth changing here: the history pair are two actions, so the group
 * carries no selection. A SegmentedControl is a radiogroup, so a screen reader announces it with
 * nothing chosen. That is a question for the library rather than for this file.
 */
export function StudioToolbar({ view, onView, zoom, onZoom, canDrawing, canUndo, canRedo, onUndo, onRedo, disabled }: Props) {
  return (
    <Toolbar tone="white" aria-label="Drawing view">
      <SegmentedControl size="sm" variant="dark" aria-label="History">
        <Segment
          icon={<Undo2 />}
          title="Undo the last change"
          disabled={disabled || !canUndo}
          onClick={onUndo}
        >
          Undo
        </Segment>
        <Segment
          icon={<Redo2 />}
          title="Redo the change just undone"
          disabled={disabled || !canRedo}
          onClick={onRedo}
        >
          Redo
        </Segment>
      </SegmentedControl>

      <SegmentedControl size="sm" variant="dark" aria-label="How the drawing is drawn">
        <Segment
          selected={view === "outline"}
          onClick={() => onView("outline")}
          icon={<EyeDashed />}
          title="Outline: every path as a thin line in its layer's colour - the paths themselves, quick to draw however many there are"
        >
          Outline
        </Segment>
        <Segment
          selected={view === "preview"}
          onClick={() => onView("preview")}
          icon={<Eye />}
          title="Preview: the ink - each tool's real width, how solid it is and how it darkens where strokes cross. Slow on a very large drawing"
        >
          Preview
        </Segment>
      </SegmentedControl>

      <SegmentedControl size="sm" variant="dark" aria-label="Zoom the preview">
        <Segment
          selected={zoom === "plotter"}
          onClick={() => onZoom("plotter")}
          icon={<Grid3x3 />}
          title="Zoom out to the plotter's full drawing area"
        >
          Plotter
        </Segment>
        <Segment
          selected={zoom === "paper"}
          onClick={() => onZoom("paper")}
          icon={<StickyNote />}
          title="Zoom to the paper"
        >
          Paper
        </Segment>
        <Segment
          selected={zoom === "drawing"}
          disabled={!canDrawing}
          onClick={() => onZoom("drawing")}
          icon={<ImageIcon />}
          title="Zoom to the drawing"
        >
          Drawing
        </Segment>
      </SegmentedControl>
    </Toolbar>
  );
}
