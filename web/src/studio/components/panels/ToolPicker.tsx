import { ButtonRound, Card } from "@tomcoggia/ui";
import { AudioWaveform, Circle, LoaderPinwheel, Minus, MousePointer2, Pentagon, Rainbow, Shell, Signal, Square, Star, Type } from "lucide-react";
import controls from "../../../shared/components/controls/controls.module.css";
import type { Tool } from "../Canvas";
import styles from "../../App.module.css";

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
}

/** The shapes that can be drawn, a round button each: the one picked is what a drag on the page makes. */
export function ToolPicker({ tool, onTool }: Props) {
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={styles.cardBody}>
        <div className={styles.tools} role="group" aria-label="Shape to draw">
          {TOOLS.map((t) => (
            <ButtonRound
              key={t.kind}
              size="sm"
              icon={t.icon}
              className={tool === t.kind ? controls.roundActive : undefined}
              aria-label={t.label}
              aria-pressed={tool === t.kind}
              title={t.hint}
              onClick={() => onTool(t.kind)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
