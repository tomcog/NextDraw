import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../shared/lib/api";
import { Button, ButtonRound, Card, Checkbox, InputSelect, Segment, SegmentedControl } from "@tomcoggia/ui";
import { RefreshCw, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import { Section } from "../../shared/components/controls/Section";
import { NumberField } from "../../shared/components/controls/NumberField";
import controls from "../../shared/components/controls/controls.module.css";
import { BLACK_SHARE, CENTER_DEFAULTS, KEY_FROM, MOST_COLORS, MOST_LAYERS, MOST_SIDE_LAYERS, MOST_PASSES, paperToneOf, OUTLINE_DEFAULTS, PLATE_AIMS, PLATE_OFF, SILHOUETTE_DEFAULTS, STREAM_DEFAULTS, ONE_LINE_DEFAULTS, ONE_LINE_MOST, HILBERT_DEFAULTS, WAVE_DEFAULTS, ANGLE_PRESETS, centerModeOf, EDGE_DEFAULTS, hatchShortestOf, MASK_SIDES, PLATE_SETS, SQUIGGLE_DRAW, SQUIGGLE_INKSCAPE, SQUIGGLE_INKSCAPE_RANGES, SQUIGGLE_RANGES, coverSteps, plateSetOf, platesOf, squiggleDrawOf, squiggleInkscapeOf, type AnglePreset, type SquiggleDraw, type SquiggleInkscape, type PlateSet, photoMarks, photoMode, type Photo, type Plate } from "../../shared/lib/drawing/photo";
import { EDGE_FIELDS, EDGE_STYLES, MOST_VARY, newEdge, newSeed, type EdgeGen, type EdgeStyle } from "../../shared/lib/drawing/edgeMask";
import { boxOf, type Shape } from "../../shared/lib/drawing/shapes";
import type { PenColor } from "../../shared/lib/types";
import styles from "../App.module.css";
import { EFFECTS, effectOf } from "./EffectToolbar";

/** What the card does to the photo. Each acts on the chosen photo, and on all its layers where it should. */
export interface PhotoActions {
  turn: (quarter: 1 | -1) => void;
  replace: (file: File | undefined) => void;
  /** Read the photo's file again, where it was opened from NextDraw's file browser and so is known. */
  reload: () => void;
  /** Another pass over the image - drawn as Edges to start with, on a layer of its own on top. */
  addPass: () => void;
  /** The chosen pass taken off the image (never the last). */
  removePass: () => void;
  /** Work on another pass: one of its layers' shapes, by id. */
  pickPass: (id: string) => void;
  /** Add a picture to the edge mask library - its black is paper - and lay it over the whole image. */
  addEdgeMask: (file: File, taken: string[]) => Promise<void>;
  /** Lay a mask from the library over the whole image; no name takes it off. */
  chooseEdgeMask: (name: string | undefined) => Promise<void>;
  /** Take a mask out of the library; drawings that use it keep their copy. */
  deleteEdgeMask: (name: string) => Promise<void>;
  /** Lay a made edge over the whole image. */
  setEdgeGen: (gen: EdgeGen) => void;
  /** Keep the made edge in the library as a picture. */
  saveEdgeGen: (taken: string[]) => Promise<void>;
  switchMode: (to: "value" | "colour" | "cmyk") => void;
  /** Change settings of the photo - this layer's, or every layer's when "All layers" is on. */
  set: (patch: Partial<Photo>) => void;
  split: (count: number) => void;
  splitByColor: (count: number) => void;
  /** Split by colour into the `count` pens that come nearest the photo as they really come out on paper. */
  splitBestFit: (count: number) => void;
  /** Split by best fit again, with or without two pens hatched across each other. */
  setPairs: (on: boolean) => void;
  setKeyLayer: (on: boolean) => void;
  place: (how: "fit" | "fill", margin: number) => void;
  setMargin: (margin: number) => void;
  setScale: (percent: number) => void;
  /** Draw a plate in another of the pen's colors, by its name in the palette. */
  setPlatePen: (plate: Plate, penName: string) => void;
  /** B&W split around the paper: so many layers darker than it and lighter, the tones between left bare. */
  splitAround: (dark: number, light: number) => void;
  /** Which of the picture's tones a photo split around the paper leaves bare, as darkness from and to. */
  setPaperTone: (tone: [number, number]) => void;
  /** With no pen preset: draw the layer in hand - or a CMYK plate's layer - in any color, from the picker. */
  setColor: (color: string, plate?: Plate) => void;
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
  busy: boolean;
  /** How many of the photo's layers are targeted in the Layers card - where a layer's settings go -
   *  and how many it has. */
  targeted: number;
  layerCount: number;
  /** The layer whose settings the card shows. */
  shownName: string;
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
  /** No pen preset is chosen: the palette is general colors, and a layer can take any color at all. */
  anyColor?: boolean;
  /** Whether the effect's cards - its own and Split - are out. */
  effectCards?: boolean;
  /** The Layers card, the app's: under the Image card, above the effect's. */
  layersCard?: ReactNode;
}

/**
 * The chosen photo's card - in the drawing's rail, and in image conversion's under its own: how it is
 * split into layers, sized to the page, and what each layer's lines are drawn as.
 */
export function PhotoCard({ shape, title, shapes, busy, targeted, layerCount, shownName, scale, estimates, actions, penWidthMm = 0.5, palette = [], anyColor = false, infoCard = true, effectCards = true, layersCard }: Props) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const maskInput = useRef<HTMLInputElement>(null);
  // The edge mask library, shared between Macs; read when the card opens and after each change to it.
  const [masks, setMasks] = useState<string[]>([]);
  const readMasks = () => api<{ masks: string[] }>("/api/edge-masks").then((r) => setMasks(r.masks)).catch(() => {});
  useEffect(() => { readMasks(); }, []);
  const photo = shape.photo;
  // A mask this drawing carries that isn't in the library: added before there was one, or taken out since.
  const ownMask = Boolean(photo.edgeMask) && !masks.includes(photo.edgeMaskName ?? "");
  // Mask edges is ticked while the image has a mask, or once ticked to choose one.
  const hasMask = Boolean(photo.edgeMask || photo.edgeGen);
  const [maskOpen, setMaskOpen] = useState(false);
  const masking = maskOpen || hasMask;
  // How many inks a photo split by colour is in: its layers, not counting the key.
  const inks = photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group && !sh.photo?.key).length : 1;
  const b = boxOf(shape);
  const marks = photoMarks(photo, b.x1 - b.x0, b.y1 - b.y0);
  const effect = EFFECTS.find((e) => e.key === effectOf(photo))!;
  // Silhouette reads the picture as paint or paper and nothing between, so it has no tones or colours
  // to split by: a photo drawn that way is one layer. Separations stay as they are, a plate each.
  // The image's passes, in the order they were added: each its own effect and layers over one picture.
  const passes = (() => {
    const members = photo.link ? shapes.filter((sh) => sh.photo?.link === photo.link) : [shape];
    const byPass = new Map<string, Shape[]>();
    for (const sh of members) {
      const key = sh.photo!.group ?? sh.id;
      byPass.set(key, [...(byPass.get(key) ?? []), sh]);
    }
    return [...byPass.values()].map((list) => ({
      id: list[0].id,
      effect: EFFECTS.find((e) => e.key === effectOf(list[0].photo!))!,
      layers: list.length,
      mine: list.some((sh) => sh.id === shape.id || (photo.group && sh.photo?.group === photo.group)),
    }));
  })();
  // How traced lines are drawn - Centerlines' and Edges': curves, straight lines, or mixed.
  const lineModes = (() => {
                      const mode = photo.style === "edges" ? photo.centerMode ?? "mixed" : centerModeOf(photo);
                      const corners = (
                        <div title="Where a line turns more than this, it keeps a sharp corner rather than being rounded through it. 0 rounds every turn">
                          <NumberField label="Sharp corners over" unit="°" min={0} max={179} step={5} value={photo.centerCornerDeg ?? 0} onChange={(v) => actions.set({ centerCornerDeg: v > 0 ? Math.min(179, v) : undefined })} />
                        </div>
                      );
                      const within = (
                        <div title="How far a straight segment may stray from the traced line: more makes fewer, longer straight lines">
                          <NumberField label="Straight within" unit="mm" min={0.05} max={5} step={0.05} value={photo.centerStraightMm ?? CENTER_DEFAULTS.straightMm} onChange={(v) => actions.set({ centerStraightMm: Math.max(0.05, v) })} />
                        </div>
                      );
                      return (
                        <>
                          <SegmentedControl size="sm" variant="dark" aria-label="Lines drawn as">
                            <Segment selected={mode === "curves"} title="Lines drawn as smooth curves" onClick={() => actions.set({ centerMode: "curves" })}>Curves</Segment>
                            <Segment selected={mode === "mixed"} title="Straight where a line runs straight, curved where it bends" onClick={() => actions.set({ centerMode: "mixed" })}>Mixed</Segment>
                            <Segment selected={mode === "straight"} title="Lines drawn as straight segments: straight edges dead straight, every corner sharp. A circle is still a circle" onClick={() => actions.set({ centerMode: "straight" })}>Straight</Segment>
                          </SegmentedControl>
                          <div className={styles.fillRow}>
                            {mode === "curves" && corners}
                            {mode === "straight" && within}
                            {mode === "mixed" && (
                              <>
                                {within}
                                <div title="A straight stretch at least this long is drawn as a straight line; shorter ones are where the line bends, and are drawn as curves">
                                  <NumberField label="Straight longer than" unit="mm" min={0.5} max={50} step={0.5} value={photo.centerLongMm ?? CENTER_DEFAULTS.longMm} onChange={(v) => actions.set({ centerLongMm: Math.max(0.5, v) })} />
                                </div>
                                {corners}
                              </>
                            )}
                          </div>
                        </>
                      );
                    })();
  // Silhouette and Edges are one layer each: no tones or colors to divide.
  const splits = photo.separation || (effect.key !== "silhouette" && effect.key !== "edges");
  // How the photo is split into pens: B&W, CMYK or Colour, with that mode's own settings. The whole
  // drawing's - in the Color mode card, above every effect's own card.
  const colourMode = (
    <>
      {photo.separation ? (
        // Separations made elsewhere: each layer is its own picture, so there's nothing to split.
        // Which plate each is, and its pen, came from its file's name; its color is its swatch's.
        <>
          <p className={styles.empty}>A separation: this layer draws its own grayscale picture, more of its color where it's darker. Click a layer's name in the Layers card to see its picture; the targeted layers are the ones the settings change. Replace swaps the shown plate alone.</p>
        </>
      ) : (
        <>
          <SegmentedControl size="sm" variant="dark" aria-label="Color mode">
            <Segment selected={photoMode(photo) === "value"} title="B&W: the image as black and white, in one color or split into tone bands" onClick={() => actions.switchMode("value")}>B&amp;W</Segment>
            <Segment selected={photoMode(photo) === "cmyk"} title="CMYK: print's four plates - cyan, magenta, yellow and black - in the pen's nearest colors, blended on paper" onClick={() => actions.switchMode("cmyk")}>CMYK</Segment>
            <Segment selected={photoMode(photo) === "colour"} title="Color: as many colors as you choose from the pen's palette, the ones that best match the image" onClick={() => actions.switchMode("colour")}>Color</Segment>
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
                  {platesOf(photo.plates).map((plate, i) => {
                    const select = (
                    <InputSelect
                      key={plate}
                      size="md"
                      label={PLATE_AIMS[plate].name}
                      value={photo.plates![i] === PLATE_OFF ? PLATE_OFF : palette.find((p) => p.color.toLowerCase() === photo.plates![i]?.toLowerCase())?.name ?? ""}
                      onChange={(e) => actions.setPlatePen(plate, e.target.value)}
                    >
                      {photo.plates![i] !== PLATE_OFF && !palette.some((p) => p.color.toLowerCase() === photo.plates![i]?.toLowerCase()) && <option value="">{anyColor ? "Custom" : "N/A"}</option>}
                      {/* None leaves the channel out: the other plates make up the photo without it. */}
                      <option value={PLATE_OFF}>None</option>
                      {palette.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </InputSelect>
                    );
                    // No pen preset: any color for the plate, from the swatch in front of its menu - the
                    // paper card's own picker swatch. Not for a plate left out.
                    if (!anyColor || photo.plates![i] === PLATE_OFF) return select;
                    const color = photo.plates![i];
                    return (
                      <div key={plate} className={styles.plateCell}>
                        <label className={controls.paperSwatch} title={`Pick any color for the ${PLATE_AIMS[plate].name.toLowerCase()} plate`} style={{ background: color }}>
                          <input type="color" aria-label={`${PLATE_AIMS[plate].name} plate color`} value={color} disabled={busy} onChange={(e) => actions.setColor(e.target.value, plate)} />
                        </label>
                        {select}
                      </div>
                    );
                  })}
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
                <Segment selected={Boolean(photo.fitPaper)} title="Best fit: the colors that, as they really come out on this paper, come nearest the image between them" onClick={() => !photo.fitPaper && actions.splitBestFit(inks)}>Best fit</Segment>
                <Segment selected={!photo.fitPaper} title="Image's colors: the image's own main colors, each drawn in the palette color nearest it" onClick={() => photo.fitPaper && actions.splitByColor(inks)}>Image's colors</Segment>
              </SegmentedControl>
              <p className={styles.empty}>
                {photo.fitPaper
                  ? "Tries combinations of your pens and keeps the set that, as they really come out on this paper, looks most like the image."
                  : "Finds the image's main colors, as many as you ask for, and draws each area in the pen nearest its color. Quick, but it doesn't check how the pens look on paper."}
              </p>
              <NumberField
                label="Colors"
                min={1}
                max={MOST_COLORS}
                step={1}
                value={inks}
                onChange={photo.fitPaper ? actions.splitBestFit : actions.splitByColor}
              />
              {photo.fitPaper && (
                // Two pens hatched across each other, for colours neither makes alone - an olive
                // from a yellow under a dark green. Each pen's layer gets its own angle so the lines cross.
                <Checkbox size="md"
                  checked={Boolean(photo.fitPairs)}
                  label="Overlaid pairs, for colors no single color makes"
                  onChange={(e) => actions.setPairs(e.target.checked)}
                />
              )}
              {photo.fitPaper && estimates && estimates.length > 0 && (
                <p className={styles.empty}>
                  Best fit, as near as the colors come to the image: {estimates.map((e) => `${e.pens} ${e.pens === 1 ? "color" : "colors"} ${e.err.toFixed(1)} ΔE`).join(", ")}. Lower is closer.
                </p>
              )}
              {/* A key ink over the colours, darkening shadows the colour layers can't reach alone.
                Its pen is the layer's: change it with the layer's dot. */}
              <Checkbox size="md"
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
            <>
              {/* One pen darker than the paper, in tone layers - or the paper as one of the tones, pens
                darker and lighter than it either side: black and white on gray, the midtones bare. */}
              <SegmentedControl size="sm" variant="dark" aria-label="Pens">
                <Segment selected={!photo.side} title="Dark pen: one pen darker than the paper, in tone layers from light to dark" onClick={() => photo.side && actions.split(1)}>Dark pen</Segment>
                <Segment selected={Boolean(photo.side)} title="Dark + light pens: pens darker than the paper draw the shadows, pens lighter than it the highlights, and the tones between are bare paper" onClick={() => !photo.side && actions.splitAround(1, 1)}>Dark + light pens</Segment>
              </SegmentedControl>
              {photo.side ? (() => {
                const members = photo.group ? shapes.filter((sh) => sh.photo?.group === photo.group) : [shape];
                const dark = members.filter((sh) => sh.photo?.side === "dark").length;
                const light = members.filter((sh) => sh.photo?.side === "light").length;
                const [p0, p1] = paperToneOf(photo);
                return (
                  <>
                    <div className={styles.fillRow}>
                      <NumberField label="Dark layers" min={light ? 0 : 1} max={MOST_SIDE_LAYERS} step={1} value={dark} onChange={(v) => actions.splitAround(v, light)} />
                      <NumberField label="Light layers" min={dark ? 0 : 1} max={MOST_SIDE_LAYERS} step={1} value={light} onChange={(v) => actions.splitAround(dark, v)} />
                    </div>
                    <div className={styles.fillRow}>
                      <NumberField label="Paper from" unit="%" min={0} max={Math.round(p1 * 100)} step={1} value={Math.round(p0 * 100)} onChange={(v) => actions.setPaperTone([v / 100, p1])} />
                      <NumberField label="Paper to" unit="%" min={Math.round(p0 * 100)} max={100} step={1} value={Math.round(p1 * 100)} onChange={(v) => actions.setPaperTone([p0, v / 100])} />
                    </div>
                    <p className={styles.empty}>
                      {`Tones from ${Math.round(p0 * 100)}% to ${Math.round(p1 * 100)}% dark are left as bare paper. Darker ones are drawn in the dark ${dark === 1 ? "pen" : "pens"}, lighter ones in the light ${light === 1 ? "pen" : "pens"}, with more lines the further they are from the paper.`}
                    </p>
                  </>
                );
              })() : (
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
      )}
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
              ? "Where the image's colors blend, the layers either side both draw, and their lines overlap."
              : "Each part of the image is drawn by the one layer nearest its color."}
          </p>
        </>
      )}
      {photo.band && (() => {
        const [lo, hi] = photo.band;
        const bleed = photo.bleed ?? 0;
        // Split around the paper, a band is a share of its side, from the paper outwards: said as the
        // picture's own darkness.
        const [p0, p1] = paperToneOf(photo);
        const real = (t: number) => (photo.side === "dark" ? p1 + (1 - p1) * t : photo.side === "light" ? p0 * (1 - t) : t);
        const ends = [real(Math.max(0, lo - (lo > 0 ? bleed : 0))), real(Math.min(1, hi + (hi < 1 ? bleed : 0)))];
        const from = Math.round(Math.min(...ends) * 100);
        const to = Math.round(Math.max(...ends) * 100);
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
  // This layer's angle. For the whole drawing - or with Uniform, which keeps every layer at one angle -
  // changing it turns every layer with it.
  const angleField = (
    <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={photo.angle} onChange={(angle) => ((targeted === layerCount || photo.anglePreset === "uniform") && photo.group ? actions.setAngles({ by: angle - photo.angle }) : actions.set({ angle }))} />
  );
  // Squiggle's own angle: every layer level, left to right, unless turned - not hatching's angles by color.
  const squiggleAngleField = (
    <NumberField label="Angle" unit="°" min={-180} max={180} step={5} value={photo.squiggleAngle ?? 0} onChange={(v) => actions.set({ squiggleAngle: v || undefined })} />
  );
  // A SquiggleDraw control: set, it keeps only what differs from the sketch's default.
  const setSquiggle = (change: Partial<SquiggleDraw>) => {
    const next: Partial<SquiggleDraw> = { ...(photo.squiggleDraw ?? {}), ...change };
    for (const key of Object.keys(next) as (keyof SquiggleDraw)[]) if (next[key] === SQUIGGLE_DRAW[key]) delete next[key];
    actions.set({ squiggleDraw: Object.keys(next).length ? next : undefined });
  };
  const squiggleField = (key: keyof typeof SQUIGGLE_RANGES) => {
    const r = SQUIGGLE_RANGES[key];
    return <NumberField label={r.label} min={r.min} max={r.max} step={r.step} value={squiggleDrawOf(photo)[key]} onChange={(v) => setSquiggle({ [key]: v })} />;
  };
  // An Inkscape control likewise, over the extension's defaults.
  const setInkscape = (change: Partial<SquiggleInkscape>) => {
    const next: Partial<SquiggleInkscape> = { ...(photo.squiggleInkscape ?? {}), ...change };
    for (const key of Object.keys(next) as (keyof SquiggleInkscape)[]) if (next[key] === SQUIGGLE_INKSCAPE[key]) delete next[key];
    actions.set({ squiggleInkscape: Object.keys(next).length ? next : undefined });
  };
  const inkscapeField = (key: keyof typeof SQUIGGLE_INKSCAPE_RANGES) => {
    const r = SQUIGGLE_INKSCAPE_RANGES[key];
    return <NumberField label={r.label} min={r.min} max={r.max} step={r.step} value={squiggleInkscapeOf(photo)[key]} onChange={(v) => setInkscape({ [key]: v })} />;
  };
  // Where the effect's settings for each layer go: the layers targeted in the Layers card, `which`
  // saying which settings they are. Said only when that isn't every layer.
  const eachLayer = (which: string) => (
    photo.group && targeted < layerCount ? (
      <p className={styles.empty}>
        {targeted
          ? `${which} above go to the ${targeted === 1 ? "layer" : `${targeted} layers`} targeted in the Layers card, and show ${shownName ? `${shownName}'s` : "its"} values.`
          : `No layers are targeted, so ${which.toLowerCase()} above change nothing: target some in the Layers card.`}
      </p>
    ) : null
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
                  <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the image left" title="Turn the image 90° left" disabled={busy} onClick={() => actions.turn(-1)} />
                  <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the image right" title="Turn the image 90° right" disabled={busy} onClick={() => actions.turn(1)} />
                  {/* Only for a picture opened from NextDraw's file browser: its file is known. */}
                  {photo.source && (
                    <ButtonRound
                      size="sm"
                      icon={<RefreshCw />}
                      aria-label="Reload the image"
                      title={`Reload ${photo.source.slice(photo.source.lastIndexOf("/") + 1)} from its file, keeping every setting - after editing it elsewhere`}
                      disabled={busy}
                      onClick={actions.reload}
                    />
                  )}
                  <Button size="sm" variant="secondary" title={photo.separation ? "Put a different picture in for this plate, keeping its settings" : "Put a different image in, keeping every setting"} onClick={() => replaceInput.current?.click()}>
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
              {/* From -100 to 100, 0 the photo as it is: typed, or stepped by 5 with the arrow keys (50 with Shift). */}
              <div className={`${styles.fillRow} ${styles.oneRow}`}>
                <NumberField label="Brightness" min={-100} max={100} step={5} value={photo.brightness} onChange={(brightness) => actions.set({ brightness })} />
                <NumberField label="Contrast" min={-100} max={100} step={5} value={photo.contrast} onChange={(contrast) => actions.set({ contrast })} />
                <NumberField label="Saturation" min={-100} max={100} step={5} value={photo.saturation ?? 0} onChange={(v) => actions.set({ saturation: v || undefined })} />
              </div>
              {/* Black and white is Saturation all the way down: on sets it to -100, off back to the photo's own. */}
              <Checkbox size="md"
                checked={photo.saturation === -100}
                label="B&W"
                onChange={(e) => actions.set({ saturation: e.target.checked ? -100 : undefined })}
              />
              {/* Sized to the page, inside the margin: the whole photo as large as it fits, or the page
                filled and the photo cropped. Moved or sized by hand, it's neither. */}
              <div className={styles.fillRow}>
                <SegmentedControl size="sm" variant="dark" aria-label="Size to the page">
                  <Segment selected={photo.fit === "fit"} title="Fit to page: all of the image, as large as it fits inside the margin" onClick={() => actions.place("fit", photo.margin ?? 0.5)}>Fit</Segment>
                  <Segment selected={photo.fit === "fill"} title="Fill page: the whole page inside the margin, the image cropped to it" onClick={() => actions.place("fill", photo.margin ?? 0.5)}>Fill</Segment>
                </SegmentedControl>
                <NumberField label="Margin" unit="in" min={0} max={4} step={0.25} value={photo.margin ?? 0.5} onChange={actions.setMargin} />
                <NumberField label="Scale" unit="%" min={5} max={1000} step={5} value={scale} onChange={actions.setScale} />
              </div>
              {/* Passes over the picture: hatching for the shading and edges over it, say - each its own
                effect, settings and layers, the picture and its place shared. Which one the cards below
                are about, and adding or taking one off. */}
              {passes.length > 1 && (
                <SegmentedControl size="sm" variant="dark" aria-label="Passes">
                  {passes.map((p, i) => (
                    <Segment key={p.id} selected={p.mine} title={`Pass ${i + 1}: ${p.effect.label}, ${p.layers === 1 ? "1 layer" : `${p.layers} layers`}`} onClick={() => !p.mine && actions.pickPass(p.id)}>
                      {`${i + 1} ${p.effect.label}`}
                    </Segment>
                  ))}
                </SegmentedControl>
              )}
              <div className={styles.fillRow}>
                <Button size="sm" variant="secondary" disabled={busy} title="Another pass over this picture, on a layer of its own on top: Edges to start with - lines where the tone changes sharply - or any effect" onClick={actions.addPass}>
                  Add pass
                </Button>
                {passes.length > 1 && (
                  <Button size="sm" variant="secondary" disabled={busy} title="Take this pass and its layers off the image. The other passes stay" onClick={actions.removePass}>
                    Remove pass
                  </Button>
                )}
              </div>
              {/* Mask edges: ticked, the mask's controls; unticked, none of them, and no mask on the
                image - so a mask never stays on out of sight. */}
              <Checkbox size="md"
                checked={masking}
                label="Mask edges"
                title="Leave the image's edges as paper: a grunge border, a torn edge"
                onChange={(e) => {
                  setMaskOpen(e.target.checked);
                  if (!e.target.checked && hasMask) actions.chooseEdgeMask(undefined);
                }}
              />
              {masking && (
                <>
                {/* An edge mask: a grunge border, a torn edge; where it's paper the image is left bare,
                  before any effect reads it. Either made here - a preset's look, its numbers to change,
                  New edge for another of the same - or a saved picture from the library, of which the
                  drawing keeps a copy. */}
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
      )}
      {layersCard}
      {/* The effect's own cards - Color mode, then its card - put away by clicking its button again. */}
      {effectCards && (
        <>
          {/* Color mode first in the photo's stack - how the picture is divided into layers and pens - then the effect's own card under it. */}
          {splits && (
            <Card variant="flat" className={styles.controls}>
              <div className={`${styles.cardBody} ${controls.cardSections}`}>
                <Section title={photo.separation ? "Separation" : "Color mode"} collapsibleKey="photo-layers">
                  {/* How many layers the photo is split into by tone. Each band layer has its own settings
                    below; the photo's picture, brightness and contrast are what the bands are cut from. */}
                  {/* By value: read as black and white, split into tone bands. By colour: split into groups
                    of similar colours, each drawn in the tool's nearest pen. Either way, a layer each, with
                    its own lines. */}
                  {colourMode}
                  {photo.group && bleed}
                </Section>
              </div>
            </Card>
          )}
          <Card variant="flat" className={styles.controls}>
            <div className={`${styles.cardBody} ${controls.cardSections}`}>
              {/* The effect's own numbers, under its name: the toolbar on the left chooses which. */}
              <Section title={<span className={controls.iconTitle}>{effect.icon}{effect.label}</span>}>
                {photo.style === "silhouette" ? (
                  <div className={styles.fillRow}>
                    <NumberField label="Paper lighter than" unit="%" min={1} max={99} step={1} value={Math.round((photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from) * 100)} onChange={(v) => actions.set({ silhouetteFrom: v / 100 })} />
                    <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.05} value={photo.silhouetteSmoothMm ?? SILHOUETTE_DEFAULTS.smoothMm} onChange={(silhouetteSmoothMm) => actions.set({ silhouetteSmoothMm })} />
                    <NumberField label="Smallest" unit="mm" min={0} max={50} step={0.5} value={photo.silhouetteSmallestMm ?? SILHOUETTE_DEFAULTS.smallestMm} onChange={(silhouetteSmallestMm) => actions.set({ silhouetteSmallestMm })} />
                  </div>
                ) : photo.style === "edges" ? (
                  <>
                    {/* Edges: where the tone changes sharply, traced as Centerlines traces strokes. */}
                    <div className={styles.fillRow}>
                      <div title="How sharp a change of tone counts as an edge, against the picture's sharpest: lower finds fainter edges">
                        <NumberField label="Edge strength" unit="%" min={1} max={100} step={5} value={Math.round((photo.edgeFrom ?? EDGE_DEFAULTS.from) * 100)} onChange={(v) => actions.set({ edgeFrom: Math.max(0.01, v / 100) })} />
                      </div>
                      <div title="How much the picture is smoothed first, so texture and grain aren't taken for edges">
                        <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.1} value={photo.edgeSmoothMm ?? EDGE_DEFAULTS.smoothMm} onChange={(edgeSmoothMm) => actions.set({ edgeSmoothMm })} />
                      </div>
                      <div title="Edges shorter than this are left out">
                        <NumberField label="Shortest" unit="mm" min={0} max={50} step={0.5} value={photo.edgeShortestMm ?? EDGE_DEFAULTS.shortestMm} onChange={(edgeShortestMm) => actions.set({ edgeShortestMm })} />
                      </div>
                    </div>
                    {lineModes}
                  </>
                ) : photo.style === "centerlines" ? (
                  <>
                    <div className={styles.fillRow}>
                      <NumberField label="Darker than" unit="%" min={1} max={99} step={5} value={Math.round((photo.centerFrom ?? CENTER_DEFAULTS.from) * 100)} onChange={(v) => actions.set({ centerFrom: v / 100 })} />
                      <NumberField label="Smoothing" unit="mm" min={0} max={5} step={0.05} value={photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm} onChange={(centerSmoothMm) => actions.set({ centerSmoothMm })} />
                      <NumberField label="Shortest" unit="mm" min={0} max={20} step={0.25} value={photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm} onChange={(centerShortestMm) => actions.set({ centerShortestMm })} />
                    </div>
                    {lineModes}
                  </>
                ) : photo.style === "streamlines" ? (
                  <>
                    {/* The layers' angles - which the lines settle to wherever the image has no shape to follow. */}
                    {anglePresets}
                    <div className={`${styles.fillRow} ${styles.oneRow}`}>
                      {angleField}
                      <NumberField label="Spacing mm" min={0.1} max={5} step={0.05} value={photo.spacingMm} onChange={(spacingMm) => actions.set({ spacingMm })} />
                      <NumberField label="Widest mm" min={0.5} max={20} step={0.25} value={photo.streamWidestMm ?? STREAM_DEFAULTS.widestMm} onChange={(streamWidestMm) => actions.set({ streamWidestMm })} />
                    </div>
                    <div className={styles.fillRow}>
                      {/* How broadly the shapes are read: more, and the lines sweep in long curves; less, and they follow every turn. */}
                      <NumberField label="Flow mm" min={0} max={20} step={0.5} value={photo.streamFlowMm ?? STREAM_DEFAULTS.flowMm} onChange={(streamFlowMm) => actions.set({ streamFlowMm })} />
                      <NumberField label="Passes" min={1} max={2} step={1} value={photo.streamPasses ?? STREAM_DEFAULTS.passes} onChange={(streamPasses) => actions.set({ streamPasses })} />
                    </div>
                    {eachLayer("Angle, spacing, widest, flow and passes")}
                  </>
                ) : photo.style === "oneline" ? (
                  <>
                    {/* No angles: the line goes where the dots are. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Dots" min={50} max={ONE_LINE_MOST} step={500} value={photo.lineDots ?? ONE_LINE_DEFAULTS.dots} onChange={(lineDots) => actions.set({ lineDots })} />
                      {/* 0 keeps it one unbroken line; more, and the pen lifts over jumps that long, leaving white as paper. */}
                      <NumberField label="Lift over" unit="mm" min={0} max={100} step={1} value={photo.lineLiftMm ?? 0} onChange={(v) => actions.set({ lineLiftMm: v > 0 ? v : undefined })} />
                    </div>
                    <div className={styles.fillRow}>
                      {/* 0, straight from dot to dot - angular; 100, smooth curves through them; 200, overshooting into loops. */}
                      <NumberField label="Curviness" unit="%" min={0} max={200} step={10} value={Math.round((photo.lineCurve ?? 0) * 100)} onChange={(v) => actions.set({ lineCurve: v > 0 ? v / 100 : undefined })} />
                      {/* 0, the dots spread evenly - a tidy maze; 100, left as scattered - looser, with clumps and gaps. */}
                      <NumberField label="Grain" unit="%" min={0} max={100} step={10} value={Math.round((photo.lineGrain ?? 0) * 100)} onChange={(v) => actions.set({ lineGrain: v > 0 ? v / 100 : undefined })} />
                      {/* Less, more dots in the lights, for detail there; more, crowded into the darks, punchier. */}
                      <NumberField label="Contrast" unit="%" min={0} max={100} step={10} value={Math.round((photo.lineContrast ?? 0.5) * 100)} onChange={(v) => actions.set({ lineContrast: v === 50 ? undefined : v / 100 })} />
                    </div>
                    <div className={styles.fillRow}>
                      {/* Which way the line prefers to run, and how strongly: 0, any way; 100, in streaks that way. */}
                      <NumberField label="Direction" unit="°" min={-180} max={180} step={15} value={photo.lineAngle ?? 0} onChange={(v) => actions.set({ lineAngle: v || undefined })} />
                      <NumberField label="Strength" unit="%" min={0} max={100} step={10} value={Math.round((photo.lineBias ?? 0) * 100)} onChange={(v) => actions.set({ lineBias: v > 0 ? v / 100 : undefined })} />
                    </div>
                    {eachLayer("These settings")}
                  </>
                ) : photo.style === "hilbert" ? (
                  <>
                    {/* No angles: the curve runs square to the picture. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Spacing mm" min={0.1} max={5} step={0.05} value={photo.spacingMm} onChange={(spacingMm) => actions.set({ spacingMm })} />
                      {/* How big the curve's squares get in the lightest parts, so they still meander. */}
                      <NumberField label="Coarsest mm" min={0.5} max={50} step={0.5} value={photo.hilbertCoarsestMm ?? HILBERT_DEFAULTS.coarsestMm} onChange={(hilbertCoarsestMm) => actions.set({ hilbertCoarsestMm })} />
                    </div>
                    {/* Which curve: Hilbert's, folding each square in four, or Peano's, in nine - a woven look, with bigger steps of tone that Blend softens. */}
                    <SegmentedControl size="sm" variant="dark" aria-label="Curve">
                      <Segment selected={photo.hilbertCurve !== "peano"} title="Hilbert: each square folds into four - bold steps of tone" onClick={() => actions.set({ hilbertCurve: undefined })}>Hilbert</Segment>
                      <Segment selected={photo.hilbertCurve === "peano"} title="Peano: each square folds into nine - a woven, back-and-forth texture with bigger steps of tone; best with Blend" onClick={() => actions.set({ hilbertCurve: "peano" })}>Peano</Segment>
                    </SegmentedControl>
                    <div className={styles.fillRow}>
                      {/* 0, square corners - a circuit board; 100, every turn a curve - a worm. */}
                      <NumberField label="Rounding" unit="%" min={0} max={100} step={10} value={Math.round((photo.hilbertRound ?? 0) * 100)} onChange={(v) => actions.set({ hilbertRound: v > 0 ? v / 100 : undefined })} />
                      {/* 0, hard steps of tone; 100, neighbouring steps mixed where the tone falls between them. */}
                      <NumberField label="Blend" unit="%" min={0} max={100} step={10} value={Math.round((photo.hilbertBlend ?? 0) * 100)} onChange={(v) => actions.set({ hilbertBlend: v > 0 ? v / 100 : undefined })} />
                      <NumberField label="Angle" unit="°" min={-180} max={180} step={15} value={photo.hilbertAngle ?? 0} onChange={(v) => actions.set({ hilbertAngle: v || undefined })} />
                    </div>
                    <Checkbox size="md" checked={Boolean(photo.hilbertLift)} label="Lift the pen in white areas" onChange={(e) => actions.set({ hilbertLift: e.target.checked || undefined })} />
                    {eachLayer("These settings")}
                  </>
                ) : photo.style === "outlines" ? (
                  <>
                    {/* No angles: contours follow the photo, not a direction. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Lines" min={1} max={40} step={1} value={photo.contours ?? OUTLINE_DEFAULTS.contours} onChange={(contours) => actions.set({ contours })} />
                      <NumberField label="Smoothing mm" min={0} max={20} step={0.25} value={photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm} onChange={(smoothMm) => actions.set({ smoothMm })} />
                    </div>
                    {eachLayer("Lines and smoothing")}
                  </>
                ) : photo.style === "squiggle" ? (
                  <>
                    {/* The rows are level, every layer alike, unless turned here. */}
                    {/* Which SquiggleDraw: the Processing sketch, whose waves tighten in the darks, or the
                      Inkscape extension's grid, whose waves keep their frequency and only grow. */}
                    <SegmentedControl size="sm" variant="dark" aria-label="SquiggleDraw version">
                      <Segment selected={photo.squiggleVersion !== "inkscape"} title="Processing: SquiggleDraw's sketch - waves taller and tighter where it's darker" onClick={() => actions.set({ squiggleVersion: undefined })}>Processing</Segment>
                      <Segment selected={photo.squiggleVersion === "inkscape"} title="Inkscape: SquiggleDraw for Inkscape - a grid of cells, the same number of rounded waves in each, taller where it's darker" onClick={() => actions.set({ squiggleVersion: "inkscape" })}>Inkscape</Segment>
                    </SegmentedControl>
                    {photo.squiggleVersion === "inkscape" ? (
                      <>
                        {/* The extension's own controls, its names, ranges and numbers; the angle and lifting are Photo's. */}
                        <div className={styles.fillRow}>
                          {squiggleAngleField}
                          {inkscapeField("rows")}
                        </div>
                        <div className={styles.fillRow}>
                          {inkscapeField("cols")}
                          {inkscapeField("freq")}
                        </div>
                        <div className={styles.fillRow}>
                          {inkscapeField("amp")}
                          <InputSelect size="md" label="Path direction" value={squiggleInkscapeOf(photo).path} onChange={(e) => setInkscape({ path: e.target.value as SquiggleInkscape["path"] })}>
                            <option value="uni">Left-to-Right</option>
                            <option value="bidi">Back-and-Forth</option>
                            <option value="join">Back-and-Forth with Joined Ends</option>
                          </InputSelect>
                        </div>
                        <Checkbox size="md" checked={squiggleInkscapeOf(photo).invert} label="Invert colors" onChange={(e) => setInkscape({ invert: e.target.checked })} />
                        <Checkbox size="md" checked={Boolean(photo.squiggleLift)} label="Lift the pen in white areas" onChange={(e) => actions.set({ squiggleLift: e.target.checked || undefined })} />
                        <Button size="sm" variant="secondary" onClick={() => actions.set({ squiggleInkscape: undefined })}>Default</Button>
                      </>
                    ) : (
                      <>
                        {/* SquiggleDraw's own controls, its names, ranges and numbers, so a photo comes out as
                          the sketch draws it; the angle, smoothness and lifting are Photo's, over it. */}
                        <div className={styles.fillRow}>
                          {squiggleAngleField}
                          {squiggleField("lines")}
                        </div>
                        <div className={styles.fillRow}>
                          {squiggleField("strength")}
                          {squiggleField("frequency")}
                        </div>
                        <div className={styles.fillRow}>
                          {squiggleField("detail")}
                          {squiggleField("lineWidth")}
                        </div>
                        <div className={styles.fillRow}>
                          {squiggleField("black")}
                          {squiggleField("white")}
                        </div>
                        <div className={styles.fillRow}>
                          {squiggleField("scale")}
                          {/* How round the waves are: 0 a zigzag, 100 as SquiggleDraw draws them, 200 broad round crests. */}
                          <NumberField label="Smoothness" unit="%" min={0} max={200} step={10} value={Math.round((photo.squiggleSmooth ?? 1) * 100)} onChange={(v) => actions.set({ squiggleSmooth: v / 100 })} />
                        </div>
                        <Checkbox size="md" checked={squiggleDrawOf(photo).invert} label="Invert colors" onChange={(e) => setSquiggle({ invert: e.target.checked })} />
                        <Checkbox size="md" checked={Boolean(photo.squiggleJoin)} label="Connect ends" onChange={(e) => actions.set({ squiggleJoin: e.target.checked || undefined })} />
                        <Checkbox size="md" checked={Boolean(photo.squiggleLift)} label="Lift the pen in white areas" onChange={(e) => actions.set({ squiggleLift: e.target.checked || undefined })} />
                        <Button size="sm" variant="secondary" onClick={() => actions.set({ squiggleDraw: undefined, squiggleSmooth: undefined, squiggleJoin: undefined })}>Default</Button>
                      </>
                    )}
                    {eachLayer("These settings")}
                  </>
                ) : photo.style === "waves" ? (
                  <>
                    {/* The layers' angles first, as Hatching's. */}
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
                          {`${photo.levels} ${photo.levels === 1 ? "pass" : "passes"} of a ${pen} mm line at ${photo.spacingMm} mm spacing cover at most ${Math.round(most * 100)}% of the paper, so colors stay paler than the image's.${enough < photo.spacingMm ? ` About ${enough} mm spacing would let them reach full strength.` : ""}`}
                        </p>
                      );
                    })()}
                    {/* The photo smoothed before it's hatched, so busy patches read as tone rather than dashes. */}
                    <div className={styles.fillRow}>
                      <NumberField label="Smoothing mm" min={0} max={5} step={0.1} value={photo.hatchSmoothMm ?? 0} onChange={(v) => actions.set({ hatchSmoothMm: v > 0 ? v : undefined })} />
                      {/* Strokes shorter than this are left out: dabs, not lines. Until it's set, one and
                        a half line spacings, following the spacing. */}
                      <div title="Leave out strokes shorter than this: a tap of the pen rather than a line. Until set, one and a half line spacings">
                        <NumberField
                          label="Shortest stroke mm"
                          min={0}
                          max={50}
                          step={0.1}
                          value={hatchShortestOf(photo)}
                          onChange={(v) => actions.set({ hatchShortestMm: Math.abs(v - hatchShortestOf({ spacingMm: photo.spacingMm })) < 1e-9 ? undefined : Math.max(0, v) })}
                        />
                      </div>
                    </div>
                    {eachLayer("Angle, spacing, passes, smoothing and shortest stroke")}
                  </>
                )}
                <p className={styles.empty}>
                  {marks
                    ? photo.style === "silhouette"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "loop" : "loops"}: the shape's outline${marks.strokes > 1 ? " and the holes in it" : ""}, where the picture meets white paper. Paper lighter than sets what counts as paper; Smallest drops specks and flecks.`
                      : photo.style === "centerlines"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}${marks.circles ? `, ${marks.circles} of them ${marks.circles === 1 ? "a circle" : "circles"}` : ""}, each drawn once down the middle of a stroke in the picture${marks.widthMm ? ` (they're about ${marks.widthMm.toFixed(1)} mm wide there)` : ""}. Darker than sets what counts as a line; Shortest drops specks and whiskers.`
                      : photo.style === "streamlines"
                      ? `${marks.strokes.toLocaleString()} lines, flowing along the image's shapes. They run from Spacing apart in the blacks to Widest apart, past which it's paper; Flow sets how broadly the shapes are followed${(photo.streamPasses ?? 1) > 1 ? ", and a second pass crosses the first in the darker half" : ""}.`
                      : photo.style === "oneline"
                      ? `${marks.strokes === 1 ? "One line" : `${marks.strokes.toLocaleString()} lines`} through ${(marks.dots ?? 0).toLocaleString()} dots, ${((marks.lengthMm ?? 0) / 1000).toFixed(1)} m of drawing. The dots are thicker where the image is darker, so the line winds tighter there.${marks.strokes > 1 ? " The pen lifts over jumps longer than Lift over." : ""}`
                      : photo.style === "hilbert"
                      ? `${marks.strokes === 1 ? "One line" : `${marks.strokes.toLocaleString()} lines`}, ${((marks.lengthMm ?? 0) / 1000).toFixed(1)} m of drawing, folding finer where the image is darker: from Coarsest in the lightest parts down to Spacing in the blacks, ${photo.hilbertCurve === "peano" ? "a third" : "halving"} at each step.${photo.hilbertLift ? " The pen lifts where there's nothing to draw." : ""}`
                      : photo.style === "outlines"
                      ? `${marks.strokes.toLocaleString()} contours, along the image's edges and shapes. More lines follow finer changes of tone; more smoothing, only the big ones.`
                      : photo.style === "squiggle"
                      ? `${marks.strokes.toLocaleString()} ${marks.strokes === 1 ? "line" : "lines"}. Each row swings higher and waves tighter where the image is darker${photo.squiggleLift ? ", and lifts off where there's nothing to draw" : ", and runs on flat through white"}. As SquiggleDraw ${photo.squiggleVersion === "inkscape" ? "for Inkscape" : "in Processing"} draws it, with its controls and numbers.`
                      : photo.style === "waves"
                      ? `${marks.strokes.toLocaleString()} strokes. Each row waves harder and tighter where the image is darker; white is left as paper.`
                      : `${marks.strokes.toLocaleString()} strokes. The spacing starts at the pen’s solid-fill spacing; each pass adds lines where the image is darker.`
                    : "Reading the image…"}
                </p>
              </Section>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
