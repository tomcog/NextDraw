import { useRef } from "react";
import { Button, ButtonRound, Card, Checkbox, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import { BLACK_SHARE, CENTER_DEFAULTS, KEY_FROM, MOST_LAYERS, MOST_PASSES, OUTLINE_DEFAULTS, PLATES, PLATE_AIMS, SILHOUETTE_DEFAULTS, WAVE_DEFAULTS, ANGLE_PRESETS, PLATE_SETS, coverSteps, plateSetOf, platesOf, squiggleAmp, type AnglePreset, type PlateSet, photoMarks, photoMode, type Photo, type Plate } from "../../shared/lib/drawing/photo";
import { boxOf, type Layer, type Shape } from "../../shared/lib/drawing/shapes";
import type { PenColor } from "../../shared/lib/types";
import styles from "../App.module.css";
import { EFFECTS, effectOf } from "./EffectToolbar";

/** What the card does to the photo. Each acts on the chosen photo, and on all its layers where it should. */
export interface PhotoActions {
  turn: (quarter: 1 | -1) => void;
  replace: (file: File | undefined) => void;
  setPlate: (plate: Plate | "other") => void;
  switchMode: (to: "value" | "colour" | "cmyk") => void;
  /** Change settings of the photo - this layer's, or every layer's when "All layers" is on. */
  set: (patch: Partial<Photo>) => void;
  split: (count: number) => void;
  splitByColor: (count: number) => void;
  /** Split by colour into the `count` pens that come nearest the photo as they really come out on paper. */
  splitBestFit: (count: number) => void;
  /** Split by best fit again, with or without two pens hatched across each other. */
  setPairs: (on: boolean) => void;
  /** Split by best fit again, hatched in fine steps or in whole passes. */
  setFine: (on: boolean) => void;
  setKeyLayer: (on: boolean) => void;
  place: (how: "fit" | "fill", margin: number) => void;
  setMargin: (margin: number) => void;
  setScale: (percent: number) => void;
  /** Draw a plate in another of the pen's colors, by its name in the palette. */
  setPlatePen: (plate: Plate, penName: string) => void;
  /** Split into a set of plates: CMYK, or CMYK with more inks. */
  splitCmyk: (set: PlateSet) => void;
  /** Set the layers' angles: a preset newly chosen, or the whole set turned by so many degrees. */
  setAngles: (change: { preset?: AnglePreset; by?: number }) => void;
  /** Pick one of the photo's bands to set, and draw on its layer. */
  pickBand: (id: string, layerId: string) => void;
}

interface Props {
  /** The chosen shape, which is a photo. */
  shape: Shape & { photo: Photo };
  title: string;
  shapes: Shape[];
  layers: Layer[];
  busy: boolean;
  /** Whether the settings go to all the photo's layers at once. */
  all: boolean;
  onAll: (all: boolean) => void;
  /** The photo's size as a percent of what Fit gives it. */
  scale: number;
  /** Split by best fit: how near the photo the best pens come, one fewer, as many and one more (ΔE). */
  estimates?: { pens: number; err: number }[];
  actions: PhotoActions;
  /** Whether the photo's own card - turning, brightness and contrast, its size on the page - is out. */
  infoCard?: boolean;
  /** The pen's line width, in mm: with the spacing, how much paper the lines can cover. */
  penWidthMm?: number;
  /** The pen's palette: the colors a plate can be drawn in. */
  palette?: PenColor[];
  /** Whether the effect's cards - its own and Layers - are out. */
  effectCards?: boolean;
}

/**
 * The chosen photo's card - in the drawing's rail, and in image conversion's under its own: how it is
 * split into layers, sized to the page, and what each layer's lines are drawn as.
 */
export function PhotoCard({ shape, title, shapes, layers, busy, all, onAll, scale, estimates, actions, penWidthMm = 0.5, palette = [], infoCard = true, effectCards = true }: Props) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const photo = shape.photo;
  // How many inks a photo split by colour is in: its layers, not counting the key.
  const inks = photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group && !sh.photo?.key).length : 1;
  const b = boxOf(shape);
  const marks = photoMarks(photo, b.x1 - b.x0, b.y1 - b.y0);
  const effect = EFFECTS.find((e) => e.key === effectOf(photo))!;
  // Silhouette reads the picture as paint or paper and nothing between, so it has no tones or colours
  // to split by: a photo drawn that way is one layer. Separations stay as they are, a plate each.
  const splits = photo.separation || effect.key !== "silhouette";
  // How the photo is split into pens: B&W, CMYK or Colour, with that mode's own settings. The
  // whole drawing's - at the top of the Hatching card, in the Layers card for the other effects.
  const colourMode = (
    <>
      {photo.separation ? (
        // Separations made elsewhere: each layer is its own picture, so there's nothing to split.
        // Which plate this one is sets its name, its screen angle and its pen.
        <>
          <InputSelect
            size="md"
            label="Plate"
            value={PLATES.find((p) => PLATE_AIMS[p].name === photo.separation) ?? "other"}
            onChange={(e) => actions.setPlate(e.target.value as Plate | "other")}
          >
            {PLATES.map((p) => <option key={p} value={p}>{PLATE_AIMS[p].name}</option>)}
            <option value="other">{PLATES.some((p) => PLATE_AIMS[p].name === photo.separation) ? "Another color" : photo.separation}</option>
          </InputSelect>
          <p className={styles.empty}>A separation: this layer draws its own grayscale picture, more of its color where it's darker. Replace swaps this plate alone.</p>
        </>
      ) : (
        <>
          <SegmentedControl size="sm" variant="dark" aria-label="Color mode">
            <Segment selected={photoMode(photo) === "value"} title="B&W: the photo as black and white, in one color or split into tone bands" onClick={() => actions.switchMode("value")}>B&amp;W</Segment>
            <Segment selected={photoMode(photo) === "cmyk"} title="CMYK: print's four plates - cyan, magenta, yellow and black - in the pen's nearest colors, blended on paper" onClick={() => actions.switchMode("cmyk")}>CMYK</Segment>
            <Segment selected={photoMode(photo) === "colour"} title="Color: as many colors as you choose from the pen's palette, the ones that best match the photo" onClick={() => actions.switchMode("colour")}>Color</Segment>
          </SegmentedControl>
          {photoMode(photo) === "cmyk" ? (
            <>
              {/* Which plates: print's four, or CMYK with more inks for truer, brighter color. */}
              <InputSelect
                size="md"
                label="Plates"
                value={plateSetOf(photo.plates)}
                title={PLATE_SETS.find((s) => s.key === plateSetOf(photo.plates))!.about}
                onChange={(e) => actions.splitCmyk(e.target.value as PlateSet)}
              >
                {PLATE_SETS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </InputSelect>
              {/* Each plate's color, from the pen's palette: chosen for it at the split, changed here.
                The photo is separated again for the colors as they now are. */}
              {photo.plates && palette.length > 0 && (
                <div className={styles.fillRow}>
                  {platesOf(photo.plates).map((plate, i) => (
                    <InputSelect
                      key={plate}
                      size="md"
                      label={PLATE_AIMS[plate].name}
                      value={palette.find((p) => p.color.toLowerCase() === photo.plates![i]?.toLowerCase())?.name ?? ""}
                      onChange={(e) => actions.setPlatePen(plate, e.target.value)}
                    >
                      {!palette.some((p) => p.color.toLowerCase() === photo.plates![i]?.toLowerCase()) && <option value="">Not in this palette</option>}
                      {palette.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </InputSelect>
                  ))}
                </div>
              )}
              {/* How much of the colors' shared gray the black plate takes over: more, and the darks are
                black; less, and they're the other inks laid over each other. */}
              <NumberField label="Black" unit="%" min={0} max={100} step={5} value={Math.round((photo.blackShare ?? BLACK_SHARE) * 100)} onChange={(v) => actions.set({ blackShare: v / 100 })} />
            </>
          ) : photo.ink ? (
            <>
              {/* How the pens are chosen: the ones that come nearest the photo as they really come
                out on paper, or the nearest pen to each of the photo's own colour groups. */}
              <SegmentedControl size="sm" variant="dark" aria-label="Choose colors">
                <Segment selected={Boolean(photo.fitPaper)} title="Best fit: the colors that, as they really come out on this paper, come nearest the photo between them" onClick={() => !photo.fitPaper && actions.splitBestFit(inks)}>Best fit</Segment>
                <Segment selected={!photo.fitPaper} title="By groups: the photo's colors gathered into groups, each drawn in the palette color nearest it" onClick={() => photo.fitPaper && actions.splitByColor(inks)}>By groups</Segment>
              </SegmentedControl>
              <NumberField
                label="Colors"
                min={1}
                max={MOST_LAYERS}
                step={1}
                value={inks}
                onChange={photo.fitPaper ? actions.splitBestFit : actions.splitByColor}
              />
              {photo.fitPaper && (
                // Two pens hatched across each other, for colours neither makes alone - an olive
                // from a yellow under a dark green. Each pen's layer gets its own angle so the lines cross.
                <Checkbox
                  checked={Boolean(photo.fitPairs)}
                  label="Overlaid pairs, for colors no single color makes"
                  onChange={(e) => actions.setPairs(e.target.checked)}
                />
              )}
              {photo.fitPaper && (
                // Lines come in one at a time rather than a pass at once, so pale colours can be a
                // few sparse lines rather than nothing or a third of the paper.
                <Checkbox
                  checked={Boolean(photo.fineSteps)}
                  label="Fine steps, for pale colors"
                  onChange={(e) => actions.setFine(e.target.checked)}
                />
              )}
              {photo.fitPaper && estimates && estimates.length > 0 && (
                <p className={styles.empty}>
                  Best fit, as near as the colors come to the photo: {estimates.map((e) => `${e.pens} ${e.pens === 1 ? "color" : "colors"} ${e.err.toFixed(1)} ΔE`).join(", ")}. Lower is closer.
                </p>
              )}
              {/* A key ink over the colours, darkening shadows the colour layers can't reach alone.
                Its pen is the layer's: change it with the layer's dot. */}
              <Checkbox
                checked={Boolean(photo.keyInk)}
                label="Key layer, to darken shadows"
                onChange={(e) => actions.setKeyLayer(e.target.checked)}
              />
              {photo.keyInk && (
                // The key's shading over the colours: how dark a part must be before it's shaded, and
                // how heavy the shading gets at black. The colours under it draw as they would without it.
                <div className={styles.fillRow}>
                  <NumberField label="Shading starts at" unit="%" min={0} max={95} step={5} value={Math.round((photo.keyFrom ?? KEY_FROM) * 100)} onChange={(v) => actions.set({ keyFrom: v / 100 })} />
                  <NumberField label="Key strength" unit="%" min={0} max={100} step={5} value={Math.round((photo.keyStrength ?? 1) * 100)} onChange={(v) => actions.set({ keyStrength: v / 100 })} />
                </div>
              )}
            </>
          ) : (
            <NumberField
              label="Tone layers"
              min={1}
              max={MOST_LAYERS}
              step={1}
              value={photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group).length : 1}
              onChange={actions.split}
            />
          )}
        </>
      )}
    </>
  );
  // Which layer the per-layer settings set: each by its number in the Layers list and a dot in its ink.
  const layerPicker = (
    <>
      {photo.group && (() => {
        // In the order of their layers, bottom first: the same order as the numbers in the
        // Layers list, lightest ink on the left once the layers are sorted by darkness.
        const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
        const bands = shapes
          .filter((sh) => sh.photo?.group === photo.group)
          .sort((a, b) => place(a) - place(b));
        // Bands by value are named for their tone; by colour, for their ink.
        // Each band by its layer: the number the Layers list gives it, and a dot in its ink - up
        // to six of them, too many for words.
        return (
          <SegmentedControl size="sm" variant="dark" aria-label="Band to set">
            {bands.map((band) => {
              const at = layers.findIndex((l) => l.id === band.layerId);
              const layer = layers[at];
              return (
                <Segment
                  key={band.id}
                  selected={band.id === shape.id}
                  aria-label={`Layer ${at + 1}, ${layer?.name ?? ""}`}
                  title={`Layer ${at + 1}, ${layer?.name ?? ""}: its lines`}
                  onClick={() => actions.pickBand(band.id, band.layerId)}
                >
                  <span className={styles.bandDot} style={{ background: layer?.color }} aria-hidden="true" />
                  {at + 1}
                </Segment>
              );
            })}
          </SegmentedControl>
        );
      })()}
    </>
  );
  // How far the layers reach into each other where they meet: the whole photo's.
  const bleed = (
    <>
      {photoMode(photo) === "colour" && photo.group && (
        // Colour layers overlap where colours blend: a part of the photo is drawn by every
        // layer whose colour is nearly as close as the nearest, within this.
        <>
          <NumberField label="Bleed" unit="%" min={0} max={25} step={1} value={Math.round((photo.bleed ?? 0) * 100)} onChange={(v) => actions.set({ bleed: v / 100 })} />
          <p className={styles.empty}>
            {(photo.bleed ?? 0) > 0
              ? "Where the photo's colors blend, the layers either side both draw, and their lines overlap."
              : "Each part of the photo is drawn by the one layer nearest its color."}
          </p>
        </>
      )}
      {photo.band && (() => {
        const [lo, hi] = photo.band;
        const bleed = photo.bleed ?? 0;
        const from = Math.round(Math.max(0, lo - (lo > 0 ? bleed : 0)) * 100);
        const to = Math.round(Math.min(1, hi + (hi < 1 ? bleed : 0)) * 100);
        return (
          <>
            {/* How far the bands reach into each other, so their lines overlap where they meet. */}
            <NumberField label="Bleed" unit="%" min={0} max={25} step={1} value={Math.round(bleed * 100)} onChange={(v) => actions.set({ bleed: v / 100 })} />
            <p className={styles.empty}>{`This layer draws the tones from ${from}% to ${to}% dark.`}</p>
          </>
        );
      })()}
    </>
  );
  // The layers' angles, set apart by a preset so no two pens' lines lie the same way: shared by the
  // effects that draw in rows or lines - Hatching and Squiggle.
  const anglePresets = (
    <InputSelect
      size="md"
      label="Angles"
      value={photo.anglePreset ?? "classic"}
      title={ANGLE_PRESETS.find((a) => a.key === (photo.anglePreset ?? "classic"))!.about}
      onChange={(e) => actions.setAngles({ preset: e.target.value as AnglePreset })}
    >
      {ANGLE_PRESETS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
    </InputSelect>
  );
  // This layer's angle. For the whole drawing, changing it turns every layer with it.
  const angleField = (
    <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={photo.angle} onChange={(angle) => (all && photo.group ? actions.setAngles({ by: angle - photo.angle }) : actions.set({ angle }))} />
  );
  // Rarely wanted: the effect's settings for one layer at a time, `which` saying which they are.
  const eachLayer = (which: string) => (
    <>
      {photo.group && (
        <Checkbox checked={!all} label="Set each layer on its own" onChange={(e) => onAll(!e.target.checked)} />
      )}
      {photo.group && !all && (
        <>
          {layerPicker}
          <p className={styles.empty}>{which} above are this layer's alone. Pick another to set it.</p>
        </>
      )}
    </>
  );
  return (
    <>
      {infoCard && (
        <Card variant="flat" className={styles.controls}>
          <div className={`${styles.cardBody} ${controls.cardSections}`}>
            <Section
              title="Image"
              collapsibleKey="photo"
              // Folded, the row names the photo in place of its buttons, as the Pen card names its pen.
              actionWhenOpen
              closedAction={<span className={controls.toolInTitle} title={title}>{title}</span>}
              action={
                <span className={controls.headerTools}>
                  {/* A quarter at a time, to stand the picture the way the paper does: the same
                    buttons as Plot's for turning a drawing. */}
                  <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the photo left" title="Turn the photo 90° left" disabled={busy} onClick={() => actions.turn(-1)} />
                  <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the photo right" title="Turn the photo 90° right" disabled={busy} onClick={() => actions.turn(1)} />
                  <Button size="sm" variant="secondary" title={photo.separation ? "Put a different picture in for this plate, keeping its settings" : "Put a different photo in, keeping every setting"} onClick={() => replaceInput.current?.click()}>
                    Replace…
                  </Button>
                  <input
                    ref={replaceInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      actions.replace(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </span>
              }
            >
              {/* The photo's name under the card's, small, as the File card says where a drawing is. */}
              <p className={controls.fileWhere} title={title}>{title}</p>
              <div className={styles.fillRow}>
                <NumberField label="Brightness" min={-100} max={100} step={5} value={photo.brightness} onChange={(brightness) => actions.set({ brightness })} />
                <NumberField label="Contrast" min={-100} max={100} step={5} value={photo.contrast} onChange={(contrast) => actions.set({ contrast })} />
              </div>
              {/* Sized to the page, inside the margin: the whole photo as large as it fits, or the page
                filled and the photo cropped. Moved or sized by hand, it's neither. */}
              <div className={styles.fillRow}>
                <SegmentedControl size="sm" variant="dark" aria-label="Size to the page">
                  <Segment selected={photo.fit === "fit"} title="Fit to page: all of the photo, as large as it fits inside the margin" onClick={() => actions.place("fit", photo.margin ?? 0.5)}>Fit</Segment>
                  <Segment selected={photo.fit === "fill"} title="Fill page: the whole page inside the margin, the photo cropped to it" onClick={() => actions.place("fill", photo.margin ?? 0.5)}>Fill</Segment>
                </SegmentedControl>
                <NumberField label="Margin" unit="in" min={0} max={4} step={0.25} value={photo.margin ?? 0.5} onChange={actions.setMargin} />
                <NumberField label="Scale" unit="%" min={5} max={1000} step={5} value={scale} onChange={actions.setScale} />
              </div>
            </Section>
          </div>
        </Card>
      )}
      {/* The effect's own cards - its card, then Layers - put away by clicking its button again. */}
      {effectCards && (
        <>
          {/* The effect's card first in the photo's stack, its Layers under it. */}
          <Card variant="flat" className={styles.controls}>
            <div className={`${styles.cardBody} ${controls.cardSections}`}>
              {/* The effect's own numbers, under its name: the toolbar on the left chooses which. */}
              <Section title={effect.label}>
                {photo.style === "silhouette" ? (
                  <div className={styles.fillRow}>
                    <NumberField label="Paper lighter than" unit="%" min={1} max={99} step={1} value={Math.round((photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from) * 100)} onChange={(v) => actions.set({ silhouetteFrom: v / 100 })} />
                    <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.05} value={photo.silhouetteSmoothMm ?? SILHOUETTE_DEFAULTS.smoothMm} onChange={(silhouetteSmoothMm) => actions.set({ silhouetteSmoothMm })} />
                    <NumberField label="Smallest" unit="mm" min={0} max={50} step={0.5} value={photo.silhouetteSmallestMm ?? SILHOUETTE_DEFAULTS.smallestMm} onChange={(silhouetteSmallestMm) => actions.set({ silhouetteSmallestMm })} />
                  </div>
                ) : photo.style === "centerlines" ? (
                  <div className={styles.fillRow}>
                    <NumberField label="Darker than" unit="%" min={1} max={99} step={5} value={Math.round((photo.centerFrom ?? CENTER_DEFAULTS.from) * 100)} onChange={(v) => actions.set({ centerFrom: v / 100 })} />
                    <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.05} value={photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm} onChange={(centerSmoothMm) => actions.set({ centerSmoothMm })} />
                    <NumberField label="Shortest" unit="mm" min={0} max={20} step={0.25} value={photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm} onChange={(centerShortestMm) => actions.set({ centerShortestMm })} />
                  </div>
                ) : photo.style === "outlines" ? (
                  <>
                    {/* The color mode first, as in the other effects. No angles: contours follow the
                      photo, not a direction. */}
                    {colourMode}
                    {photo.group && bleed}
                    <div className={styles.fillRow}>
                      <NumberField label="Lines" min={1} max={40} step={1} value={photo.contours ?? OUTLINE_DEFAULTS.contours} onChange={(contours) => actions.set({ contours })} />
                      <NumberField label="Smoothing mm" min={0} max={20} step={0.25} value={photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm} onChange={(smoothMm) => actions.set({ smoothMm })} />
                    </div>
                    {eachLayer("Lines and smoothing")}
                  </>
                ) : photo.style === "squiggle" ? (
                  <>
                    {/* As Hatching: the color mode first, then the layers' angles. */}
                    {colourMode}
                    {photo.group && bleed}
                    {anglePresets}
                    <div className={styles.fillRow}>
                      {angleField}
                      <NumberField label="Spacing mm" min={0.2} max={20} step={0.25} value={photo.rowMm ?? WAVE_DEFAULTS.rowMm} onChange={(rowMm) => actions.set({ rowMm, squiggleAmpMm: squiggleAmp(photo), squiggleHeight: undefined })} />
                    </div>
                    {/* The waves themselves, apart from the rows: how far they swing at black, and how long one is there. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Amplitude mm" min={0} max={20} step={0.1} value={Math.round(squiggleAmp(photo) * 100) / 100} onChange={(squiggleAmpMm) => actions.set({ squiggleAmpMm, squiggleHeight: undefined })} />
                      <NumberField label="Wavelength mm" min={0.2} max={20} step={0.1} value={photo.waveMm ?? WAVE_DEFAULTS.waveMm} onChange={(waveMm) => actions.set({ waveMm })} />
                    </div>
                    <Checkbox checked={Boolean(photo.squiggleJoin)} label="Join rows into one line" onChange={(e) => actions.set({ squiggleJoin: e.target.checked || undefined })} />
                    <Checkbox checked={Boolean(photo.squiggleLift)} label="Lift the pen where there's nothing to draw" onChange={(e) => actions.set({ squiggleLift: e.target.checked || undefined })} />
                    {eachLayer("Angle, spacing, amplitude and wavelength")}
                  </>
                ) : photo.style === "waves" ? (
                  <>
                    {/* As Hatching and Squiggle: the color mode first, then the layers' angles. */}
                    {colourMode}
                    {photo.group && bleed}
                    {anglePresets}
                    <div className={`${styles.fillRow} ${styles.oneRow}`}>
                      {angleField}
                      <NumberField label="Spacing mm" min={0.2} max={20} step={0.25} value={photo.rowMm ?? WAVE_DEFAULTS.rowMm} onChange={(rowMm) => actions.set({ rowMm })} />
                      <NumberField label="Wavelength mm" min={0.2} max={20} step={0.1} value={photo.waveMm ?? WAVE_DEFAULTS.waveMm} onChange={(waveMm) => actions.set({ waveMm })} />
                    </div>
                    {eachLayer("Angle, spacing and wavelength")}
                  </>
                ) : (
                  <>
                    {/* The colour mode first: it changes everything under it. */}
                    {colourMode}
                    {photo.group && bleed}
                    {anglePresets}
                    <div className={`${styles.fillRow} ${styles.oneRow}`}>
                      {angleField}
                      <NumberField label="Spacing mm" min={0.1} max={5} step={0.05} value={photo.spacingMm} onChange={(spacingMm) => actions.set({ spacingMm })} />
                      <NumberField label="Passes" min={1} max={MOST_PASSES} step={1} value={photo.levels} onChange={(levels) => actions.set({ levels })} />
                    </div>
                    {/* When the lines can't cover enough of the paper for colors to reach full strength: by how
                      much, and the spacing that would. */}
                    {(() => {
                      const pen = photo.penMm ?? penWidthMm;
                      const fullest = (spacing: number) => { const steps = coverSteps(pen, spacing, photo.levels); return steps[steps.length - 1]; };
                      const most = fullest(photo.spacingMm);
                      if (most >= 0.7) return null;
                      let enough = photo.spacingMm;
                      while (enough > 0.1 && fullest(enough) < 0.85) enough = Math.round((enough - 0.05) * 100) / 100;
                      return (
                        <p className={styles.empty}>
                          {`${photo.levels} ${photo.levels === 1 ? "pass" : "passes"} of a ${pen} mm line at ${photo.spacingMm} mm spacing cover at most ${Math.round(most * 100)}% of the paper, so colors stay paler than the photo's.${enough < photo.spacingMm ? ` About ${enough} mm spacing would let them reach full strength.` : ""}`}
                        </p>
                      );
                    })()}
                    {/* The photo smoothed before it's hatched, so busy patches read as tone rather than dashes. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Smoothing mm" min={0} max={5} step={0.1} value={photo.hatchSmoothMm ?? 0} onChange={(v) => actions.set({ hatchSmoothMm: v > 0 ? v : undefined })} />
                    </div>
                    {eachLayer("Angle, spacing, passes and smoothing")}
                  </>
                )}
                <p className={styles.empty}>
                  {marks
                    ? photo.style === "silhouette"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "loop" : "loops"}: the shape's outline${marks.strokes > 1 ? " and the holes in it" : ""}, where the picture meets white paper. Paper lighter than sets what counts as paper; Smallest drops specks and flecks.`
                      : photo.style === "centerlines"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}${marks.circles ? `, ${marks.circles} of them ${marks.circles === 1 ? "a circle" : "circles"}` : ""}, each drawn once down the middle of a stroke in the picture${marks.widthMm ? ` (they're about ${marks.widthMm.toFixed(1)} mm wide there)` : ""}. Darker than sets what counts as a line; Shortest drops specks and whiskers.`
                      : photo.style === "outlines"
                      ? `${marks.strokes.toLocaleString()} contours, along the photo's edges and shapes. More lines follow finer changes of tone; more smoothing, only the big ones.`
                      : photo.style === "squiggle"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}. Each row swings higher and waves tighter where the photo is darker${photo.squiggleLift ? ", and lifts off where there's nothing to draw" : ", and runs on flat through white"}. An amplitude of half the spacing and neighboring rows just meet.`
                      : photo.style === "waves"
                      ? `${marks.strokes.toLocaleString()} strokes. Each row waves harder and tighter where the photo is darker; white is left as paper.`
                      : `${marks.strokes.toLocaleString()} strokes. The spacing starts at the pen’s solid-fill spacing; each pass adds lines where the photo is darker.`
                    : "Reading the photo…"}
                </p>
              </Section>
            </div>
          </Card>
          {splits && effect.key !== "hatch" && effect.key !== "squiggle" && effect.key !== "waves" && effect.key !== "outlines" && (
            <Card variant="flat" className={styles.controls}>
              <div className={`${styles.cardBody} ${controls.cardSections}`}>
                <Section title={photo.separation ? "Separation" : "Layers"} collapsibleKey="photo-layers">
                  {/* How many layers the photo is split into by tone. Each band layer has its own settings
                    below; the photo's picture, brightness and contrast are what the bands are cut from. */}
                  {/* By value: read as black and white, split into tone bands. By colour: split into groups
                    of similar colours, each drawn in the tool's nearest pen. Either way, a layer each, with
                    its own lines. */}
                  {colourMode}
                  {/* Which band's lines the rest of the card sets. The bands lie on top of each other, so
                    this is how to reach each one; its layer in the list does the same. */}
                  {photo.group && (
                    // Where the settings below go: to the layer picked in the switch under this, or to every
                    // layer of the photo at once. The switch still says whose settings are showing.
                    <SegmentedControl size="sm" variant="dark" aria-label="Settings for">
                      <Segment selected={!all} title="The settings below go to the layer picked here" onClick={() => onAll(false)}>This layer</Segment>
                      <Segment selected={all} title="The settings below go to all the photo's layers at once" onClick={() => onAll(true)}>All layers</Segment>
                    </SegmentedControl>
                  )}
                  {layerPicker}
                  {bleed}
                </Section>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
