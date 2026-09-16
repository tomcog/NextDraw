import { LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Eye, PenTool } from "lucide-react";
import styles from "./LayersSection.module.css";
import { Section } from "./Section";
import type { LayerView } from "../../lib/types";

interface Props {
  mode: "preview" | "work";
  onMode: (mode: "preview" | "work") => void;
  layers: LayerView[]; // bottom layer (number 1) first, in the drawing's own order
  target: string | null; // id of the layer chosen to print
  printed: string[]; // ids of layers plotted to the end this session
  disabled: boolean;
  onTarget: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
}

// The drawing's layers, listed like Illustrator's Layers panel: the top layer at the top and layer 1,
// the bottom layer, last. Read-only, on purpose - the name, the colour and the order are the
// drawing's, made in Studio, and Plot has no business rewriting them. All this card decides is which
// layer goes on the paper next, and which ones to leave out of today's plot.
//
// No grip on a row, either: the order is the drawing's. A grip that can be grabbed and does nothing
// reads as a broken drag rather than as an absent feature.
export function LayersSection({ mode, onMode, layers, target, printed, disabled, onTarget, onVisible }: Props) {
  // In Plot mode the layers held back in Preview mode leave the list, and the eye goes. Numbers stay
  // the plot-order numbers from the full list.
  const numberOf = new Map(layers.map((l, i) => [l.id, i + 1]));
  const rows = [...layers].reverse().filter((l) => mode === "preview" || !l.hidden);

  return (
    <Section
      title="Layers"
      action={
        <SegmentedControl size="sm" aria-label="Layers view">
          <Segment selected={mode === "preview"} onClick={() => onMode("preview")} icon={<Eye />} aria-label="Preview" title="Preview: the whole drawing, and which layers to leave out" />
          <Segment selected={mode === "work"} onClick={() => onMode("work")} icon={<PenTool />} aria-label="Plot" title="Plot: layer by layer - only the layer to print is drawn" />
        </SegmentedControl>
      }
    >
      <ol className={styles.list}>
        {rows.map((layer) => {
          const i = numberOf.get(layer.id)! - 1; // position in the drawing's order
          return (
            <li key={layer.id} className={styles.row} data-skipped={layer.skipped}>
              <LayerController
                name="print-layer"
                number={i + 1}
                color={layer.color ?? "transparent"}
                checked={target === layer.id}
                printed={printed.includes(layer.id)}
                visible={!layer.hidden}
                hideVisibility={mode === "work"}
                onVisibleChange={(visible) => onVisible(layer.id, visible)}
                disabled={disabled}
                onChange={() => onTarget(layer.id)}
                aria-label={`Print layer ${i + 1}, ${layer.name}`}
                label={layer.name}
                hideHandle
              />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
