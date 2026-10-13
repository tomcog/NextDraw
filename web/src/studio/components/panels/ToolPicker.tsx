import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { AudioWaveform, Circle, LoaderPinwheel, Minus, MousePointer2, Pentagon, Rainbow, Shell, Signal, Spline, Square, Star, Type, Layers } from "lucide-react";
import bar from "../../../shared/components/PreviewToolbar.module.css";
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
  /** The Layers card - and the card of the layer being drawn on - is out; its switch heads the tools. */
  layersOut: boolean;
  onLayers: () => void;
}

/**
 * Studio's toolbars at the left, a glyph each, as Image's effects are. First the Layers switch, its
 * cards out or away; then, on its own, the Simplifier, which works on what's drawn from its card. Last the
 * tools that make paths, under Select, which picks, moves and sizes what's drawn: the one pressed is
 * what a drag on the page makes. One tool in hand at a time across both. The names are in the tooltips.
 */
export function ToolPicker({ tool, onTool, simplifying, onSimplify, layersOut, onLayers }: Props) {
  const segment = (t: (typeof TOOLS)[number]) => (
    <Segment key={t.kind} selected={!simplifying && tool === t.kind} icon={t.icon} title={t.hint} onClick={() => onTool(t.kind)}>
      {t.label}
    </Segment>
  );
  return (
    <>
      {/* Not a tool but a switch, like the card switches: the Layers cards out or away. */}
      <span className={bar.row}>
        <Toolbar tone="white" orientation="vertical" aria-label="Layers">
          <SegmentedControl size="sm" variant="dark" actions aria-label="Layers cards">
            <Segment
              aria-pressed={layersOut}
              className={layersOut ? bar.on : undefined}
              onClick={onLayers}
              icon={<Layers />}
              title={`${layersOut ? "Hide" : "Show"} the Layers card`}
              aria-label="Layers card"
            />
          </SegmentedControl>
        </Toolbar>
      </span>
      <Toolbar tone="white" orientation="vertical" aria-label="Simplifier">
        <SegmentedControl size="sm" aria-label="Simplify">
          <Segment selected={simplifying} icon={<Spline />} title="Simplifier: fewer points in the drawing's paths, set from its card" onClick={onSimplify}>
            Simplifier
          </Segment>
        </SegmentedControl>
      </Toolbar>
      <Toolbar tone="white" orientation="vertical" aria-label="Tools">
        <SegmentedControl size="sm" variant="dark" aria-label="Tool">
          {TOOLS.map(segment)}
        </SegmentedControl>
      </Toolbar>
    </>
  );
}
