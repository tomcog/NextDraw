import type { ReactNode } from "react";
import { Button, ButtonRound, Card, Checkbox } from "@tomcoggia/ui";
import { ArrowDownLeft, ArrowDownRight, ArrowDownToLine, ArrowUpLeft, ArrowUpRight, Ellipsis, FlameKindling, Grid2x2, LineStyle, Orbit, PaintBucket, PaintRoller, Pipette, RotateCw, SquareStack } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";
import { canFill } from "../../../shared/lib/drawing/hatch";
import { closingTurns, CURVE_FIELDS, type Corner, type Curve } from "../../../shared/lib/drawing/parametric";
import { defaultRepeat, placements, REPEAT_FIELDS, type Repeat, type RepeatKind } from "../../../shared/lib/drawing/repeat";
import { pathRuns, POINT_HANDLE_LIMIT, type Shape } from "../../../shared/lib/drawing/shapes";
import styles from "../../App.module.css";

/** Which of the shape's settings are on show, if any: one at a time. */
export type ShapePanel = "simplify" | "fill" | "rotate" | "repeat" | null;

// How a shape repeats, as the row of round buttons in the Repeat card: one of them is always on.
const REPEATS: { kind: RepeatKind; label: string; hint: string; icon: JSX.Element }[] = [
  { kind: "line", label: "Row", hint: "Repeat it in a row, in whatever direction you point it", icon: <Ellipsis /> },
  { kind: "grid", label: "Grid", hint: "Repeat it in rows and columns", icon: <Grid2x2 /> },
  { kind: "ring", label: "Ring", hint: "Repeat it round a circle, with this shape at the top", icon: <Orbit /> },
];

/**
 * Whether a shape still has numbers to give up. Points drawn as the lines between them are already
 * what flattening would leave; a turn and a set of copies are not given up by it, so neither counts.
 */
export const canFlatten = (s: Shape) => !(s.kind === "path" && !s.smooth);

/** Whether the shape card has anything to show for a shape. */
export const hasShapeCard = (s: Shape) => Boolean(s.curve) || canFill(s) || s.kind === "path";

export interface ShapeActions {
  flatten: (id: string) => void;
  setCurve: (curve: Curve) => void;
  split: (id: string) => void;
  simplify: (id: string) => void;
  copyFill: () => void;
  pasteFill: () => void;
  setRotation: (deg: number) => void;
  setRepeat: (repeat: Repeat | undefined) => void;
  bake: (id: string) => void;
}

interface Props {
  shape: Shape;
  title: string;
  busy: boolean;
  /** Whether the shape has a fill to copy, and whether there is a copied one to paste. */
  hasFill: boolean;
  canPaste: boolean;
  panel: ShapePanel;
  onPanel: (which: Exclude<ShapePanel, null>) => void;
  /** The fill's settings, shown under the Hatch button while it's open. */
  fillPanel: ReactNode;
  simplifyMm: number;
  onSimplifyMm: (mm: number) => void;
  actions: ShapeActions;
}

/**
 * What the shape itself is made of: the numbers that draw it, and what can be done to it - simplified,
 * hatched, turned, repeated. Named after the shape it is about.
 */
export function ShapeCard({ shape, title, busy, hasFill, canPaste, panel, onPanel, fillPanel, simplifyMm, onSimplifyMm, actions }: Props) {
  const simplifying = panel === "simplify";
  const filling = panel === "fill";
  const repeating = panel === "repeat";
  const rotating = panel === "rotate";
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        {/* Named after the shape it is about, which is what the card is: the chosen shape,
          and what can be done to it. The fold is remembered under one key all the same. */}
        <Section
          title={title}
          collapsibleKey="shape"
          // Beside the shape's name rather than in the row below it: every button in that
          // row opens something to adjust, and this one is done the moment it is pressed.
          // Anything still made of numbers can be flattened, so the button stands here for
          // every kind of shape rather than being repeated inside each one's settings.
          action={canFlatten(shape) ? (
            <ButtonRound
              size="sm"
              icon={<ArrowDownToLine />}
              aria-label="Flatten path"
              title="Flatten: the numbers behind this path are given up and it becomes points to drag. Its turn and its copies are left as they are."
              onClick={() => actions.flatten(shape.id)}
            />
          ) : undefined}
        >
          {/* No flatten of its own: giving up these numbers is what Flatten does, and the
            card says that once, beside the shape's name, for every kind of shape. */}
          {shape.curve && (
            <Section title="Curve" collapsibleKey="curve">
              <div className={styles.fillRow}>
                {CURVE_FIELDS[shape.curve.kind].map((f) => (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    unit={f.unit}
                    value={Number((shape.curve as unknown as Record<string, number>)[f.key])}
                    onChange={(v) => actions.setCurve({ ...(shape.curve as Curve), [f.key]: v } as Curve)}
                  />
                ))}
              </div>
              {shape.curve.kind === "parabolic" && (() => {
                // Which corners the strings are drawn from: any of the four, set out as they sit on the
                // box. Each toggles on its own; the last one on can't be turned off, or there'd be nothing.
                const curve = shape.curve;
                const corner = (k: Corner, icon: JSX.Element, name: string) => {
                  const on = curve.corners.includes(k);
                  return (
                    <ButtonRound
                      size="sm"
                      icon={icon}
                      className={on ? controls.roundActive : undefined}
                      aria-label={name}
                      aria-pressed={on}
                      title={on ? `${name}: drawn from this corner` : `${name}: draw from this corner too`}
                      disabled={busy || (on && curve.corners.length === 1)}
                      onClick={() => actions.setCurve({ ...curve, corners: on ? curve.corners.filter((c) => c !== k) : [...curve.corners, k] })}
                    />
                  );
                };
                return (
                  <div className={styles.cornerPick}>
                    <span className={styles.cornerLabel}>Corners</span>
                    <div className={styles.cornerGrid} role="group" aria-label="Corners to draw from">
                      {corner("tl", <ArrowUpLeft />, "Top left")}
                      {corner("tr", <ArrowUpRight />, "Top right")}
                      {corner("bl", <ArrowDownLeft />, "Bottom left")}
                      {corner("br", <ArrowDownRight />, "Bottom right")}
                    </div>
                  </div>
                );
              })()}
              {shape.curve.kind === "hypotrochoid" && (() => {
                // Past this it retraces itself, and a retraced line is a line the pen draws twice. With the
                // offset changing, each pass lands apart from the last, so it's how long one pass takes.
                const closes = closingTurns(shape.curve);
                const drifting = Boolean(shape.curve.drift);
                return (
                  <p className={styles.empty}>
                    {closes == null
                      ? "Doesn’t close within 1,000 turns"
                      : drifting
                        ? `One pass every ${closes} ${closes === 1 ? "turn" : "turns"} - the changing offset keeps them apart`
                        : `Closes after ${closes} ${closes === 1 ? "turn" : "turns"}`}
                  </p>
                );
              })()}
            </Section>
          )}

          {(shape.runs?.length ?? 0) > 1 && (
            <Button size="md" variant="secondary" onClick={() => actions.split(shape.id)}>
              {`Split into ${shape.runs?.length} paths`}
            </Button>
          )}
          <div className={styles.tools} role="group" aria-label="What is done to this shape">
            {/* Simplify keeps its button here rather than in the row's menu: it opens a
              tolerance to type, and you come back to it until the points are where you
              want them. */}
            {shape.kind === "path" && (
              <ButtonRound
                size="sm"
                icon={<LineStyle />}
                className={simplifying ? controls.roundActive : undefined}
                aria-label="Simplify"
                aria-expanded={simplifying}
                aria-pressed={simplifying}
                title="Simplify: take out the points the path can do without"
                onClick={() => onPanel("simplify")}
              />
            )}
            {/* Only a shape with an inside can be hatched. */}
            {canFill(shape) && (
              <ButtonRound
                size="sm"
                icon={<PaintBucket />}
                className={filling ? controls.roundActive : undefined}
                aria-label="Hatch"
                aria-expanded={filling}
                aria-pressed={filling}
                title="Hatch: fill this path with lines, and set how they run"
                onClick={() => onPanel("fill")}
              />
            )}
            {/* Copy a shape's fill, then paste it onto another: a fill set up once, used again. */}
            {hasFill && (
              <ButtonRound
                size="sm"
                icon={<Pipette />}
                aria-label="Copy fill"
                title="Copy fill: pick up this path's fill, to paste onto another path"
                disabled={busy}
                onClick={actions.copyFill}
              />
            )}
            {canFill(shape) && canPaste && (
              <ButtonRound
                size="sm"
                icon={<PaintRoller />}
                aria-label="Paste fill"
                title="Paste fill: give this path the fill you copied, in place of its own"
                disabled={busy}
                onClick={actions.pasteFill}
              />
            )}
            {/* One button per thing that can be done to a shape as a whole, each opening its
              own settings: how far it is turned, and how many of it there are. */}
            <ButtonRound
              size="sm"
              icon={<RotateCw />}
              className={rotating ? controls.roundActive : undefined}
              aria-label="Rotate"
              aria-expanded={rotating}
              aria-pressed={rotating}
              title="Rotate: turn this path about the middle of its box"
              onClick={() => onPanel("rotate")}
            />
            <ButtonRound
              size="sm"
              icon={<SquareStack />}
              className={repeating ? controls.roundActive : undefined}
              aria-label="Repeat"
              aria-expanded={repeating}
              aria-pressed={repeating}
              title="Repeat: draw this path more than once, in a row, a grid or a ring"
              onClick={() => onPanel("repeat")}
            />
          </div>

          {shape.kind === "path" && simplifying && (() => {
            const points = pathRuns(shape).reduce((n, r) => n + r.length, 0);
            return (
              <>
                <div className={styles.fillRow}>
                  <Button size="md" variant="secondary" onClick={() => actions.simplify(shape.id)}>
                    Simplify
                  </Button>
                  <NumberField
                    label="Within"
                    unit="mm"
                    min={0.01}
                    max={10}
                    step={0.05}
                    value={simplifyMm}
                    onChange={onSimplifyMm}
                  />
                </div>
                <p className={styles.empty}>
                  {`${points} point${points === 1 ? "" : "s"}${points > POINT_HANDLE_LIMIT ? " - too many to drag one by one" : ""}`}
                </p>
              </>
            );
          })()}

          {canFill(shape) && filling && fillPanel}
          {rotating && (
            <NumberField
              label="Rotation"
              unit="°"
              step={5}
              value={shape.rotation ?? 0}
              onChange={actions.setRotation}
            />
          )}

          {repeating && (
            <>
              {/* Whether there is more than one of it, then how they are laid out - the same two
                questions in the same order as a fill, which asks whether the shape is filled
                before it asks what the filling is made of. A row is the plainest of the three,
                so that is what ticking the box gives you to adjust. */}
              <Checkbox
                checked={!!shape.repeat}
                label="Duplicate"
                onChange={(e) => actions.setRepeat(e.target.checked ? defaultRepeat("line", shape) : undefined)}
              />
              {shape.repeat && (
                <div className={styles.tools} role="group" aria-label="How this shape repeats">
                  {REPEATS.map((r) => {
                    const on = shape.repeat?.kind === r.kind;
                    return (
                      <ButtonRound
                        key={r.label}
                        size="sm"
                        icon={r.icon}
                        className={on ? controls.roundActive : undefined}
                        aria-label={r.label}
                        aria-pressed={on}
                        title={r.hint}
                        onClick={() => actions.setRepeat(defaultRepeat(r.kind, shape))}
                      />
                    );
                  })}
                  {/* At the end of the row that made the copies: the one thing that gives them up
                    and leaves each as a shape of its own. */}
                  <ButtonRound
                    size="sm"
                    icon={<FlameKindling />}
                    aria-label="Bake the copies"
                    title={`Bake: all ${placements(shape).length} copies become paths of their own, each still made of its own numbers`}
                    onClick={() => actions.bake(shape.id)}
                  />
                </div>
              )}
              {shape.repeat && (
                <div className={styles.fillRow}>
                  {REPEAT_FIELDS[shape.repeat.kind].map((f) => (
                    <NumberField
                      key={f.key}
                      label={f.label}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      unit={f.unit}
                      value={Number((shape.repeat as unknown as Record<string, number>)[f.key])}
                      onChange={(v) => actions.setRepeat({ ...(shape.repeat as Repeat), [f.key]: v } as Repeat)}
                    />
                  ))}
                </div>
              )}
              {shape.repeat?.kind === "ring" && (
                <Checkbox
                  checked={shape.repeat.facing}
                  label="Turn each copy to face out"
                  onChange={(e) => actions.setRepeat({ ...(shape.repeat as Repeat), facing: e.target.checked } as Repeat)}
                />
              )}
            </>
          )}
        </Section>
      </div>
    </Card>
  );
}
