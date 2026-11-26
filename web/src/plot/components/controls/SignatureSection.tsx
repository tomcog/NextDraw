import { Checkbox, InputSelect } from "@tomcoggia/ui";
import styles from "../../../shared/components/controls/controls.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { LengthField } from "../../../shared/components/controls/LengthField";
import { panelIcon } from "../../../shared/components/PanelToolbar";
import { DEFAULT_BLOCKS, DEFAULT_SIGNATURE } from "../../../shared/lib/drawing/plotStamps";
import type { Anchor, ColorBlocks, SignatureMarks, Units } from "../../../shared/lib/types";

interface Shared {
  units: Units;
  busy: boolean;
  /** Why it can't be set, if it can't: said instead of the controls. */
  refused?: string;
}

interface BlocksProps extends Shared {
  /** The color blocks this print gets, or none. */
  blocks: ColorBlocks | null;
  onBlocks: (blocks: ColorBlocks | null) => void;
}

interface SignatureProps extends Shared {
  /** The signature it gets, or none. */
  signature: SignatureMarks | null;
  onSignature: (signature: SignatureMarks | null) => void;
}

/**
 * What each axis offers, named by the margin it is measured from (Tom, 2026-11-25). Two each, where
 * there were four: across, a mark lines up with the left margin or the right one, always inside the
 * live area, since a block hanging off the side of a print is not a thing anyone wants; down, it
 * sits above the bottom margin or below it, and never against the top - nothing Plot adds belongs at
 * the head of a print. The other six were settings to get wrong.
 */
const PLACES = {
  x: [
    { side: "inside", edge: "left", label: "From left" },
    { side: "inside", edge: "right", label: "From right" },
  ],
  // Below and above, with nothing after them: the margin they are measured from is the only one
  // there is, and the field beside them already says how far (Tom, 2026-11-25).
  y: [
    { side: "outside", edge: "bottom", label: "Below" },
    { side: "inside", edge: "bottom", label: "Above" },
  ],
} as const;

const keyOf = (a: Anchor) => `${a.side}-${a.edge}`;

/**
 * Where one of them sits on one axis: how far, and from which margin. The distance is measured to
 * the two nearest edges, so half an inch below the bottom margin is half an inch of gap - which is
 * why it is always a positive length with the direction in words, never a sign.
 */
function AnchorRow({ label, axis, anchor, units, busy, onChange }: {
  label: string;
  axis: "x" | "y";
  anchor: Anchor;
  units: Units;
  busy: boolean;
  onChange: (anchor: Anchor) => void;
}) {
  return (
    <div className={styles.pairRow}>
      <LengthField label={label} mm={anchor.mm} units={units} min={0} disabled={busy} onChange={(mm) => onChange({ ...anchor, mm })} />
      <InputSelect
        size="md"
        label={`${label}: which margin`}
        hideLabel
        value={keyOf(anchor)}
        disabled={busy}
        title="Which margin it is measured from"
        onChange={(e) => {
          const place = PLACES[axis].find((p) => `${p.side}-${p.edge}` === e.target.value);
          if (place) onChange({ ...anchor, side: place.side, edge: place.edge });
        }}
      >
        {PLACES[axis].map((p) => <option key={p.label} value={`${p.side}-${p.edge}`}>{p.label}</option>)}
      </InputSelect>
    </div>
  );
}

/**
 * One of them: on or off, and where it sits on each axis. What it is measured against was a choice
 * of three - the artwork, the artboard, the margins - until 2026-11-25: the margins are the guides
 * the print was composed to, so everything Plot adds belongs to them, and the other two were a
 * setting to get wrong (Tom). A drawing that stored one of them is read as margins.
 */
function Placed({ title, hint, on, anchors, units, busy, onChange }: {
  title: string;
  hint: string;
  on: boolean;
  anchors: { x: Anchor; y: Anchor };
  units: Units;
  busy: boolean;
  onChange: (anchors: { x: Anchor; y: Anchor } | null) => void;
}) {
  return (
    <div className={styles.cardGroup}>
      <Checkbox size="md" checked={on} label="On" aria-label={title} title={hint} disabled={busy} onChange={(e) => onChange(e.target.checked ? anchors : null)} />
      {on && (
        <>
          <AnchorRow label="Across" axis="x" anchor={anchors.x} units={units} busy={busy} onChange={(x) => onChange({ ...anchors, x })} />
          <AnchorRow label="Down" axis="y" anchor={anchors.y} units={units} busy={busy} onChange={(y) => onChange({ ...anchors, y })} />
        </>
      )}
    </div>
  );
}

/**
 * The color blocks and the signature: two of the three things Plot adds to a print as the last step
 * before plotting, and a section each inside the Plotter's marks card (Tom, 2026-11-24). They were
 * one section called "Signature & blocks"; they are separate decisions, placed separately, and each
 * now folds on its own.
 *
 * Plot's alone - neither is part of the drawing. They are drawn when it is plotted, so the blocks
 * always say which inks actually went down, in the order they went, and the signature carries the
 * year the print was made. These sections hold only where they go; the geometry is made in the page
 * (plotStamps.ts) and they come out the same size on paper whatever size the artwork prints at.
 */
export function BlocksSection({ blocks, units, busy, refused, onBlocks }: BlocksProps) {
  return (
    <Section title="Color blocks" icon={panelIcon("blocks")} collapsibleKey="plot-blocks">
      {refused ? <p className={styles.hint}>{refused}</p> : (
        <Placed
          title="Color blocks"
          hint="A block of each ink this print lays down, in the order they go down: a record of what the print is made of"
          on={Boolean(blocks)}
          anchors={blocks ?? DEFAULT_BLOCKS}
          units={units}
          busy={busy}
          onChange={(next) => onBlocks(next)}
        />
      )}
    </Section>
  );
}

export function SignatureSection({ signature, units, busy, refused, onSignature }: SignatureProps) {
  return (
    <Section title="Signature" icon={panelIcon("signature")} collapsibleKey="plot-signature">
      {refused ? <p className={styles.hint}>{refused}</p> : (
        <Placed
          title="Signature"
          hint="The initials and the year the print is made, in their own pen"
          on={Boolean(signature)}
          anchors={signature ?? DEFAULT_SIGNATURE}
          units={units}
          busy={busy}
          onChange={(next) => onSignature(next && { ...(signature ?? {}), ...next })}
        />
      )}
    </Section>
  );
}
