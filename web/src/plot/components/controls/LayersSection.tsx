import { useRef, useState } from "react";
import { ButtonRound, LayerController, Segment, SegmentedControl } from "@tomcoggia/ui";
import { Eye, LayersArrowUp, Link2, Link2Off, PenTool, RotateCcw } from "lucide-react";
import styles from "./LayersSection.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { Slider } from "./Slider";
import { PaletteMenu } from "../../../shared/components/controls/PaletteMenu";
import type { LayerView, PenColor } from "../../../shared/lib/types";

interface Props {
  mode: "preview" | "work";
  onMode: (mode: "preview" | "work") => void;
  layers: LayerView[]; // bottom layer (number 1) first, in the drawing's own order
  target: string | null; // id of the layer chosen to print
  /** The layers a layer is linked to print together with (not itself). */
  linksOf: (id: string) => string[];
  /** Link a layer with the others in its pen, so they print together. */
  onLink: (id: string, others: string[]) => void;
  /** Undo the link a layer is in: each layer of it plots on its own again. */
  onUnlink: (id: string) => void;
  printing: string[]; // ids of the layers the next plot draws: the chosen one and those linked to it
  hatchSpacing: Record<string, number>; // hatch spacings chosen in Plot, by layer id, in mm
  /** Fill these layers' Studio hatches at this spacing (mm) when plotting them. */
  onHatch: (ids: string[], mm: number) => void;
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
export function LayersSection({ mode, onMode, layers, target, linksOf, onLink, onUnlink, printing, hatchSpacing, onHatch, printed, disabled, onTarget, onVisible, paletteFor, toolFor, onColor, onSort, onResetPrinted }: Props) {
  // A tool with no palette still lets a layer be recolored: the dot opens the system color picker.
  const pickerRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<LayerView | null>(null);
  const [colorMenu, setColorMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuLayer = colorMenu ? layers.find((l) => l.id === colorMenu.id) : null;
  // In Plot mode the layers held back in Preview mode leave the list, and the eye goes. Numbers stay
  // the plot-order numbers from the full list.
  const numberOf = new Map(layers.map((l, i) => [l.id, i + 1]));
  const rows = [...layers].reverse().filter((l) => mode === "preview" || !l.hidden);
  // The other layers going down in the same pen of the same tool: the ones a layer can be linked with.
  const sameInk = (layer: LayerView) => layers.filter((l) => l.id !== layer.id && l.penKey !== null && l.penKey === layer.penKey);
  // Rows with nothing to link keep the button's room, so the eyes stay lined up down the list.
  const anyLinkable = rows.some((l) => sameInk(l).length > 0);
  // Linked layers next to each other in the list are drawn as one block (Figma 745:521): one print box
  // down the side, with the printer in the top row, and no rule between the rows. Each run of them is
  // keyed by its top row.
  const runTop = new Map<string, string>();
  rows.forEach((l, r) => {
    const above = rows[r - 1];
    runTop.set(l.id, above && linksOf(l.id).includes(above.id) ? runTop.get(above.id)! : l.id);
  });
  const runOf = (top: string) => rows.filter((l) => runTop.get(l.id) === top).map((l) => l.id);
  // The layers about to be plotted that hold Studio hatch fills, whose spacing can be tried out here.
  const hatched = layers.filter((l) => printing.includes(l.id) && l.fill_spacing != null);
  const hatchNow = hatched.length ? hatchSpacing[hatched[0].id] ?? hatched[0].fill_spacing! : null;

  return (
    <Section
      title="Layers"
      collapsibleKey="plot-layers"
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
          const links = linksOf(layer.id);
          const partners = sameInk(layer);
          const numbers = (ids: string[]) => ids.map((id) => numberOf.get(id)).join(", ");
          const run = runOf(runTop.get(layer.id)!);
          const place = run.length < 2 ? undefined : run[0] === layer.id ? "top" : run[run.length - 1] === layer.id ? "bottom" : "middle";
          // The block has one print box, and it's the top row's: it shows the printer when any layer of
          // the block is the one chosen, and the printed mark once all of them are down.
          const isTop = place === undefined || place === "top";
          // The link button is the uppermost same-pen layer's alone: the layers below it in that pen
          // are the ones it gathers, so they show nothing.
          const uppermost = partners.every((l) => !rows.includes(l) || rows.indexOf(l) > rows.indexOf(layer));
          return (
            <li key={layer.id} className={styles.row} data-skipped={layer.skipped} data-linked={place}>
              <LayerController
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
                      // The picker opens where its input is: at the swatch, not the page's corner.
                      const at = e.currentTarget.getBoundingClientRect();
                      input.style.left = `${at.left}px`;
                      input.style.top = `${at.bottom}px`;
                      input.value = layer.color ?? "#808080";
                      input.click();
                    }
                  },
                }}
                name="print-layer"
                checked={isTop && run.includes(target ?? "")}
                printed={isTop && run.every((id) => printed.includes(id))}
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
                  links.length ? `Prints together with ${numbers(links)}` : null,
                ].filter(Boolean).join(" · ") || undefined}
                label={layer.name}
                hideHandle
              />
              {partners.length > 0 && isTop && uppermost ? (
                // Linking takes in every layer in the pen; unlinking undoes the whole link. The glyph is
                // what a click does: a whole link to link them, and once they're linked, a broken one in
                // Primary to unlink them.
                <ButtonRound
                  size="sm"
                  variant="ghost"
                  icon={links.length ? <Link2Off /> : <Link2 />}
                  className={links.length ? styles.linkOn : undefined}
                  aria-pressed={links.length > 0}
                  aria-label={links.length ? `Unlink ${numbers([layer.id, ...links])}` : `Link ${layer.name} with ${numbers(partners.map((l) => l.id))}`}
                  title={links.length
                    ? `Prints together with ${numbers(links)}. Click to plot them one at a time.`
                    : `Print together with ${numbers(partners.map((l) => l.id))}, the same pen - one plot instead of ${partners.length + 1}`}
                  disabled={disabled}
                  onClick={() => (links.length ? onUnlink(layer.id) : onLink(layer.id, partners.map((l) => l.id)))}
                />
              ) : anyLinkable ? (
                <span className={styles.linkSpace} aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      {hatchNow !== null && (
        // For the layer chosen to print: how far apart its Studio fills go down. The best spacing
        // depends on the ink, which only shows on paper, so it's set here, between plots. The drawing
        // keeps its own spacing; this is Plot's, for this drawing.
        <div className={styles.hatch}>
          <Slider
            label="Hatch spacing (mm)"
            value={hatchNow}
            min={0.3}
            max={5}
            step={0.1}
            decimals={2}
            disabled={disabled}
            onChange={(mm) => onHatch(hatched.map((l) => l.id), mm)}
          />
          {Math.abs(hatchNow - hatched[0].fill_spacing!) > 1e-9 && (
            // Typing the drawing's own number back in drops the override.
            <p className={styles.hatchNote}>{`The drawing has ${hatched[0].fill_spacing} mm`}</p>
          )}
        </div>
      )}
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
