import { useEffect, useRef, useState } from "react";
import { Button, Card, Checkbox, InputSelect } from "@tomcoggia/ui";
import { SquareDashed } from "lucide-react";
import { api } from "../../shared/lib/api";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import { MASK_SIDES, type Photo } from "../../shared/lib/drawing/photo";
import { EDGE_FIELDS, EDGE_STYLES, MOST_VARY, newEdge, newSeed, type EdgeStyle } from "../../shared/lib/drawing/edgeMask";
import type { PhotoActions } from "./PhotoCard";
import styles from "../App.module.css";

interface Props {
  /** The image in hand: its mask is every layer's. */
  photo: Photo;
  busy: boolean;
  /** Layers the image is drawn in: Vary by layer only means something with more than one. */
  layerCount: number;
  actions: PhotoActions;
}

/**
 * The edge mask: a grunge border, a torn edge; where it's paper the image is left bare, before any
 * effect reads it. Either made here - a preset's look, its numbers to change, New edge for another of
 * the same - or a saved picture from the library, of which the drawing keeps a copy. On, its controls;
 * off, none of them and no mask on the image, so a mask never stays on out of sight in the card.
 */
export function MaskCard({ photo, busy, layerCount, actions }: Props) {
  const maskInput = useRef<HTMLInputElement>(null);
  // The edge mask library, shared between Macs; read when the card opens and after each change to it.
  const [masks, setMasks] = useState<string[]>([]);
  const readMasks = () => api<{ masks: string[] }>("/api/edge-masks").then((r) => setMasks(r.masks)).catch(() => {});
  useEffect(() => { readMasks(); }, []);
  // A mask this drawing carries that isn't in the library: added before there was one, or taken out since.
  const ownMask = Boolean(photo.edgeMask) && !masks.includes(photo.edgeMaskName ?? "");
  // On while the image has a mask, or once ticked to choose one.
  const hasMask = Boolean(photo.edgeMask || photo.edgeGen);
  const [maskOpen, setMaskOpen] = useState(false);
  const masking = maskOpen || hasMask;
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section title="Mask" icon={<SquareDashed />} collapsibleKey="photo-mask">
          <Checkbox size="md"
            checked={masking}
            label="On"
            title="Leave the image's edges as paper: a grunge border, a torn edge"
            onChange={(e) => {
              setMaskOpen(e.target.checked);
              if (!e.target.checked && hasMask) actions.chooseEdgeMask(undefined);
            }}
          />
          {masking && (
            <>
              <InputSelect
                size="md"
                label="Edge mask"
                value={photo.edgeGen ? `gen:${photo.edgeGen.style}` : !photo.edgeMask ? "" : ownMask ? "__own__" : photo.edgeMaskName}
                disabled={busy}
                title="Leave the image's edges as paper: a made edge, new each time you ask, or a saved mask picture"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("gen:")) actions.setEdgeGen({ ...newEdge(v.slice(4) as EdgeStyle), vary: photo.edgeGen?.vary });
                  else if (v !== "__own__") actions.chooseEdgeMask(v || undefined);
                }}
              >
                <option value="">None</option>
                <optgroup label="Made">
                  {EDGE_STYLES.map((st) => <option key={st.key} value={`gen:${st.key}`}>{st.label}</option>)}
                </optgroup>
                {(ownMask || masks.length > 0) && (
                  <optgroup label="Saved">
                    {ownMask && <option value={"__own__"}>{`${photo.edgeMaskName ?? "Edge mask"} (this drawing's own)`}</option>}
                    {masks.map((name) => <option key={name} value={name}>{name}</option>)}
                  </optgroup>
                )}
              </InputSelect>
              {photo.edgeGen && (() => {
                const gen = photo.edgeGen;
                return (
                  <>
                    <div className={styles.fillRow}>
                      <Button size="sm" variant="secondary" disabled={busy} title="Another edge with the same look" onClick={() => actions.setEdgeGen({ ...gen, seed: newSeed() })}>
                        New edge
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} title={`Put the numbers back to ${EDGE_STYLES.find((st) => st.key === gen.style)?.label}'s, keeping this edge`} onClick={() => actions.setEdgeGen({ ...newEdge(gen.style), seed: gen.seed, vary: gen.vary })}>
                        Reset
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} title="Keep this edge in the edge masks, as a picture to use again" onClick={() => actions.saveEdgeGen(masks).then(readMasks)}>
                        Save…
                      </Button>
                    </div>
                    <div className={styles.fillRow}>
                      {EDGE_FIELDS.map((f) => (
                        <div key={f.key} title={f.about}>
                          <NumberField label={f.label} unit={f.unit} min={f.min} max={f.max} step={f.step} value={gen[f.key]} onChange={(v) => actions.setEdgeGen({ ...gen, [f.key]: v })} />
                        </div>
                      ))}
                      {/* Each layer its own slight variation on the edge, so the colours' borders sit
                        close without lining up exactly. Only with more than one layer to vary. */}
                      {layerCount > 1 && (
                        <div title="Give each layer its own slight variation on this edge: every number nudged up or down by up to this much, differently for each layer. 0 is the same edge on every layer">
                          <NumberField label="Vary by layer" unit="%" min={0} max={MOST_VARY} step={1} value={gen.vary ?? 0} onChange={(v) => actions.setEdgeGen({ ...gen, vary: v > 0 ? v : undefined })} />
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
              <div className={styles.fillRow}>
                <Button size="sm" variant="secondary" disabled={busy} title="Add a picture to the edge masks - black border, white middle - and lay it over this image" onClick={() => maskInput.current?.click()}>
                  Load image mask…
                </Button>
                {photo.edgeMask && (
                  <Checkbox size="md"
                    checked={Boolean(photo.edgeMaskInvert)}
                    label="Invert"
                    title="Read the mask the other way: white is paper, black keeps the image"
                    onChange={(e) => actions.set({ edgeMaskInvert: e.target.checked || undefined })}
                  />
                )}
                {photo.edgeMask && !ownMask && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    title="Take this mask out of the edge masks. Drawings that use it keep it"
                    onClick={() => {
                      const name = photo.edgeMaskName!;
                      if (window.confirm(`Take “${name}” out of the edge masks? Drawings that use it keep it.`)) actions.deleteEdgeMask(name).then(readMasks);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
              {/* Which sides it works on: a drawing that bleeds off only one or two edges is masked
                on those, and the others left as they are. Two to a row: Top and Right, then Left and Bottom. */}
              {(photo.edgeMask || photo.edgeGen) && (
                <div className={styles.fillRow}>
                  {(["top", "right", "left", "bottom"] as const).map((side) => {
                    const sides = photo.edgeMaskSides ?? MASK_SIDES;
                    return (
                      <Checkbox size="md"
                        key={side}
                        checked={sides.includes(side)}
                        label={side[0].toUpperCase() + side.slice(1)}
                        title={`Mask the ${side} edge. Leave it off where the drawing doesn't bleed off that side`}
                        onChange={(e) => {
                          const next = MASK_SIDES.filter((x) => (x === side ? e.target.checked : sides.includes(x)));
                          actions.set({ edgeMaskSides: next.length === MASK_SIDES.length ? undefined : next });
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
          <input
            ref={maskInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) actions.addEdgeMask(file, masks).then(readMasks);
            }}
          />
        </Section>
      </div>
    </Card>
  );
}
