import { Segment, SegmentedControl } from "@tomcoggia/ui";
import { Blend, PenTool } from "lucide-react";

export type View = "outline" | "preview";

interface Props {
  view: View;
  onView: (view: View) => void;
}

// How the drawing is drawn, at the left end of the width dimension line, opposite the zoom presets
// and built the same way. Outline is every path as a thin line in its layer's colour, whatever the
// pen: the paths themselves, cheap to draw however many there are. Preview is the ink - the pen's
// real width, how solid it is, how it darkens where strokes cross - which is what the paper will
// show and what a large drawing chokes on. A drawing always opens in Outline; Preview is asked for.
export function ViewControl({ view, onView }: Props) {
  return (
    <SegmentedControl size="sm" aria-label="How the drawing is drawn">
      <Segment
        selected={view === "outline"}
        onClick={() => onView("outline")}
        icon={<PenTool />}
        aria-label="Outline"
        title="Outline: every path as a thin line in its layer's colour - the paths themselves, quick to draw however many there are"
      />
      <Segment
        selected={view === "preview"}
        onClick={() => onView("preview")}
        icon={<Blend />}
        aria-label="Preview"
        title="Preview: the ink - each tool's real width, how solid it is and how it darkens where strokes cross. Slow on a very large drawing"
      />
    </SegmentedControl>
  );
}
