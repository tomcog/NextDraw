import { Checkbox, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import styles from "../../../shared/components/controls/controls.module.css";
import { Section } from "../../../shared/components/controls/Section";
import { LengthField } from "../../../shared/components/controls/LengthField";
import { panelIcon } from "../../../shared/components/PanelToolbar";
import { DEFAULT_BLOCKS, DEFAULT_SIGNATURE } from "../../../shared/lib/drawing/plotStamps";
import type { Anchor, ColorBlocks, SignatureMarks, Units } from "../../../shared/lib/types";

interface Props {
  /** The color blocks this print gets, or none. */
  blocks: ColorBlocks | null;
  /** The signature it gets, or none. */
  signature: SignatureMarks | null;
  units: Units;
  busy: boolean;
  /** Why neither can be set, if they can't: said instead of the controls. */
  refused?: string;
  onBlocks: (blocks: ColorBlocks | null) => void;
  onSignature: (signature: SignatureMarks | null) => void;
}

/** What each axis offers, in the words the design note reads them in. */
const PLACES = {
  x: [
    { side: "inside", edge: "left", label: "Inside the left edge" },
    { side: "outside", edge: "left", label: "Outside the left edge" },
    { side: "inside", edge: "right", label: "Inside the right edge" },
    { side: "outside", edge: "right", label: "Outside the right edge" },
  ],
  y: [
    { side: "inside", edge: "top", label: "Inside the top edge" },
    { side: "outside", edge: "top", label: "Outside the top edge" },
    { side: "inside", edge: "bottom", label: "Inside the bottom edge" },
    { side: "outside", edge: "bottom", label: "Outside the bottom edge" },
  ],
} as const;

const keyOf = (a: Anchor) => `${a.side}-${a.edge}`;

/**
 * Where one of them sits on one axis: how far, and from which edge of what. The distance is measured
 * to the two nearest edges, so half an inch outside the bottom is half an inch of gap - which is why
 * it is always a positive length with the direction in words, never a sign.
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
        label={`${label}: which edge`}
        hideLabel
        value={keyOf(anchor)}
        disabled={busy}
        title="Which edge it is measured from, and whether it sits inside that edge or outside it"
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

/** One of them: on or off, where it sits on each axis, and what it is measured against. */
function Placed({ title, hint, on, anchors, units, busy, onChange }: {
  title: string;
  hint: string;
  on: boolean;
  anchors: { x: Anchor; y: Anchor };
  units: Units;
  busy: boolean;
  onChange: (anchors: { x: Anchor; y: Anchor } | null) => void;
}) {
  const from = anchors.x.from;
  return (
    <div className={styles.cardGroup}>
      <Checkbox size="md" checked={on} label={title} title={hint} disabled={busy} onChange={(e) => onChange(e.target.checked ? anchors : null)} />
      {on && (
        <>
          <AnchorRow label="Across" axis="x" anchor={anchors.x} units={units} busy={busy} onChange={(x) => onChange({ ...anchors, x })} />
          <AnchorRow label="Down" axis="y" anchor={anchors.y} units={units} busy={busy} onChange={(y) => onChange({ ...anchors, y })} />
          <SegmentedControl size="sm" variant="dark" aria-label={`${title}: measured from`}>
            {([
              { value: "artwork" as const, label: "Artwork", hint: "Placed against the lines themselves, wherever they reach" },
              { value: "artboard" as const, label: "Artboard", hint: "Placed against the artboard, wherever the lines reach" },
            ]).map(({ value, label, hint: why }) => (
              <Segment
                key={value}
                selected={from === value}
                aria-label={label}
                title={why}
                disabled={busy}
                onClick={() => onChange({ x: { ...anchors.x, from: value }, y: { ...anchors.y, from: value } })}
              >
                {label}
              </Segment>
            ))}
          </SegmentedControl>
        </>
      )}
    </div>
  );
}

/**
 * The signature and the color blocks: what Plot adds to a print as the last step before plotting.
 * Plot's card alone - neither is part of the drawing. They are drawn when it is plotted, so the
 * blocks always say which inks actually went down, in the order they went, and the signature carries
 * the year the print was made. This card holds only where they go; the geometry is made in the page
 * (plotStamps.ts) and they come out the same size on paper whatever size the artwork prints at.
 */
export function SignatureSection({ blocks, signature, units, busy, refused, onBlocks, onSignature }: Props) {
  return (
    <Section title="Signature & blocks" icon={panelIcon("signature")} collapsibleKey="plot-signature">
      {refused ? <p className={styles.hint}>{refused}</p> : <>
        <Placed
          title="Color blocks"
          hint="A block of each ink this print lays down, in the order they go down: a record of what the print is made of"
          on={Boolean(blocks)}
          anchors={blocks ?? DEFAULT_BLOCKS}
          units={units}
          busy={busy}
          onChange={(next) => onBlocks(next)}
        />
        <Placed
          title="Signature"
          hint="The initials and the year the print is made, in their own pen"
          on={Boolean(signature)}
          anchors={signature ?? DEFAULT_SIGNATURE}
          units={units}
          busy={busy}
          onChange={(next) => onSignature(next && { ...(signature ?? {}), ...next })}
        />
      </>}
    </Section>
  );
}
