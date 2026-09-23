import type { KeyboardEvent } from "react";
import { Button, ButtonRound, Checkbox, Segment, SegmentedControl } from "@tomcoggia/ui";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, House } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import styles from "./MachinePanel.module.css";
import { STEPS } from "../../shared/lib/constants";
import { fmtLen } from "../../shared/lib/format";
import type { Carriage, Message, PlotterModel, Units } from "../../shared/lib/types";

interface Props {
  model: PlotterModel | undefined;
  units: Units;
  carriage: Carriage | undefined;
  stepIndex: number;
  onStepIndex: (i: number) => void;
  busy: boolean;
  walkSupported: boolean;
  message: Message | null;
  onWalk: (axis: "x" | "y", dir: 1 | -1) => void;
  onHome: () => void;
  onRaise: () => void;
  onLower: () => void;
  onRelease: () => void;
  onSetupHeight: () => void;
  onTestPen: () => void;
  showPenUp: boolean;
  onShowPenUp: (show: boolean) => void;
}

function carriageText(c: Carriage | undefined, model: PlotterModel | undefined, units: Units) {
  let text;
  if (c?.known) {
    const pen = c.pen_up === false ? "pen down" : c.pen_up === true ? "pen up" : "pen unknown";
    text = `Carriage at ${fmtLen(c.x, units)} across, ${fmtLen(c.y, units)} down, ${pen}`;
    if (!c.verified && model?.auto_home) text += ". The first move finds home";
  } else if (c && c.motors_on === false) {
    text = "Carriage released. It will find home before the next move.";
  } else if (c && !c.verified && model?.auto_home) {
    text = "Carriage position not read yet. The first move finds home.";
  } else {
    text = "Carriage position not read yet";
  }
  if (model && !model.auto_home) {
    text += ". This model can’t find home by itself: push the carriage to the home corner before moving it.";
  }
  return text;
}

// Manual pen and carriage controls, collapsed under "Utilities" since they're not needed for every plot.
export function MachinePanel(props: Props) {
  const { busy, walkSupported } = props;
  const walkDisabled = busy || !walkSupported;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, ["x" | "y", 1 | -1]> = {
      ArrowUp: ["y", -1], ArrowDown: ["y", 1], ArrowLeft: ["x", -1], ArrowRight: ["x", 1],
    };
    if (keys[e.key]) {
      e.preventDefault();
      if (!walkDisabled) props.onWalk(...keys[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (!busy) props.onHome();
    }
  };

  return (
    <Section title="Utilities" collapsibleKey="plot-utilities" defaultOpen={false}>
      <section className={styles.panel} aria-label="Pen and carriage">
        <div className={styles.jog} role="group" aria-label="Move the carriage (arrow keys work here)" onKeyDown={onKeyDown}>
          <ButtonRound className={styles.up} size="md" icon={<ArrowUp />} aria-label="Move carriage toward the back" disabled={walkDisabled} onClick={() => props.onWalk("y", -1)} />
          <ButtonRound className={styles.left} size="md" icon={<ArrowLeft />} aria-label="Move carriage left" disabled={walkDisabled} onClick={() => props.onWalk("x", -1)} />
          <ButtonRound className={styles.home} size="md" variant="ghost" icon={<House />} aria-label="Return home" title="Return home" disabled={busy} onClick={props.onHome} />
          <ButtonRound className={styles.right} size="md" icon={<ArrowRight />} aria-label="Move carriage right" disabled={walkDisabled} onClick={() => props.onWalk("x", 1)} />
          <ButtonRound className={styles.down} size="md" icon={<ArrowDown />} aria-label="Move carriage toward the front" disabled={walkDisabled} onClick={() => props.onWalk("y", 1)} />
        </div>

        <div className={styles.side}>
          <div className={styles.stepRow}>
            <span className={styles.stepLabel}>Move by</span>
            <SegmentedControl size="sm" aria-label="Distance per click">
              {STEPS[props.units].map((step, i) => (
                <Segment key={i} selected={props.stepIndex === i} onClick={() => props.onStepIndex(i)}>
                  {`${step} ${props.units}`}
                </Segment>
              ))}
            </SegmentedControl>
          </div>
          <p className={styles.readout}>{carriageText(props.carriage, props.model, props.units)}</p>
          <div className={styles.buttons}>
            <Button size="md" variant="secondary" disabled={busy} onClick={props.onHome} title="Raise the pen and move to the home corner. The next plot will start there.">
              Return home
            </Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={props.onRaise}>Raise pen</Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={props.onLower}>Lower pen</Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={props.onSetupHeight} title="Move the pen holder to the setup height so you can mount a pen with your sizing block">
              Move to setup height
            </Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={props.onTestPen} title="Lower and raise the pen once using the current heights">
              Test pen heights
            </Button>
            <Button size="md" variant="tertiary" disabled={busy} onClick={props.onRelease} title="Raise the pen and turn off the motors so you can move the carriage by hand">
              Release carriage
            </Button>
          </div>
          <Checkbox
            size="md"
            label="Show pen-up movement on the preview"
            checked={props.showPenUp}
            onChange={(e) => props.onShowPenUp(e.target.checked)}
          />
          <p className={styles.status} role="status" aria-live="polite" data-tone={props.message?.tone}>
            {props.message?.text}
          </p>
        </div>
      </section>
    </Section>
  );
}
