import { useRef, useState } from "react";
import { ButtonRound, LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Eye, LayersArrowUp, PenTool, RotateCcw } from "lucide-react";
import styles from "./LayersSection.module.css";
import { Section } from "./Section";
import { PaletteMenu } from "./PaletteMenu";
import type { LayerView, PenColor } from "../../lib/types";

interface Props {
  mode: "preview" | "work";
  onMode: (mode: "preview" | "work") => void;
  layers: LayerView[]; // bottom layer (number 1) first, in the drawing's own order
  target: string | null; // id of the layer chosen to print
  printed: string[]; // ids of layers plotted to the end this session
  disabled: boolean;
  onTarget: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
  /** The pens of the layer's drawing tool; empty means the dot opens the system color picker. */
  paletteFor: (id: string) => PenColor[];
  /** The name of the drawing tool a layer is plotted with, for saying which palette a colour is off. */
  toolFor: (id: string) => string;
  /**
   * The ink to plot this layer in: a pen of its tool's palette, a colour picked by hand, or null to
   * hand the layer back to the colour the drawing gives it. A pen is reported as the pen itself, not
   * as its colour, so the layer goes on following it when the palette is edited.
   */
  onColor: (id: string, pick: { pen: PenColor } | { hex: string } | null) => void;
  /** Restack lightest-first, so the darks go over them. */
  onSort: () => void;
  /** Forget which layers have been plotted - a new sheet, or a run being started over. */
  onResetPrinted: () => void;
}

// The drawing's layers, listed like Illustrator's Layers panel: the top layer at the top and layer 1,
// the bottom layer, last. Read-only, on purpose - the name, the colour and the order are the
// drawing's, made in Studio, and Plot has no business rewriting them. All this card decides is which
// layer goes on the paper next, and which ones to leave out of today's plot.
//
// No grip on a row, either: the order is the drawing's. A grip that can be grabbed and does nothing
// reads as a broken drag rather than as an absent feature.
export function LayersSection({ mode, onMode, layers, target, printed, disabled, onTarget, onVisible, paletteFor, toolFor, onColor, onSort, onResetPrinted }: Props) {
  // A tool with no palette still lets a layer be recolored: the dot opens the system color picker.
  const pickerRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<LayerView | null>(null);
  const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuLayer = colorMenu ? layers.find((l) => l.id === colorMenu.id) : null;
  // In Plot mode the layers held back in Preview mode leave the list, and the eye goes. Numbers stay
  // the plot-order numbers from the full list.
  const numberOf = new Map(layers.map((l, i) => [l.id, i + 1]));
  const rows = [...layers].reverse().filter((l) => mode === "preview" || !l.hidden);

  return (
    <Section
      title="Layers"
      action={
        <span className={styles.headerTools}>
        {printed.length > 0 && (
          // Only worth offering once something has been printed, which is also the only time it says
          // anything: with nothing marked, a reset would be a button that does nothing visible.
          <ButtonRound
            size="sm"
            icon={<RotateCcw />}
            aria-label="Clear printed marks"
            title="Clear the printed marks: none of these layers counts as plotted any more"
            disabled={disabled}
            onClick={onResetPrinted}
          />
        )}
        {mode === "preview" && layers.length > 1 && (
          <ButtonRound
            size="sm"
            icon={<LayersArrowUp />}
            aria-label="Sort layers by darkness"
            title="Sort by darkness: the lightest ink is layer 1 and plots first, with darker inks over it"
            disabled={disabled}
            onClick={onSort}
          />
        )}
        <SegmentedControl size="sm" aria-label="Layers view">
          <Segment selected={mode === "preview"} onClick={() => onMode("preview")} icon={<Eye />} aria-label="Preview" title="Preview: the whole drawing, and which layers to leave out" />
          <Segment selected={mode === "work"} onClick={() => onMode("work")} icon={<PenTool />} aria-label="Plot" title="Plot: layer by layer - only the layer to print is drawn" />
        </SegmentedControl>
        </span>
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
                // A colour no pen of this tool can draw is struck through on the dot itself, because
                // the dot is the thing making the claim. Usually it's the drawing's own colour, made
                // in Studio with another tool: the preview shows it, and nothing in the holder will.
                swatchCut={layer.inPalette === false}
                swatchProps={{
                  "aria-label": layer.inPalette === false
                    ? `Ink for ${layer.name} - no ${toolFor(layer.id)} pen draws this colour`
                    : `Ink for ${layer.name}`,
                  ...(paletteFor(layer.id).length
                    ? { "aria-haspopup": "menu" as const, "aria-expanded": colorMenu?.id === layer.id, title: "Choose the ink to plot this layer in" }
                    : { title: "Pick the ink to plot this layer in" }),
                  disabled,
                  onClick: (e) => {
                    if (paletteFor(layer.id).length) {
                      const anchor = e.currentTarget;
                      setColorMenu((open) => (open?.id === layer.id ? null : { id: layer.id, anchor }));
                      return;
                    }
                    // No palette for this tool: straight to the color picker, on the click itself so
                    // the browser counts it as the gesture that opened it.
                    setPicking(layer);
                    const input = pickerRef.current;
                    if (input) {
                      input.value = layer.color ?? "#808080";
                      input.click();
                    }
                  },
                }}
                checked={target === layer.id}
                printed={printed.includes(layer.id)}
                visible={!layer.hidden}
                hideVisibility={mode === "work"}
                onVisibleChange={(visible) => onVisible(layer.id, visible)}
                disabled={disabled}
                onChange={() => onTarget(layer.id)}
                aria-label={`Print layer ${i + 1}, ${layer.name}`}
                // Choosing an ink renames the layer to it, so this list reads as the pens to load.
                // The drawing's own name is kept on the row as its title, for telling which layer of
                // the drawing you're looking at when the two differ.
                title={[
                  layer.ownName !== layer.name ? `${layer.ownName} in the drawing` : null,
                  layer.inPalette === false ? `No ${toolFor(layer.id)} pen draws ${layer.color ?? "this colour"}` : null,
                ].filter(Boolean).join(" · ") || undefined}
                label={layer.name}
                hideHandle
              />
            </li>
          );
        })}
      </ol>
      <input
        ref={pickerRef}
        type="color"
        className={styles.hiddenPicker}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          // Landing back on the drawing's own colour means there's no choice to record, the same as
          // picking "The drawing's own" from the palette - otherwise the file carries an override
          // that says nothing.
          if (!picking) return;
          const chosen = e.target.value.toLowerCase();
          onColor(picking.id, chosen === picking.ownColor?.toLowerCase() ? null : { hex: chosen });
        }}
      />
      {colorMenu && menuLayer && (
        <PaletteMenu
          anchor={colorMenu.anchor}
          palette={paletteFor(menuLayer.id)}
          current={menuLayer.color}
          own={menuLayer.ownColor}
          onPick={(pen) => onColor(menuLayer.id, pen.color === menuLayer.ownColor ? null : { pen })}
          onClose={() => setColorMenu(null)}
        />
      )}
    </Section>
  );
}
