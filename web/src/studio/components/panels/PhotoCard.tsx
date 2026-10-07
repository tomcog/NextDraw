import { useRef } from "react";
import { Button, ButtonRound, Card, Checkbox, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import { Section } from "../../../shared/components/controls/Section";
import { NumberField } from "../../../shared/components/controls/NumberField";
import controls from "../../../shared/components/controls/controls.module.css";
import { BLACK_SHARE, CENTER_DEFAULTS, KEY_FROM, MOST_LAYERS, OUTLINE_DEFAULTS, PLATES, PLATE_AIMS, SILHOUETTE_DEFAULTS, WAVE_DEFAULTS, photoMarks, photoMode, type Photo, type Plate } from "../../../shared/lib/drawing/photo";
import { boxOf, type Layer, type Shape } from "../../../shared/lib/drawing/shapes";
import styles from "../../App.module.css";

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
  setKeyLayer: (on: boolean) => void;
  place: (how: "fit" | "fill", margin: number) => void;
  setMargin: (margin: number) => void;
  setScale: (percent: number) => void;
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
  actions: PhotoActions;
}

/**
 * The chosen photo's card - in the drawing's rail, and in image conversion's under its own: how it is
 * split into layers, sized to the page, and what each layer's lines are drawn as.
 */
export function PhotoCard({ shape, title, shapes, layers, busy, all, onAll, scale, actions }: Props) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const photo = shape.photo;
  const b = boxOf(shape);
  const marks = photoMarks(photo, b.x1 - b.x0, b.y1 - b.y0);
  return (
    <Card variant="flat" className={styles.controls}>
      <div className={`${styles.cardBody} ${controls.cardSections}`}>
        <Section
          title={title}
          collapsibleKey="photo"
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
          {/* How many layers the photo is split into by tone. Each band layer has its own settings
            below; the photo's picture, brightness and contrast are what the bands are cut from. */}
          {/* By value: read as black and white, split into tone bands. By colour: split into groups
            of similar colours, each drawn in the tool's nearest pen. Either way, a layer each, with
            its own lines. */}
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
                <option value="other">{PLATES.some((p) => PLATE_AIMS[p].name === photo.separation) ? "Another ink" : photo.separation}</option>
              </InputSelect>
              <p className={styles.empty}>A separation: this layer draws its own greyscale picture, more of its pen where it's darker. Replace swaps this plate alone.</p>
            </>
          ) : (
            <>
              <SegmentedControl size="sm" variant="dark" aria-label="Split by">
                <Segment selected={photoMode(photo) === "value"} title="By value: the photo as black and white, split into tone bands" onClick={() => actions.switchMode("value")}>Value</Segment>
                <Segment selected={photoMode(photo) === "colour"} title="By colour: the photo's colours gathered into groups, each drawn in the tool's nearest pen" onClick={() => actions.switchMode("colour")}>Colour</Segment>
                <Segment selected={photoMode(photo) === "cmyk"} title="CMYK: four plates - cyan, magenta, yellow and black - in the tool's nearest pens, blended on paper" onClick={() => actions.switchMode("cmyk")}>CMYK</Segment>
              </SegmentedControl>
              {photoMode(photo) === "cmyk" ? (
                // How much of the colours' shared grey the black plate takes over: more, and the darks are
                // black; less, and they're the three colours laid over each other.
                <NumberField label="Black" unit="%" min={0} max={100} step={5} value={Math.round((photo.blackShare ?? BLACK_SHARE) * 100)} onChange={(v) => actions.set({ blackShare: v / 100 })} />
              ) : photo.ink ? (
                <>
                  <NumberField
                    label="Inks"
                    min={1}
                    max={MOST_LAYERS}
                    step={1}
                    value={photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group && !sh.photo?.key).length : 1}
                    onChange={actions.splitByColor}
                  />
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
          {photoMode(photo) === "colour" && photo.group && (
            // Colour layers overlap where colours blend: a part of the photo is drawn by every
            // layer whose colour is nearly as close as the nearest, within this.
            <>
              <NumberField label="Bleed" unit="%" min={0} max={25} step={1} value={Math.round((photo.bleed ?? 0) * 100)} onChange={(v) => actions.set({ bleed: v / 100 })} />
              <p className={styles.empty}>
                {(photo.bleed ?? 0) > 0
                  ? "Where the photo's colours blend, the layers either side both draw, and their lines overlap."
                  : "Each part of the photo is drawn by the one layer nearest its colour."}
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
          <div className={styles.fillRow}>
            <NumberField label="Brightness" min={-100} max={100} step={5} value={photo.brightness} onChange={(brightness) => actions.set({ brightness })} />
            <NumberField label="Contrast" min={-100} max={100} step={5} value={photo.contrast} onChange={(contrast) => actions.set({ contrast })} />
          </div>
          {/* What this band's tone is drawn as, and the numbers that style has. Each band its own. */}
          <InputSelect
            size="md"
            label="Drawn as"
            value={photo.style ?? "hatch"}
            title={({
              hatch: "Hatching: lines that cross and fill in as the photo darkens",
              waves: "Tone lines: one line along each row, waving harder and tighter where it's darker",
              outlines: "Outlines: the photo traced as contour lines, following its edges and shapes",
              centerlines: "Centerlines: each dark stroke of a line drawing drawn once, down its middle, so a ring is one circle",
              silhouette: "Silhouette: the line round a shape on white paper - its outline, and each hole in it",
            } as const)[photo.style ?? "hatch"]}
            onChange={(e) => {
              const style = e.target.value as NonNullable<Photo["style"]>;
              actions.set({ style: style === "hatch" ? undefined : style });
            }}
          >
            <option value="hatch">Hatching</option>
            <option value="waves">Tone lines</option>
            <option value="outlines">Outlines</option>
            <option value="centerlines">Centerlines</option>
            <option value="silhouette">Silhouette</option>
          </InputSelect>
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
            <div className={styles.fillRow}>
              <NumberField label="Lines" min={1} max={40} step={1} value={photo.contours ?? OUTLINE_DEFAULTS.contours} onChange={(contours) => actions.set({ contours })} />
              <NumberField label="Smoothing" unit="mm" min={0} max={20} step={0.25} value={photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm} onChange={(smoothMm) => actions.set({ smoothMm })} />
            </div>
          ) : photo.style === "waves" ? (
            <div className={styles.fillRow}>
              <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={photo.angle} onChange={(angle) => actions.set({ angle })} />
              <NumberField label="Row spacing" unit="mm" min={0.2} max={20} step={0.25} value={photo.rowMm ?? WAVE_DEFAULTS.rowMm} onChange={(rowMm) => actions.set({ rowMm })} />
              <NumberField label="Wave length" unit="mm" min={0.2} max={20} step={0.1} value={photo.waveMm ?? WAVE_DEFAULTS.waveMm} onChange={(waveMm) => actions.set({ waveMm })} />
            </div>
          ) : (
            <div className={styles.fillRow}>
              <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={photo.angle} onChange={(angle) => actions.set({ angle })} />
              <NumberField label="Closest lines" unit="mm" min={0.1} max={5} step={0.05} value={photo.spacingMm} onChange={(spacingMm) => actions.set({ spacingMm })} />
              <NumberField label="Passes" min={1} max={4} step={1} value={photo.levels} onChange={(levels) => actions.set({ levels })} />
            </div>
          )}
          <p className={styles.empty}>
            {marks
              ? photo.style === "silhouette"
                ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "loop" : "loops"}: the shape's outline${marks.strokes > 1 ? " and the holes in it" : ""}, where the picture meets white paper. Paper lighter than sets what counts as paper; Smallest drops specks and flecks.`
                : photo.style === "centerlines"
                ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}${marks.circles ? `, ${marks.circles} of them ${marks.circles === 1 ? "a circle" : "circles"}` : ""}, each drawn once down the middle of a stroke in the picture${marks.widthMm ? ` (they're about ${marks.widthMm.toFixed(1)} mm wide there)` : ""}. Darker than sets what counts as a line; Shortest drops specks and whiskers.`
                : photo.style === "outlines"
                ? `${marks.strokes.toLocaleString()} contours, along the photo's edges and shapes. More lines follow finer changes of tone; more smoothing, only the big ones.`
                : photo.style === "waves"
                ? `${marks.strokes.toLocaleString()} strokes. Each row waves harder and tighter where the photo is darker; white is left as paper.`
                : `${marks.strokes.toLocaleString()} strokes. The closest lines start at the tool’s solid-fill spacing; each pass adds lines where the photo is darker.`
              : "Reading the photo…"}
          </p>
        </Section>
      </div>
    </Card>
  );
}
