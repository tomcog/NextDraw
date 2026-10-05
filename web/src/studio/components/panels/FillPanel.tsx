import { Button, ButtonRound, Checkbox } from "@tomcoggia/ui";
import { LineStyle, Menu, Target, Waves } from "lucide-react";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";
import { canConnect, fillNumbers, FILL_LABEL, type Fill, type FillKind } from "../../lib/hatch";
import styles from "../../App.module.css";

const FILL_ICON: Record<FillKind, JSX.Element> = {
  hatch: <Menu />,
  concentric: <Target />,
  wavy: <Waves />,
  dashes: <LineStyle />,
};

const FILL_HINT: Record<FillKind, string> = {
  hatch: "Straight lines, the spacing apart",
  concentric: "The shape's own outline stepped inward",
  wavy: "The same lines drawn as waves",
  dashes: "The same lines broken into strokes: lighter, and a pen lift each",
};

export interface FillActions {
  /** Fill the shape, or take its fill away. */
  setHatched: (on: boolean) => void;
  /** Change one pass of the fill, leaving it following the tool's spacing. */
  setAt: (at: number, fill: Fill) => void;
  /** Change one pass of the fill by hand: it keeps its own numbers from then on. */
  setByHand: (at: number, fill: Fill) => void;
  /** Put one pass back on the tool's own spacing. */
  followTool: (at: number, fill: Fill) => void;
  /** Add or take away the second pass, square to the first. */
  setCross: (on: boolean) => void;
  setConnected: (on: boolean) => void;
  setOutline: (on: boolean) => void;
}

interface Props {
  /** The fill's passes: one, or two for a cross-hatch. None while the shape isn't filled. */
  fills: Fill[];
  /** Whether the shape's own outline is drawn as well. */
  outline: boolean;
  actions: FillActions;
}

/** The Hatch settings, for the chosen shape or for a whole selection at once. */
export function FillPanel({ fills, outline, actions }: Props) {
  const first = fills[0];
  const kind = first?.kind ?? "hatch";
  return (
    <>
      <Checkbox
        checked={fills.length > 0}
        label="Fill shape"
        onChange={(e) => actions.setHatched(e.target.checked)}
      />
      {first && (
        <div className={styles.tools} role="group" aria-label="What the fill is made of">
          {(Object.keys(FILL_LABEL) as FillKind[]).map((k) => {
            const on = kind === k;
            return (
              <ButtonRound
                key={k}
                size="sm"
                icon={FILL_ICON[k]}
                className={on ? controls.roundActive : undefined}
                aria-label={FILL_LABEL[k]}
                aria-pressed={on}
                title={FILL_HINT[k]}
                // Both passes of a cross-hatch are the same kind of thing.
                onClick={() => fills.forEach((f, at) => actions.setAt(at, { ...f, kind: k }))}
              />
            );
          })}
        </div>
      )}
      {fills.map((fill, i) => (
        <div key={fill.id} className={styles.fillRow}>
          <NumberField
            label={i === 0 ? "Angle" : "Cross angle"}
            unit="°"
            step={5}
            value={fill.angle}
            onChange={(angle) => actions.setByHand(i, { ...fill, angle })}
          />
          <NumberField
            label="Spacing"
            unit="mm"
            step={0.1}
            min={0.05}
            value={fill.spacingMm}
            onChange={(spacingMm) => actions.setByHand(i, { ...fill, spacingMm })}
          />
        </div>
      ))}
      {/* No sentence saying the spacing was set by hand: the field above says the number,
        and the way back to the tool's own is the only part of it worth the room. */}
      {fills.map((fill, i) => (fill.custom ? (
        <p key={`${fill.id}-note`} className={`${styles.empty} ${styles.fillFollow}`}>
          <Button size="sm" variant="ghost" onClick={() => actions.followTool(i, fill)}>
            Use tool spacing
          </Button>
        </p>
      ) : null))}
      {first && kind === "wavy" && (
        <div className={styles.fillRow}>
          <NumberField
            label="Wave"
            unit="mm"
            step={0.5}
            min={0.2}
            value={fillNumbers(first).waveMm}
            onChange={(waveMm) => fills.forEach((f, at) => actions.setByHand(at, { ...f, waveMm }))}
          />
          <NumberField
            label="Swing"
            unit="mm"
            step={0.25}
            min={0}
            value={fillNumbers(first).swingMm}
            onChange={(swingMm) => fills.forEach((f, at) => actions.setByHand(at, { ...f, swingMm }))}
          />
        </div>
      )}
      {first && kind === "dashes" && (
        <div className={styles.fillRow}>
          <NumberField
            label="Dash"
            unit="mm"
            step={0.5}
            min={0.2}
            value={fillNumbers(first).dashMm}
            onChange={(dashMm) => fills.forEach((f, at) => actions.setByHand(at, { ...f, dashMm }))}
          />
          <NumberField
            label="Gap"
            unit="mm"
            step={0.5}
            min={0.1}
            value={fillNumbers(first).gapMm}
            onChange={(gapMm) => fills.forEach((f, at) => actions.setByHand(at, { ...f, gapMm }))}
          />
        </div>
      )}
      {first && (
        <Checkbox
          checked={fills.length > 1}
          label="Cross-hatch"
          onChange={(e) => actions.setCross(e.target.checked)}
        />
      )}
      {first && canConnect(first) && (
        <Checkbox
          checked={first.connected === true}
          label="Connect ends"
          // Each pass becomes one zigzag stroke, joined along the shape's edge. Both passes
          // of a cross-hatch follow the one switch.
          onChange={(e) => actions.setConnected(e.target.checked)}
        />
      )}
      {/* Only worth asking about while there is a hatch: a shape with no hatch is its
        outline, and nothing else. */}
      {first && (
        <Checkbox
          checked={outline}
          label="Draw the outline too"
          onChange={(e) => actions.setOutline(e.target.checked)}
        />
      )}
    </>
  );
}
