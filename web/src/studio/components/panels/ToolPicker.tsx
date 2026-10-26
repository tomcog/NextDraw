import { useState } from "react";
import { Segment, SegmentedControl, Toolbar, ToolbarExpander } from "@tomcoggia/ui";
import { LassoSelect, MousePointer2, PenTool, Pentagon, Rainbow, Signal, Spline, SwatchBook, SquareDashedMousePointer, Star, Type, Layers, Vibrate } from "lucide-react";
import { EllipseIcon, LineIcon, RectangleIcon, SignatureIcon, SpiralIcon, SpirographIcon, WaveIcon } from "./toolIcons";
import bar from "../../../shared/components/PreviewToolbar.module.css";
import { load, save } from "../../../shared/lib/storage";
import type { Tool } from "../Canvas";
import type { Shape } from "../../../shared/lib/drawing/shapes";
import { ToolbarIcons } from "../../../shared/components/ToolbarIcons";
import { panelIcon } from "../../../shared/components/PanelToolbar";

/** The tools that pick rather than draw: a group of their own at the head of the Tools bar. */
const PICKERS: Tool[] = ["select", "strokes", "lasso"];

const TOOLS: { kind: Tool; label: string; hint: string; icon: JSX.Element }[] = [
  { kind: "select", label: "Select", hint: "Select (V): drag a shape to move it, its corners to resize", icon: <MousePointer2 /> },
  // Cleanup: single strokes picked out of a layer's paths, for Delete, leaving the paths whole.
  { kind: "strokes", label: "Stroke select", hint: "Stroke select (D): click a stroke, or drag a box over strokes, on the targeted layers - Shift adds. Delete takes them out; their paths stay whole", icon: <SquareDashedMousePointer /> },
  { kind: "lasso", label: "Lasso", hint: "Lasso (Q): draw round strokes on the targeted layers to pick them - Shift adds. Delete takes them out; their paths stay whole", icon: <LassoSelect /> },
  { kind: "rect", label: "Rectangle", hint: "Rectangle (R): drag on the page", icon: <RectangleIcon /> },
  { kind: "ellipse", label: "Ellipse", hint: "Oval (O): drag on the page", icon: <EllipseIcon /> },
  { kind: "line", label: "Line", hint: "Line (L): drag on the page", icon: <LineIcon /> },
  // Parametric shapes: drawn as a box like the rest, then tuned by their numbers in the Curve card.
  { kind: "hypotrochoid", label: "Spirograph", hint: "Draw a spirograph: drag on the page, then set its circles", icon: <SpirographIcon /> },
  { kind: "parabolic", label: "Parabolic curve", hint: "Draw curve stitching: drag on the page, then set its strings", icon: <Signal /> },
  { kind: "polygon", label: "Polygon", hint: "Polygon (P): drag on the page, then set how many sides", icon: <Pentagon /> },
  { kind: "star", label: "Star", hint: "Star (S): drag on the page, then set its points", icon: <Star /> },
  { kind: "spiral", label: "Spiral", hint: "Draw a spiral: drag on the page, then set its turns", icon: <SpiralIcon /> },
  { kind: "arc", label: "Arc", hint: "Arc (A): drag on the page, then set where it starts and how far it goes", icon: <Rainbow /> },
  { kind: "wave", label: "Wave", hint: "Draw a wave: drag on the page, then set how many", icon: <WaveIcon /> },
  { kind: "text", label: "Text", hint: "Text (T): drag to say how tall, then type the words", icon: <Type /> },
];

/** A shape's glyph, for its card: the tool that draws its kind, or for a path, which none does, a curve. */
export function shapeIcon(shape: Shape): JSX.Element | undefined {
  if (shape.kind === "path") return <Spline />;
  // Trim marks are set from their card rather than drawn with a tool: its glyph.
  if (shape.curve?.kind === "trim") return panelIcon("trim");
  const kind = shape.curve?.kind ?? shape.kind;
  return TOOLS.find((t) => t.kind === kind)?.icon;
}

interface Props {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** The Simplifier is the tool in hand: its card is out, and the page picks as Select does. */
  simplifying: boolean;
  onSimplify: () => void;
  /** Jiggle, the same way: its card out, the page picking as Select does. */
  jiggling: boolean;
  onJiggle: () => void;
  /** The Layers card - and the card of the layer being drawn on - is out; its switch heads the tools. */
  layersOut: boolean;
  onLayers: () => void;
  /** Put the signature on the page: TC and this year, on its own layer, ready to move. */
  onSignature: () => void;
  /** Put a registration block for each layer in the page's lower left corner, in plotting order. */
  onRegistration: () => void;
}

/**
 * Studio's toolbars at the left, a glyph each, as Image's effects are. First the Layers switch, its
 * cards out or away; then the tools - those that pick, Select first, then those that make paths: the
 * one pressed is what a drag on the page makes. Last, on its own, the Simplifier, which works on
 * what's drawn from its card. One tool in hand at a time across all of them. The names are in the tooltips.
 */
export function ToolPicker({ tool, onTool, simplifying, onSimplify, jiggling, onJiggle, layersOut, onLayers, onSignature, onRegistration }: Props) {
  // The drawing tools fold away behind their Tool button, open or shut as it was last left.
  const [drawerOpen, setDrawerOpen] = useState(() => load<boolean>("studio-tools-drawer") ?? true);
  const toggleDrawer = (open: boolean) => {
    setDrawerOpen(open);
    save("studio-tools-drawer", open);
  };
  const segment = (t: (typeof TOOLS)[number]) => (
    <Segment key={t.kind} selected={!simplifying && !jiggling && tool === t.kind} icon={t.icon} title={t.hint} onClick={() => onTool(t.kind)}>
      {t.label}
    </Segment>
  );
  return (
    <>
      {/* Not a tool but a switch, like the card switches: the Layers cards out or away. */}
      <span className={bar.row}>
        <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label="Layers">
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
        </Toolbar></ToolbarIcons>
      </span>
      {/* The tools that pick - Select, Stroke select, the Lasso. One tool in hand across these and
          the drawer below. */}
      <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label="Tools">
        <SegmentedControl size="sm" variant="dark" aria-label="Picking tool">
          {TOOLS.filter((t) => PICKERS.includes(t.kind)).map(segment)}
        </SegmentedControl>
      </Toolbar></ToolbarIcons>
      {/* The tools that draw, in a toolbar of their own that opens and shuts from the Tool button at its head. */}
      <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label="Drawing tools">
        <ToolbarExpander size="sm" icon={<PenTool />} label="Tool" open={drawerOpen} onOpenChange={toggleDrawer} aria-label="Drawing tool"
          // On the drawer, which the Tool button takes it from; each tool in it has its own.
          title={drawerOpen ? "Tool: put the drawing tools away" : "Tool: the drawing tools - rectangle, oval, line, the curves and text"}>
          {TOOLS.filter((t) => !PICKERS.includes(t.kind)).map(segment)}
        </ToolbarExpander>
      </Toolbar></ToolbarIcons>
      {/* What works on what's drawn: the Simplifier and Jiggle, from their cards; then what's added at
          once, so actions - the signature and the registration blocks, placed to be moved from there. */}
      <ToolbarIcons><Toolbar tone="white" orientation="vertical" aria-label="Work on the drawing">
        <SegmentedControl size="sm" aria-label="Work on what's drawn">
          <Segment selected={simplifying} icon={<Spline />} title="Simplifier: fewer points in the drawing's paths, set from its card" onClick={onSimplify}>
            Simplifier
          </Segment>
          <Segment selected={jiggling} icon={<Vibrate />} title="Jiggle: the targeted layers' strokes moved a little, set from its card - on a copy, for another pass" onClick={onJiggle}>
            Jiggle
          </Segment>
        </SegmentedControl>
        <SegmentedControl size="sm" variant="dark" actions aria-label="Add">
          <Segment icon={<SignatureIcon />} title="Signature: TC and this year, in the page's bottom right corner on its own Signature layer - drag it where it goes" onClick={onSignature}>
            Signature
          </Segment>
          <Segment icon={<SwatchBook />} title="Registration: a solid block for each layer in the page's lower left corner, left to right in the order they're plotted - again to make them afresh after the layers change" onClick={onRegistration}>
            Registration
          </Segment>
        </SegmentedControl>
      </Toolbar></ToolbarIcons>
    </>
  );
}
