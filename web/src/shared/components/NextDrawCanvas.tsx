import { BedCanvas, type BedCanvasProps } from "./BedCanvas";
import { PreviewToolbar, type PreviewToolbarProps } from "./PreviewToolbar";

interface Props extends Omit<BedCanvasProps, "toolbarLeft" | "zoom" | "loupe"> {
  /**
   * The shared bar on the width line: history where the app has one, how the drawing is drawn, an
   * app's own view controls after those (`extras`), how close the view sits, and the loupe. The bar's
   * zoom and loupe are the canvas's. Left out, a canvas shows no bar - the second of Photo's side by
   * side panes, which follows the first.
   */
  bar?: PreviewToolbarProps;
  /** The zoom and loupe, when there's no bar to take them from. */
  zoom?: BedCanvasProps["zoom"];
  loupe?: boolean;
}

/**
 * The canvas every NextDraw app shows its drawing on, Plot, Studio and Photo alike: the plotter's
 * bed at true scale with the paper on it, the dimension lines, and over them the one bar of view
 * controls. What's the same is here, so the apps can't drift apart; each brings only what's its own -
 * the drawing (`children`), its own controls in the bar (`bar.extras`) and at the line's right end
 * (`toolbar`), and anything it does with the pointer.
 */
export function NextDrawCanvas({ bar, zoom, loupe, ...canvas }: Props) {
  return (
    <BedCanvas
      {...canvas}
      zoom={bar?.zoom ?? zoom ?? "paper"}
      loupe={bar ? bar.loupe : loupe}
      toolbarLeft={bar ? <PreviewToolbar {...bar} /> : undefined}
    />
  );
}
