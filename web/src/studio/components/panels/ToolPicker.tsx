import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { AudioWaveform, Circle, LoaderPinwheel, Minus, MousePointer2, Pentagon, Rainbow, Shell, Signal, Spline, Square, Star, Type } from "lucide-react";
import type { Tool } from "../Canvas";

const TOOLS: { kind: Tool; label: string; hint: string; icon: JSX.Element }[] = [
  { kind: "select", label: "Select", hint: "Select (V): drag a shape to move it, its corners to resize", icon: <MousePointer2 /> },
  { kind: "rect", label: "Rectangle", hint: "Rectangle (R): drag on the page", icon: <Square /> },
  { kind: "ellipse", label: "Ellipse", hint: "Oval (O): drag on the page", icon: <Circle /> },
  { kind: "line", label: "Line", hint: "Line (L): drag on the page", icon: <Minus /> },
  // Parametric shapes: drawn as a box like the rest, then tuned by their numbers in the Curve card.
  { kind: "hypotrochoid", label: "Spirograph", hint: "Draw a spirograph: drag on the page, then set its circles", icon: <LoaderPinwheel /> },
  { kind: "parabolic", label: "Parabolic curve", hint: "Draw curve stitching: drag on the page, then set its strings", icon: <Signal /> },
  { kind: "polygon", label: "Polygon", hint: "Polygon (P): drag on the page, then set how many sides", icon: <Pentagon /> },
  { kind: "star", label: "Star", hint: "Star (S): drag on the page, then set its points", icon: <Star /> },
  { kind: "spiral", label: "Spiral", hint: "Draw a spiral: drag on the page, then set its turns", icon: <Shell /> },
  { kind: "arc", label: "Arc", hint: "Arc (A): drag on the page, then set where it starts and how far it goes", icon: <Rainbow /> },
  { kind: "wave", label: "Wave", hint: "Draw a wave: drag on the page, then set how many", icon: <AudioWaveform /> },
  { kind: "text", label: "Text", hint: "Text (T): drag to say how tall, then type the words", icon: <Type /> },
];

interface Props {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** The Simplifier is the tool in hand: its card is out, and the page picks as Select does. */
  simplifying: boolean;
  onSimplify: () => void;
}

/**
 * The shapes that can be drawn, a glyph each in a vertical toolbar of their own at the left, as Photo's
 * effects are: the one pressed is what a drag on the page makes. The names are in the tooltips and read out.
 */
export function ToolPicker({ tool, onTool, simplifying, onSimplify }: Props) {
  return (
    <Toolbar tone="white" orientation="vertical" aria-label="What to draw">
      <SegmentedControl size="sm" aria-label="Tool">
        {TOOLS.map((t) => (
          <Segment key={t.kind} selected={!simplifying && tool === t.kind} icon={t.icon} title={t.hint} onClick={() => onTool(t.kind)}>
            {t.label}
          </Segment>
        ))}
        {/* Not a shape to draw but a tool all the same: it works on what's drawn, from its card. */}
        <Segment selected={simplifying} icon={<Spline />} title="Simplifier: fewer points in the drawing's paths, set from its card" onClick={onSimplify}>
          Simplifier
        </Segment>
      </SegmentedControl>
    </Toolbar>
  );
}
