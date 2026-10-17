// A photo on the page, drawn as hatching: lines whose spacing follows how dark the photo is there.
// The photo itself is kept - a working copy of it, small enough to travel inside the drawing - with a
// few numbers, and the lines are made from those every time. Nothing here is a shape to edit line by
// line: a photo is tens of thousands of strokes, and it is the photo and its numbers that are edited.

import { colorNamed } from "../colorNames";
import { FIT_CENTERED, type FitAlign } from "../geometry";
import { edgeForLayer, edgeGenFromData, edgeGenKey, edgeKeep, type EdgeGen } from "./edgeMask";
import { vignetted, vignetteFromData, vignetteKey, vignetteOn, vignetteStrength, type Vignette } from "./vignette";
import { inksOf, parseProfile, usesBpc, type InkProfile } from "./icc";
import type { Point } from "./parametric";
import { fitNodes, pathData, type Node } from "./path";

/** What a photo shape keeps: its working copy, and how it is turned into lines. */
export interface Photo {
  /** The working copy, as a data URL: a JPEG no longer than WORKING_EDGE pixels on its longer side. */
  src: string;
  /** The working copy's size in pixels, so its proportions are known before it has been read. */
  width: number;
  height: number;
  /** The file it was made from, where it was opened from NextDraw's own file browser: what Reload reads again. */
  source?: string;
  /** A channel of a Multichannel Photoshop `source`, counted from 0: what Reload reads it from. */
  sourceChannel?: number;
  /** Quarter turns given it since it came from its file, clockwise, 0 to 3: what Reload turns the file again by. */
  quarterTurns?: number;
  /**
   * The part of its file it was cropped to - left, top, right, bottom, as fractions of the file turned
   * by `quarterTurns` - so Reload cuts the file again the same way. Absent, all of it. The picture held
   * (`src`) is already cut.
   */
  cut?: [number, number, number, number];
  /** -100 to 100: lighter or darker overall. */
  brightness: number;
  /** -100 to 100: flatter or more contrasty. */
  contrast: number;
  /**
   * A separation's own brightness and contrast, -100 to 100, applied to its plate before the whole
   * image's `brightness` and `contrast`, which every plate shares. Absent, 0.
   */
  channelBrightness?: number;
  channelContrast?: number;
  /**
   * Separations: the black point, 0 to 90 percent - every tone at least that dark is full ink, and
   * the lighter ones stretched to meet it, white staying white. Punches the shadows. `blackPoint` is
   * the whole image's, every plate alike; `channelBlackPoint` a plate's own, before it. Absent, 0.
   */
  blackPoint?: number;
  channelBlackPoint?: number;
  /**
   * Split by a printer's color profile: the profile's file in NextDraw's Color profiles folder, its name,
   * the rendering intent (0 perceptual, 1 relative colorimetric, 2 saturation) and which of its inks
   * this layer is. The layer draws that ink's share of the photo, worked out from `src` as it's drawn -
   * the photo itself stays as it is, so turning or replacing it splits it again. Its `separation` is
   * the ink's name, so it's set and seen as a separation is.
   */
  profile?: string;
  profileName?: string;
  profileIntent?: number;
  /** Black point compensation, for Relative colorimetric: the photo's black brought to the inks' own
   *  rather than clipped (see icc.ts, pcsFit). Absent, off. */
  profileBpc?: boolean;
  profileInk?: number;
  /** -100 to 100: greyer or more vivid - -100 grey, 100 twice as colourful. The lightness stays. Absent, 0. */
  saturation?: number;
  /** Degrees: the direction of the first set of lines. The second crosses it at a right angle. */
  angle: number;
  /**
   * How the layers of a photo are set at angles to each other, so they don't all lie the same way -
   * the whole photo's (each layer keeps a copy). Each layer's `angle` is the preset's for its place,
   * turned by `angleTurn`. Absent, classic.
   */
  anglePreset?: AnglePreset;
  /** Degrees the whole preset is turned. Absent, none. */
  angleTurn?: number;
  /** The closest the lines ever come, in mm: the spacing the tool fills solid at. */
  spacingMm: number;
  /**
   * How many passes of lines build up the darks, 1 to 6: two directions, then each again between,
   * then the two diagonals across them for the deepest darks.
   */
  levels: number;
  /**
   * Hatching: how much the photo is smoothed before it's hatched, in mm on the page - so a busy
   * patch (skin, hair, grain) reads as an even tone rather than a speckle of short dashes. Absent, none.
   */
  hatchSmoothMm?: number;
  /**
   * Hatching: the shortest stroke drawn, in mm on the page - anything shorter is left out, a tap of
   * the pen rather than a line. Absent, one and a half line spacings.
   */
  hatchShortestMm?: number;
  /**
   * What the tone is drawn as: hatching, lines crossing and filling in as it darkens; or tone lines,
   * one line along each row that waves harder and tighter where it's darker; or squiggles, the same
   * drawn the way SquiggleDraw draws it - smooth curves, unbroken through white, rows joinable into
   * one line. Absent, hatching.
   */
  style?: "hatch" | "waves" | "squiggle" | "streamlines" | "scribble" | "oneline" | "hilbert" | "outlines" | "centerlines" | "silhouette" | "edges" | "paint";
  /**
   * Edges: how sharp a change of tone, 0 to 1 against the picture's sharpest, counts as an edge - the
   * line where a wall meets a ceiling, round a window. Lower finds fainter edges.
   */
  edgeFrom?: number;
  /** Edges: how much the picture is smoothed first, in mm on the page, so texture and grain aren't edges. */
  edgeSmoothMm?: number;
  /** Edges: edges shorter than this are left out, in mm. */
  edgeShortestMm?: number;
  /** Hilbert curve: the largest its squares get, in mm, however light - so light areas still meander. */
  hilbertCoarsestMm?: number;
  /** Hilbert curve: lift the pen where this layer has nothing to draw, rather than meandering on through white. */
  hilbertLift?: boolean;
  /** Hilbert curve: which curve - Hilbert's, folding in four, or Peano's, in nine (bigger steps of tone, a woven look). Absent, Hilbert. */
  hilbertCurve?: "hilbert" | "peano";
  /** Hilbert curve: how round its corners are, 0 to 1 - 1 every turn a curve. Absent, square. */
  hilbertRound?: number;
  /** Hilbert curve: how much the steps of tone are blended, 0 to 1. Absent, hard steps. */
  hilbertBlend?: number;
  /** Hilbert curve: the whole curve turned, in degrees. Absent, square to the picture. */
  hilbertAngle?: number;
  /** One line: how many dots the line is drawn through. More, a finer picture and a longer line. */
  lineDots?: number;
  /** One line: lift the pen over jumps longer than this, in mm, so white stays paper. Absent or 0, never. */
  lineLiftMm?: number;
  /** One line: how round the line is, 0 to 2 - 0 straight from dot to dot, 1 smooth curves through them, 2 loops. Absent, 0. */
  lineCurve?: number;
  /** One line: the way the line prefers to run, in degrees, and how strongly, 0 to 1. Absent, any way. */
  lineAngle?: number;
  lineBias?: number;
  /** One line: how grainy the dots are, 0 to 1 - 0 spread evenly, like stipple; 1 left as scattered. Absent, 0. */
  lineGrain?: number;
  /** One line: how strongly the dots crowd into the darks, 0 to 1. Absent, 0.5. */
  lineContrast?: number;
  /**
   * Streamlines: the widest the lines ever get apart, in mm - lighter than that is paper. The closest
   * is `spacingMm`, at black; between, the spacing follows the tone.
   */
  /**
   * Scribble: how long one stroke runs at most, in mm, and how short it may be before it's left out
   * (0, or absent, keeps all but the tiniest); how much it curls, 0 to 100 - gentle bends to
   * tight loops; and which of its random scribbles it is - a new number, a new scribble. Absent, the
   * defaults (SCRIBBLE_DEFAULTS).
   */
  scribbleLengthMm?: number;
  scribbleMinMm?: number;
  scribbleWiggle?: number;
  scribbleSeed?: number;
  /**
   * Paint: how far the borders between colors are smoothed, in mm; the smallest region kept, as the
   * side of a square in mm - a smaller one takes its biggest neighbor's color; and whether each
   * region has a line round it (absent, it has). Absent, the defaults (PAINT_DEFAULTS).
   */
  paintSmoothMm?: number;
  paintSmallestMm?: number;
  paintOutline?: boolean;
  streamWidestMm?: number;
  /** Streamlines: 1, or 2 for a second pass across the first in the darker half of the tones. Absent, 1. */
  streamPasses?: number;
  /** Streamlines: how broadly the picture's shapes are read before the lines follow them, in mm. More, longer sweeps. */
  streamFlowMm?: number;
  /** Outlines: how many contours, spread across the tones this layer draws. */
  contours?: number;
  /** Outlines: how much fine detail and noise is smoothed away first, in mm on the page. */
  smoothMm?: number;
  /**
   * Centerlines: how dark, 0 to 1, a part of the picture is before it counts as a line. Each dark
   * stroke of the picture is drawn once, down its middle, however wide it is.
   */
  centerFrom?: number;
  /** Centerlines: how much the picture is smoothed first, in mm on the page, so a ragged edge doesn't sprout whiskers. */
  centerSmoothMm?: number;
  /** Centerlines: lines and whiskers shorter than this are left out, in mm. */
  centerShortestMm?: number;
  /**
   * Centerlines: how lines are drawn - smooth curves; straight segments, straight edges dead straight
   * and every corner sharp; or mixed, straight where the line runs straight and curved where it bends.
   * Absent, curves - or straight, for a drawing saved with only `centerStraightMm`, before mixed.
   */
  centerMode?: "curves" | "mixed" | "straight";
  /** Centerlines, straight or mixed: how far, in mm, a straight segment may stray from the traced line. */
  centerStraightMm?: number;
  /** Centerlines, mixed: a straight stretch at least this long, in mm, is drawn straight; shorter ones belong to curves. */
  centerLongMm?: number;
  /**
   * Centerlines, curves or mixed: where a line turns more than this many degrees it keeps a sharp
   * corner rather than being rounded through it. Absent or 0, only a line's tips are sharp.
   */
  centerCornerDeg?: number;
  /**
   * Silhouette: how light, 0 to 1, a part of the picture is before it counts as paper. The shape is
   * drawn round where paint meets paper - its outline, and each hole in it as a loop of its own.
   */
  silhouetteFrom?: number;
  /** Silhouette: how much the edge is smoothed first, in mm on the page, so brush texture isn't followed. */
  silhouetteSmoothMm?: number;
  /** Silhouette: loops shorter than this all the way round are left out, in mm: specks of paint, flecks of paper. */
  silhouetteSmallestMm?: number;
  /** Tone lines: how far apart the rows are, in mm. */
  rowMm?: number;
  /** Tone lines: the length of one wave where the photo is darkest, in mm. Lighter tones stretch it. */
  waveMm?: number;
  /**
   * Squiggle (after SquiggleDraw, 2026-10-10): how far the line swings either side of its row at
   * black, in mm - whatever the rows' spacing, so the waves and the gap between rows are set apart.
   * Half the spacing and neighbouring rows' waves just meet; more and they overlap. Rows and wave
   * length are tone lines' `rowMm` and `waveMm`.
   */
  squiggleAmpMm?: number;
  /** Squiggle, as first saved: the swing as a share of half the row spacing. Read for old drawings; squiggleAmpMm wins. */
  squiggleHeight?: number;
  /** Squiggle: each row turns round into the next, so the photo is one line wherever nothing breaks it. */
  squiggleJoin?: boolean;
  /**
   * Squiggle: lift the pen where this layer has nothing to draw - white, another band's tone, another
   * pen's colour - rather than running on as a flat line, so bare paper stays bare. Off, every layer's
   * rows are unbroken, edge to edge, as SquiggleDraw's.
   */
  squiggleLift?: boolean;
  /**
   * Squiggle: how round the waves are, as a share - 0 a zigzag of straight lines, 1 the curve through
   * the crests as first built, 2 broad round crests. Absent, 1.
   */
  squiggleSmooth?: number;
  /** Squiggle: SquiggleDraw's own controls, those changed from its defaults - see SQUIGGLE_DRAW. */
  squiggleDraw?: Partial<SquiggleDraw>;
  /** Squiggle: which SquiggleDraw it follows - the Processing sketch, or the Inkscape extension. Absent, Processing. */
  squiggleVersion?: "processing" | "inkscape";
  /** Squiggle, the Inkscape way: the extension's controls, those changed from its defaults - see SQUIGGLE_INKSCAPE. */
  squiggleInkscape?: Partial<SquiggleInkscape>;
  /**
   * Squiggle: the rows' angle, in degrees - every layer the same, left to right, unless changed.
   * Its own, not hatching's `angle`, whose presets set each color at its own angle. Absent, 0.
   */
  squiggleAngle?: number;
  /**
   * Split by colour: the photo's colours gathered into groups of similar colours, `regions`, each
   * the average colour of its group. This layer draws group number `region`'s area, in its pen, `ink`
   * - the palette's nearest to that group, or whichever pen its layer has been given since. Absent,
   * the photo is read by its lightness alone, as black and white.
   */
  ink?: string;
  regions?: string[];
  region?: number;
  /**
   * Split by best fit (NextDraw Photo, 2026-10-06): the pens were chosen for how they come out on
   * paper, and `regions` are those pens' colours on this paper, solid. Each point goes to the pen whose
   * colour, at the share of paper that matches best, comes nearest the photo's - mixed in linear light
   * - and that pen hatches it as near that share as its passes allow. Absent, `regions` are the
   * photo's own colour groups, as before.
   */
  fitPaper?: string;
  /** Split by best fit: the pen's real line width, in mm, which with the spacing sets how much paper a pass covers. */
  penMm?: number;
  /** Split by best fit: two pens may be hatched across each other where together they come nearer than either alone. */
  fitPairs?: boolean;
  /** Split by best fit: the tool's ink covers what's under it rather than letting it show through. */
  fitOpaque?: boolean;
  /**
   * The key layer of a photo split by colour: shading drawn over the colours in its ink, across the
   * whole photo, heavier where it's darker - like shading a coloured drawing with a black pen. Only
   * one of a photo's layers is the key; it has no `region`.
   */
  key?: boolean;
  /**
   * How the photo was split the other way, kept for when it's split that way again: switching between
   * value and colour puts back the layers and settings it had, rather than starting over.
   */
  modes?: Partial<Record<"value" | "colour" | "cmyk", PhotoPart[]>>;
  /** Split by colour: every group's pen, by group, and the key's, so each layer can be worked out alongside the rest. */
  regionInks?: (string | null)[];
  keyInk?: string;
  /** How heavy the key's shading gets at black, 0 to 1. The whole photo's. Absent, full. */
  keyStrength?: number;
  /** How dark, 0 to 1, a part of the photo is before the key shades it. The whole photo's. */
  keyFrom?: number;
  /**
   * Split into CMYK: this layer is one of four plates - cyan, magenta, yellow, black - drawn across
   * the whole photo in its pen, `ink`, and blended on paper with the others. `plates` is all four
   * pens, in that order, so each plate is worked out alongside the rest.
   */
  plate?: Plate;
  plates?: string[];
  /**
   * A separation made elsewhere: this layer's picture is one greyscale plate of a photo already
   * split - cyan, magenta, yellow, black, or any other ink - darker where more of this layer's pen
   * goes. Named by what it is: a plate's name ("Cyan") or the file's. Its layers are one photo on
   * the page, as a split is, but each draws its own picture rather than a part of a shared one.
   */
  separation?: string;
  /** CMYK: how much of the grey the colours share goes to the black plate, 0 to 1. The whole photo's. */
  blackShare?: number;
  /**
   * How far this layer's lines are shifted from where the photo puts them, in mm across and down:
   * to bring one layer into register with another, or to set it deliberately out of register. Each
   * layer's own; the photo and the other layers stay where they are.
   */
  offsetMm?: [number, number];
  /**
   * A photo split into tone bands is several photo shapes, one per band, each on a layer of its own:
   * the same picture in the same place, each drawing only the part of it whose tone is in its band.
   * They share this, so they move and size as one photo.
   */
  group?: string;
  /**
   * Passes over one image: each pass is a group of its own (or a single layer) with its own effect
   * and settings - hatching for the shading, edges over it, say - and all of them share this, so
   * they stay the same picture in the same place: moved, sized, cropped, turned, masked as one.
   */
  link?: string;
  /** How dark this band is, from and to: 0 is white, 1 black. Absent, the whole photo. */
  band?: [number, number];
  /**
   * Split around the paper (B&W, "Dark + light pens", 2026-10-11): the paper is one of the tones -
   * black and white pens on gray paper, the midtones left bare. `paperTone` is the picture's tones
   * left as paper, as darkness from and to (0 white, 1 black); `side` which way from it this layer
   * draws: "dark", the tones darker than that in a pen darker than the paper, or "light", the tones
   * lighter in a pen lighter than it. Either way more lines the further from the paper, none at its
   * edge; `band` is then a share of the side, from the paper outwards. Absent, the paper is white
   * and every layer draws darkness, as before.
   */
  side?: "dark" | "light";
  paperTone?: [number, number];
  /** The paper's tones were set by hand. Otherwise they follow the paper's color when it changes. */
  paperToneSet?: boolean;
  /**
   * How far each band reaches into its neighbours, as a share of the whole range from white to black:
   * 0.05 takes a middle third from 33-67% to 28-72%. Where bands meet, both draw, so their lines
   * overlap there rather than stopping at a hard edge. The whole photo's, like its contrast.
   */
  bleed?: number;
  /**
   * The part of the picture that is drawn, as fractions of it across and down: left, top, right,
   * bottom. Absent, all of it. Filling the page crops whatever would hang off it, rather than
   * drawing lines past the paper's edge.
   */
  crop?: [number, number, number, number];
  /**
   * An edge mask: a picture laid over the part of the image that shows, stretched to it, whose black
   * is paper - a grunge border, a torn edge. Where it's black the image fades to white before any
   * effect reads it, so every layer and every style leaves it bare; grey fades it part way. A data
   * URL, read like the image itself. The whole photo's. Absent, none.
   */
  edgeMask?: string;
  /** The mask's file name, to say which it is. */
  edgeMaskName?: string;
  /** The mask read the other way: white is paper, black keeps the image. */
  edgeMaskInvert?: boolean;
  /**
   * The sides the mask works on, for a drawing that bleeds off only some of them. A side left out has
   * the mask's border on it cut away, the rest stretched over the space, so the borders that remain
   * run on to that edge. Absent, all four.
   */
  edgeMaskSides?: MaskSide[];
  /**
   * A random edge made rather than loaded: a style, a seed and how deep and rough it is, from which
   * the same edge is made again every time (edgeMask.ts). In place of `edgeMask`, never with it.
   */
  edgeGen?: EdgeGen;
  /**
   * A vignette: the picture darkened toward its edges, or faded toward the paper, inside the part that
   * shows, before any effect reads it (vignette.ts). The whole photo's, like the edge mask. Absent, none.
   */
  vignette?: Vignette;
  /** Sized to the page: all of it as large as it fits, or filling the page and cropped. Absent once
   *  it has been moved or sized by hand. A photo sized to the page is sized again when the page is. */
  fit?: "fit" | "fill";
  /** The margin, in inches, it is fitted or filled inside. */
  margin?: number;
  /** Where a fitted photo sits in the room the margin leaves: against an edge, or centred. Absent, centred. */
  align?: FitAlign;
}

/** How a photo is split: by value, into colour groups, into CMYK plates, or already split into separations elsewhere. */
export const photoMode = (p: Photo) => (p.profile ? "profile" : p.separation ? "separations" : p.plate ? "cmyk" : p.ink ? "colour" : "value");

/**
 * Where a photo goes to fit or fill a page, inside a margin: its box, and the part of it that shows.
 * `aspect` is the picture's width over its height.
 */
export function placeOnPage(aspect: number, page: { w: number; h: number }, how: "fit" | "fill", margin: number, align: FitAlign = FIT_CENTERED) {
  const m = Math.max(0, Math.min(margin, page.w / 2 - 0.1, page.h / 2 - 0.1));
  const aw = page.w - m * 2;
  const ah = page.h - m * 2;
  if (how === "fit") {
    const k = Math.min(aw / aspect, ah);
    const w = aspect * k;
    const h = k;
    // What it doesn't fill one way goes where the alignment says: before it, after it, or both halves.
    const x = m + (aw - w) * align.x;
    const y = m + (ah - h) * align.y;
    return { x, y, x2: x + w, y2: y + h, crop: undefined };
  }
  // Filling: the whole area inside the margin, with the picture cropped on the sides that don't fit -
  // evenly, keeping its middle, or keeping the edge the alignment names: Left keeps its left side.
  const area = aw / ah;
  const cut = aspect > area ? 1 - area / aspect : 1 - aspect / area;
  const crop: [number, number, number, number] = aspect > area
    ? [cut * align.x, 0, cut * align.x + (1 - cut), 1]
    : [0, cut * align.y, 1, cut * align.y + (1 - cut)];
  return { x: m, y: m, x2: page.w - m, y2: page.h - m, crop };
}

/** The four plates of a CMYK split, in the order they're worked out. */
export type Plate = "c" | "m" | "y" | "k" | "o" | "g" | "r" | "v";
/** Print's four plates: what separations made elsewhere are, and the first four of every plate set. */
export const PLATES: Plate[] = ["c", "m", "y", "k"];

/**
 * The plate sets a photo can be separated into: CMYK, and CMYK with more inks for truer, brighter
 * colour - Hexachrome's orange and green, today's extended gamut's orange, green and violet, and
 * those with red too. Black is always fourth. More plates, fewer colours left to mixing.
 */
export type PlateSet = "cmyk" | "cmykog" | "cmykogv" | "cmykogrv";
export const PLATE_SETS: { key: PlateSet; label: string; about: string; plates: Plate[] }[] = [
  { key: "cmyk", label: "CMYK", about: "Print's four plates: cyan, magenta, yellow and black", plates: ["c", "m", "y", "k"] },
  { key: "cmykog", label: "CMYK + OG", about: "Six plates, as Hexachrome printing: CMYK with orange and green", plates: ["c", "m", "y", "k", "o", "g"] },
  { key: "cmykogv", label: "CMYK + OGV", about: "Seven plates, as today's extended-gamut printing: CMYK with orange, green and violet", plates: ["c", "m", "y", "k", "o", "g", "v"] },
  { key: "cmykogrv", label: "CMYK + OGRV", about: "Eight plates: CMYK with orange, green, red and violet", plates: ["c", "m", "y", "k", "o", "g", "r", "v"] },
];
/** Which plate set a photo's plates are, by how many there are. */
export const plateSetOf = (plates: unknown[] | undefined): PlateSet =>
  PLATE_SETS.find((s) => s.plates.length === (plates?.length ?? 4))?.key ?? "cmyk";
/** The plates, in order, of the set a photo's plates are. */
/** A plate set to None: its channel is left out - the others are separated without it, and it draws nothing. */
export const PLATE_OFF = "none";

export const platesOf = (plates: unknown[] | undefined): Plate[] => PLATE_SETS.find((s) => s.key === plateSetOf(plates))!.plates;

/**
 * What each plate aims for - printing's own cyan, magenta, yellow and black, to find the nearest pen
 * to - and the angle it's hatched at: print's screen angles, apart enough that the four don't make
 * moiré patterns where they cross.
 */
export const PLATE_AIMS: Record<Plate, { name: string; color: string; angle: number }> = {
  c: { name: "Cyan", color: "#00a3e0", angle: 15 },
  m: { name: "Magenta", color: "#d6007a", angle: 75 },
  y: { name: "Yellow", color: "#ffe500", angle: 0 },
  k: { name: "Black", color: "#1a1a1a", angle: 45 },
  // The extra plates, at angles between CMYK's - apart from them and from each other, hatching's own
  // right-angle cross counted.
  o: { name: "Orange", color: "#ff6a13", angle: 30 },
  g: { name: "Green", color: "#00a650", angle: 60 },
  r: { name: "Red", color: "#e4002b", angle: 7.5 },
  v: { name: "Violet", color: "#5b2c8f", angle: 52.5 },
};

/** A colour's hue round the colour wheel (0-360), saturation and value (0-1). */
function hsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/**
 * The pens a palette has for the four plates, each used once: black the darkest, and cyan, magenta
 * and yellow each the pen nearest printing's own round the colour wheel - by hue, as a painter would
 * match them, among pens with colour enough to count. Measured in a space where distance means
 * colour, a pale violet can come out nearer cyan than a real turquoise does; by hue, it doesn't.
 */
export function platePens<P extends { color: string }>(palette: P[], plates: Plate[] = PLATES, hatching = { penMm: 0.5, spacingMm: 1, levels: 4 }): (P | undefined)[] {
  const out: (P | undefined)[] = plates.map(() => undefined);
  const used = new Set<P>();
  const black = plates.indexOf("k");
  const darkest = [...palette].sort((a, b) => hsv(a.color)[2] - hsv(b.color)[2])[0];
  if (darkest && black >= 0) { out[black] = darkest; used.add(darkest); }
  const pairs: { plate: number; pen: P; score: number }[] = [];
  plates.forEach((plate, i) => {
    if (plate === "k") return;
    const [ah, as, av] = hsv(PLATE_AIMS[plate].color);
    for (const pen of palette) {
      const [h, sat, val] = hsv(pen.color);
      if (sat < 0.25) continue;
      const turn = Math.min(Math.abs(h - ah), 360 - Math.abs(h - ah));
      pairs.push({ plate: i, pen, score: turn + 40 * Math.abs(sat - as) + 30 * Math.abs(val - av) });
    }
  });
  pairs.sort((a, b) => a.score - b.score);
  for (const { plate, pen } of pairs) {
    if (out[plate] || used.has(pen)) continue;
    out[plate] = pen;
    used.add(pen);
  }
  // Then, plate by plate, whichever pen near its hue makes the hatching come nearest a range of photo
  // colours: matching by hue alone takes a dark pen near the hue (a brown for orange, a wine for
  // magenta) over a truer one a little further round, and the drawing comes out muddy.
  return refinePlatePens(palette, plates, out, hatching);
}

/** Colours a photo is made of, to judge a set of plate pens by: skin, sky, leaves, shadow, and each hue. */
const PEN_TEST_COLOURS: [number, number, number][] = [
  [225, 170, 140], [190, 130, 100], [120, 75, 55], [120, 170, 220], [60, 110, 50], [200, 40, 40],
  [240, 140, 40], [120, 60, 140], [128, 128, 128], [40, 30, 30], [240, 230, 180], [40, 130, 130],
  [230, 90, 150], [40, 60, 140], [250, 210, 60], [150, 200, 120],
];

/**
 * How near, on average in ΔE, hatching with these pens comes to the test colours - and to each plate's
 * own colour, so a red plate is judged on drawing red as well as on everything else.
 */
function plateSetError(pens: number[][], steps: number[], plates: Plate[]): number {
  const colours = [...PEN_TEST_COLOURS, ...plates.filter((p) => p !== "k").map((p) => {
    const n = parseInt(PLATE_AIMS[p].color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
  })];
  const reach = withinReach(pens, steps);
  let sum = 0;
  for (const rgb of colours) {
    const want = reach(labOfLinear(rgb.map(linear)));
    // As the hatching will draw them: each pen's amount rounded to its nearest number of passes.
    const covers = chooseCovers(want, pens, steps, BLACK_SHARE, null).map((c) => {
      const tone = coverTone(c, steps);
      return tone ? steps[Math.floor(tone * steps.length)] : 0;
    });
    const got = labOfLinear(mixOf([1, 1, 1], pens, covers, false));
    sum += Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
  }
  return sum / colours.length;
}

function refinePlatePens<P extends { color: string }>(palette: P[], plates: Plate[], picked: (P | undefined)[], hatching: { penMm: number; spacingMm: number; levels: number }): (P | undefined)[] {
  if (picked.some((p) => !p)) return picked;
  const out = [...picked];
  const steps = coverSteps(hatching.penMm, hatching.spacingMm, hatching.levels);
  const pensOf = (list: (P | undefined)[]) => list.map((p) => hexLinear(p!.color));
  let best = plateSetError(pensOf(out), steps, plates);
  for (let round = 0; round < 2; round++) {
    let better = false;
    plates.forEach((plate, i) => {
      if (plate === "k") return;
      const ah = hsv(PLATE_AIMS[plate].color)[0];
      for (const pen of palette) {
        if (out.includes(pen)) continue;
        const [h, sat] = hsv(pen.color);
        // Only pens that are this plate's colour still - within 20° of its hue - so an orange plate
        // stays orange, choosing among oranges: 30° and it drifts to whatever pen the test colours
        // happen to like (a second yellow as the orange plate); 15° missed EnerGel's Lime Green,
        // which draws green truer than its Green. And strong enough to be that colour, not a tint.
        const off = (hue: number) => Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
        if (sat < 0.45 || off(ah) > 20) continue;
        // And nearer this plate's hue than any other plate's in the set: a pink is magenta's, not
        // red's, and a golden yellow is yellow's, not orange's.
        if (plates.some((other) => other !== plate && other !== "k" && off(hsv(PLATE_AIMS[other].color)[0]) < off(ah))) continue;
        const trial = [...out];
        trial[i] = pen;
        const e = plateSetError(pensOf(trial), steps, plates);
        if (e < best - 1e-6) { best = e; out[i] = pen; better = true; }
      }
    });
    if (!better) break;
  }
  return out;
}

// The words a separation's file can name its plate by: CMYK and the extra inks.
const PLATE_WORDS: [string, Plate][] = [
  ["cyan", "c"], ["magenta", "m"], ["yellow", "y"], ["black", "k"], ["key", "k"],
  ["orange", "o"], ["green", "g"], ["red", "r"], ["violet", "v"], ["purple", "v"],
];
// Long enough to find inside a run-together name - "portraitcyan" - without "red" turning up in "colored".
const FINDABLE = new Set(["cyan", "magenta", "yellow", "black", "orange", "green", "violet", "purple"]);

/** A file's name as lowercase words: its extension off, split at anything not a letter or digit and at camelCase. */
const nameWords = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Which ink a separation's file is for, from its name however it's written - "Portrait_Cyan.png",
 * "portrait-cyan-channel.tif", "PortraitMagenta.jpg", "img yellow 2.png", "portrait_K.png". In turn:
 * a plate's name as a word of its own (CMYK and the extra inks: orange, green, red, violet), the
 * last such word winning; a long plate name run into others ("portraitcyan"); one of the palette's
 * pens by its name ("Pink", "Light gray"), the longest name found; any other color by its name
 * (colorNames.ts: "peach", "cranberry", "federal blue"); or C, M, Y or K as a word of its own.
 * Undefined when the name says no ink.
 */
export function inkNamed<P extends { name: string }>(name: string, pens: P[] = []): { plate?: Plate; pen?: P; color?: { name: string; color: string } } | undefined {
  const words = nameWords(name);
  for (let i = words.length - 1; i >= 0; i--) {
    const plate = PLATE_WORDS.find(([w]) => w === words[i])?.[1];
    if (plate) return { plate };
  }
  const joined = words.join("");
  const found = PLATE_WORDS.filter(([w]) => FINDABLE.has(w) && joined.includes(w))
    .sort((a, b) => joined.lastIndexOf(b[0]) - joined.lastIndexOf(a[0]))[0];
  if (found) return { plate: found[1] };
  const spaced = ` ${words.join(" ")} `;
  const pen = pens.filter((p) => nameWords(p.name).length && spaced.includes(` ${nameWords(p.name).join(" ")} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  // Any other color by its name - "peach", "cranberry", "federal blue" - drawn in that color, whatever
  // pen there is: one can be chosen for it later. The longer name wins, so "fluorescent pink" isn't
  // taken for the pen called Pink.
  const color = colorNamed(words);
  if (pen && (!color || nameWords(pen.name).length >= color.name.split(" ").length)) return { pen };
  if (color) return { color };
  for (let i = words.length - 1; i >= 0; i--) {
    const plate = (["c", "m", "y", "k"] as Plate[]).find((p) => p === words[i]);
    if (plate) return { plate };
  }
  return undefined;
}

/** Which plate a separation's file is, from its name (see inkNamed). Undefined when it names none. */
export const plateNamed = (name: string): Plate | undefined => inkNamed(name)?.plate;

/** The plate a layer is: a CMYK split's, or a separation's by its name ("Cyan"). For its angle. */
export const plateOfPhoto = (p: Pick<Photo, "plate" | "separation">): Plate | undefined =>
  p.plate ?? (p.separation ? plateNamed(p.separation) : undefined);

/**
 * A separation file's name without its ink, for naming the drawing they make together: "Portrait_Cyan"
 * and "portrait-cyan-channel" are both "Portrait". The ink's word goes, and the words that say a file
 * is a separation - channel, plate, separation, layer - with it. A name that is nothing but its ink
 * gives `fallback` - its folder's name - when there is one.
 */
export const stemWithoutPlate = (name: string, pens: { name: string }[] = [], fallback = "") => {
  const bare = name.replace(/\.[^.]+$/, "");
  const inks = [...PLATE_WORDS.map(([w]) => w), ...pens.map((p) => p.name.toLowerCase()), "c", "m", "y", "k", "channel", "plate", "separation", "sep", "layer"];
  const words = bare.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_\-.()]+/).filter(Boolean);
  const kept = words.filter((w) => !inks.includes(w.toLowerCase()));
  // A file named for its ink alone - "cyan.png" - leaves nothing: the folder it came from, if known.
  return kept.join(" ").trim() || fallback || bare;
};

/** How much of the colours' shared grey goes to the black plate unless set: half, as print often does. */
export const BLACK_SHARE = 0.5;

/** One layer of a photo as it was split: the layer, the shape, and that layer's own settings. */
export interface PhotoPart {
  layerName: string;
  layerColor: string;
  shapeName: string;
  photo: Partial<Photo>;
}

/** The settings a layer of a photo keeps as its own, as opposed to the photo's: what a mode remembers. */
export const LAYER_SETTINGS = [
  "style", "angle", "spacingMm", "levels", "hatchSmoothMm", "hatchShortestMm", "rowMm", "waveMm", "squiggleAmpMm", "squiggleHeight", "squiggleJoin", "squiggleLift", "squiggleSmooth", "squiggleDraw", "squiggleVersion", "squiggleInkscape", "squiggleAngle", "contours", "smoothMm", "centerFrom", "centerSmoothMm", "centerShortestMm", "centerMode", "centerStraightMm", "centerLongMm", "centerCornerDeg", "edgeFrom", "edgeSmoothMm", "edgeShortestMm", "silhouetteFrom", "silhouetteSmoothMm", "silhouetteSmallestMm", "streamWidestMm", "streamPasses", "streamFlowMm", "scribbleLengthMm", "scribbleMinMm", "scribbleWiggle", "scribbleSeed", "paintSmoothMm", "paintSmallestMm", "paintOutline", "lineDots", "lineLiftMm", "lineCurve", "lineAngle", "lineBias", "lineGrain", "lineContrast", "hilbertCoarsestMm", "hilbertLift", "hilbertCurve", "hilbertRound", "hilbertBlend", "hilbertAngle", "offsetMm",
  "band", "side", "paperTone", "ink", "regions", "region", "key", "regionInks", "keyInk", "plate", "plates", "fitPaper", "penMm", "fitPairs", "fitOpaque",
] as const;

/** The picture's tones a photo split around the paper leaves bare, as darkness from and to: unless set, the middle third. */
export const paperToneOf = (photo: Pick<Photo, "paperTone">): [number, number] => {
  const [a, b] = photo.paperTone ?? [1 / 3, 2 / 3];
  return [Math.min(1, Math.max(0, Math.min(a, b))), Math.min(1, Math.max(0, Math.max(a, b)))];
};

/** What each band is called, lightest first, for a photo split into this many. */
export const BAND_NAMES: Record<number, string[]> = {
  2: ["light", "dark"],
  3: ["light", "mid", "dark"],
  4: ["lightest", "light", "dark", "darkest"],
  5: ["lightest", "light", "mid", "dark", "darkest"],
  6: ["lightest", "lighter", "light", "dark", "darker", "darkest"],
};

/** The most tone layers a photo is split into. */
export const MOST_LAYERS = 6;
/** The most layers on each side of the paper, split around it: three each, the most there are names for. */
export const MOST_SIDE_LAYERS = 3;

/** The most colors a photo is split into, by best fit or by the photo's own colors. */
export const MOST_COLORS = 8;
/** Paint's flat regions take more colors than hatching mixes: its own, higher limit. */
export const MOST_PAINT_COLORS = 10;
/** The most colors an image split by color may have, drawn this way. */
export const mostColorsOf = (photo: Pick<Photo, "style">) => (photo.style === "paint" ? MOST_PAINT_COLORS : MOST_COLORS);

/** Hatching's shortest stroke unless set: one and a half line spacings, in mm. */
export const hatchShortestOf = (photo: Pick<Photo, "hatchShortestMm" | "spacingMm">) =>
  photo.hatchShortestMm ?? Math.round(Math.max(0.05, photo.spacingMm) * 1.5 * 100) / 100;

/** The longer side of the working copy, in pixels: enough for lines a pen width apart across a big sheet. */
export const WORKING_EDGE = 1600;
export type MaskSide = "top" | "right" | "bottom" | "left";
export const MASK_SIDES: MaskSide[] = ["top", "right", "bottom", "left"];

/** An edge mask's copy: smaller than the image's, since a border only has to be rough, and every layer keeps one. */
export const MASK_EDGE_PX = 1000;

export const PHOTO_DEFAULTS = { brightness: 0, contrast: 0, angle: 45, levels: 4 };

/**
 * The angle presets: how a photo's layers are set apart, so one pen's lines never lie along
 * another's. Classic is print's: CMYK's screen angles, and for layers by tone or colour a spread from
 * 45°. Cardinal keeps to the square and its diagonals. Golden spread turns each layer by the golden
 * angle from the last - for any number of layers, as far apart as they can be. Complementary is
 * print's way with more than four inks: CMYK as Classic, and each extra ink on the angle of the one
 * opposite it on the color wheel, since the two seldom print in the same place.
 */
export type AnglePreset = "classic" | "complementary" | "cardinal" | "golden" | "uniform";
export const ANGLE_PRESETS: { key: AnglePreset; label: string; about: string }[] = [
  { key: "classic", label: "Classic", about: "Print's screen angles: cyan 15°, magenta 75°, yellow 0°, black 45°; layers by tone or color 45°, 15°, 75°, 0°, 30°, 60°" },
  { key: "complementary", label: "Complementary", about: "Print's way with extra inks: CMYK as Classic, orange on cyan's 15°, green on magenta's 75°, violet on yellow's 0°, red at 7.5°; layers by tone or color as Classic" },
  { key: "cardinal", label: "Cardinal", about: "Only horizontal, vertical and the diagonals: 0°, 90°, 45°, 135°, then round again for more layers" },
  { key: "golden", label: "Golden spread", about: "Each layer turned 137.5° - the golden angle - from the last: 0°, 137.5°, 95°, 52.5°, 10°, 147.5°" },
  { key: "uniform", label: "Uniform", about: "Every layer's lines at the same angle: the Angle setting, which then turns them all together" },
];
const CLASSIC = [45, 15, 75, 0, 30, 60];
/** The plate whose angle an extra ink shares in Complementary: the one opposite it on the color wheel. */
const COMPLEMENT: Partial<Record<Plate, Plate>> = { o: "c", g: "m", v: "y" };
// Never between: a fifth layer goes back to 0°, sharing a direction rather than taking an odd one.
const CARDINAL = [0, 90, 45, 135];
const GOLDEN = 180 * (3 - Math.sqrt(5)); // 137.5077...°, the golden angle

/** The angle a preset gives the layer at `index` (bottom first), or the plate it is. */
export function presetAngle(preset: AnglePreset, index: number, plate?: Plate): number {
  if (preset === "classic") return plate ? PLATE_AIMS[plate].angle : CLASSIC[index % CLASSIC.length];
  // Red is cyan's opposite too, but orange has that angle and the two print side by side: its own.
  if (preset === "complementary") return plate ? PLATE_AIMS[COMPLEMENT[plate] ?? plate].angle : CLASSIC[index % CLASSIC.length];
  if (preset === "cardinal") return CARDINAL[index % CARDINAL.length];
  if (preset === "uniform") return 0; // all alike: the angle they share is the turn on top of it
  return Math.round(((index * GOLDEN) % 180) * 10) / 10;
}

/** The most passes hatching builds the darks in: two directions, each again between, then the diagonals. */
export const MOST_PASSES = 6;

/** What tone lines start from: rows a couple of millimetres apart, waves a millimetre long at black. */
export const WAVE_DEFAULTS = { rowMm: 2, waveMm: 1 };

/** What squiggles start from: SquiggleDraw's look, waves at black swinging 1.5 mm, overlapping 2 mm rows. */
export const SQUIGGLE_DEFAULTS = { ampMm: 1.5 };

/**
 * SquiggleDraw's controls, with the sketch's names, ranges and defaults (its Default button), in its
 * own units: rows to the photo's height; strength; detail, the step along a row (31 less it, in the
 * sketch's pixels); frequency; resolution scale, how many times the photo is scaled up; line width,
 * which caps how tight the waves get; the black and white points, 0 to 255; and invert.
 */
export const SQUIGGLE_DRAW = { lines: 120, strength: 13, detail: 28, frequency: 128, scale: 3, lineWidth: 5, black: 0, white: 255, invert: false };
export type SquiggleDraw = typeof SQUIGGLE_DRAW;
export const SQUIGGLE_RANGES: Record<Exclude<keyof SquiggleDraw, "invert">, { label: string; min: number; max: number; step: number }> = {
  lines: { label: "Number of lines", min: 10, max: 200, step: 1 },
  strength: { label: "Squiggle strength", min: 0, max: 20, step: 1 },
  detail: { label: "Detail", min: 1, max: 30, step: 1 },
  frequency: { label: "Frequency", min: 5, max: 200, step: 1 },
  scale: { label: "Resolution scale", min: 1, max: 3, step: 1 },
  lineWidth: { label: "Line width", min: 1, max: 10, step: 1 },
  black: { label: "Black point", min: 0, max: 255, step: 1 },
  white: { label: "White point", min: 0, max: 255, step: 1 },
};
/**
 * SquiggleDraw for Inkscape's controls, with the extension's names, ranges and defaults: the grid's
 * rows and columns; frequency, waves to a cell; amplitude, 1 to 6; invert; and the path's
 * direction - each row left to right, back and forth, or back and forth joined into one line.
 */
export const SQUIGGLE_INKSCAPE = { rows: 50, cols: 50, freq: 2, amp: 2, invert: false, path: "uni" as "uni" | "bidi" | "join" };
export type SquiggleInkscape = typeof SQUIGGLE_INKSCAPE;
export const SQUIGGLE_INKSCAPE_RANGES: Record<"rows" | "cols" | "freq" | "amp", { label: string; min: number; max: number; step: number }> = {
  rows: { label: "Rows", min: 10, max: 200, step: 1 },
  cols: { label: "Columns", min: 10, max: 200, step: 1 },
  freq: { label: "Frequency", min: 1, max: 6, step: 1 },
  amp: { label: "Amplitude", min: 1, max: 6, step: 1 },
};
/** A photo's SquiggleDraw for Inkscape settings: its own over the extension's defaults, each kept in its range. */
export const squiggleInkscapeOf = (photo: Pick<Photo, "squiggleInkscape">): SquiggleInkscape => {
  const out = { ...SQUIGGLE_INKSCAPE, ...(photo.squiggleInkscape ?? {}) };
  for (const [key, r] of Object.entries(SQUIGGLE_INKSCAPE_RANGES) as ["rows" | "cols" | "freq" | "amp", { min: number; max: number }][]) {
    out[key] = Math.min(r.max, Math.max(r.min, Math.round(Number.isFinite(out[key]) ? out[key] : SQUIGGLE_INKSCAPE[key])));
  }
  out.invert = out.invert === true;
  if (out.path !== "bidi" && out.path !== "join") out.path = "uni";
  return out;
};

/** A photo's SquiggleDraw settings: its own over the sketch's defaults, each kept in its range. */
export const squiggleDrawOf = (photo: Pick<Photo, "squiggleDraw">): SquiggleDraw => {
  const out = { ...SQUIGGLE_DRAW, ...(photo.squiggleDraw ?? {}) };
  for (const [key, r] of Object.entries(SQUIGGLE_RANGES) as [Exclude<keyof SquiggleDraw, "invert">, { min: number; max: number }][]) {
    out[key] = Math.min(r.max, Math.max(r.min, Number.isFinite(out[key]) ? out[key] : SQUIGGLE_DRAW[key]));
  }
  out.invert = out.invert === true;
  return out;
};

/** How far a squiggle swings at black, in mm: its own, or worked out from a share of the rows as first saved. */
export const squiggleAmp = (photo: Pick<Photo, "squiggleAmpMm" | "squiggleHeight" | "rowMm">) =>
  photo.squiggleAmpMm ?? (photo.squiggleHeight !== undefined ? (photo.squiggleHeight * (photo.rowMm ?? WAVE_DEFAULTS.rowMm)) / 2 : SQUIGGLE_DEFAULTS.ampMm);

/** What outlines start from: a handful of contours, a millimetre's detail smoothed away. */
/** The Hilbert curve's coarsest square to start with, in mm. */
export const HILBERT_DEFAULTS = { coarsestMm: 6 };
/** The longer side of the grid the Hilbert curve reads the tone from. */
const HILBERT_EDGE = 1024;

/** One line's starting number of dots, and the most it allows. */
export const ONE_LINE_DEFAULTS = { dots: 5000 };
export const ONE_LINE_MOST = 30000;
/** The longer side of the grid the dots are spread on, and how many times they're spread. */
const ONE_LINE_EDGE = 500;
const ONE_LINE_SPREAD = 12;

/** Streamlines' starting numbers: widest spacing in mm, passes, and how broadly the flow is read, in mm. */
export const STREAM_DEFAULTS = { widestMm: 3, passes: 1, flowMm: 2 };

/** What a scribble starts from: strokes up to 60 mm long, none too short, curling moderately - loops of about 5 mm. */
export const SCRIBBLE_DEFAULTS = { lengthMm: 60, minMm: 0, wiggle: 50, seed: 1 };

export const OUTLINE_DEFAULTS = { contours: 6, smoothMm: 1 };

/** What centerlines start from: anything darker than half-way is a line; a fifth of a millimetre smoothed. */
export const CENTER_DEFAULTS = { from: 0.5, smoothMm: 0.2, shortestMm: 1, straightMm: 0.3, longMm: 3 };
/** Edges' starting numbers: a quarter of the sharpest change of tone, smoothed half a millimetre, 3 mm the shortest edge. */
export const EDGE_DEFAULTS = { from: 0.25, smoothMm: 0.5, shortestMm: 3 };

/** How a photo's centerlines are drawn: as set, or straight for a drawing saved with only a tolerance, before mixed. */
export const centerModeOf = (p: Pick<Photo, "centerMode" | "centerStraightMm">) => p.centerMode ?? (p.centerStraightMm ? "straight" : "curves");

/** What a silhouette starts from: paper is lighter than 88% in every colour; a third of a millimetre smoothed; loops under 3 mm left out. */
export const SILHOUETTE_DEFAULTS = { from: 0.88, smoothMm: 0.3, smallestMm: 3 };

// ---------- Reading the photo ----------

interface Tones {
  w: number;
  h: number;
  /** Lightness of each pixel, 0 black to 1 white, row by row. */
  light: Float32Array;
  /** The pixels themselves, red, green, blue and alpha, for splitting by colour. */
  rgba: Uint8ClampedArray;
  /** A smoothed copy: how far, in pixels. Kept in what's worked out from it, so a copy and the photo never share an answer. */
  blur?: number;
  /** A copy with its saturation changed, by how much (-100 to 100), kept in what's worked out from it likewise. */
  sat?: number;
  /** A copy faded to paper under an edge mask: which mask, and how it lay, kept in what's worked out from it likewise. */
  mask?: string;
}

const saturatedCache = new Map<string, Tones>();

/**
 * The photo with its colours made greyer or more vivid, `sat` -100 to 100: each pixel's colour pushed
 * toward or away from its own grey - the lightness the photo is read by - so a black and white reading
 * of it is the same, and only its colours change. Worked out once for each photo and amount.
 */
/** Pixels made greyer or more colourful about their own grey (see saturatedTones), into `out` - which
 *  may be `rgba` itself, for a whole photo too big to copy. */
export function saturate(rgba: Uint8ClampedArray, sat: number, out: Uint8ClampedArray = rgba): Uint8ClampedArray {
  const k = 1 + Math.max(-100, Math.min(100, sat)) / 100;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i] = grey + (r - grey) * k;
    out[i + 1] = grey + (g - grey) * k;
    out[i + 2] = grey + (b - grey) * k;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

function saturatedTones(src: string, tones: Tones, sat: number): Tones {
  if (!sat) return tones;
  const key = `${src.length}|${src.slice(-32)}|${sat}`;
  const known = saturatedCache.get(key);
  if (known) return known;
  const rgba = saturate(tones.rgba, sat, new Uint8ClampedArray(tones.rgba.length));
  const made = { ...tones, rgba, sat };
  if (saturatedCache.size > 4) saturatedCache.delete(saturatedCache.keys().next().value!);
  saturatedCache.set(key, made);
  return made;
}

/** A photo's pixels with a saturation applied, for reading its colours: undefined until it's been read. */
export const saturatedOf = (src: string, saturation: number) => photoTones({ src, saturation });

/** A photo as its layers read it: its pixels, with its saturation applied and its edge mask laid over. Undefined until both have been read. */
const photoTones = (photo: Pick<Photo, "src" | "saturation" | "vignette" | "edgeMask" | "edgeMaskInvert" | "edgeMaskSides" | "edgeGen" | "crop" | "band" | "side" | "plate" | "ink" | "region" | "key" | "separation">) => {
  const tones = tonesOf(photo.src);
  if (!tones) return undefined;
  const saturated = vignettedTones(photo.src, saturatedTones(photo.src, tones, photo.saturation ?? 0), photo);
  if (photo.edgeGen) return maskedTones(photo.src, saturated, null, photo);
  if (!photo.edgeMask) return saturated;
  const mask = tonesOf(photo.edgeMask);
  if (!mask) {
    // Read now, and whatever is drawing the photo told when it can be drawn masked. Until then nothing,
    // rather than lines drawn over the border that then vanish.
    if (!maskReading.has(photo.edgeMask)) {
      const src = photo.edgeMask;
      maskReading.add(src);
      readTones(src).then(() => separationListeners.forEach((heard) => heard())).catch(() => {}).finally(() => maskReading.delete(src));
    }
    return undefined;
  }
  return maskedTones(photo.src, saturated, mask, photo);
};

const vignetteCache = new Map<string, Tones>();

/**
 * The photo under its vignette, stretched over the part of the picture that shows - inside the crop -
 * so it frames what's drawn, whatever the crop. Each pixel is taken toward black, or toward white for
 * a lightening one, by the vignette's strength there. Worked out once for each photo, vignette and crop.
 */
function vignettedTones(src: string, tones: Tones, photo: Pick<Photo, "vignette" | "crop">): Tones {
  const v = photo.vignette;
  if (!vignetteOn(v)) return tones;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const id = `vig:${vignetteKey(v)}|${c0},${c1},${c2},${c3}`;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${id}`;
  const known = vignetteCache.get(key);
  if (known) return known;
  const { w, h } = tones;
  // Worked out over the pixels that show, at their own shape.
  const x0 = Math.round(c0 * w);
  const y0 = Math.round(c1 * h);
  const gw = Math.max(1, Math.round((c2 - c0) * w));
  const gh = Math.max(1, Math.round((c3 - c1) * h));
  const strength = vignetteStrength(v, gw, gh);
  const darker = v.amount > 0;
  const light = Float32Array.from(tones.light);
  const rgba = Uint8ClampedArray.from(tones.rgba);
  for (let gy = 0; gy < gh; gy++) {
    const y = y0 + gy;
    if (y < 0 || y >= h) continue;
    for (let gx = 0; gx < gw; gx++) {
      const x = x0 + gx;
      if (x < 0 || x >= w) continue;
      const k = strength[gy * gw + gx];
      if (!k) continue;
      const i = y * w + x;
      light[i] = vignetted(light[i], k, darker);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = vignetted(rgba[i * 4 + c], k, darker, 255);
    }
  }
  const out = { w, h, light, rgba, sat: tones.sat, mask: id };
  if (vignetteCache.size > 4) vignetteCache.delete(vignetteCache.keys().next().value!);
  vignetteCache.set(key, out);
  return out;
}

const maskedCache = new Map<string, Tones>();
const maskReading = new Set<string>();

/**
 * The photo faded to paper under its edge mask. The mask is stretched over the part of the picture
 * that shows - inside the crop - so its border frames what's drawn, whatever the crop; how much of
 * each pixel is kept is the mask's lightness there (its darkness, inverted), and the pixel is taken
 * that far back toward white. Worked out once for each photo, mask and crop.
 */
/**
 * Which layer of a photo this is, as text: what tells its layers apart - the band, the plate, the
 * colour group, the separation, the key. The same for a layer every time, so its varied edge is too.
 */
const layerOf = (p: Partial<Photo>) =>
  JSON.stringify([p.band, p.side, p.plate, p.ink, p.region, p.key ? 1 : 0, p.separation ? `${p.separation.length}|${p.separation.slice(-24)}` : ""]);

function maskedTones(src: string, tones: Tones, mask: Tones | null, photo: Pick<Photo, "edgeMask" | "edgeMaskInvert" | "edgeMaskSides" | "edgeGen" | "crop" | "band" | "side" | "plate" | "ink" | "region" | "key" | "separation">): Tones {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const sides = photo.edgeMaskSides ?? MASK_SIDES;
  // A made edge varied by layer: this layer's own version of it.
  const gen = photo.edgeGen && edgeForLayer(photo.edgeGen, layerOf(photo));
  const what = gen ? `gen:${edgeGenKey(gen)}` : `${photo.edgeMask!.length}|${photo.edgeMask!.slice(-32)}|${photo.edgeMaskInvert ? "inv" : ""}`;
  const id = `${what}|${c0},${c1},${c2},${c3}|${sides.join(",")}`;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${id}`;
  const known = maskedCache.get(key);
  if (known) return known;
  const { w, h } = tones;
  const light = new Float32Array(w * h);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const cw = Math.max(1e-6, c2 - c0);
  const ch = Math.max(1e-6, c3 - c1);
  // A made edge: worked out over the pixels that show, on the sides chosen.
  const gw = Math.max(1, Math.round(w * cw));
  const gh = Math.max(1, Math.round(h * ch));
  const made = gen ? edgeKeep(gen, sides, gw, gh) : null;
  // A side left out of a loaded mask: its border there is cut off and the rest stretched to the edge.
  const depth = mask ? borderDepths(mask, photo.edgeMaskInvert) : null;
  const off = (side: MaskSide) => (!depth || sides.includes(side) ? 0 : depth[side]);
  const [u0, u1] = [off("left"), 1 - off("right")];
  const [v0, v1] = [off("top"), 1 - off("bottom")];
  for (let y = 0; y < h; y++) {
    const mv = ((y + 0.5) / h - c1) / ch;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mu = ((x + 0.5) / w - c0) / cw;
      // Outside the crop nothing is drawn anyway: left as it is.
      let keep = 1;
      if (mu >= 0 && mu <= 1 && mv >= 0 && mv <= 1) {
        if (made) {
          keep = made[Math.min(gh - 1, Math.floor(mv * gh)) * gw + Math.min(gw - 1, Math.floor(mu * gw))];
        } else {
          const m = lightAt(mask!, u0 + mu * (u1 - u0), v0 + mv * (v1 - v0));
          keep = photo.edgeMaskInvert ? 1 - m : m;
        }
      }
      light[i] = 1 - (1 - tones.light[i]) * keep;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = 255 - (255 - tones.rgba[i * 4 + c]) * keep;
      rgba[i * 4 + 3] = tones.rgba[i * 4 + 3];
    }
  }
  // Under a vignette as well: both kept in what's worked out from it.
  const out = { w, h, light, rgba, sat: tones.sat, mask: tones.mask ? `${tones.mask}+${id}` : id };
  if (maskedCache.size > 8) maskedCache.delete(maskedCache.keys().next().value!);
  maskedCache.set(key, out);
  return out;
}

/**
 * How far in from each edge a mask's border reaches, 0 to 1 of the way across: the furthest any
 * paper reaches along the middle half of that side, so its corners - where the next border runs -
 * don't count. A little more, so a side cut away leaves no sliver of it behind.
 */
function borderDepths(mask: Tones, invert?: boolean): Record<MaskSide, number> {
  const { w, h } = mask;
  const paper = (x: number, y: number) => {
    const l = mask.light[y * w + x];
    return (invert ? l : 1 - l) > 0.15;
  };
  // From one edge inward: the last line, within the first half, with any paper on it.
  const reach = (lines: number, along: number, at: (line: number, k: number) => boolean) => {
    let last = -1;
    for (let line = 0; line < lines / 2; line++) {
      for (let k = Math.floor(along / 4); k < Math.ceil((along * 3) / 4); k++) {
        if (at(line, k)) { last = line; break; }
      }
    }
    return last < 0 ? 0 : Math.min(0.45, (last + 1) / lines + 0.01);
  };
  return {
    left: reach(w, h, (c, r) => paper(c, r)),
    right: reach(w, h, (c, r) => paper(w - 1 - c, r)),
    top: reach(h, w, (r, c) => paper(c, r)),
    bottom: reach(h, w, (r, c) => paper(c, h - 1 - r)),
  };
}

/** A picture's lightness at a point of it, 0 to 1 across and down, blended between its four nearest pixels. */
function lightAt(t: Tones, u: number, v: number): number {
  const x = Math.min(t.w - 1, Math.max(0, u * t.w - 0.5));
  const y = Math.min(t.h - 1, Math.max(0, v * t.h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(t.w - 1, x0 + 1);
  const y1 = Math.min(t.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = t.light[y0 * t.w + x0] * (1 - fx) + t.light[y0 * t.w + x1] * fx;
  const bottom = t.light[y1 * t.w + x0] * (1 - fx) + t.light[y1 * t.w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

const smoothCache = new Map<string, Tones>();

/**
 * The photo smoothed by `r` pixels - its lightness and its colours alike, so every way of splitting it
 * sees the same smoothing. Worked out once for each photo and amount.
 */
function smoothedTones(src: string, tones: Tones, r: number): Tones {
  const k = Math.round(r * 2) / 2;
  if (k < 0.5) return tones;
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${k}`;
  const known = smoothCache.get(key);
  if (known) return known;
  const n = tones.w * tones.h;
  const light = Float32Array.from(tones.light);
  blurGrid(light, tones.w, tones.h, k);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const channel = new Float32Array(n);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) channel[i] = tones.rgba[i * 4 + c];
    if (c < 3) blurGrid(channel, tones.w, tones.h, k);
    for (let i = 0; i < n; i++) rgba[i * 4 + c] = channel[i];
  }
  const made = { w: tones.w, h: tones.h, light, rgba, blur: k, sat: tones.sat, mask: tones.mask };
  if (smoothCache.size > 4) smoothCache.delete(smoothCache.keys().next().value!);
  smoothCache.set(key, made);
  return made;
}

const tonesCache = new Map<string, Tones>();
const reading = new Map<string, Promise<Tones>>();

/** The photo's lightness, once it has been read; undefined until then. */
export const tonesOf = (src: string) => tonesCache.get(src);

/** Read the photo's lightness, once per photo, however many things ask. */
export function readTones(src: string): Promise<Tones> {
  const known = tonesCache.get(src);
  if (known) return Promise.resolve(known);
  const pending = reading.get(src);
  if (pending) return pending;
  const job = (async () => {
    // Decoded as a bitmap, away from the page: quicker, and it doesn't wait on the tab being in view.
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const light = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, p = 0; p < light.length; i += 4, p++) {
      light[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    const tones = { w: canvas.width, h: canvas.height, light, rgba: data };
    tonesCache.set(src, tones);
    reading.delete(src);
    return tones;
  })();
  reading.set(src, job);
  return job;
}

// ---------- Splitting by a color profile ----------

const profiles = new Map<string, InkProfile>();
const profileLoading = new Map<string, Promise<InkProfile>>();

/**
 * A printer profile from the server's Color profiles folder, by its file name, read once however many
 * layers ask. (A drawing from before the folder has the profile's whole path: the server looks for
 * its file name.)
 */
export function loadProfile(path: string): Promise<InkProfile> {
  const known = profiles.get(path);
  if (known) return Promise.resolve(known);
  const pending = profileLoading.get(path);
  if (pending) return pending;
  const job = (async () => {
    const res = await fetch(`/api/color-profile?name=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "That profile couldn't be read");
    const made = parseProfile(await res.arrayBuffer());
    profiles.set(path, made);
    return made;
  })().finally(() => profileLoading.delete(path));
  profileLoading.set(path, job);
  return job;
}

/** A short, steady stand-in for a profile's path in the keys below. */
const pathHash = (path: string) => {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/**
 * What an ink's share of the photo is kept under, as though it were a picture of its own - so every
 * cache keyed by a photo's picture tells one ink from another. Ends with what tells them apart.
 */
const profileKey = (p: Pick<Photo, "src" | "profile" | "profileIntent" | "profileBpc" | "profileInk" | "saturation">) =>
  `${p.src}#icc|${pathHash(p.profile!)}|${p.profileIntent ?? 0}${bpcKey(p)}|${p.saturation ?? 0}|${p.profileInk ?? 0}`;
/** Black point compensation, in a key only where it changes anything: older keys stay as they were. */
const bpcKey = (p: Pick<Photo, "profileIntent" | "profileBpc">) => (p.profileBpc && usesBpc(p.profileIntent ?? 0) ? "b" : "");
const splitting = new Set<string>();

/**
 * The photo as a profile ink's layer draws it: its picture that ink's share, darker where more of it
 * goes, as a separation's is. Null while the profile or the photo is still being read - asked for now,
 * and whatever is drawing told when it's ready. Any other photo comes back as it is.
 */
export function profiled(p: Photo): Photo | null {
  if (!p.profile) return p;
  const key = profileKey(p);
  if (tonesCache.has(key)) return { ...p, src: key };
  const whole = `${p.src}#icc|${pathHash(p.profile)}|${p.profileIntent ?? 0}${bpcKey(p)}|${p.saturation ?? 0}`;
  if (!splitting.has(whole)) {
    splitting.add(whole);
    Promise.all([loadProfile(p.profile), readTones(p.src)])
      .then(([profile, tones]) => {
        // Split from the colors as saturated: more vivid, more of the colored inks; greyer, more black.
        const inks = inksOf(profile, saturatedTones(p.src, tones, p.saturation ?? 0).rgba, { intent: p.profileIntent ?? 0, bpc: p.profileBpc });
        inks.forEach((ink, i) => {
          const light = new Float32Array(ink.length);
          const rgba = new Uint8ClampedArray(ink.length * 4);
          for (let k = 0; k < ink.length; k++) {
            light[k] = 1 - ink[k];
            const v = Math.round(light[k] * 255);
            rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = v;
            rgba[k * 4 + 3] = 255;
          }
          tonesCache.set(`${whole}|${i}`, { w: tones.w, h: tones.h, light, rgba });
        });
        separationListeners.forEach((heard) => heard());
      })
      .catch(() => {})
      .finally(() => splitting.delete(whole));
  }
  return null;
}

const plateImages = new Map<string, string>();

/**
 * A profile ink's share of the photo as a picture, for the stage to show - gray, darker where more of
 * it goes. Undefined until it's worked out (see profiled). Any other photo: its own picture.
 */
export function pictureOf(p: Photo): string | undefined {
  if (!p.profile) return p.src;
  const shown = profiled(p);
  if (!shown) return undefined;
  const known = plateImages.get(shown.src);
  if (known) return known;
  const tones = tonesCache.get(shown.src)!;
  const canvas = document.createElement("canvas");
  canvas.width = tones.w;
  canvas.height = tones.h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(tones.rgba), tones.w, tones.h), 0, 0);
  const url = canvas.toDataURL("image/png");
  if (plateImages.size > 24) plateImages.delete(plateImages.keys().next().value!);
  plateImages.set(shown.src, url);
  return url;
}

/**
 * A photo file made into a working copy: no longer than WORKING_EDGE on its longer side, as a JPEG,
 * so a drawing that carries it stays a size a browser opens without a pause. Rejects with a sentence
 * to show when the browser can't read the file - an iPhone's HEIC, in most of them.
 */
export async function workingCopy(file: File, edge = WORKING_EDGE): Promise<Pick<Photo, "src" | "width" | "height">> {
  const img = await readPicture(file);
  try {
    const scale = Math.min(1, edge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // a transparent PNG is on white paper, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width, height };
  } finally {
    img.close();
  }
}

/**
 * A picture file as pixels. A TIFF goes to the server, which flattens it on this Mac - a layered one
 * from Photoshop comes back as the picture Photoshop shows, adjustment layers applied - since Chrome
 * can't read TIFFs at all. Anything else the browser can't read (an iPhone's HEIC, in Chrome) gets
 * the same treatment before it's turned away.
 */
async function readPicture(file: File): Promise<ImageBitmap> {
  const tiff = /\.tiff?$/i.test(file.name) || file.type === "image/tiff";
  if (!tiff) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* the server may read it */
    }
  }
  let flat: Response;
  try {
    flat = await fetch(`/api/flat-image?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  } catch {
    throw new Error(`${file.name} needs the server to read it, and the server can't be reached.`);
  }
  if (flat.status === 413) throw new Error(`${file.name} is too big to send (50 MB at most). Save a smaller copy and add that.`);
  if (!flat.ok) {
    const said = await flat.json().catch(() => ({}));
    throw new Error(said.error ? `${file.name}: ${said.error}` : `${file.name} is a kind of picture this browser can’t read. Save it as a JPEG or PNG and add that.`);
  }
  return createImageBitmap(await flat.blob());
}

/**
 * The working copy turned a quarter, right (1) or left (-1): to stand a picture the way the paper
 * does. The pixels are turned, not the shape, so its lines are worked out square to the paper as
 * any photo's are. A JPEG at the working copy's quality, so the drawing that carries it stays its size.
 */
export async function turnedCopy(src: string, quarter: 1 | -1): Promise<Pick<Photo, "src" | "width" | "height">> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.height;
    canvas.height = img.width;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((quarter * Math.PI) / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
  } finally {
    img.close();
  }
}

/** Whether this is a part of a picture - left, top, right, bottom, as fractions, each in order. */
export const isPart = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && n >= 0 && n <= 1) && v[0] < v[2] && v[1] < v[3];

/** A part of a part, as a part of the whole: `inner` in fractions of `outer`, made fractions of what `outer` is cut from. */
export function partOfPart(outer: [number, number, number, number] | undefined, inner: [number, number, number, number]): [number, number, number, number] {
  const [l, t, r, b] = outer ?? [0, 0, 1, 1];
  return [l + inner[0] * (r - l), t + inner[1] * (b - t), l + inner[2] * (r - l), t + inner[3] * (b - t)];
}

/** A copy of a picture cut to a part of it - left, top, right, bottom, as fractions. */
export async function croppedCopy(src: string, part: [number, number, number, number]): Promise<Pick<Photo, "src" | "width" | "height">> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const [l, t, r, b] = part;
    const x = Math.round(l * img.width), y = Math.round(t * img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(r * img.width) - x);
    canvas.height = Math.max(1, Math.round(b * img.height) - y);
    canvas.getContext("2d")!.drawImage(img, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
  } finally {
    img.close();
  }
}

/** A crop - left, top, right, bottom, as fractions - turned with its picture. */
export function turnedCrop(crop: Photo["crop"], quarter: 1 | -1): Photo["crop"] {
  if (!crop) return undefined;
  const [l, t, r, b] = crop;
  return quarter === 1 ? [1 - b, l, 1 - t, r] : [t, 1 - r, b, 1 - l];
}

// ---------- Hatching ----------

/** The hatching, one path per pass of lines, in inches from the photo's own top-left corner. */
export interface PhotoMarks {
  passes: string[];
  strokes: number;
  /** Centerlines: how wide the picture's lines typically are, in mm on the page. */
  widthMm?: number;
  /** Centerlines: how many of the lines came out as true circles. */
  circles?: number;
  /** One line: how many dots it runs through, and how long it is where the pen is down, in mm. */
  dots?: number;
  lengthMm?: number;
}

const marksCache = new Map<string, PhotoMarks>();

/**
 * The lines for a photo in a box of this size, or null until the photo has been read. Worked out
 * in the photo's own corner, not the page's, so moving it about the page reuses them: only a new
 * size or new numbers draws them again.
 */
export function photoMarks(photo: Photo, w: number, h: number): PhotoMarks | null {
  // A profile's ink: drawn from its own share of the photo, once the profile and the photo are read.
  const inked = profiled(photo);
  if (!inked) return null;
  photo = channelAdjusted(inked);
  const tones = photoTones(photo);
  if (!tones || w <= 0 || h <= 0) return null;
  const key = marksKey(photo, w, h);
  const known = marksCache.get(key);
  if (known) return known;
  // Hatching smoothed first, by as many of the photo's pixels as the millimetres asked for on the page.
  const [c0, , c2] = photo.crop ?? [0, 0, 1, 1];
  const hatchTones = !photo.style && photo.hatchSmoothMm
    ? smoothedTones(photo.src, tones, (photo.hatchSmoothMm * tones.w * (c2 - c0)) / (w * 25.4))
    : tones;
  // A plate whose separation - of the photo as this style reads it, smoothed or not - is still being
  // worked out off the page: not yet, and not kept. Asked of the unsmoothed photo, a smoothed plate
  // was drawn from a separation that wasn't there, came out empty, and stayed empty.
  const drawsFrom = photo.style === "squiggle" ? (photo.squiggleVersion === "inkscape" ? smoothedTones(photo.src, tones, 2) : processingBlurred(photo.src, tones)) : photo.style ? tones : hatchTones;
  if (photo.plate && (photo.plates?.length ?? 0) >= 4 && !separationOf(drawsFrom, photo)) return null;
  const made = photo.style === "waves" ? waves(tones, photo, w, h)
    : photo.style === "squiggle" ? (photo.squiggleVersion === "inkscape" ? squiggleInkscape(tones, photo, w, h) : squiggle(tones, photo, w, h))
    : photo.style === "streamlines" ? streamlines(tones, photo, w, h)
    : photo.style === "scribble" ? scribble(tones, photo, w, h)
    : photo.style === "oneline" ? oneLine(tones, photo, w, h)
    : photo.style === "hilbert" ? hilbert(tones, photo, w, h)
    : photo.style === "outlines" ? outlines(tones, photo, w, h)
    : photo.style === "centerlines" ? centerlines(tones, photo, w, h)
    : photo.style === "silhouette" ? silhouette(tones, photo, w, h)
    : photo.style === "edges" ? edges(tones, photo, w, h)
    : photo.style === "paint" ? paint(tones, photo, w, h)
    : hatch(hatchTones, photo, w, h);
  if (marksCache.size > 24) marksCache.delete(marksCache.keys().next().value!);
  marksCache.set(key, made);
  return made;
}

/** Everything a photo's lines depend on, as one string: the same key, the same lines. */
function marksKey(photo: Photo, w: number, h: number) {
  return [photo.src.length, photo.src.slice(-32), w.toFixed(4), h.toFixed(4), photo.brightness, photo.contrast, photo.saturation ?? 0, photo.angle, photo.spacingMm, photo.levels, photo.hatchSmoothMm ?? "", photo.hatchShortestMm ?? "", photo.band?.join(",") ?? "", photo.side ?? "", photo.paperTone?.join(",") ?? "", photo.crop?.join(",") ?? "", photo.bleed ?? 0, photo.style ?? "hatch", photo.rowMm ?? "", photo.waveMm ?? "", photo.squiggleAmpMm ?? "", photo.squiggleHeight ?? "", photo.squiggleJoin ? "join" : "", photo.squiggleLift ? "lift" : "", photo.squiggleSmooth ?? "", JSON.stringify(photo.squiggleDraw ?? {}), photo.squiggleVersion ?? "", JSON.stringify(photo.squiggleInkscape ?? {}), photo.squiggleAngle ?? "", photo.ink ?? "", photo.regions?.join(",") ?? "", photo.region ?? "", photo.contours ?? "", photo.smoothMm ?? "", photo.key ? "key" : "", photo.keyInk ?? "", photo.regionInks?.join(",") ?? "", photo.keyStrength ?? "", photo.keyFrom ?? "", photo.plate ?? "", photo.plates?.join(",") ?? "", photo.blackShare ?? "", photo.centerFrom ?? "", photo.centerSmoothMm ?? "", photo.centerShortestMm ?? "", photo.centerMode ?? "", photo.centerStraightMm ?? "", photo.centerLongMm ?? "", photo.centerCornerDeg ?? "", photo.edgeFrom ?? "", photo.edgeSmoothMm ?? "", photo.edgeShortestMm ?? "", photo.silhouetteFrom ?? "", photo.silhouetteSmoothMm ?? "", photo.silhouetteSmallestMm ?? "", photo.fitPaper ?? "", photo.penMm ?? "", photo.fitPairs ? "pairs" : "", photo.fitOpaque ? "opaque" : "", photo.streamWidestMm ?? "", photo.streamPasses ?? "", photo.streamFlowMm ?? "", photo.scribbleLengthMm ?? "", photo.scribbleMinMm ?? "", photo.scribbleWiggle ?? "", photo.scribbleSeed ?? "", photo.paintSmoothMm ?? "", photo.paintSmallestMm ?? "", photo.paintOutline ?? "", photo.profileInk ?? "", photo.lineDots ?? "", photo.lineLiftMm ?? "", photo.lineCurve ?? "", photo.lineAngle ?? "", photo.lineBias ?? "", photo.lineGrain ?? "", photo.lineContrast ?? "", photo.hilbertCoarsestMm ?? "", photo.hilbertLift ? "hlift" : "", photo.hilbertCurve ?? "", photo.hilbertRound ?? "", photo.hilbertBlend ?? "", photo.hilbertAngle ?? "", photo.edgeMask ? `${photo.edgeMask.length}|${photo.edgeMask.slice(-32)}` : "", photo.edgeMaskInvert ? "inv" : "", photo.edgeMaskSides?.join(",") ?? "", photo.edgeGen ? edgeGenKey(photo.edgeGen) : "", vignetteKey(photo.vignette)].join("|");
}

/**
 * What a style sees in the photo before it draws anything, as a grid: 255 where it finds what it
 * traces, 0 where it finds nothing. For centerlines, the strokes it will run down the middle of;
 * for a silhouette, the paint; for hatching, tone lines and outlines, how dark it takes each point
 * to be - or, for a colour layer or a plate, how much of its pen it wants there.
 */
export interface PhotoMask {
  w: number;
  h: number;
  seen: Uint8ClampedArray;
}

const maskCache = new Map<string, PhotoMask>();

/** The longer side of a mask of tone: enough to judge by eye, quick to redo on every change. */
const MASK_EDGE = 600;

export function photoMask(photo: Photo, w: number, h: number): PhotoMask | null {
  const tones = photoTones(photo);
  if (!tones || w <= 0 || h <= 0) return null;
  // A plate whose separation is still being worked out off the page: not yet, and not kept.
  if (!separationReady(photo)) return null;
  const key = marksKey(photo, w, h);
  const known = maskCache.get(key);
  if (known) return known;
  let made: PhotoMask;
  if (photo.style === "centerlines") {
    const { gw, gh, on } = centerOn(tones, photo, w, h);
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(on, (v) => v * 255) };
  } else if (photo.style === "paint") {
    const { gw, gh, labels, mine } = paintRegions(tones, photo, w, h);
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(labels, (v) => (v === mine ? 255 : 0)) };
  } else if (photo.style === "silhouette") {
    const { gw, gh, field } = paintField(tones, photo, w, h);
    const level = 1 - Math.min(0.99, Math.max(0.01, photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from));
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(field, (v) => (v > level ? 255 : 0)) };
  } else {
    const gw = Math.max(2, Math.round((MASK_EDGE * w) / Math.max(w, h)));
    const gh = Math.max(2, Math.round((MASK_EDGE * h) / Math.max(w, h)));
    const { field } = fieldOf(tones, photo, gw, gh, 1);
    if (photo.style === "outlines") blurGrid(field, gw, gh, Math.max(0, photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm) / 25.4 / (w / (gw - 1)));
    made = { w: gw, h: gh, seen: Uint8ClampedArray.from(field, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) };
  }
  if (maskCache.size > 8) maskCache.delete(maskCache.keys().next().value!);
  maskCache.set(key, made);
  return made;
}

/** How dark the photo is at a point of its box (0 to 1 across and down), after brightness and contrast. */
function darknessAt(tones: Tones, u: number, v: number, lift: number, gain: number): number {
  const x = Math.min(tones.w - 1, Math.max(0, u * (tones.w - 1)));
  const y = Math.min(tones.h - 1, Math.max(0, v * (tones.h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(tones.w - 1, x0 + 1);
  const y1 = Math.min(tones.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const L = tones.light;
  const top = L[y0 * tones.w + x0] * (1 - fx) + L[y0 * tones.w + x1] * fx;
  const bottom = L[y1 * tones.w + x0] * (1 - fx) + L[y1 * tones.w + x1] * fx;
  const light = (top * (1 - fy) + bottom * fy - 0.5) * gain + 0.5 + lift;
  return 1 - Math.min(1, Math.max(0, light));
}

// ---------- Splitting by colour ----------

/** Light let through by an sRGB channel value, 0 to 255: what multiplies when inks are layered. */
const linear = (v: number) => {
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * How much light a channel value stops: its optical density, which adds as inks are layered. Held
 * to where an ink reads as solid - past about a tenth of the light through, more density is nothing
 * the eye sees, and left unheld a yellow's near-empty blue would count for more than all the rest.
 */
const MAX_DENSITY = 2.3;
const density = (v: number) => Math.min(MAX_DENSITY, -Math.log(Math.max(1e-3, linear(v))));

/** An ink's density in each channel. */
const densityOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(density) as [number, number, number];
};

/** The longer side the photo's colour areas are worked out at: finer than any pen, and quick to redo. */
const COVER_EDGE = 800;

/** sRGB to CIELAB, where a distance is near enough how different two colours look. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export const hexLab = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return lab((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** How much a contrast of -100 to 100 stretches the tones about middle grey. */
const contrastGain = (contrast: number) => {
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  return c >= 0 ? 1 / (1 - c) : 1 + c;
};

/** Most of the way to black a black point goes: 90%, past which a plate would be nothing but ink. */
export const MOST_BLACK_POINT = 90;

/**
 * A separation as its lines see it: its own brightness and contrast, then its own black point, then
 * the whole image's three, made one brightness and contrast. Each is a straight line on the tones -
 * a stretch and a lift - so any number in a row are one. A photo with none of a plate's own settings
 * and no black point comes back as it is.
 */
export function channelAdjusted(p: Photo): Photo {
  const own = { b: p.channelBrightness ?? 0, c: p.channelContrast ?? 0, k: p.channelBlackPoint ?? 0 };
  if (!own.b && !own.c && !own.k && !p.blackPoint) return p;
  // Lightness 0 to 1 as a * L + m, stage by stage.
  let a = 1;
  let m = 0;
  const then = (gain: number, offset: number) => {
    a *= gain;
    m = m * gain + offset;
  };
  const levels = (b: number, c: number) => {
    const gain = contrastGain(c);
    then(gain, 0.5 - 0.5 * gain + b / 200);
  };
  const black = (k: number) => {
    const point = Math.max(0, Math.min(MOST_BLACK_POINT, k)) / 100;
    if (point) then(1 / (1 - point), -point / (1 - point));
  };
  levels(own.b, own.c);
  black(own.k);
  levels(p.brightness, p.contrast);
  black(p.blackPoint ?? 0);
  const contrast = a >= 1 ? (1 - 1 / a) * 100 : (a - 1) * 100;
  return {
    ...p, brightness: (m - 0.5 + 0.5 * a) * 200, contrast: Math.max(-99, Math.min(99, contrast)),
    channelBrightness: undefined, channelContrast: undefined, channelBlackPoint: undefined, blackPoint: undefined,
  };
}

/** Brightness and contrast, applied to a channel value 0 to 255. */
const adjuster = (brightness: number, contrast: number) => {
  const lift = brightness / 200;
  const c = Math.max(-99, Math.min(99, contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  return (v: number) => Math.min(255, Math.max(0, ((v / 255 - 0.5) * gain + 0.5 + lift) * 255));
};

/**
 * Whether a photo is in colour to speak of: enough of it far enough from grey. A black and white
 * photo - or a colour one that's nearly so - is split by value; one in colour, by its colours.
 */
export function isColourful(src: string): boolean {
  const tones = tonesOf(src);
  if (!tones) return false;
  const total = tones.w * tones.h;
  let coloured = 0;
  const probes = 2000;
  for (let i = 0; i < probes; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    const [, a, b] = lab(tones.rgba[p], tones.rgba[p + 1], tones.rgba[p + 2]);
    if (Math.hypot(a, b) > 20) coloured++;
  }
  return coloured > probes * 0.1;
}

/** The darkest colour of a photo to speak of - a dark shade, not its one blackest pixel - as a hex. */
export function darkestOf(src: string): string {
  const tones = tonesOf(src);
  if (!tones) return "#000000";
  const total = tones.w * tones.h;
  const picks: { l: number; p: number }[] = [];
  for (let i = 0; i < 2000; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    picks.push({ l: tones.light[p / 4], p });
  }
  picks.sort((a, b) => a.l - b.l);
  const dark = picks.slice(0, Math.max(1, Math.round(picks.length * 0.05)));
  const avg = [0, 1, 2].map((ch) => dark.reduce((sum, d) => sum + tones.rgba[d.p + ch], 0) / dark.length);
  return toHex(avg);
}

/**
 * A colour group this light and this nearly grey is the paper showing, and gets no layer of its own.
 * Both: a bright yellow is nearly as light as white, but it's a colour to draw, not paper.
 */
const PAPER_LIGHTNESS = 92;
const PAPER_CHROMA = 12;
const isPaper = (c: number[]) => c[0] >= PAPER_LIGHTNESS && Math.hypot(c[1], c[2]) <= PAPER_CHROMA;

/**
 * The photo's colours gathered into this many groups of similar colours: each group's average
 * colour, lightest first, leaving out any group so light it's the paper. Gathered from a scattering
 * of the photo's pixels, the way a painter mixes a limited palette from a scene: start from colours
 * far apart, then settle each group on the average of what's nearest it, a few times over.
 */
export function colourGroups(src: string, count: number, brightness: number, contrast: number, saturation = 0): string[] {
  const tones = photoTones({ src, saturation });
  if (!tones) return [];
  const adjust = adjuster(brightness, contrast);
  const total = tones.w * tones.h;
  const pixels: { rgb: number[]; lab: [number, number, number] }[] = [];
  for (let i = 0; i < 4000; i++) {
    const p = Math.floor((((i * 2654435761) % 4294967296) / 4294967296) * total) * 4;
    const rgb = [adjust(tones.rgba[p]), adjust(tones.rgba[p + 1]), adjust(tones.rgba[p + 2])];
    pixels.push({ rgb, lab: lab(rgb[0], rgb[1], rgb[2]) });
  }
  const k = Math.max(1, Math.min(count + 1, pixels.length)); // one more, in case one is the paper
  // Starting colours as far apart as the photo allows: each next one the pixel furthest from all so far.
  const centres: [number, number, number][] = [pixels[0].lab];
  while (centres.length < k) {
    let far = pixels[0];
    let farthest = -1;
    for (const px of pixels) {
      const d = Math.min(...centres.map((c) => dist2(px.lab, c)));
      if (d > farthest) { farthest = d; far = px; }
    }
    centres.push(far.lab);
  }
  const sums = centres.map(() => ({ lab: [0, 0, 0], rgb: [0, 0, 0], n: 0 }));
  for (let pass = 0; pass < 12; pass++) {
    sums.forEach((s) => { s.lab = [0, 0, 0]; s.rgb = [0, 0, 0]; s.n = 0; });
    for (const px of pixels) {
      let best = 0;
      let nearest = Infinity;
      centres.forEach((c, i) => { const d = dist2(px.lab, c); if (d < nearest) { nearest = d; best = i; } });
      const s = sums[best];
      for (let ch = 0; ch < 3; ch++) { s.lab[ch] += px.lab[ch]; s.rgb[ch] += px.rgb[ch]; }
      s.n++;
    }
    sums.forEach((s, i) => { if (s.n) centres[i] = [s.lab[0] / s.n, s.lab[1] / s.n, s.lab[2] / s.n]; });
  }
  const groups = sums
    .map((s, i) => ({ lab: centres[i], hex: s.n ? toHex(s.rgb.map((v) => v / s.n)) : "#ffffff", n: s.n }))
    .filter((g) => g.n > 0);
  // Drop the paper, then keep the biggest groups if there are still more than asked for.
  const inked = groups.filter((g) => !isPaper(g.lab)).sort((a, b) => b.n - a.n).slice(0, count);
  return inked.sort((a, b) => b.lab[0] - a.lab[0]).map((g) => g.hex);
}

/**
 * The pen of a palette nearest each colour group, each pen used once: the closest pairs are matched
 * first, so a group only settles for a further pen when a nearer group has taken its own.
 */
export function matchPens<P extends { color: string }>(groups: string[], palette: P[]): (P | undefined)[] {
  const pairs: { g: number; p: number; d: number }[] = [];
  groups.forEach((hex, g) => palette.forEach((pen, p) => pairs.push({ g, p, d: dist2(hexLab(hex), hexLab(pen.color)) })));
  pairs.sort((a, b) => a.d - b.d);
  const out: (P | undefined)[] = groups.map(() => undefined);
  const used = new Set<number>();
  for (const { g, p } of pairs) {
    if (out[g] || used.has(p)) continue;
    out[g] = palette[p];
    used.add(p);
  }
  return out;
}

interface Areas {
  w: number;
  h: number;
  /** How many groups, the paper counted last. */
  groups: number;
  /** How far each point's colour is from each group's, in CIELAB units: `groups` to a point. */
  dist: Float32Array;
  /** How far each point is from its nearest group. */
  nearest: Float32Array;
  /** Which group each point is nearest, the paper being the last. */
  best: Uint8Array;
  want: Float32Array;
  /** Split by best fit: every colour the pens can make, and which of them each point takes. */
  menu?: Mix[];
  choice?: Uint16Array;
}

/** What a split by best fit is fitted with: the paper, the cover of 0, 1, 2… passes, and whether pens may be paired. */
interface Fit {
  paper: string;
  steps: number[];
  pairs: boolean;
  opaque: boolean;
}

/** A photo layer's best fit, or undefined when it isn't split that way. */
const fitOf = (photo: Photo): Fit | undefined =>
  photo.fitPaper
    ? { paper: photo.fitPaper, steps: coverSteps(photo.penMm ?? 0.5, photo.spacingMm, photo.levels), pairs: Boolean(photo.fitPairs), opaque: Boolean(photo.fitOpaque) }
    : undefined;

/** Bleed, as a share, in CIELAB units: how much further a group may be than the nearest and still draw. */
const BLEED_LAB = 100;

/**
 * Whether a point of the photo is in this group's area: its colour nearest this group's - or, with
 * bleed, nearly as near as the nearest, so where colours blend two groups both draw.
 */
function inArea(areas: Areas, at: number, group: number, bleed: number) {
  return areas.dist[at * areas.groups + group] <= areas.nearest[at] + bleed * BLEED_LAB;
}
const areasCache = new Map<string, Areas>();

// ---------- Best fit: pens as they come out on paper ----------

/** A colour's light, per channel, 0 to 1: what mixes when a pen's lines and the paper between them blur together. */
export const hexLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [linear((n >> 16) & 255), linear((n >> 8) & 255), linear(n & 255)];
};
const unlinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
/** A colour as a hex, from its light per channel. */
export const linearHex = (rgb: number[]) => toHex(rgb.map((v) => unlinear(Math.min(1, Math.max(0, v)))));
/** CIELAB from light per channel. */
export function labOfLinear([R, G, B]: number[]): [number, number, number] {
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * Pens laid over the paper, each covering its share of it, bottom first: the colour that comes out,
 * as light per channel. Hatching seen from a little way off is the paper and the pen's colour mixed
 * by how much of the paper the lines cover, in linear light - which predicts a calibration sheet's
 * measured patches to within about 2 ΔE. A pen's lines over another's pass their share of the light
 * through, as a filter does; an opaque ink's cover what's under them instead. `pens` are each pen's
 * colour on this paper, solid, as light.
 */
export function mixOf(paper: number[], pens: number[][], covers: number[], opaque: boolean): [number, number, number] {
  const out: [number, number, number] = [paper[0], paper[1], paper[2]];
  pens.forEach((pen, k) => {
    const c = covers[k];
    if (!c) return;
    for (let i = 0; i < 3; i++) {
      out[i] = opaque ? out[i] * (1 - c) + pen[i] * c : out[i] * (1 - c + (c * pen[i]) / Math.max(1e-4, paper[i]));
    }
  });
  return out;
}

/** One colour some pens can make: how many passes of each pen it takes, and what comes out. */
export interface Mix {
  passes: number[];
  lab: [number, number, number];
}

/**
 * Every colour these pens can make on this paper: bare paper, each pen alone at each number of
 * passes, and - with `pairs` - each two of them hatched across each other at each number of passes
 * of each. `pens` are hex colours on this paper, solid; `steps` how much paper 0, 1, 2… passes
 * cover. Pens are laid lightest first, which matters only for an opaque ink.
 */
export function fitMenu(paper: string, pens: string[], steps: number[], pairs: boolean, opaque: boolean): Mix[] {
  const paperLight = hexLinear(paper);
  const light = pens.map(hexLinear);
  // Lightest first, the order the layers go down in.
  const order = light.map((_, k) => k).sort((a, b) => labOfLinear(light[b])[0] - labOfLinear(light[a])[0]);
  const make = (passes: number[]): Mix => {
    const covers = order.map((k) => steps[passes[k]] ?? 0);
    return { passes, lab: labOfLinear(mixOf(paperLight, order.map((k) => light[k]), covers, opaque)) };
  };
  const none = pens.map(() => 0);
  const menu = [make(none)];
  for (let a = 0; a < pens.length; a++) {
    for (let i = 1; i < steps.length; i++) menu.push(make(none.map((_, k) => (k === a ? i : 0))));
    if (!pairs) continue;
    for (let b = a + 1; b < pens.length; b++) {
      for (let i = 1; i < steps.length; i++) {
        for (let j = 1; j < steps.length; j++) menu.push(make(none.map((_, k) => (k === a ? i : k === b ? j : 0))));
      }
    }
  }
  return menu;
}

/**
 * How much of the paper hatching covers with 0, 1, 2… passes, for a line `penMm` wide, `spacingMm`
 * apart and up to `levels` passes. Each pass draws lines two spacings apart: the second crosses the
 * first, the third falls between the first's lines and the fourth between the second's; the fifth and
 * sixth run on the diagonals, each laying its share over what's left.
 */
export function coverSteps(penMm: number, spacingMm: number, levels: number): number[] {
  const one = Math.min(1, penMm / (2 * Math.max(0.05, spacingMm)));
  const both = Math.min(1, 2 * one);
  const four = 1 - (1 - both) ** 2;
  const steps = [0, one, 1 - (1 - one) ** 2, 1 - (1 - both) * (1 - one), four, 1 - (1 - four) * (1 - one), 1 - (1 - four) * (1 - one) ** 2];
  return steps.slice(0, Math.min(MOST_PASSES, Math.max(1, Math.round(levels))) + 1);
}

/**
 * Which colour group each point of the photo belongs to - the nearest - and the density of its
 * colour, worked out small and read at its nearest pixel. What each layer draws is its group's area.
 * Split by best fit, the groups are pens, and each point takes whichever colour the pens can make -
 * bare paper, one pen at some number of passes, or two hatched across each other - comes nearest the
 * photo there: a pen's area is wherever that colour uses it, and `menu` says how many passes.
 */
function areasOf(tones: Tones, groups: string[], brightness: number, contrast: number, fit?: Fit): Areas {
  const key = [tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.light[0], tones.light[tones.light.length >> 1], groups.join(","), brightness, contrast, fit ? JSON.stringify(fit) : ""].join("|");
  const known = areasCache.get(key);
  if (known) return known;
  const adjust = adjuster(brightness, contrast);
  const scale = Math.min(1, COVER_EDGE / Math.max(tones.w, tones.h));
  const w = Math.max(1, Math.round(tones.w * scale));
  const h = Math.max(1, Math.round(tones.h * scale));
  const centres = groups.map(hexLab);
  // The paper is a group of its own here, so pale areas belong to it and no layer draws them.
  centres.push(lab(255, 255, 255));
  const count = centres.length;
  const dist = new Float32Array(w * h * count);
  const nearestAll = new Float32Array(w * h);
  const bestAll = new Uint8Array(w * h);
  const want = new Float32Array(w * h * 3);
  const menu = fit ? fitMenu(fit.paper, groups, fit.steps, fit.pairs, fit.opaque) : undefined;
  const choice = menu ? new Uint16Array(w * h) : undefined;
  // A photo repeats its colours: each one is looked up in the menu once.
  const chosen = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    const sy = Math.min(tones.h - 1, Math.round((y / Math.max(1, h - 1)) * (tones.h - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(tones.w - 1, Math.round((x / Math.max(1, w - 1)) * (tones.w - 1)));
      const i = (sy * tones.w + sx) * 4;
      const r = adjust(tones.rgba[i]);
      const g = adjust(tones.rgba[i + 1]);
      const b = adjust(tones.rgba[i + 2]);
      const here = lab(r, g, b);
      const at = y * w + x;
      let nearest = Infinity;
      if (menu && choice) {
        const colour = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
        let pick = chosen.get(colour);
        if (pick === undefined) {
          pick = 0;
          let closest = Infinity;
          menu.forEach((mix, m) => {
            const d = dist2(here, mix.lab);
            if (d < closest) { closest = d; pick = m; }
          });
          chosen.set(colour, pick);
        }
        choice[at] = pick;
        // A pen's area is wherever the colour chosen uses it; the paper's, where it uses none.
        const passes = menu[pick].passes;
        let any = false;
        for (let k = 0; k < count - 1; k++) {
          const used = passes[k] > 0;
          dist[at * count + k] = used ? 0 : 1e9;
          if (used && !any) { bestAll[at] = k; any = true; }
        }
        dist[at * count + count - 1] = any ? 1e9 : 0;
        if (!any) bestAll[at] = count - 1;
        nearest = 0;
      } else {
        centres.forEach((c, k) => {
          const d = Math.sqrt(dist2(here, c));
          dist[at * count + k] = d;
          if (d < nearest) { nearest = d; bestAll[at] = k; }
        });
      }
      nearestAll[at] = nearest;
      want[at * 3] = density(r);
      want[at * 3 + 1] = density(g);
      want[at * 3 + 2] = density(b);
    }
  }
  const made = { w, h, groups: count, dist, nearest: nearestAll, best: bestAll, want, menu, choice };
  if (areasCache.size > 8) areasCache.delete(areasCache.keys().next().value!);
  areasCache.set(key, made);
  return made;
}

/**
 * How much of an area's pen and of the key, 0 to 1 each, to put down at a point, the way a printer
 * takes the grey out of colour: the key takes the darkness every channel shares - as much of it as
 * it can without going darker than the photo in any channel, times `strength` - and the pen draws
 * what's left, which is the colour itself. Either ink can be missing.
 */
// ---------- CMYK ----------

interface Separation { w: number; h: number; maps: Float32Array[] }
const separationCache = new Map<string, Separation>();

/**
 * How much of each of the four plates' pens the photo needs at every point, 0 to 1, laid over each
 * other on white paper. The black takes `blackShare` of the grey the colours would otherwise share
 * - the darkness every channel has in common - and cyan, magenta and yellow make up the rest between
 * them: at each point the amounts whose densities, added up, come nearest the photo's own, none less
 * than nothing or more than solid. Worked out from the pens' own colours, not printing's, so the
 * blend is what these markers will actually make. Worked out small, and read at its nearest pixel.
 */
function separationOf(tones: Tones, photo: Photo): Separation | null {
  const plates = photo.plates!;
  const { brightness, contrast } = photo;
  const blackShare = Math.min(1, Math.max(0, photo.blackShare ?? BLACK_SHARE));
  // What the hatching can draw: how many passes, and how much paper each covers.
  const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
  const penMm = photo.penMm ?? 0.5;
  const spacingMm = photo.spacingMm;
  const key = [tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.light[0], tones.light[tones.light.length >> 1], plates.join(","), brightness, contrast, blackShare, levels, penMm, spacingMm].join("|");
  const known = separationCache.get(key);
  if (known) return known;
  const keep = (made: Separation) => {
    if (separationCache.size > 6) separationCache.delete(separationCache.keys().next().value!);
    separationCache.set(key, made);
    return made;
  };
  // The photo at the size it's separated at, read at the nearest pixel: quick, so done here.
  const scale = Math.min(1, COVER_EDGE / Math.max(tones.w, tones.h));
  const w = Math.max(1, Math.round(tones.w * scale));
  const h = Math.max(1, Math.round(tones.h * scale));
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(tones.h - 1, Math.round((y / Math.max(1, h - 1)) * (tones.h - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(tones.w - 1, Math.round((x / Math.max(1, w - 1)) * (tones.w - 1)));
      const i = (sy * tones.w + sx) * 4;
      rgb.set([tones.rgba[i], tones.rgba[i + 1], tones.rgba[i + 2]], (y * w + x) * 3);
    }
  }
  // A separation takes a moment to solve, so it's done off the page when the app has said how, and
  // until then there's nothing to draw yet. With no worker, here and now.
  if (separationRunner && !separateNow) {
    if (!separating.has(key)) {
      separating.add(key);
      separationRunner({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm })
        .then((maps) => {
          keep({ w, h, maps });
          for (const heard of separationListeners) heard();
        })
        .catch(() => {})
        .finally(() => separating.delete(key));
    }
    return null;
  }
  return keep({ w, h, maps: solveSeparation({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm }) });
}

/** What a separation off the page is asked: the photo at its separating size, and how to separate it. */
export interface SeparationRequest {
  rgb: Uint8ClampedArray; w: number; h: number; plates: string[]; brightness: number; contrast: number; blackShare: number;
  /** The hatching the plates are drawn in: passes, the pen's line width and the closest spacing, in mm. */
  levels: number; penMm: number; spacingMm: number;
}
let separationRunner: ((ask: SeparationRequest) => Promise<Float32Array[]>) | null = null;
// Set while lines are wanted at once, whatever the wait: when a drawing is written to a file.
let separateNow = false;

/** A photo's lines now, its separation worked out here if it isn't ready - for saving, which can't wait. */
export function photoMarksNow(photo: Photo, w: number, h: number): PhotoMarks | null {
  separateNow = true;
  try {
    return photoMarks(photo, w, h);
  } finally {
    separateNow = false;
  }
}
const separating = new Set<string>();
const separationListeners = new Set<() => void>();

/** How the app solves separations off the page - a worker; without one they're solved where asked. */
export function setSeparationRunner(run: (ask: SeparationRequest) => Promise<Float32Array[]>) {
  separationRunner = run;
}

/** Be told when a separation solved off the page is ready, so its lines can be drawn. Returns the way to stop. */
export function onSeparation(heard: () => void): () => void {
  separationListeners.add(heard);
  return () => separationListeners.delete(heard);
}

/** Whether a photo layer can be drawn yet: false while its plates are still being separated off the page. */
export function separationReady(photo: Photo): boolean {
  if (!photo.plate || (photo.plates?.length ?? 0) < 4) return true;
  const tones = photoTones(photo);
  return Boolean(tones && separationOf(tones, photo));
}

/**
 * The slow half of a separation, as hatching draws it. A pen's ink is always full strength: what
 * changes is how much of the paper its lines cover, and the lines mostly lie beside each other, or
 * across where they cross. So for each point of the photo this works out how much paper each plate's
 * pen should cover - smoothly, from none to as much as its passes reach (coverSteps for this pen and
 * spacing) - so that, laid over white paper and each other (mixOf), they come nearest the photo's
 * colour in Lab, with a small cost on ink so none is spent where it doesn't help, black weighed
 * against the colours by `blackShare`. Then each amount becomes the tone its hatching draws the
 * nearest number of passes at.
 *
 * Several mixes of many pens can come about equally near a colour, and two nearly equal colours
 * solved on their own can land on quite different ones - hard-edged blotches across a face. So each
 * point starts from the mix of the point before it and only adjusts it, and neighbouring colours stay
 * on the same mix; where the colour jumps - an edge - it's solved afresh. Pure, so a worker can run it.
 */
export function solveSeparation({ rgb, w, h, plates, brightness, contrast, blackShare, levels, penMm, spacingMm }: SeparationRequest): Float32Array[] {
  const adjust = adjuster(brightness, contrast);
  // A plate set to None is a pen of paper's colour that's never used: the rest come as near as they can
  // without it, and its map stays empty.
  const off = plates.map((p) => p === PLATE_OFF);
  const pens = plates.map((p) => (p === PLATE_OFF ? [1, 1, 1] : hexLinear(p)));
  const steps = coverSteps(penMm, spacingMm, levels);
  const reach = withinReach(pens, steps);
  const maps = plates.map(() => new Float32Array(w * h));
  // Each colour solved once - shades an eighth of a step apart in each channel share an answer - but
  // reached from wherever its first point was, so the answer it keeps is a neighbour's.
  const solved = new Map<number, Float32Array>();
  let before: { want: number[]; covers: number[] } | null = null;
  // Each row starts from the point above it, not from the far end of the row before.
  let rowStart: { want: number[]; covers: number[] } | null = null;
  const toTone = (cover: number) => coverTone(cover, steps);
  for (let y = 0; y < h; y++) {
    before = rowStart;
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      const i = at * 3;
      const key = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
      const want = reach(labOfLinear([linear(adjust(rgb[i])), linear(adjust(rgb[i + 1])), linear(adjust(rgb[i + 2]))]));
      let covers = solved.get(key);
      if (!covers) {
        const from: number[] | null = before && Math.hypot(want[0] - before.want[0], want[1] - before.want[1], want[2] - before.want[2]) < EDGE_DE ? before.covers : null;
        covers = Float32Array.from(chooseCovers(want, pens, steps, blackShare, from, off));
        solved.set(key, covers);
      }
      before = { want, covers: [...covers] };
      if (x === 0) rowStart = before;
      for (let n = 0; n < plates.length; n++) maps[n][at] = toTone(covers[n]);
    }
  }
  return maps;
}

/**
 * The photo's colours brought within what these pens can draw - black-point compensation, as print's
 * colour management does it. Hatching covers only part of the paper, so the darkest it can draw (every
 * pen at its most) is often a mid grey; matched exactly, everything darker than that goes to full ink
 * and the photo's shadows, mid-tones and much of its light are drawn alike - flat. So the photo's
 * black becomes the pens' darkest, white stays the paper, and every tone and colour between is
 * spread in proportion. Returns the mapping, Lab to Lab.
 */
function withinReach(pens: number[][], steps: number[]): (lab: number[]) => number[] {
  const most = steps[steps.length - 1];
  const darkest = labOfLinear(mixOf([1, 1, 1], pens, pens.map(() => most), false))[0];
  const k = Math.max(0, Math.min(1, (100 - darkest) / 100));
  return ([L, a, b]) => [100 - (100 - L) * k, a * k, b * k];
}

/** How far apart two neighbouring colours are, in ΔE, before they count as an edge and are solved afresh. */
const EDGE_DE = 12;
/** What ink costs, in ΔE per whole paper covered: a tie-breaker, so none is spent where it doesn't help. */
const INK_COST = 1;

/** The tone a plate's hatching draws the nearest number of passes to `cover` at: 0 for none. */
function coverTone(cover: number, steps: number[]): number {
  const most = steps.length - 1;
  let p = 0;
  while (p < most && steps[p + 1] <= cover) p++;
  const passes = Math.min(most, Math.round(p + (p < most ? (cover - steps[p]) / (steps[p + 1] - steps[p]) : 0)));
  return passes ? (passes + 0.5) / (most + 1) : 0;
}

/**
 * How much paper each pen should cover (in plate order, black fourth) to come nearest a colour `want`
 * in Lab: one pen at a time, its best amount found with the others held, until none moves. Started
 * from `from` - a neighbour's mix - or, with none, from the one pen that comes nearest on its own:
 * from nothing, the first pens tried (cyan, magenta, yellow) settle an orange as yellow over magenta
 * and the orange pen is never reached.
 */
function chooseCovers(want: number[], pens: number[][], steps: number[], blackShare: number, from: number[] | null, off: boolean[] = []): number[] {
  const most = steps[steps.length - 1];
  const covers = from ? [...from] : new Array<number>(pens.length).fill(0);
  const weight = pens.map((_, n) => (n === 3 ? 1 - blackShare : blackShare) * 2 * INK_COST);
  const score = () => {
    const got = labOfLinear(mixOf([1, 1, 1], pens, covers, false));
    let sum = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
    for (let n = 0; n < covers.length; n++) sum += covers[n] * weight[n];
    return sum;
  };
  if (!from) {
    let best = score();
    let start = -1;
    let amount = 0;
    for (let n = 0; n < pens.length; n++) {
      if (off[n]) continue;
      for (let k = 1; k <= 16; k++) {
        covers[n] = (most * k) / 16;
        const e = score();
        if (e < best) { best = e; start = n; amount = covers[n]; }
      }
      covers[n] = 0;
    }
    if (start >= 0) covers[start] = amount;
  }
  for (let round = 0; round < 30; round++) {
    let moved = 0;
    for (let n = 0; n < pens.length; n++) {
      if (off[n]) continue;
      const was = covers[n];
      // The best amount for this pen, the others held: a golden-section search, then none if none is better.
      let a = 0;
      let b = most;
      // Ten steps narrow it to under a hundredth of the range - finer than whole passes can show.
      for (let it = 0; it < 10; it++) {
        const x1 = b - 0.618 * (b - a);
        const x2 = a + 0.618 * (b - a);
        covers[n] = x1;
        const f1 = score();
        covers[n] = x2;
        const f2 = score();
        if (f1 < f2) b = x2;
        else a = x1;
      }
      const found = (a + b) / 2;
      covers[n] = found;
      const withIt = score();
      covers[n] = 0;
      covers[n] = score() <= withIt ? 0 : found;
      moved = Math.max(moved, Math.abs(covers[n] - was));
    }
    if (moved < 2e-3) break;
  }
  return covers;
}

/** How many passes of each plate's pen, in plate order, a colour is drawn with: one point of a separation, for checking it. */
export function platePasses(rgb: [number, number, number], plates: string[], { levels = 6, penMm = 0.4, spacingMm = 1.2, blackShare = BLACK_SHARE } = {}): number[] {
  const steps = coverSteps(penMm, spacingMm, levels);
  const off = plates.map((p) => p === PLATE_OFF);
  const pens = plates.map((p) => (p === PLATE_OFF ? [1, 1, 1] : hexLinear(p)));
  const covers = chooseCovers(withinReach(pens, steps)(labOfLinear(rgb.map(linear))), pens, steps, blackShare, null, off);
  return covers.map((c) => {
    const tone = coverTone(c, steps);
    return tone ? Math.floor(tone * steps.length) : 0;
  });
}

/** A CMYK plate, read at a point of the photo (u and v, 0 to 1): -1 where it draws nothing, else how much. */
function plateSampler(tones: Tones, photo: Photo) {
  const sep = separationOf(tones, photo);
  // Still being separated off the page: nothing yet (photoMarks waits for it rather than keep this).
  if (!sep) return () => -1;
  const map = sep.maps[platesOf(photo.plates).indexOf(photo.plate!)];
  // A plate the separation doesn't have - its list of plates out of step - draws nothing rather than
  // stopping the whole app: a drawing opened with its extra plates dropped did once.
  if (!map) return () => -1;
  return (u: number, v: number) => {
    const amount = map[Math.min(sep.h - 1, Math.round(v * (sep.h - 1))) * sep.w + Math.min(sep.w - 1, Math.round(u * (sep.w - 1)))];
    return amount > 0.02 ? amount : -1;
  };
}

/** How dark a part of a photo is, 0 to 1, before its key starts to shade it, unless set. */
export const KEY_FROM = 0.35;

/**
 * A layer of a photo split by colour, read at a point of the photo (u and v, 0 to 1): -1 where it
 * draws nothing, otherwise how much of its ink. A colour layer draws its group's area - widened by
 * the bleed - as much of its pen as comes nearest the photo there. The key shades over all of them.
 */
function colourSampler(tones: Tones, photo: Photo) {
  const areas = areasOf(tones, photo.regions!, photo.brightness, photo.contrast, fitOf(photo));
  const bleed = Math.max(0, photo.bleed ?? 0);
  const own = densityOf(photo.ink!);
  const pointAt = (u: number, v: number) =>
    Math.min(areas.h - 1, Math.round(v * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)));
  if (photo.key) {
    // The key shades over the colours rather than taking their place: it follows how dark the photo
    // is, from `keyFrom` to black, and the colour layers under it draw as they would without it.
    // How dark, the way the eye sees it: a bright red is a mid-tone, not a shadow.
    const adjust = adjuster(photo.brightness, photo.contrast);
    const from = Math.min(0.95, Math.max(0, photo.keyFrom ?? KEY_FROM));
    const strength = Math.min(1, Math.max(0, photo.keyStrength ?? 1));
    return (u: number, v: number) => {
      const px = (Math.min(tones.h - 1, Math.round(v * (tones.h - 1))) * tones.w + Math.min(tones.w - 1, Math.round(u * (tones.w - 1)))) * 4;
      const dark = 1 - lab(adjust(tones.rgba[px]), adjust(tones.rgba[px + 1]), adjust(tones.rgba[px + 2]))[0] / 100;
      const amount = strength * ((dark - from) / (1 - from));
      return amount > 0.02 ? Math.min(1, amount) : -1;
    };
  }
  const mine = photo.region!;
  if (areas.menu && areas.choice) {
    // Best fit: as many passes of this pen as the colour chosen here takes, as a tone that just
    // clears that many of the hatching's thresholds.
    const { menu, choice } = areas;
    const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
    return (u: number, v: number) => {
      const passes = menu[choice[pointAt(u, v)]].passes[mine];
      return passes ? (passes + 0.5) / (levels + 1) : -1;
    };
  }
  const dd = own[0] * own[0] + own[1] * own[1] + own[2] * own[2];
  return (u: number, v: number) => {
    const at = pointAt(u, v);
    if (!inArea(areas, at, mine, bleed) || dd < 1e-9) return -1;
    const want = areas.want;
    return Math.min(1, Math.max(0, (want[at * 3] * own[0] + want[at * 3 + 1] * own[1] + want[at * 3 + 2] * own[2]) / dd));
  };
}

/**
 * How a photo's tone is read at a point of its box, in inches from its corner: -1 outside its band,
 * otherwise - with `whole` - the photo's own darkness there, 0 to 1, or without it how far through
 * the band it is, 0 to 1. Brightness, contrast and the crop are applied.
 * A band draws only where the photo's tone falls in it, and grades its lines across its own range;
 * `fromWhite` says whether it's the lightest, which leaves white as paper where the others draw
 * something everywhere in their band, so two bands meet without a gap. Widened by the bleed, into
 * the bands either side: graded across the wider range, what spills over starts sparse and builds,
 * like a haze rather than a second edge.
 */
function toneSampler(tones: Tones, photo: Photo, w: number, h: number, whole = false) {
  const lift = photo.brightness / 200;
  const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // Split by colour: this layer draws its colour group's area, as much of its pen's ink there as
  // comes nearest the photo's colour - so a pale part of its area gets few lines.
  if (photo.plate && (photo.plates?.length ?? 0) >= 4) {
    const sample = plateSampler(tones, photo);
    return {
      toneAt: (x: number, y: number) => {
        if (x < 0 || x > w || y < 0 || y > h) return -1;
        return sample(c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1));
      },
      fromWhite: true,
    };
  }
  if (photo.ink && photo.regions && (photo.region !== undefined || photo.key)) {
    const sample = colourSampler(tones, photo);
    return {
      toneAt: (x: number, y: number) => {
        if (x < 0 || x > w || y < 0 || y > h) return -1;
        return sample(c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1));
      },
      fromWhite: true,
    };
  }
  const bleed = photo.band ? Math.max(0, photo.bleed ?? 0) : 0;
  const lo = photo.band ? Math.max(0, photo.band[0] - (photo.band[0] > 0 ? bleed : 0)) : 0;
  const hi = photo.band ? Math.min(1, photo.band[1] + (photo.band[1] < 1 ? bleed : 0)) : 1;
  // Split around the paper: the tone is how far past the paper's tones this layer's side reaches -
  // 0 at the paper's edge, 1 at black for a dark pen, at white for a light one - and the band is a
  // share of that, from the paper outwards. Nothing on the paper's side of its edge.
  const [p0, p1] = photo.side ? paperToneOf(photo) : [0, 0];
  const sided = (d: number) =>
    photo.side === "light" ? (d < p0 ? (p0 - d) / p0 : -1) : photo.side === "dark" ? (d > p1 ? (p1 < 1 ? (d - p1) / (1 - p1) : 1) : -1) : d;
  const toneAt = (x: number, y: number) => {
    if (x < 0 || x > w || y < 0 || y > h) return -1;
    const d = sided(darknessAt(tones, c0 + (x / w) * (c2 - c0), c1 + (y / h) * (c3 - c1), lift, gain));
    if (d < 0) return -1;
    if (d < lo || d > hi || (d === hi && hi < 1)) return -1;
    // `whole`: where it's this band's, the photo's own darkness rather than how far through the band.
    if (whole) return d;
    return hi > lo ? (d - lo) / (hi - lo) : 1;
  };
  // Split around the paper, the paper's own tones are where nothing's drawn: every tone past them
  // gets at least one pass, so a band is filled right up to the paper's edge.
  return { toneAt, fromWhite: photo.side ? false : lo <= 0 };
}

/**
 * Tone as tone lines: one line along each row, waving across it - harder and tighter where the photo
 * is darker, flattening out as it lightens, and lifted off the paper where there's nothing to draw.
 * At black, neighbouring rows' waves just meet. Every other row runs back the way the last came, so
 * the pen goes on from where it stopped. One path, one stroke per run of line.
 */
function waves(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const row = Math.max(0.2, photo.rowMm ?? WAVE_DEFAULTS.rowMm) / 25.4;
  const shortestWave = Math.max(0.2, photo.waveMm ?? WAVE_DEFAULTS.waveMm) / 25.4;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const rad = (photo.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  // Eight looks at the photo to the tightest wave: enough for the wave to read as a curve.
  const step = shortestWave / 8;
  const n = (v: number) => Number(v.toFixed(4));
  // How strongly the line waves: by the whole photo's darkness, in a band as in one layer, so bands
  // meet at the same strength and white is paper.
  const strength = (t: number) => t;
  const parts: string[] = [];
  let strokes = 0;
  let line = 0;
  for (let o = -reach + row / 2; o <= reach; o += row, line++) {
    const back = line % 2 === 1;
    let phase = 0;
    let run: string[] = [];
    const close = () => {
      if (run.length > 2) {
        parts.push(`M${run.join("L")}`);
        strokes++;
      }
      run = [];
    };
    for (let i = 0; i <= (reach * 2) / step; i++) {
      const t = back ? reach - i * step : -reach + i * step;
      const bx = cx - dy * o + dx * t;
      const by = cy + dx * o + dy * t;
      const tone = toneAt(bx, by);
      const s = tone < 0 ? 0 : strength(tone);
      if (s < 0.03) {
        close();
        continue;
      }
      // Darker waves are tighter: at black a wave is the shortest; toward white, four times as long.
      phase += (2 * Math.PI * step) / (shortestWave * (1 + 3 * (1 - s)));
      const swing = (row / 2) * s * Math.sin(phase);
      const x = bx - dy * swing;
      const y = by + dx * swing;
      if (x < 0 || x > w || y < 0 || y > h) {
        close();
        continue;
      }
      run.push(`${n(x)} ${n(y)}`);
    }
    close();
  }
  return { passes: [parts.join("")], strokes };
}

// ---------- Squiggle ----------

const processingBlurCache = new Map<string, Tones>();
/**
 * The photo blurred as Processing's filter(BLUR, 2) blurs it, for squiggles: its kernel - 15 wide,
 * weighted (7 - distance) squared - across then down, the edges weighed by what's inside the picture.
 */
function processingBlurred(src: string, tones: Tones): Tones {
  const key = `${src.length}|${src.slice(-32)}|${tones.sat ?? 0}|${tones.mask ?? ""}|${tones.w}x${tones.h}`;
  const known = processingBlurCache.get(key);
  if (known) return known;
  const radius = 7;
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => (radius - Math.abs(i - radius)) ** 2);
  kernel[radius] = radius * radius;
  const { w, h } = tones;
  const pass = (v: Float32Array, across: boolean) => {
    const out = new Float32Array(v.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let weight = 0;
        for (let i = 0; i < kernel.length; i++) {
          const xx = across ? x - radius + i : x;
          const yy = across ? y : y - radius + i;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          sum += v[yy * w + xx] * kernel[i];
          weight += kernel[i];
        }
        out[y * w + x] = sum / weight;
      }
    }
    return out;
  };
  const light = pass(pass(Float32Array.from(tones.light), true), false);
  const rgba = new Uint8ClampedArray(tones.rgba.length);
  const channel = new Float32Array(w * h);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < w * h; i++) channel[i] = tones.rgba[i * 4 + c];
    const done = c < 3 ? pass(pass(channel, true), false) : channel;
    for (let i = 0; i < w * h; i++) rgba[i * 4 + c] = done[i];
  }
  const made = { w, h, light, rgba, blur: -2, sat: tones.sat, mask: tones.mask };
  if (processingBlurCache.size > 4) processingBlurCache.delete(processingBlurCache.keys().next().value!);
  processingBlurCache.set(key, made);
  return made;
}

/**
 * Tone as squiggles, the way Gregg Wygonik's SquiggleDraw for Inkscape (v1.0.1) draws them - see
 * SQUIGGLE_INKSCAPE. Unlike the Processing sketch, the waves keep their frequency: the photo is cut
 * into a grid of `rows` by `cols`, every cell of a row gets `freq` waves, and only their height
 * follows the darkness, read from the grid as the extension reads it (the grid scaled up to a
 * pixel a millimetre, Lanczos, and read at each cell's corner). Each wave is two rounded humps -
 * quadratic curves, written here as cubics - up to a quarter of (256 less the brightness) over
 * the amplitude's divisor, in mm, as Inkscape's own millimetre documents have it. Joined, each row
 * turns round into the next half a cell out past the edge.
 *
 * As the extension's, the waves of the top and bottom rows swing out past the photo's edge where
 * they're tall enough: nothing here stops them there (Plot's driver stops at the page edge).
 *
 * Over the extension: rows at `squiggleAngle`; and with `squiggleLift`, a layer of a photo lifts
 * off at the cells where it has nothing to draw - white, another band's tone, another pen's colour.
 * Without it, every layer's rows run edge to edge, flat there, as the extension's do.
 */
function squiggleInkscape(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sq = squiggleInkscapeOf(photo);
  const rows = Math.round(sq.rows);
  const cols = Math.round(sq.cols);
  const freq = Math.round(sq.freq);
  const divisor = [128, 64, 32, 16, 8, 4][Math.round(sq.amp) - 1];
  const sqMax = 256 / divisor;
  const MM = 1 / 25.4;
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(smoothedTones(photo.src, tones, 2), photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));

  // The grid in the rows' own frame: along them L, across them A - the box itself at no angle.
  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const A = Math.abs(w * dy) + Math.abs(h * dx);
  const cx = w / 2;
  const cy = h / 2;
  type P = { x: number; y: number };
  // A point by how far along (0 to L) and across (0 to A) the frame it is.
  const at = (t: number, o: number): P => ({ x: cx + (t - L / 2) * dx - (o - A / 2) * dy, y: cy + (t - L / 2) * dy + (o - A / 2) * dx });
  const inside = (p: P) => p.x >= -1e-9 && p.x <= w + 1e-9 && p.y >= -1e-9 && p.y <= h + 1e-9;
  const n = (v: number) => Number(v.toFixed(4));
  const brightness = (p: P) => {
    if (!inside(p)) return 255;
    const tone = toneAt(p.x, p.y);
    if (tone < 0) return 255;
    return 255 * (1 - (sq.invert ? 1 - tone : tone));
  };

  // The photo shrunk to the grid, each cell the average of its brightness, as whole numbers.
  const grid = new Float32Array(rows * cols);
  const SUB = 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) sum += brightness(at(((c + (j + 0.5) / SUB) * L) / cols, ((r + (i + 0.5) / SUB) * A) / rows));
    grid[r * cols + c] = Math.round(sum / (SUB * SUB));
  }
  // Then scaled up to a pixel a millimetre, plus one, by Lanczos, and read at a whole pixel.
  const Wpx = Math.round(L / MM) + 1;
  const Hpx = Math.round(A / MM) + 1;
  const lanczos = (x: number) => (x === 0 ? 1 : Math.abs(x) >= 3 ? 0 : (3 * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / 3)) / (Math.PI * Math.PI * x * x));
  const weights = (px: number, size: number, cells: number) => {
    const s = ((px + 0.5) * cells) / size - 0.5;
    const out: [number, number][] = [];
    let total = 0;
    for (let k = Math.floor(s) - 2; k <= Math.floor(s) + 3; k++) {
      if (k < 0 || k >= cells) continue;
      const wt = lanczos(s - k);
      out.push([k, wt]);
      total += wt;
    }
    return out.map(([k, wt]) => [k, wt / total] as [number, number]);
  };
  const read = (px: number, py: number) => {
    let v = 0;
    for (const [r, wr] of weights(py, Hpx, rows)) for (const [c, wc] of weights(px, Wpx, cols)) v += grid[r * cols + c] * wr * wc;
    return Math.min(255, Math.max(0, Math.round(v)));
  };

  // Whether this layer draws at a point along a row: its tone (and, lifting, not white). Asked of each
  // half-wave's middle, so a run stops at the half-wave where the tone does - asked of a whole cell,
  // a run reaching white ran on to the cell's end and spilled into it.
  const xinc = L / (cols - 1);
  const rowH = A / rows;
  const drawsAt = (t: number, oMid: number) => {
    const p = at(t, oMid);
    if (!inside(p)) return false;
    const tone = toneAt(p.x, p.y);
    return tone >= 0 && !(photo.squiggleLift && fromWhite && tone < 0.03);
  };

  // Each run: its cubics' points, from the row's middle at a cell's edge to another.
  type Run = { start: P; segs: [P, P, P][]; fromStart: boolean; toEnd: boolean; row: number };
  const lines: { start: P; segs: [P, P, P][] }[] = [];
  let open: Run | null = null;
  const quad = (p0: P, q: P, p1: P): [P, P, P] => [
    { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
    p1,
  ];
  const back = sq.path !== "uni";
  for (let r = 0; r < rows; r++) {
    const oMid = rowH * (r + 1) - rowH / 2;
    const reversed = back && r % 2 !== 0;
    const order = Array.from({ length: cols - 1 }, (_, i) => (reversed ? cols - 2 - i : i));
    const runs: Run[] = [];
    let run: Run | null = null;
    for (const [i, x] of order.entries()) {
      let amp = sqMax - read(Math.floor(x * (L / MM / cols)), Math.floor(r * (A / MM / rows))) / divisor;
      if (reversed) amp *= -1;
      const sign = reversed ? -1 : 1;
      const t0 = (reversed ? x + 1 : x) * xinc;
      // `freq` waves to the cell, each a hump out and its reflection back: a quadratic, then the
      // extension's smooth 't'. Each half drawn only where the tone is, so runs end with it.
      const half = (sign * xinc) / 2 / freq;
      for (let k = 0; k < 2 * freq; k++) {
        const s = t0 + half * k;
        if (!drawsAt(s + half / 2, oMid)) {
          if (run) runs.push(run);
          run = null;
          continue;
        }
        if (!run) run = { start: at(s, oMid), segs: [], fromStart: i === 0 && k === 0, toEnd: false, row: r };
        const swing = (k % 2 === 0 ? amp : -amp) / 2;
        run.segs.push(quad(at(s, oMid), at(s + half / 2, oMid + swing * MM), at(s + half, oMid)));
      }
      if (i === order.length - 1 && run) run.toEnd = true;
    }
    if (run) runs.push(run);
    for (const runNow of runs) {
      if (open && sq.path === "join" && runNow.fromStart && open.toEnd && open.row === r - 1) {
        // The turn, as the extension's: out half a cell past the edge the last row ended at, and round, down a row.
        const end = open.segs[open.segs.length - 1][2];
        const tOut = back && (r - 1) % 2 !== 0 ? -xinc / 2 : L + xinc / 2;
        const ctrl = at(tOut, oMid - rowH);
        const mid = at(tOut, oMid - rowH / 2);
        const ctrl2 = at(tOut, oMid);
        open.segs.push(quad(end, ctrl, mid), quad(mid, ctrl2, runNow.start), ...runNow.segs);
        open.toEnd = runNow.toEnd;
        open.row = r;
        continue;
      }
      if (open) lines.push(open);
      open = runNow;
    }
  }
  if (open) lines.push(open);

  const parts = lines
    .filter((l) => l.segs.length)
    .map((l) => `M${n(l.start.x)} ${n(l.start.y)}` + l.segs.map(([a, b, c]) => `C${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(c.x)} ${n(c.y)}`).join(""));
  return { passes: [parts.join("")], strokes: parts.length };
}

/**
 * Tone as squiggles: Gregg Wygonik's SquiggleDraw (public domain), its sums as the Processing sketch
 * has them, with its controls and their numbers - see SQUIGGLE_DRAW. It works on the photo as the
 * sketch sees it: grey, blurred by 2 pixels and scaled up by the resolution scale, its rows
 * `lines` to the photo's height. Along each row the phase moves on by the darkness over the
 * frequency at every `detail` step, so darker is tighter, and the swing is the darkness times the
 * strength over the lines. A point goes at each crest, trough and crossing of the middle, and the
 * points are joined as a Catmull-Rom curve - Processing's curveVertex - with a point a tenth of a
 * step past each end to aim the ends straight. Connect ends turns each row round into the next,
 * out past the edge by a third of a row, as the sketch does.
 *
 * Over the sketch: rows at `squiggleAngle`; with `squiggleLift`, a layer of a photo lifts off where
 * it has nothing to draw - white, another band's tone, another pen's colour (the sketch never lifts;
 * without it every layer's rows run edge to edge, flat there); and `squiggleSmooth` lengthens
 * or shortens the curve's handles, 1 being Processing's.
 */
function squiggle(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const sd = squiggleDrawOf(photo);
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  // The sketch's own picture: blurred as Processing's filter(BLUR, 2) does, then scaled up.
  const blurred = processingBlurred(photo.src, tones);
  const W2 = Math.max(1, Math.round(tones.w * (c2 - c0) * sd.scale));
  const H2 = Math.max(1, Math.round(tones.h * (c3 - c1) * sd.scale));
  const unit = h / H2; // inches to one of the sketch's pixels
  // A tone band waves as the whole photo does there, not as far through its own band: its stretches of
  // each row then meet the other bands' at the same strength, rather than flat against full.
  const { toneAt: drawn, fromWhite } = toneSampler(blurred, photo, w, h, true);
  // Not lifting, every row of every layer runs edge to edge, as SquiggleDraw's: flat wherever this
  // layer has nothing to draw - white, another band's tone, another pen's colour.
  const toneAt = photo.squiggleLift ? drawn : (x: number, y: number) => Math.max(0, drawn(x, y));
  const ystep = Math.round(sd.lines);
  const ymult = sd.strength;
  const xstep = 31 - Math.round(sd.detail);
  const xsmooth = 257 - sd.frequency;
  const strokeWidth = Math.max(1, Math.round(sd.lineWidth));
  const minB = sd.black;
  const maxB = sd.white;
  // At least ten waves across the picture, and none tighter than the line is wide.
  const minPhaseIncr = (10 * 2 * Math.PI) / (W2 / xstep);
  const maxPhaseIncr = (2 * Math.PI * xstep) / strokeWidth;
  const HALF_PI = Math.PI / 2;
  const scaledYstep = Math.max(1, Math.floor(H2 / ystep));
  const row = scaledYstep * unit;

  const rad = ((photo.squiggleAngle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  type P = { x: number; y: number };
  const inBox = (p: P): P => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) });
  // Where a point of the box is read from: the sketch reads its scaled-up picture's pixel x at the
  // photo's x / scale, pixels counted from their corners - the reading here counts the last pixel as
  // the far edge, so the point is moved out to match. Off by a pixel in three hundred, the phase,
  // added up along a row, drifted.
  const [tw, th] = [tones.w, tones.h];
  const onPixels = (p: P): P => ({
    x: (((c0 + (p.x / w) * (c2 - c0)) * tw) / Math.max(1, tw - 1) - c0) * (w / (c2 - c0)),
    y: (((c1 + (p.y / h) * (c3 - c1)) * th) / Math.max(1, th - 1) - c1) * (h / (c3 - c1)),
  });

  // The stretch of a row inside the box, as distances along it from the middle; null if it misses.
  const span = (o: number): [number, number] | null => {
    let lo = -Infinity;
    let hi = Infinity;
    const clip = (start: number, along: number, max: number) => {
      if (Math.abs(along) < 1e-9) {
        if (start < 0 || start > max) lo = Infinity;
        return;
      }
      const a = (0 - start) / along;
      const b = (max - start) / along;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    };
    clip(cx - dy * o, dx, w);
    clip(cy + dx * o, dy, h);
    return hi - lo > unit * xstep ? [lo, hi] : null;
  };

  // Each run of line: its points, and whether it reaches its row's start and end.
  type Run = { points: P[]; fromStart: boolean; toEnd: boolean };
  const rows: Run[][] = [];
  // Rows from the top edge, a row apart, as the sketch's y = 0, scaledYstep… - turned, as far as they reach.
  const first = -Math.ceil((reach - h / 2) / row);
  for (let k = first; -h / 2 + k * row <= reach; k++) {
    const o = -h / 2 + k * row;
    if (k * scaledYstep >= H2 && Math.abs(dx) > 0.999) break; // the sketch's last row is above the bottom edge
    const s0 = span(o);
    if (!s0) continue;
    const [lo, hi] = s0;
    const length = (hi - lo) / unit; // the row, in the sketch's pixels
    const at = (x: number, swing: number): P => {
      const t = lo + x * unit;
      return { x: cx - dy * o + dx * t - dy * swing * unit, y: cy + dx * o + dy * t + dx * swing * unit };
    };
    // How dark the sketch finds a point: 0 to 255 trimmed to the black and white points; -1 where this layer draws nothing.
    const zAt = (x: number) => {
      const base = onPixels(at(x, 0));
      const tone = toneAt(Math.min(w, Math.max(0, base.x)), Math.min(h, Math.max(0, base.y)));
      if (tone < 0) return -1;
      if (photo.squiggleLift && fromWhite && tone < 0.03) return -1;
      const dark = sd.invert ? 1 - tone : tone;
      // Processing's whole-number blur and scale-up round down: its white reads 254, its 177 176.
      const b = Math.max(minB, Math.floor(255 * (1 - dark) - 0.5));
      return Math.max(maxB - b, 0);
    };

    // The sketch's vertices, each with whether this layer draws there.
    const verts: { x: number; y: number; on: boolean }[] = [];
    let phase = 0;
    let lastPhase = 0;
    let lastAmpl = 0;
    let lastX = 1;
    let x = 1;
    let finalStep = false;
    while (!finalStep) {
      x += xstep;
      finalStep = x + xstep >= length;
      const zRaw = zAt(x);
      const on = zRaw >= 0;
      const z = on ? zRaw : 0;
      const r = (z / ystep) * ymult;
      let df = z / xsmooth;
      if (df < minPhaseIncr) df = minPhaseIncr;
      if (df > maxPhaseIncr) df = maxPhaseIncr;
      phase += df;
      const deltaX = x - lastX;
      const deltaAmpl = r - lastAmpl;
      const deltaPhase = phase - lastPhase;
      if (!finalStep && deltaPhase > HALF_PI) {
        const vertexCount = Math.floor(deltaPhase / HALF_PI);
        const integerPart = (vertexCount * HALF_PI) / deltaPhase;
        const xPerVertex = (deltaX * integerPart) / vertexCount;
        const amplPerVertex = (integerPart * deltaAmpl) / vertexCount;
        for (let i = 0; i < vertexCount; i++) {
          lastX += xPerVertex;
          lastPhase += HALF_PI;
          lastAmpl += amplPerVertex;
          verts.push({ x: lastX, y: Math.round(Math.sin(lastPhase)) * lastAmpl, on });
        }
      }
    }

    // Runs of the vertices this layer draws, each starting and ending on the row's middle - at the
    // row's own ends where they reach them, as the sketch's do, and elsewhere where the tone itself
    // starts and stops, found a step at a time. Vertices are a quarter wave apart, which in pale
    // tones is far: ended at the next one, a run spilled that far into white as a flat tail.
    const runs: Run[] = [];
    let run: Run | null = null;
    // Where the tone starts after `from`, or stops before `to`, a step at a time - the row's own end where it's drawn to.
    const startOn = (from: number, to: number) => { for (let x = from; x < to; x += xstep) if (zAt(x) >= 0) return x; return to; };
    const stopOn = (from: number, to: number) => { for (let x = to; x > from; x -= xstep) if (zAt(x) >= 0) return x; return from; };
    for (let i = 0; i <= verts.length; i++) {
      const v = verts[i];
      if (v?.on) {
        if (!run) {
          const from = startOn(i === 0 ? 0 : verts[i - 1].x, v.x);
          run = { points: [inBox(at(from, 0))], fromStart: from === 0, toEnd: false };
        }
        run.points.push(inBox(at(v.x, v.y)));
        continue;
      }
      if (run) {
        const last = verts[i - 1].x;
        const to = stopOn(last, i === verts.length ? length : v.x);
        run.toEnd = to === length;
        run.points.push(inBox(at(to, 0)));
        runs.push(run);
        run = null;
      }
    }
    if (!verts.length && zAt(length / 2) >= 0) runs.push({ points: [inBox(at(0, 0)), inBox(at(length, 0))], fromStart: true, toEnd: true });
    // Every other row runs back the way the last came: the same curve, drawn from its other end.
    if (rows.length % 2 === 1) {
      runs.reverse();
      for (const r of runs) {
        r.points.reverse();
        [r.fromStart, r.toEnd] = [r.toEnd, r.fromStart];
      }
    }
    rows.push(runs);
  }

  // Each line: its points with an aiming point before and after - a tenth of a step past a row's
  // end, along it; at a break, the end itself. Connected, a row that reaches its end turns round
  // into the next where that starts at its edge, through a point out past the edge by a third of a row.
  const lines: P[][] = [];
  const past = (a: P, b: P, by: number): P => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: b.x + ((b.x - a.x) / len) * by, y: b.y + ((b.y - a.y) / len) * by };
  };
  const tenth = 0.1 * xstep * unit;
  const lead = (r: Run) => (r.fromStart ? [past(r.points[1], r.points[0], tenth)] : [r.points[0]]);
  const tail = (r: Run) => (r.toEnd ? [past(r.points[r.points.length - 2], r.points[r.points.length - 1], tenth)] : [r.points[r.points.length - 1]]);
  let open: P[] | null = null;
  let openRun: Run | null = null;
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].length; i++) {
      const runNow = rows[r][i];
      if (open && openRun && photo.squiggleJoin && i === 0 && runNow.fromStart && openRun.toEnd && rows[r - 1]?.[rows[r - 1].length - 1] === openRun) {
        const end = open[open.length - 1];
        const start = runNow.points[0];
        const [a, b] = [openRun.points[openRun.points.length - 2], end];
        const out = past(a, b, tenth + row / 3);
        open.push({ x: out.x + (start.x - end.x) / 2, y: out.y + (start.y - end.y) / 2 }, ...runNow.points);
        openRun = runNow;
        continue;
      }
      if (open && openRun) lines.push([...open, ...tail(openRun)]);
      open = [...lead(runNow), ...runNow.points];
      openRun = runNow;
    }
  }
  if (open && openRun) lines.push([...open, ...tail(openRun)]);

  // Each line as Processing's curveVertex draws it: a Catmull-Rom spline through all but its first
  // and last points, which only aim it - written as cubics, the handles scaled by the smoothness.
  const k = Math.min(2, Math.max(0, photo.squiggleSmooth ?? 1)) / 6;
  const parts: string[] = [];
  for (const pts of lines) {
    if (pts.length < 4) continue;
    let d = `M${n(pts[1].x)} ${n(pts[1].y)}`;
    for (let i = 1; i < pts.length - 2; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      d += `C${n(p1.x + (p2.x - p0.x) * k)} ${n(p1.y + (p2.y - p0.y) * k)} ${n(p2.x - (p3.x - p1.x) * k)} ${n(p2.y - (p3.y - p1.y) * k)} ${n(p2.x)} ${n(p2.y)}`;
    }
    parts.push(d);
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Outlines ----------

/** The longer side of the grid outlines are traced on: fine enough for a pen, quick to trace. */
const OUTLINE_EDGE = 480;

/** A blur of a grid, a box three times over - near enough a gaussian - `r` cells either way. */
function blurGrid(v: Float32Array, gw: number, gh: number, r: number) {
  if (r < 0.5) return;
  const k = Math.max(1, Math.round(r));
  const tmp = new Float32Array(v.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < gh; y++) {
      let sum = 0;
      for (let x = -k; x <= k; x++) sum += v[y * gw + Math.min(gw - 1, Math.max(0, x))];
      for (let x = 0; x < gw; x++) {
        tmp[y * gw + x] = sum / (2 * k + 1);
        sum += v[y * gw + Math.min(gw - 1, x + k + 1)] - v[y * gw + Math.max(0, x - k)];
      }
    }
    for (let x = 0; x < gw; x++) {
      let sum = 0;
      for (let y = -k; y <= k; y++) sum += tmp[Math.min(gh - 1, Math.max(0, y)) * gw + x];
      for (let y = 0; y < gh; y++) {
        v[y * gw + x] = sum / (2 * k + 1);
        sum += tmp[Math.min(gh - 1, y + k + 1) * gw + x] - tmp[Math.max(0, y - k) * gw + x];
      }
    }
  }
}

/**
 * The lines along which a grid crosses a level - marching squares - joined up into runs: each run a
 * list of grid points, closed where it comes back round to its start.
 */
export function contour(v: Float32Array, gw: number, gh: number, level: number): number[][][] {
  // A point on the edge between two grid points, where the level falls between them. Keyed by the
  // edge, so the two cells that share an edge find the same point and the pieces join up.
  const points = new Map<number, number[]>();
  const pointOn = (x0: number, y0: number, x1: number, y1: number) => {
    const key = y1 > y0 ? ((y0 * gw + x0) * 2 + 1) : (y0 * gw + x0) * 2;
    let p = points.get(key);
    if (!p) {
      const a = v[y0 * gw + x0];
      const b = v[y1 * gw + x1];
      const t = b !== a ? (level - a) / (b - a) : 0.5;
      p = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, key];
      points.set(key, p);
    }
    return p;
  };
  const next = new Map<number, number[]>(); // edge key -> the edge keys it joins
  const link = (a: number[], b: number[]) => {
    (next.get(a[2]) ?? next.set(a[2], []).get(a[2])!).push(b[2]);
    (next.get(b[2]) ?? next.set(b[2], []).get(b[2])!).push(a[2]);
  };
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const tl = v[y * gw + x] > level ? 8 : 0;
      const tr = v[y * gw + x + 1] > level ? 4 : 0;
      const br = v[(y + 1) * gw + x + 1] > level ? 2 : 0;
      const bl = v[(y + 1) * gw + x] > level ? 1 : 0;
      const c = tl | tr | br | bl;
      if (c === 0 || c === 15) continue;
      const top = () => pointOn(x, y, x + 1, y);
      const bottom = () => pointOn(x, y + 1, x + 1, y + 1);
      const left = () => pointOn(x, y, x, y + 1);
      const right = () => pointOn(x + 1, y, x + 1, y + 1);
      switch (c) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: link(left(), top()); link(bottom(), right()); break;
        case 10: link(top(), right()); link(left(), bottom()); break;
      }
    }
  }
  // Walk each chain from an end (an edge joined once), then what's left are closed loops.
  const used = new Set<number>();
  const runs: number[][][] = [];
  const walk = (start: number) => {
    const run: number[][] = [];
    let at: number | undefined = start;
    let from = -1;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      const p = points.get(at)!;
      run.push([p[0], p[1]]);
      const onward: number | undefined = (next.get(at) ?? []).find((k) => k !== from && !used.has(k));
      from = at;
      at = onward;
    }
    // Back round to the start: close it.
    if (run.length > 2 && (next.get(from) ?? []).includes(start)) run.push(run[0]);
    if (run.length > 1) runs.push(run);
  };
  for (const [key, joins] of next) if (joins.length === 1 && !used.has(key)) walk(key);
  for (const key of next.keys()) if (!used.has(key)) walk(key);
  return runs;
}

/**
 * What a layer of the photo is traced from, on a grid `gw` by `gh` over its box: how dark the photo
 * is at each point - or, for a colour layer, 1 inside its colour's area and 0 outside; for a plate or
 * the key, how much of its pen is wanted there. With the levels a contour is traced at, `count` of
 * them spread across it (a colour layer has just the one, half-way).
 */
function fieldOf(tones: Tones, photo: Photo, gw: number, gh: number, count: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const field = new Float32Array(gw * gh);
  const levels: number[] = [];
  if (photo.plate && (photo.plates?.length ?? 0) >= 4) {
    // A plate: how much of its pen the photo needs, traced at levels spread across it like tone.
    const sample = plateSampler(tones, photo);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = Math.max(0, sample(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1)));
      }
    }
    for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
  } else if (photo.ink && photo.regions && photo.key) {
    // The key: how much of it the photo needs, traced at levels spread across it like tone.
    const sample = colourSampler(tones, photo);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = Math.max(0, sample(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1)));
      }
    }
    for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
  } else if (photo.ink && photo.regions && photo.region !== undefined) {
    // A colour layer: 1 inside its colour's area, 0 outside, traced at the half-way line.
    const areas = areasOf(tones, photo.regions, photo.brightness, photo.contrast, fitOf(photo));
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const u = c0 + (gx / (gw - 1)) * (c2 - c0);
        const vv = c1 + (gy / (gh - 1)) * (c3 - c1);
        const at = Math.min(areas.h - 1, Math.round(vv * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)));
        field[gy * gw + gx] = inArea(areas, at, photo.region, Math.max(0, photo.bleed ?? 0)) ? 1 : 0;
      }
    }
    levels.push(0.5);
  } else {
    const lift = photo.brightness / 200;
    const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
    const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        field[gy * gw + gx] = darknessAt(tones, c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1), lift, gain);
      }
    }
    if (photo.band) {
      const [lo, hi] = photo.band;
      for (let k = 0; k < count; k++) {
        const t = lo + ((hi - lo) * k) / count;
        if (t > 0) levels.push(t); // the lightest band's lower edge is white: nothing to trace
      }
    } else {
      for (let k = 1; k <= count; k++) levels.push(k / (count + 1));
    }
  }
  return { field, levels };
}

/**
 * Tone as outlines: the photo traced as contour lines, like a map's - along the places its tone
 * crosses a level, so they follow its edges and its shapes. Smoothed first, so a speck of noise is
 * not a contour. A whole photo is traced at levels spread from white to black; a tone band at its own
 * lower edge and levels inside it, so an edge two bands share is drawn once; a colour layer around
 * its colour's area.
 */
function outlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const gw = Math.max(2, Math.round((OUTLINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(2, Math.round((OUTLINE_EDGE * h) / Math.max(w, h)));
  const cell = w / (gw - 1);
  const cellY = h / (gh - 1);
  const count = Math.max(1, Math.min(40, Math.round(photo.contours ?? OUTLINE_DEFAULTS.contours)));
  const { field, levels } = fieldOf(tones, photo, gw, gh, count);
  blurGrid(field, gw, gh, Math.max(0, photo.smoothMm ?? OUTLINE_DEFAULTS.smoothMm) / 25.4 / cell);
  // A contour shorter than this is a speck, not a shape.
  const shortest = 2 / 25.4;
  const n = (val: number) => Number(val.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  for (const level of levels) {
    for (const run of contour(field, gw, gh, level)) {
      let length = 0;
      for (let i = 1; i < run.length; i++) length += Math.hypot((run[i][0] - run[i - 1][0]) * cell, (run[i][1] - run[i - 1][1]) * cellY);
      if (length < shortest) continue;
      parts.push(`M${run.map(([gx, gy]) => `${n(gx * cell)} ${n(gy * cellY)}`).join("L")}`);
      strokes++;
    }
  }
  return { passes: [parts.join("")], strokes };
}

// ---------- Centerlines ----------

/** The longer side of the grid centerlines are traced on, at most: fine enough for a line a pen draws. */
const CENTER_EDGE = 1000;

/** How far a centerline's curves may stray from the traced points, in grid steps: past a pixel's jag, short of the picture's own bends. */
const FIT_CELLS = 1.5;

/** The eight neighbours of a grid point, clockwise from above, as steps across and down. */
const RING: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * A black-and-white grid worn down to lines one point wide, down the middle of each dark stroke:
 * Zhang-Suen thinning, which peels a point off a stroke's edge only where that leaves the stroke
 * in one piece and doesn't shorten its ends, from each side in turn until nothing more comes off.
 */
function thin(on: Uint8Array, gw: number, gh: number) {
  // Only points still on are looked at, and the list shrinks as they come off.
  let live: number[] = [];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) if (on[y * gw + x]) live.push(y * gw + x);
  const gone: number[] = [];
  const p = new Uint8Array(8);
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      gone.length = 0;
      for (const i of live) {
        if (!on[i]) continue;
        p[0] = on[i - gw]; p[1] = on[i - gw + 1]; p[2] = on[i + 1]; p[3] = on[i + gw + 1];
        p[4] = on[i + gw]; p[5] = on[i + gw - 1]; p[6] = on[i - 1]; p[7] = on[i - gw - 1];
        let count = 0;
        let turns = 0;
        for (let k = 0; k < 8; k++) {
          count += p[k];
          if (!p[k] && p[(k + 1) & 7]) turns++;
        }
        if (count < 2 || count > 6 || turns !== 1) continue;
        // p[0] above, p[2] right, p[4] below, p[6] left.
        if (step === 0 ? (p[0] && p[2] && p[4]) || (p[2] && p[4] && p[6]) : (p[0] && p[2] && p[6]) || (p[0] && p[4] && p[6])) continue;
        gone.push(i);
      }
      for (const i of gone) on[i] = 0;
      if (gone.length) {
        changed = true;
        live = live.filter((i) => on[i]);
      }
    }
  }
  // Thinning leaves a point at the inside of each step of a staircase, which reads as a junction.
  // Take out any point whose neighbours are joined to each other without it.
  for (const i of live) if (on[i] && neighbours(on, i, gw).length >= 2 && joinedWithout(on, i, gw)) on[i] = 0;
}

const neighbours = (on: Uint8Array, i: number, gw: number) => {
  const out: number[] = [];
  for (const [dx, dy] of RING) if (on[i + dy * gw + dx]) out.push(i + dy * gw + dx);
  return out;
};

/** Whether a point's neighbours touch one another in a single chain, so taking it out breaks nothing. */
function joinedWithout(on: Uint8Array, i: number, gw: number) {
  const near = neighbours(on, i, gw);
  const seen = new Set([near[0]]);
  const todo = [near[0]];
  while (todo.length) {
    const a = todo.pop()!;
    for (const b of near) {
      if (seen.has(b)) continue;
      if (Math.abs((a % gw) - (b % gw)) <= 1 && Math.abs(Math.floor(a / gw) - Math.floor(b / gw)) <= 1) {
        seen.add(b);
        todo.push(b);
      }
    }
  }
  return seen.size === near.length;
}

/** How far each dark point is from the nearest light one, in grid steps: a 3-4 chamfer, so half a stroke's width on its middle line. */
function distances(on: Uint8Array, gw: number, gh: number): Float32Array {
  const d = new Float32Array(gw * gh);
  const far = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = on[i] ? far : 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - gw] + 3);
        if (x > 0) v = Math.min(v, d[i - gw - 1] + 4);
        if (x < gw - 1) v = Math.min(v, d[i - gw + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < gw - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < gh - 1) {
        v = Math.min(v, d[i + gw] + 3);
        if (x < gw - 1) v = Math.min(v, d[i + gw + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + gw - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * Whiskers taken off: thinning grows a short branch toward every bump in a stroke's edge. A branch
 * from a free end to a junction that is shorter than the stroke is wide there, or than `shortest`,
 * is one of those rather than a line of the picture.
 */
function prune(on: Uint8Array, gw: number, gh: number, dist: Float32Array, shortest: number) {
  for (let round = 0; round < 3; round++) {
    let cut = false;
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const start = y * gw + x;
        if (!on[start] || neighbours(on, start, gw).length !== 1) continue;
        const branch = [start];
        let prev = -1;
        let at = start;
        let junction = -1;
        for (;;) {
          const next = neighbours(on, at, gw).filter((k) => k !== prev && !branch.includes(k));
          if (next.length !== 1) break;
          if (neighbours(on, next[0], gw).length > 2) {
            junction = next[0];
            break;
          }
          prev = at;
          at = next[0];
          branch.push(at);
          if (branch.length > shortest + 40) break;
        }
        if (junction < 0) continue;
        if (branch.length < Math.max(shortest, dist[junction] * 1.5)) {
          for (const k of branch) on[k] = 0;
          cut = true;
        }
      }
    }
    if (!cut) break;
    thin(on, gw, gh);
  }
}

interface Run {
  pts: number[];
  /** What each end meets: a junction's number, or -1 at a free end. */
  ends: [number, number];
  closed: boolean;
}

/**
 * The thinned lines walked into runs, from junction to junction or free end to free end, and the
 * loops that have neither. A junction is the points of three or more lines' meeting, taken together.
 */
function traceRuns(on: Uint8Array, gw: number, gh: number): Run[] {
  const degree = new Uint8Array(gw * gh);
  for (let i = 0; i < on.length; i++) if (on[i]) degree[i] = neighbours(on, i, gw).length;
  // Neighbouring junction points are one junction.
  const junction = new Int32Array(gw * gh).fill(-1);
  let junctions = 0;
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || degree[i] < 3 || junction[i] >= 0) continue;
    const todo = [i];
    junction[i] = junctions;
    while (todo.length) {
      const a = todo.pop()!;
      for (const b of neighbours(on, a, gw)) {
        if (degree[b] >= 3 && junction[b] < 0) {
          junction[b] = junctions;
          todo.push(b);
        }
      }
    }
    junctions++;
  }
  const isNode = (i: number) => degree[i] !== 2;
  const endOf = (i: number) => (degree[i] >= 3 ? junction[i] : -1);
  const walked = new Uint8Array(gw * gh);
  const runs: Run[] = [];
  const pairs = new Set<string>();
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || !isNode(i)) continue;
    for (const m of neighbours(on, i, gw)) {
      if (isNode(m)) {
        // Two ends side by side, or a step inside one junction: only a line if they're different things.
        const key = i < m ? `${i},${m}` : `${m},${i}`;
        if (pairs.has(key) || (degree[i] >= 3 && degree[m] >= 3 && junction[i] === junction[m])) continue;
        pairs.add(key);
        runs.push({ pts: [i, m], ends: [endOf(i), endOf(m)], closed: false });
        continue;
      }
      if (walked[m]) continue;
      const pts = [i];
      let prev = i;
      let at = m;
      for (;;) {
        pts.push(at);
        if (isNode(at)) break;
        walked[at] = 1;
        const next = neighbours(on, at, gw).find((k) => k !== prev && (isNode(k) || !walked[k]));
        if (next === undefined) break;
        prev = at;
        at = next;
      }
      runs.push({ pts, ends: [endOf(i), isNode(pts[pts.length - 1]) ? endOf(pts[pts.length - 1]) : -1], closed: false });
    }
  }
  // What's left are loops with no junction on them: a ring, an O.
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || walked[i] || isNode(i)) continue;
    const pts = [i];
    walked[i] = 1;
    let prev = i;
    let at = neighbours(on, i, gw)[0];
    while (at !== undefined && !walked[at]) {
      walked[at] = 1;
      pts.push(at);
      const next = neighbours(on, at, gw).find((k) => k !== prev && !walked[k]);
      prev = at;
      at = next ?? -1;
      if (at < 0) break;
    }
    if (pts.length > 2) runs.push({ pts, ends: [-1, -1], closed: true });
  }
  return runs;
}

/** Which way a run leaves its end: toward a point `steps` in, so a pixel's jag doesn't decide it. */
function leavingDir(r: Run, end: 0 | 1, gw: number, steps = 6): [number, number] {
  const n = r.pts.length;
  const a = r.pts[end ? n - 1 : 0];
  const b = r.pts[end ? Math.max(0, n - 1 - steps) : Math.min(n - 1, steps)];
  const dx = (b % gw) - (a % gw);
  const dy = Math.floor(b / gw) - Math.floor(a / gw);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/**
 * Sharp tips made whole. Where two lines of a drawing meet in a point - a leaf's tip, a V - the ink
 * runs together into a wedge, and thinning makes that a Y: the two lines meeting a short tail that
 * runs on out to the point. A junction of just three, where two lines arrive from much the same
 * side and the third is a free end pointing away between them, is one of those: the tail is taken
 * off and the two lines joined as one, running into the point and back out, with the point kept
 * sharp. The points that are tips are added to `tips`.
 */
function joinTips(runs: Run[], gw: number, dist: Float32Array, tips: Set<number>): Run[] {
  const at = new Map<number, Set<Run>>();
  const add = (r: Run) => {
    for (const e of r.ends) if (e >= 0) (at.get(e) ?? at.set(e, new Set()).get(e)!).add(r);
  };
  const drop = (r: Run) => {
    for (const e of r.ends) if (e >= 0) at.get(e)?.delete(r);
  };
  runs.forEach(add);
  const reach = 10;
  for (const [j, set] of at) {
    const ends: [Run, 0 | 1][] = [];
    for (const r of set) for (const e of [0, 1] as const) if (!r.closed && r.ends[e] === j) ends.push([r, e]);
    if (ends.length !== 3) continue;
    for (let s = 0; s < 3; s++) {
      const [tail, te] = ends[s];
      if (tail.ends[1 - te] !== -1) continue;
      const [[ra, ea], [rb, eb]] = ends.filter((_, k) => k !== s);
      // The tail is no longer than the wedge is likely to be: a few times the ink's width there.
      const where = tail.pts[te ? tail.pts.length - 1 : 0];
      if (tail.pts.length > Math.max(8, dist[where] * 8)) continue;
      const u = leavingDir(ra, ea, gw, reach);
      const v = leavingDir(rb, eb, gw, reach);
      // The two lines leave together, less than about 75 degrees apart...
      if (u[0] * v[0] + u[1] * v[1] < 0.25) continue;
      const mx = u[0] + v[0];
      const my = u[1] + v[1];
      const ml = Math.hypot(mx, my) || 1;
      const t = leavingDir(tail, te, gw);
      // ...and the tail points away from them both, out of the V.
      if ((t[0] * mx + t[1] * my) / ml > -0.7) continue;
      const apex = tail.pts[te ? 0 : tail.pts.length - 1];
      // Each line is cut back from the junction by the length of the bend it makes into the tail, and
      // runs from there straight into the point.
      const cut = Math.max(1, Math.round(dist[where] * 3));
      const trim = (r: Run, e: 0 | 1) => {
        const pts = e === 1 ? r.pts : [...r.pts].reverse(); // toward the junction
        return pts.slice(0, Math.max(2, pts.length - cut));
      };
      drop(ra);
      drop(rb);
      drop(tail);
      tail.pts = [];
      tips.add(apex);
      if (ra === rb) {
        // One run leaves the junction and comes back to it: a loop with a point, like a teardrop.
        const loop = ra.pts.length > cut * 2 + 2 ? ra.pts.slice(cut, ra.pts.length - cut) : ra.pts;
        ra.pts = [apex, ...loop, apex];
        ra.ends = [-1, -1];
      } else {
        const inward = trim(ra, ea);
        const outward = trim(rb, eb).reverse();
        const joined: Run = { pts: [...inward, apex, ...outward], ends: [ra.ends[1 - ea], rb.ends[1 - eb]], closed: false };
        ra.pts = [];
        rb.pts = [];
        runs.push(joined);
        add(joined);
      }
      break;
    }
  }
  return runs.filter((r) => r.pts.length > 1);
}

/**
 * Runs that meet at a junction joined where one carries straight on into another, so a line that
 * another crosses or branches off is still drawn as one stroke. The straightest pair at a junction
 * goes first; a run that comes back round to its own junction closes into a loop.
 */
function joinRuns(runs: Run[], gw: number): Run[] {
  const at = new Map<number, Set<Run>>();
  const add = (r: Run) => {
    for (const e of r.ends) if (e >= 0) (at.get(e) ?? at.set(e, new Set()).get(e)!).add(r);
  };
  const drop = (r: Run) => {
    for (const e of r.ends) if (e >= 0) at.get(e)?.delete(r);
  };
  runs.forEach(add);
  const leaving = (r: Run, end: 0 | 1) => leavingDir(r, end, gw);
  for (const [j, set] of at) {
    for (;;) {
      const ends: [Run, 0 | 1][] = [];
      for (const r of set) for (const e of [0, 1] as const) if (!r.closed && r.ends[e] === j) ends.push([r, e]);
      let best: [number, number] | null = null;
      let bestCos = -0.4; // straighter than this or not at all: a sharp corner is two strokes
      for (let a = 0; a < ends.length; a++) {
        for (let b = a + 1; b < ends.length; b++) {
          const u = leaving(...ends[a]);
          const v = leaving(...ends[b]);
          const cos = u[0] * v[0] + u[1] * v[1];
          if (cos < bestCos) {
            bestCos = cos;
            best = [a, b];
          }
        }
      }
      if (!best) break;
      const [ra, ea] = ends[best[0]];
      const [rb, eb] = ends[best[1]];
      if (ra === rb) {
        // Both ends of one run: it goes round and comes back, so it's a loop.
        drop(ra);
        ra.closed = true;
        ra.ends = [-1, -1];
        continue;
      }
      drop(ra);
      drop(rb);
      const first = ea === 1 ? ra.pts : [...ra.pts].reverse();
      const second = eb === 0 ? rb.pts : [...rb.pts].reverse();
      const joined: Run = { pts: [...first, ...second], ends: [ra.ends[1 - ea], rb.ends[1 - eb]], closed: false };
      runs.push(joined);
      ra.pts = [];
      rb.pts = [];
      add(joined);
    }
  }
  return runs.filter((r) => r.pts.length > 1);
}

/** A loop that is a circle, near enough, as its centre and radius; null if it isn't one. */
function circleOf(pts: Point[], tolerance: number): { cx: number; cy: number; r: number } | null {
  if (pts.length < 12) return null;
  // Kasa's fit: the circle that best explains every point, by least squares, in one solve.
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / pts.length;
  const my = sy / pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  const cx = mx + uc;
  const cy = my + vc;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  return worst <= Math.max(tolerance, r * 0.04) ? { cx, cy, r } : null;
}

/** A circle as four cubic curves, starting at `from` radians and going the way the loop went. */
function circleNodes(c: { cx: number; cy: number; r: number }, from: number, clockwise: boolean): Node[] {
  const k = 0.5523 * c.r; // how long a quarter circle's handles are
  const s = clockwise ? 1 : -1;
  const nodes: Node[] = [];
  for (let q = 0; q <= 4; q++) {
    const a = from + (s * q * Math.PI) / 2;
    const x = c.cx + c.r * Math.cos(a);
    const y = c.cy + c.r * Math.sin(a);
    const tx = -Math.sin(a) * s;
    const ty = Math.cos(a) * s;
    nodes.push({ x, y, in: { x: x - tx * k, y: y - ty * k }, out: { x: x + tx * k, y: y + ty * k } });
  }
  delete nodes[0].in;
  delete nodes[4].out;
  return nodes;
}

/** The grid a line is traced on over a box `w` by `h`: CENTER_EDGE on its longer side, and no finer than the picture itself, which has nothing more to say. */
function pictureGrid(tones: Tones, photo: Photo, w: number, h: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const edge = Math.min(CENTER_EDGE, Math.max(tones.w * (c2 - c0), tones.h * (c3 - c1)));
  const gw = Math.max(3, Math.round((edge * w) / Math.max(w, h)));
  const gh = Math.max(3, Math.round((edge * h) / Math.max(w, h)));
  return { gw, gh, cell: w / (gw - 1), cellY: h / (gh - 1) };
}

/**
 * What centerlines are traced from: the picture as black and white on a grid over its box - 1 where
 * it is a line, past `centerFrom` after smoothing; a colour layer's own area; a band's own tones.
 */
function centerOn(tones: Tones, photo: Photo, w: number, h: number) {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const { field } = fieldOf(tones, photo, gw, gh, 1);
  blurGrid(field, gw, gh, Math.max(0, photo.centerSmoothMm ?? CENTER_DEFAULTS.smoothMm) / 25.4 / cell);
  // Which points are line: past `centerFrom`; a colour layer's own area; a band's own tones.
  const from = Math.min(0.99, Math.max(0.01, photo.centerFrom ?? CENTER_DEFAULTS.from));
  const colourArea = photo.ink && photo.regions && photo.region !== undefined && !photo.key;
  const toneBand = !photo.plate && !photo.ink && photo.band;
  const lo = colourArea ? 0.5 : toneBand ? Math.max(from, photo.band![0]) : from;
  const hi = toneBand && photo.band![1] < 1 ? photo.band![1] : Infinity;
  const on = new Uint8Array(gw * gh);
  // The grid's own edge stays light, so a line that runs off the picture ends at its edge.
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const v = field[y * gw + x];
    if (v > lo && v <= hi) on[y * gw + x] = 1;
  }
  return { gw, gh, cell, cellY, on };
}

/**
 * Where a picture's tone changes sharply, on a grid over its box: the Canny way - smoothed, the change
 * measured across each point (Sobel), kept only at its ridge across the edge so an edge is one point
 * wide, and kept where it's at least `edgeFrom` of the picture's sharpest changes or carries on from
 * one that is. What Edges traces, as Centerlines traces a drawing's strokes.
 */
function edgesOn(tones: Tones, photo: Photo, w: number, h: number) {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const { field } = fieldOf(tones, { ...photo, band: undefined, ink: undefined, regions: undefined, region: undefined, key: undefined, plate: undefined, plates: undefined }, gw, gh, 1);
  blurGrid(field, gw, gh, Math.max(0, photo.edgeSmoothMm ?? EDGE_DEFAULTS.smoothMm) / 25.4 / cell);
  const mag = new Float32Array(gw * gh);
  const dir = new Uint8Array(gw * gh); // 0 across, 1 one diagonal, 2 down, 3 the other diagonal
  const at = (x: number, y: number) => field[y * gw + x];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    mag[y * gw + x] = Math.hypot(gx, gy);
    const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
    dir[y * gw + x] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
  }
  // Against the picture's sharpest changes - nearly the sharpest, so one freak point doesn't set the scale.
  const sorted = Array.from(mag).filter((v) => v > 1e-6).sort((a, b) => a - b);
  const top = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 1;
  const strong = Math.max(0.01, Math.min(1, photo.edgeFrom ?? EDGE_DEFAULTS.from)) * top;
  const weak = strong / 2;
  // Only the ridge of each edge: a point at least as strong as its neighbours across it.
  const ridge = new Uint8Array(gw * gh);
  const across: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const i = y * gw + x;
    const m = mag[i];
    if (m < weak) continue;
    const [ox, oy] = across[dir[i]];
    if (m >= mag[(y + oy) * gw + x + ox] && m >= mag[(y - oy) * gw + x - ox]) ridge[i] = m >= strong ? 2 : 1;
  }
  // A weak point is an edge only where it carries on from a strong one.
  const on = new Uint8Array(gw * gh);
  const stack: number[] = [];
  for (let i = 0; i < ridge.length; i++) if (ridge[i] === 2) { on[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % gw, y = (i - x) / gw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= gw - 1 || ny >= gh - 1) continue;
      const j = ny * gw + nx;
      if (ridge[j] && !on[j]) { on[j] = 1; stack.push(j); }
    }
  }
  return { gw, gh, cell, cellY, on };
}

/**
 * Edges: the lines where the picture's tone changes sharply - a wall against a ceiling, round a window
 * - traced and drawn as Centerlines draws a drawing's strokes, curved, straight or mixed. A pass to lay
 * over shading: hatching for the tones, edges to define them.
 */
function edges(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const traced = edgesOn(tones, photo, w, h);
  const marks = centerlines(tones, { ...photo, centerShortestMm: photo.edgeShortestMm ?? EDGE_DEFAULTS.shortestMm, centerMode: photo.centerMode ?? "mixed" }, w, h, traced);
  return { ...marks, widthMm: undefined };
}

/**
 * Line art as centerlines: each dark stroke of the picture drawn once, down its middle, however wide
 * it is - a ring is one circle rather than the two edges of a filled band. The picture is made black
 * and white at `centerFrom`, worn down to lines one point wide, and those are walked into strokes:
 * whiskers off, lines carried straight on through where others cross them, smoothed into curves, and
 * a loop that is a circle drawn as an exact one. Split into bands or colours, each layer traces its
 * own part the same way.
 */
function centerlines(tones: Tones, photo: Photo, w: number, h: number, traced = centerOn(tones, photo, w, h)): PhotoMarks {
  const { gw, gh, cell, cellY, on } = traced;
  const dist = distances(on, gw, gh);
  thin(on, gw, gh);
  const shortest = Math.max(0, photo.centerShortestMm ?? CENTER_DEFAULTS.shortestMm) / 25.4 / cell;
  prune(on, gw, gh, dist, Math.max(2, shortest));

  // How wide the picture's lines are: twice the distance to the edge, along their middles.
  const widths: number[] = [];
  for (let i = 0; i < on.length; i++) if (on[i]) widths.push(dist[i] * 2);
  widths.sort((a, b) => a - b);
  const widthMm = widths.length ? widths[Math.floor(widths.length / 2)] * cell * 25.4 : undefined;

  const tips = new Set<number>();
  const runs = joinRuns(joinTips(traceRuns(on, gw, gh), gw, dist, tips), gw);
  const toPoint = (i: number): Point => ({ x: (i % gw) * cell, y: Math.floor(i / gw) * cellY });
  // Curves, straight lines within a tolerance (inches here), or mixed - and, curving, sharp where a
  // line turns more than cornerDeg.
  const mode = centerModeOf(photo);
  const within = Math.max(0.05, photo.centerStraightMm ?? CENTER_DEFAULTS.straightMm) / 25.4;
  const long = Math.max(0.1, photo.centerLongMm ?? CENTER_DEFAULTS.longMm) / 25.4;
  const cornerDeg = mode !== "straight" && photo.centerCornerDeg && photo.centerCornerDeg > 0 ? photo.centerCornerDeg : 0;
  // Turns are read about a millimetre either way, so a pixel's step isn't a corner.
  const reach = Math.max(2, Math.round(1 / 25.4 / cell));
  const strokes: Node[][] = [];
  let circles = 0;
  for (const run of runs) {
    let pts = run.pts.map(toPoint);
    // A tip stays where it is and stays sharp - and so, set to, does a turn sharper than cornerDeg.
    const corners: number[] = [];
    run.pts.forEach((g, i) => { if (tips.has(g)) corners.push(i); });
    if (cornerDeg) for (const i of turnsOver(pts, run.closed, reach, cornerDeg)) if (!corners.includes(i)) corners.push(i);
    corners.sort((a, b) => a - b);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(2, shortest) * cell) continue;
    // Pixel steps smoothed out: each point moved to the average of its neighbours, a few either
    // way. A loop wraps round; an open line keeps its ends where they are, so lines still meet.
    const k = 2;
    const n = pts.length;
    pts = pts.map((p, i) => {
      if (!run.closed && (i < 1 || i > n - 2)) return p;
      if (corners.includes(i)) return p;
      let sx = p.x, sy = p.y, c = 1;
      // Out either way as far as `k`, stopping short of a tip: the straight run into it is a long
      // step, and averaging across it would pull the line out of true.
      for (const way of [-1, 1]) {
        for (let d = 1; d <= k; d++) {
          const j = run.closed ? (i + way * d + n) % n : Math.min(n - 1, Math.max(0, i + way * d));
          if (corners.includes(j)) break;
          sx += pts[j].x;
          sy += pts[j].y;
          c++;
        }
      }
      return { x: sx / c, y: sy / c };
    });
    if (run.closed) {
      const ring = circleOf(pts, cell * 1.2);
      if (ring) {
        // Clockwise on the page (y down) when the area it goes round is positive.
        let area = 0;
        for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y;
        strokes.push(circleNodes(ring, Math.atan2(pts[0].y - ring.cy, pts[0].x - ring.cx), area > 0));
        circles++;
        continue;
      }
      pts.push({ ...pts[0] });
    }
    const fitTol = Math.max(cell, cellY) * FIT_CELLS;
    strokes.push(mode === "straight" ? straightened(pts, within, corners)
      : mode === "mixed" ? mixedLine(pts, within, long, corners, fitTol)
        : fitNodes(pts, fitTol, corners));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length, widthMm, circles };
}

/**
 * Where a traced line turns more than `degrees`: each point's turn read `reach` points either way,
 * and only the sharpest point of each bend kept, so a corner is one point, not a cluster of them.
 */
function turnsOver(pts: Point[], closed: boolean, reach: number, degrees: number): number[] {
  const n = pts.length;
  const limit = (degrees * Math.PI) / 180;
  const turn: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - reach + n) % n] : pts[i - reach];
    const b = closed ? pts[(i + reach) % n] : pts[i + reach];
    if (!a || !b) continue;
    const ax = pts[i].x - a.x, ay = pts[i].y - a.y, bx = b.x - pts[i].x, by = b.y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) continue;
    turn[i] = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] <= limit) continue;
    let peak = true;
    for (let d = 1; d <= reach && peak; d++) {
      for (const j of [i - d, i + d]) {
        const k = closed ? (j + n) % n : j;
        if (k >= 0 && k < n && (turn[k] > turn[i] || (turn[k] === turn[i] && k < i))) peak = false;
      }
    }
    if (peak) out.push(i);
  }
  return out;
}

/**
 * A traced line as straight segments that stay within `tolerance` of it (Douglas-Peucker): the
 * fewest points that keep its shape, each joined to the next by a straight line, so its corners
 * are sharp. Its ends and `keep` - the tips and corners - are always among them.
 */
function straightened(pts: Point[], tolerance: number, keep: number[]): Node[] {
  return straightPoints(pts, tolerance, keep).map((i) => ({ x: pts[i].x, y: pts[i].y }));
}

/** Which of a traced line's points the straight segments of `straightened` run between, in order. */
function straightPoints(pts: Point[], tolerance: number, keep: number[]): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const fixed = [...new Set([0, ...keep.filter((i) => i > 0 && i < n - 1), n - 1])].sort((a, b) => a - b);
  const chosen = new Uint8Array(n);
  for (const i of fixed) chosen[i] = 1;
  const off = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-12 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  };
  const stack: [number, number][] = [];
  for (let k = 0; k + 1 < fixed.length; k++) stack.push([fixed[k], fixed[k + 1]]);
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = off(pts[k], pts[i], pts[j]);
      if (d > worst) { worst = d; at = k; }
    }
    if (at >= 0 && worst > tolerance) {
      chosen[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (chosen[i]) out.push(i);
  return out;
}

/**
 * A traced line drawn straight where it runs straight and curved where it bends. Simplified to straight
 * segments within `tolerance` first: a segment `long` or longer is a stretch that really is straight,
 * and stays a straight line; runs of shorter ones are where the line bends, and are fitted with
 * curves as the curves mode fits them. Where the two meet, the line keeps the point between them.
 */
function mixedLine(pts: Point[], tolerance: number, long: number, keep: number[], fitTol: number): Node[] {
  const idx = straightPoints(pts, tolerance, keep);
  const parts: Node[][] = [];
  let bendFrom: number | null = null;
  const bend = (to: number) => {
    if (bendFrom === null) return;
    if (to > bendFrom) {
      const sub = pts.slice(bendFrom, to + 1);
      parts.push(fitNodes(sub, fitTol, keep.filter((i) => i > bendFrom! && i < to).map((i) => i - bendFrom!)));
    }
    bendFrom = null;
  };
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = idx[k], b = idx[k + 1];
    if (Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) >= long) {
      bend(a);
      parts.push([{ x: pts[a].x, y: pts[a].y }, { x: pts[b].x, y: pts[b].y }]);
    } else if (bendFrom === null) bendFrom = a;
  }
  bend(idx[idx.length - 1]);
  // One line: each part starts where the last ended, so their shared point is one node - keeping the
  // handle into it from the part before and the handle out of it into the part after.
  const out: Node[] = [];
  for (const part of parts) {
    if (!out.length) { out.push(...part); continue; }
    const last = out[out.length - 1];
    const first = part[0];
    out[out.length - 1] = { x: last.x, y: last.y, ...(last.in ? { in: last.in } : {}), ...(first.out ? { out: first.out } : {}) };
    out.push(...part.slice(1));
  }
  return out;
}

/**
 * Strokes drawn in an order that keeps the pen's travel short: each next the nearest to where the
 * last ended, turned round if its far end is nearer.
 */
function shortTravel(strokes: Node[][]): Node[][] {
  const ordered: Node[][] = [];
  const left = new Set(strokes.keys());
  let x = 0, y = 0;
  while (left.size) {
    let best = -1;
    let flip = false;
    let bestD = Infinity;
    for (const i of left) {
      const s = strokes[i];
      const a = s[0];
      const b = s[s.length - 1];
      const da = (a.x - x) ** 2 + (a.y - y) ** 2;
      const db = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (da < bestD) { bestD = da; best = i; flip = false; }
      if (db < bestD) { bestD = db; best = i; flip = true; }
    }
    left.delete(best);
    const s = flip ? reverseNodes(strokes[best]) : strokes[best];
    ordered.push(s);
    x = s[s.length - 1].x;
    y = s[s.length - 1].y;
  }
  return ordered;
}

// ---------- Silhouette ----------

/**
 * A painted or photographed thing on white paper as the line round its shape: traced where paint
 * meets paper, so it's the outline and, as loops of their own, the holes in it - whatever the paint
 * does inside. Paper is what is light in every colour, so a pale yellow-green highlight is still
 * paint. The edge of the picture counts as paper, so a shape cut off by it is closed along it.
 * Every layer of a split photo draws the same shape: it doesn't depend on tone or colour.
 */
function silhouette(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const { gw, gh, cell, cellY, field } = paintField(tones, photo, w, h);
  const from = Math.min(0.99, Math.max(0.01, photo.silhouetteFrom ?? SILHOUETTE_DEFAULTS.from));
  const smallest = Math.max(0, photo.silhouetteSmallestMm ?? SILHOUETTE_DEFAULTS.smallestMm) / 25.4;
  const strokes: Node[][] = [];
  for (const run of contour(field, gw, gh, 1 - from)) {
    const pts = run.map(([gx, gy]) => ({ x: gx * cell, y: gy * cellY }));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < Math.max(smallest, 2 * cell)) continue;
    strokes.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS));
  }
  const ordered = shortTravel(strokes);
  return { passes: [pathData(ordered)], strokes: ordered.length };
}

/**
 * What a silhouette is traced from: how much paint there is at each point of a grid over the box -
 * 0 on white paper, 1 where the darkest colour is black - smoothed. The grid's own edge is paper.
 */
function paintField(tones: Tones, photo: Photo, w: number, h: number) {
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  // How light each pixel is in its darkest colour, after brightness and contrast.
  const adjust = adjuster(photo.brightness, photo.contrast);
  const pale = new Float32Array(tones.w * tones.h);
  for (let p = 0, i = 0; p < pale.length; p++, i += 4) {
    pale[p] = Math.min(adjust(tones.rgba[i]), adjust(tones.rgba[i + 1]), adjust(tones.rgba[i + 2])) / 255;
  }
  const paleAt = (u: number, v: number) => {
    const x = Math.min(tones.w - 1, Math.max(0, u * (tones.w - 1)));
    const y = Math.min(tones.h - 1, Math.max(0, v * (tones.h - 1)));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(tones.w - 1, x0 + 1), y1 = Math.min(tones.h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const top = pale[y0 * tones.w + x0] * (1 - fx) + pale[y0 * tones.w + x1] * fx;
    const bottom = pale[y1 * tones.w + x0] * (1 - fx) + pale[y1 * tones.w + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  // How much paint: 0 on white paper, 1 where the darkest colour is black. The grid's own edge is paper.
  const field = new Float32Array(gw * gh);
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      field[gy * gw + gx] = 1 - paleAt(c0 + (gx / (gw - 1)) * (c2 - c0), c1 + (gy / (gh - 1)) * (c3 - c1));
    }
  }
  blurGrid(field, gw, gh, Math.max(0, photo.silhouetteSmoothMm ?? SILHOUETTE_DEFAULTS.smoothMm) / 25.4 / cell);
  return { gw, gh, cell, cellY, field };
}

/** A run drawn the other way: the same curve, its handles swapped end for end. */
const reverseNodes = (run: Node[]): Node[] => [...run].reverse().map((p) => {
  const out: Node = { x: p.x, y: p.y };
  if (p.out) out.in = p.out;
  if (p.in) out.out = p.in;
  return out;
});

/**
 * Tone as hatching, the way an engraver builds it: a first set of lines where the photo is darker
 * than a fifth of the way to black, a second set across it past two fifths, and each set again
 * between its own lines past three and four fifths. So the darkest parts are crosshatched at the
 * spacing the tool fills solid at, and the lightest are left as paper. Five and six passes go on
 * with the diagonals, at 45° to the first two, for the deepest darks; the steps between the
 * passes close up to make room for them.
 */
function hatch(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const levels = Math.min(MOST_PASSES, Math.max(1, Math.round(photo.levels)));
  // Along each line, a look at the photo every half a line-spacing: fine enough that a line stops
  // where the tone does, coarse enough that a big sheet is still quick.
  const step = spacing / 2;
  // Anything shorter than this is a dot, not a line: the pen would only tap the paper. One and a half
  // line spacings, unless the card says otherwise.
  const shortest = photo.hatchShortestMm !== undefined ? photo.hatchShortestMm / 25.4 : spacing * 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(4));
  const passes: string[] = [];
  let strokes = 0;
  // A tone band takes the passes whose thresholds fall in its band, measured against the whole photo,
  // rather than running every pass across its own band: the bands together then draw what one layer
  // would, and the darks get the lighter bands' lines as well as their own. Run across its own band,
  // a light band was crosshatched black just under its top edge while the band above it started
  // sparse - the tones turned over at every edge between bands.
  // Split around the paper, each band is a pen of its own - black, a gray - and draws its own region
  // whole, graded across it, rather than taking a share of one ink's passes.
  const band = photo.band && !photo.plate && !photo.ink && !photo.side ? photo.band : null;
  const { toneAt, fromWhite } = toneSampler(tones, band ? { ...photo, band: undefined } : photo, w, h);

  for (let k = 0; k < levels; k++) {
    const threshold = fromWhite ? (k + 1) / (levels + 1) : k / levels;
    if (band && !(threshold >= band[0] && (threshold < band[1] || band[1] >= 1))) {
      passes.push("");
      continue;
    }
    const rad = ((photo.angle + (k % 2 ? 90 : 0) + (k >= 4 ? 45 : 0)) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Lines two spacings apart in each pass; the third and fourth passes fall between the first two's,
    // and the fifth and sixth run on the diagonals.
    const gap = spacing * 2;
    const shift = k === 2 || k === 3 ? spacing : 0;
    const parts: string[] = [];
    let line = 0;
    for (let o = -reach + shift; o <= reach; o += gap, line++) {
      // Every other line runs back the way the last one came, so the pen doesn't travel home between them.
      const back = line % 2 === 1;
      let start: number | null = null;
      let end = 0;
      const close = () => {
        if (start !== null && end - start >= shortest) {
          const a = back ? end : start;
          const b = back ? start : end;
          parts.push(`M${n(cx - dy * o + dx * a)} ${n(cy + dx * o + dy * a)}L${n(cx - dy * o + dx * b)} ${n(cy + dx * o + dy * b)}`);
          strokes++;
        }
        start = null;
      };
      for (let t = -reach; t <= reach; t += step) {
        const x = cx - dy * o + dx * t;
        const y = cy + dx * o + dy * t;
        const tone = toneAt(x, y);
        if (tone >= 0 && (tone > threshold || (!fromWhite && k === 0))) {
          if (start === null) start = t;
          end = t;
        } else {
          close();
        }
      }
      close();
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}


// ---------- Paint ----------

/** What a painting starts from: borders smoothed over a millimetre, nothing smaller than a 3 mm square kept, a line round each region. */
export const PAINT_DEFAULTS = { smoothMm: 1, smallestMm: 3, outline: true };

interface PaintRegions { gw: number; gh: number; cell: number; cellY: number; labels: Uint8Array; mine: number }
const paintCache = new Map<string, Omit<PaintRegions, "mine">>();

/**
 * The picture as a painting by numbers would have it: on a grid over the box, which color each point
 * is painted - flat, one color to a region. A color layer's points are the nearest of the split's
 * colors, or the paper; any other layer's are its own pen or not, where it would draw darker than
 * half-way. The borders are smoothed - each color's area blurred, and every point taking the color
 * strongest there - and then any region smaller than the smallest asked for takes the color of the
 * neighbor it shares most border with, until none is left. Worked out once for all of a split's
 * color layers, so they share every border: `mine` is the label this layer paints.
 */
function paintRegions(tones: Tones, photo: Photo, w: number, h: number): PaintRegions {
  const { gw, gh, cell, cellY } = pictureGrid(tones, photo, w, h);
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const smooth = Math.max(0, photo.paintSmoothMm ?? PAINT_DEFAULTS.smoothMm) / 25.4 / cell;
  const smallest = Math.max(0, photo.paintSmallestMm ?? PAINT_DEFAULTS.smallestMm) / 25.4;
  const colour = Boolean(photo.ink && photo.regions && photo.region !== undefined && !photo.key);
  const key = colour
    ? ["colour", tones.w, tones.h, tones.blur ?? 0, tones.sat ?? 0, tones.mask ?? "", tones.light[0], tones.light[tones.light.length >> 1], photo.crop?.join(",") ?? "", photo.regions!.join(","), photo.brightness, photo.contrast, gw, gh, smooth, smallest].join("|")
    : ["layer", marksKey(photo, w, h)].join("|");
  const mine = colour ? photo.region! : 1;
  const known = paintCache.get(key);
  if (known) return { ...known, mine };

  const labels = new Uint8Array(gw * gh);
  let count: number;
  if (colour) {
    // The nearest color of the split, or the paper (the last), at each point - not the mixes Best fit
    // hatches, since a painting is flat: one color to a region.
    const areas = areasOf(tones, photo.regions!, photo.brightness, photo.contrast);
    count = areas.groups;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const u = c0 + (gx / (gw - 1)) * (c2 - c0);
        const v = c1 + (gy / (gh - 1)) * (c3 - c1);
        labels[gy * gw + gx] = areas.best[Math.min(areas.h - 1, Math.round(v * (areas.h - 1))) * areas.w + Math.min(areas.w - 1, Math.round(u * (areas.w - 1)))];
      }
    }
  } else {
    // This layer's pen or not: in its band - the lightest band, and a layer that isn't one, where it
    // is past half-way to its darkest - or where its plate wants more than half its ink.
    const { toneAt, fromWhite } = toneSampler(tones, photo, w, h);
    count = 2;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const t = toneAt(Math.min(w, gx * cell), Math.min(h, gy * cellY));
        labels[gy * gw + gx] = t >= 0 && (!fromWhite || t > 0.5) ? 1 : 0;
      }
    }
  }

  // Smoothed borders: each color's area blurred, every point taking whichever is strongest there.
  if (smooth >= 0.5 && count > 1) {
    const strongest = new Float32Array(gw * gh).fill(-1);
    const out = new Uint8Array(gw * gh);
    const area = new Float32Array(gw * gh);
    for (let k = 0; k < count; k++) {
      let any = false;
      for (let i = 0; i < area.length; i++) { area[i] = labels[i] === k ? 1 : 0; if (area[i]) any = true; }
      if (!any) continue;
      blurGrid(area, gw, gh, smooth);
      for (let i = 0; i < area.length; i++) if (area[i] > strongest[i]) { strongest[i] = area[i]; out[i] = k; }
    }
    labels.set(out);
  }

  // Regions too small to paint take their biggest neighbor's color, a few times over: a speck
  // merged into a sliver can leave the two still too small together.
  const fewest = (smallest / cell) * (smallest / cellY);
  if (fewest >= 2) {
    const region = new Int32Array(gw * gh);
    const queue = new Int32Array(gw * gh);
    for (let round = 0; round < 6; round++) {
      region.fill(-1);
      let merged = 0;
      let id = 0;
      for (let start = 0; start < labels.length; start++) {
        if (region[start] >= 0) continue;
        const k = labels[start];
        // The region: every point of this color joined to this one, side to side.
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        region[start] = id;
        const touching = new Map<number, number>();
        while (head < tail) {
          const at = queue[head++];
          const x = at % gw;
          const y = (at - x) / gw;
          for (const next of [x > 0 ? at - 1 : -1, x < gw - 1 ? at + 1 : -1, y > 0 ? at - gw : -1, y < gh - 1 ? at + gw : -1]) {
            if (next < 0) continue;
            if (labels[next] !== k) {
              touching.set(labels[next], (touching.get(labels[next]) ?? 0) + 1);
            } else if (region[next] < 0) {
              region[next] = id;
              queue[tail++] = next;
            }
          }
        }
        if (tail < fewest && touching.size) {
          let into = k;
          let most = 0;
          for (const [other, n] of touching) if (n > most) { most = n; into = other; }
          for (let i = 0; i < tail; i++) labels[queue[i]] = into;
          merged++;
        }
        id++;
      }
      if (!merged) break;
    }
  }

  const made = { gw, gh, cell, cellY, labels };
  if (paintCache.size > 8) paintCache.delete(paintCache.keys().next().value!);
  paintCache.set(key, made);
  return { ...made, mine };
}

/**
 * Tone as a painting: the picture as flat regions of color, each filled solid in its pen - one set of
 * lines at the spacing the pen fills solid at, at the layer's angle - with, unless asked not to, a
 * line round each region, like the printed lines a painting by numbers is painted up to. Every
 * color layer paints its own regions and outlines them in its own pen; the paper's are left bare.
 */
function paint(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const { gw, gh, cell, cellY, labels, mine } = paintRegions(tones, photo, w, h);
  const labelAt = (x: number, y: number) => {
    const gx = Math.round(x / cell);
    const gy = Math.round(y / cellY);
    return gx >= 0 && gx < gw && gy >= 0 && gy < gh ? labels[gy * gw + gx] : -1;
  };
  const isMine = (x: number, y: number) => labelAt(x, y) === mine;
  const outline = photo.paintOutline ?? PAINT_DEFAULTS.outline;
  // The paper's label: the last of a split's colors; a single layer's is 0, and it has no other pen.
  const colour = Boolean(photo.ink && photo.regions && photo.region !== undefined && !photo.key);
  const paper = colour ? photo.regions!.length : 0;
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const step = Math.min(spacing / 2, cell);
  // With no outline to cover the seam, a line that ends at another color's region runs on past the
  // border - half a step to reach it, half a line's width beyond - so the two colors meet with no
  // paper showing between them. Against the paper, or the box's edge, it stops where it is.
  const overrun = step / 2 + spacing / 2;
  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  const rad = (photo.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const n = (v: number) => Number(v.toFixed(4));
  const fill: string[] = [];
  let strokes = 0;
  let line = 0;
  for (let o = -reach; o <= reach; o += spacing, line++) {
    // Every other line runs back the way the last one came, so the pen doesn't travel home between them.
    const back = line % 2 === 1;
    const runs: [number, number][] = [];
    let start: number | null = null;
    let end = 0;
    for (let t = -reach; t <= reach; t += step) {
      if (isMine(cx - dy * o + dx * t, cy + dx * o + dy * t)) {
        if (start === null) start = t;
        end = t;
      } else if (start !== null) {
        runs.push([start, end]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, end]);
    if (back) runs.reverse();
    for (let [a0, b0] of runs) {
      if (b0 - a0 < spacing) continue; // a dab, not a line
      if (!outline) {
        const meets = (t: number) => {
          const k = labelAt(cx - dy * o + dx * t, cy + dx * o + dy * t);
          return k >= 0 && k !== mine && k !== paper;
        };
        if (meets(a0 - step)) a0 -= overrun;
        if (meets(b0 + step)) b0 += overrun;
      }
      const a = back ? b0 : a0;
      const b = back ? a0 : b0;
      fill.push(`M${n(cx - dy * o + dx * a)} ${n(cy + dx * o + dy * a)}L${n(cx - dy * o + dx * b)} ${n(cy + dx * o + dy * b)}`);
      strokes++;
    }
  }
  const passes = [fill.join("")];
  if (outline) {
    // Round each of this layer's regions: where its own area meets anything else, the box's edge included.
    const field = new Float32Array(gw * gh);
    for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) field[gy * gw + gx] = labels[gy * gw + gx] === mine ? 1 : 0;
    const rings: Node[][] = [];
    for (const run of contour(field, gw, gh, 0.5)) {
      const pts = run.map(([gx, gy]) => ({ x: gx * cell, y: gy * cellY }));
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (length < 2 * Math.max(cell, cellY)) continue;
      rings.push(fitNodes(pts, Math.max(cell, cellY) * FIT_CELLS));
    }
    const ordered = shortTravel(rings);
    passes.push(pathData(ordered));
    strokes += ordered.length;
  }
  return { passes, strokes };
}

// ---------- Hilbert curve ----------

/**
 * Tone as a Hilbert curve: one line that fills the picture by folding into itself, square within
 * square, folded finer where it's darker. A square of the curve is as wide as the spacing over the
 * darkness there - the line through it covers the paper in proportion - but never wider than
 * Coarsest, so light areas still meander gently. The tone shows in steps, each fold halving the
 * square: that stepped, mechanical halftone is the look. A picture that isn't square is a row of
 * near-square tiles, each curve ending where the next begins, so it is one line - broken only, if
 * asked, where there's nothing to draw, or where a turned curve runs off the picture and back.
 *
 * Or a Peano curve, which folds each square into nine and runs corner to opposite corner: a woven,
 * back-and-forth texture, with fewer and bigger steps of tone - each three times as dense as the
 * last - so it's at its best blended. Its corners can be rounded; its steps of tone blended, each square
 * folding or not by chance in proportion to how far its tone lies between two steps; and the whole
 * curve turned.
 */
function hilbert(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const coarsest = Math.max(spacing, (photo.hilbertCoarsestMm ?? HILBERT_DEFAULTS.coarsestMm) / 25.4);
  const lift = Boolean(photo.hilbertLift);
  const peano = photo.hilbertCurve === "peano";
  // Each fold divides a square's side by this.
  const split = peano ? 3 : 2;
  const round = Math.min(1, Math.max(0, photo.hilbertRound ?? 0));
  const blend = Math.min(1, Math.max(0, photo.hilbertBlend ?? 0));
  const { toneAt } = toneSampler(tones, photo, w, h, true);

  // The darkness, summed across and down, so any box's average is four look-ups.
  const gw = Math.max(4, Math.round((HILBERT_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(4, Math.round((HILBERT_EDGE * h) / Math.max(w, h)));
  const sum = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let row = 0;
    for (let x = 0; x < gw; x++) {
      const t = toneAt(((x + 0.5) * w) / gw, ((y + 0.5) * h) / gh);
      row += t > 0 ? t : 0;
      sum[(y + 1) * (gw + 1) + x + 1] = sum[y * (gw + 1) + x + 1] + row;
    }
  }
  const at = (x: number, y: number) => sum[y * (gw + 1) + x];
  // The average darkness over the part of a box, in inches, that's on the picture: none if it's all
  // off it. For a box smaller than a grid square, the square it's in.
  const toneOver = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return 0;
    const a = Math.max(0, Math.min(gw - 1, Math.floor((x0 / w) * gw)));
    const b = Math.max(0, Math.min(gh - 1, Math.floor((y0 / h) * gh)));
    const c = Math.max(a + 1, Math.min(gw, Math.ceil((x1 / w) * gw)));
    const d = Math.max(b + 1, Math.min(gh, Math.ceil((y1 / h) * gh)));
    return (at(c, d) - at(a, d) - at(c, b) + at(a, b)) / ((c - a) * (d - b));
  };
  // A number from 0 to 1 that's always the same for the same square, for blending its fold.
  const chance = (x: number, y: number, side: number) => {
    let k = Math.imul(Math.round(x * 4096), 0x27d4eb2d) ^ Math.imul(Math.round(y * 4096), 0x165667b1) ^ Math.imul(Math.round(side * 65536), 0x9e3779b1);
    k = Math.imul(k ^ (k >>> 15), 0x85ebca6b);
    k = Math.imul(k ^ (k >>> 13), 0xc2b2ae35);
    return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
  };

  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let length = 0;
  let piece: number[][] = [];
  const close = () => {
    if (piece.length > 1) {
      // Points in a straight run are one segment: the curve is mostly straight runs.
      const kept = [piece[0]];
      for (let i = 1; i < piece.length - 1; i++) {
        const [ax, ay] = kept[kept.length - 1];
        const [bx, by] = piece[i];
        const [cx, cy] = piece[i + 1];
        if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-10) kept.push(piece[i]);
      }
      kept.push(piece[piece.length - 1]);
      for (let i = 1; i < kept.length; i++) length += Math.hypot(kept[i][0] - kept[i - 1][0], kept[i][1] - kept[i - 1][1]);
      let d = `M${n(kept[0][0])} ${n(kept[0][1])}`;
      if (round > 0) {
        // Rounded: each corner cut back along both its legs, by up to half the shorter, and the gap
        // bridged by a curve with the corner as its handle.
        for (let i = 1; i < kept.length - 1; i++) {
          const [ax, ay] = kept[i - 1];
          const [px, py] = kept[i];
          const [bx, by] = kept[i + 1];
          const la = Math.hypot(px - ax, py - ay);
          const lb = Math.hypot(bx - px, by - py);
          const r = (round * Math.min(la, lb)) / 2;
          d += `L${n(px + ((ax - px) * r) / la)} ${n(py + ((ay - py) * r) / la)}Q${n(px)} ${n(py)} ${n(px + ((bx - px) * r) / lb)} ${n(py + ((by - py) * r) / lb)}`;
        }
        const last = kept[kept.length - 1];
        d += `L${n(last[0])} ${n(last[1])}`;
      } else {
        for (let i = 1; i < kept.length; i++) d += `L${n(kept[i][0])} ${n(kept[i][1])}`;
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  // One square of the curve, at (x0, y0), `i` the way it travels and `j` across: folded into smaller
  // squares, in the curve's order, until it's fine enough for its tone, then a point at its middle.
  const fold = (x0: number, y0: number, ix: number, iy: number, jx: number, jy: number) => {
    const side = Math.max(Math.hypot(ix, iy), Math.hypot(jx, jy));
    const xs = [x0, x0 + ix, x0 + jx, x0 + ix + jx];
    const ys = [y0, y0 + iy, y0 + jy, y0 + iy + jy];
    const tone = toneOver(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    const wanted = tone > 0 ? spacing / tone : Infinity;
    // How many folds short of the size its tone wants this square is, on the curve's own scale: past
    // one half it folds, so each takes the nearest step. Blended, the half-way mark moves square by
    // square, by chance, so between two steps the squares take each in proportion and the bands
    // between steps soften into a mix. The finest step is within a half-step of the spacing.
    const short = Math.log(side / wanted) / Math.log(split);
    const mark = 0.5 + blend * (chance(x0 + (ix + jx) / 2, y0 + (iy + jy) / 2, side) - 0.5);
    if (side / split >= spacing / Math.sqrt(split) && (side > coarsest || short > mark)) {
      if (peano) {
        // Nine squares, column by column along `i`, up the first, down the second, up the third;
        // each turned so it starts where the last ended - mirrored along `i` in the middle row,
        // across `j` in the middle column.
        const [tix, tiy, tjx, tjy] = [ix / 3, iy / 3, jx / 3, jy / 3];
        for (let c = 0; c < 3; c++) {
          for (let k = 0; k < 3; k++) {
            const r = c === 1 ? 2 - k : k;
            const flipI = r === 1;
            const flipJ = c === 1;
            const ox = x0 + c * tix + r * tjx + (flipI ? tix : 0) + (flipJ ? tjx : 0);
            const oy = y0 + c * tiy + r * tjy + (flipI ? tiy : 0) + (flipJ ? tjy : 0);
            fold(ox, oy, flipI ? -tix : tix, flipI ? -tiy : tiy, flipJ ? -tjx : tjx, flipJ ? -tjy : tjy);
          }
        }
      } else {
        const [hix, hiy, hjx, hjy] = [ix / 2, iy / 2, jx / 2, jy / 2];
        fold(x0, y0, hjx, hjy, hix, hiy);
        fold(x0 + hjx, y0 + hjy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + hix, y0 + hjy + hiy, hix, hiy, hjx, hjy);
        fold(x0 + hjx + ix, y0 + hjy + iy, -hjx, -hjy, -hix, -hiy);
      }
      return;
    }
    const cx = x0 + (ix + jx) / 2;
    const cy = y0 + (iy + jy) / 2;
    // Off the picture - a turned curve's corners - or, lifting, nothing to draw: the pen comes up.
    if (cx < 0 || cx > w || cy < 0 || cy > h || (lift && tone <= 0.01)) {
      close();
      return;
    }
    piece.push([cx, cy]);
  };
  // The curve turned: worked out on axes `u` and `v` at its angle, over the box that holds the
  // picture at that angle. A row of tiles along that box's long side, as many as divide it into
  // near-squares, so it's covered exactly. A Hilbert tile runs from its first corner along `i` to
  // the next tile's first corner; a Peano tile runs to its opposite corner, so every other one is
  // flipped across to start there.
  const rad = ((photo.hilbertAngle ?? 0) * Math.PI) / 180;
  const [ux, uy] = [Math.cos(rad), Math.sin(rad)];
  const [vx, vy] = [-uy, ux];
  const us = [0, w * ux, h * uy, w * ux + h * uy];
  const vs = [0, w * vx, h * vy, w * vx + h * vy];
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const lu = u1 - u0;
  const lv = v1 - v0;
  const across = lu >= lv;
  const count = Math.max(1, Math.ceil(Math.max(lu, lv) / Math.min(lu, lv) - 1e-9));
  const along = Math.max(lu, lv) / count;
  // A point on the page from its place on the turned axes.
  const page = (u: number, v: number) => [u * ux + v * vx, u * uy + v * vy];
  for (let k = 0; k < count; k++) {
    const flip = peano && k % 2 === 1;
    if (across) {
      const [ox, oy] = page(u0 + k * along, flip ? v1 : v0);
      fold(ox, oy, along * ux, along * uy, (flip ? -lv : lv) * vx, (flip ? -lv : lv) * vy);
    } else {
      const [ox, oy] = page(flip ? u1 : u0, v0 + k * along);
      fold(ox, oy, along * vx, along * vy, (flip ? -lu : lu) * ux, (flip ? -lu : lu) * uy);
    }
  }
  close();
  return { passes: [parts.join("")], strokes, lengthMm: length * 25.4 };
}

// ---------- One line ----------

/**
 * Tone as one line: the photo stippled - dots scattered thicker where it's darker, then spread evenly
 * (Secord's weighted Voronoi stippling) - and the dots joined by the shortest route that visits each
 * once (a travelling salesman's tour), so the pen goes down once and draws the whole picture. Where
 * the dots are thick the line winds tightly and reads dark; where they're sparse it runs in long
 * strokes and reads light. Lifting over long jumps, if asked, leaves white as paper.
 */
function oneLine(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const count = Math.round(Math.min(ONE_LINE_MOST, Math.max(50, photo.lineDots ?? ONE_LINE_DEFAULTS.dots)));
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  // The grid the dots are spread on: fine enough that each dot's cell is a few squares across.
  const gw = Math.max(8, Math.round((ONE_LINE_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(8, Math.round((ONE_LINE_EDGE * h) / Math.max(w, h)));
  const sx = w / gw;
  const sy = h / gh;
  // How many dots each square wants. The line's ink goes as the square root of how thick the dots
  // are - twice the dots, about 1.4 times the line - so squared, the ink follows the tone: that's
  // Contrast at its middle. Less spreads the dots into the lights, for detail there; more crowds
  // them into the darks, for a punchier picture.
  const power = 0.5 + 3 * Math.min(1, Math.max(0, photo.lineContrast ?? 0.5));
  const want = new Float32Array(gw * gh);
  let total = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = toneAt((x + 0.5) * sx, (y + 0.5) * sy);
      const d = t > 0 ? t ** power : 0;
      want[y * gw + x] = d;
      total += d;
    }
  }
  if (total <= 0) return { passes: [""], strokes: 0 };

  // The same scatter every time, so a changed number doesn't reshuffle the whole picture.
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // First scatter: each dot in a square picked as often as it wants dots, somewhere inside it.
  const cumulative = new Float64Array(want.length);
  let run = 0;
  for (let i = 0; i < want.length; i++) cumulative[i] = run += want[i];
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const r = random() * run;
    let lo = 0;
    let hi = want.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    px[k] = (lo % gw) + random();
    py[k] = Math.floor(lo / gw) + random();
  }

  // Then spread them evenly: each dot moved to the weighted middle of the squares nearest it (Lloyd's
  // relaxation), so they sit apart like stipple rather than clumping like grain.
  const cell = Math.max(1, Math.sqrt((gw * gh) / count));
  const bw = Math.ceil(gw / cell) + 1;
  const bh = Math.ceil(gh / cell) + 1;
  const head = new Int32Array(bw * bh);
  const next = new Int32Array(count);
  const file = () => {
    head.fill(-1);
    for (let k = 0; k < count; k++) {
      const b = Math.min(bh - 1, Math.floor(py[k] / cell)) * bw + Math.min(bw - 1, Math.floor(px[k] / cell));
      next[k] = head[b];
      head[b] = k;
    }
  };
  // The dot nearest a point: the squares round it in widening rings until no nearer can be found.
  const nearest = (x: number, y: number) => {
    const bx = Math.min(bw - 1, Math.floor(x / cell));
    const by = Math.min(bh - 1, Math.floor(y / cell));
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring < Math.max(bw, bh); ring++) {
      if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestD)) break;
      for (let cy = by - ring; cy <= by + ring; cy++) {
        if (cy < 0 || cy >= bh) continue;
        for (let cx = bx - ring; cx <= bx + ring; cx++) {
          if (cx < 0 || cx >= bw || (Math.abs(cx - bx) !== ring && Math.abs(cy - by) !== ring)) continue;
          for (let k = head[cy * bw + cx]; k >= 0; k = next[k]) {
            const d = (px[k] - x) ** 2 + (py[k] - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
    }
    return best;
  };
  const mx = new Float64Array(count);
  const my = new Float64Array(count);
  const mw = new Float64Array(count);
  // Grain: fewer spreads, and the dots keep more of their first scatter's clumps and gaps.
  const spreads = Math.round(ONE_LINE_SPREAD * (1 - Math.min(1, Math.max(0, photo.lineGrain ?? 0))));
  for (let pass = 0; pass < spreads; pass++) {
    file();
    mx.fill(0);
    my.fill(0);
    mw.fill(0);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const d = want[y * gw + x];
        if (d <= 0) continue;
        const k = nearest(x + 0.5, y + 0.5);
        mx[k] += d * (x + 0.5);
        my[k] += d * (y + 0.5);
        mw[k] += d;
      }
    }
    for (let k = 0; k < count; k++) {
      if (mw[k] > 0) {
        px[k] = mx[k] / mw[k];
        py[k] = my[k] / mw[k];
      }
    }
  }
  // Into inches on the page.
  for (let k = 0; k < count; k++) {
    px[k] *= sx;
    py[k] *= sy;
  }

  // Direction: the route is planned with the page stretched across the way the line should run, so
  // a step across costs more than a step along and the line runs in streaks that way. At full
  // strength a step across costs four times as much.
  const bias = Math.min(1, Math.max(0, photo.lineBias ?? 0));
  let order: Int32Array;
  if (bias > 0) {
    const rad = ((photo.lineAngle ?? 0) * Math.PI) / 180;
    const [c, sn] = [Math.cos(rad), Math.sin(rad)];
    const stretch = 1 + 3 * bias;
    const tx = new Float64Array(count);
    const ty = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      tx[k] = px[k] * c + py[k] * sn;
      ty[k] = (-px[k] * sn + py[k] * c) * stretch;
    }
    order = tour(tx, ty);
  } else {
    order = tour(px, py);
  }
  // The tour is a loop; the line is the loop opened at its longest jump, so that one is never drawn.
  const dist = (a: number, b: number) => Math.hypot(px[a] - px[b], py[a] - py[b]);
  let cut = 0;
  for (let i = 0; i < count; i++) if (dist(order[i], order[(i + 1) % count]) > dist(order[cut], order[(cut + 1) % count])) cut = i;
  const line = Array.from({ length: count }, (_, i) => order[(cut + 1 + i) % count]);
  // Lifting over jumps longer than asked, so white is left as paper. Absent or 0, one unbroken line.
  const lift = (photo.lineLiftMm ?? 0) / 25.4;
  // Curviness: each step a curve through the dots, its handles along the line from the dot before to
  // the dot after (Catmull-Rom), as long as asked - at 1, the usual sixth of that; past it they
  // overshoot into loops, up to 2. 0, straight.
  const curve = Math.min(2, Math.max(0, photo.lineCurve ?? 0));
  const n = (v: number) => Number(v.toFixed(4));
  const parts: string[] = [];
  let strokes = 0;
  let piece: number[] = [];
  let length = 0;
  const close = () => {
    if (piece.length > 1) {
      const at = (i: number) => piece[Math.max(0, Math.min(piece.length - 1, i))];
      let d = `M${n(px[piece[0]])} ${n(py[piece[0]])}`;
      for (let i = 1; i < piece.length; i++) {
        const [a, b, c, e] = [at(i - 2), at(i - 1), at(i), at(i + 1)];
        if (curve > 0) {
          const k = curve / 6;
          d += `C${n(px[b] + (px[c] - px[a]) * k)} ${n(py[b] + (py[c] - py[a]) * k)} ${n(px[c] - (px[e] - px[b]) * k)} ${n(py[c] - (py[e] - py[b]) * k)} ${n(px[c])} ${n(py[c])}`;
        } else {
          d += `L${n(px[c])} ${n(py[c])}`;
        }
      }
      parts.push(d);
      strokes++;
    }
    piece = [];
  };
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const jump = dist(line[i - 1], line[i]);
      if (lift > 0 && jump > lift) close();
      else length += jump;
    }
    piece.push(line[i]);
  }
  close();
  return { passes: [parts.join("")], strokes, dots: count, lengthMm: length * 25.4 };
}

/**
 * A short route through every point, back to the start: the points in a Hilbert curve's order, then
 * straightened - wherever two of its legs cross or could be swapped for two shorter
 * ones, the stretch between is turned round (2-opt), looking only at each point's nearest few so a
 * big picture is still quick.
 */
function tour(px: Float64Array, py: Float64Array): Int32Array {
  const count = px.length;
  const order = new Int32Array(count);
  if (count < 4) return order.map((_, i) => i);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < count; k++) {
    x0 = Math.min(x0, px[k]); x1 = Math.max(x1, px[k]);
    y0 = Math.min(y0, py[k]); y1 = Math.max(y1, py[k]);
  }
  const cell = Math.max(1e-6, Math.sqrt(((x1 - x0) * (y1 - y0) || 1) / count) * 2);
  const bw = Math.floor((x1 - x0) / cell) + 1;
  const bh = Math.floor((y1 - y0) / cell) + 1;
  const bucketOf = (k: number) => Math.floor((py[k] - y0) / cell) * bw + Math.floor((px[k] - x0) / cell);
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  for (let k = 0; k < count; k++) buckets[bucketOf(k)].push(k);
  const d = (a: number, b: number) => Math.hypot(px[a] - px[b], py[a] - py[b]);

  // Each point's nearest few.
  const NEAR = 8;
  const near: Int32Array[] = [];
  for (let k = 0; k < count; k++) {
    const bx = Math.floor((px[k] - x0) / cell);
    const by = Math.floor((py[k] - y0) / cell);
    const found: number[] = [];
    for (let ring = 1; found.length < NEAR + 1 && ring <= Math.max(bw, bh); ring++) {
      found.length = 0;
      for (let cy = Math.max(0, by - ring); cy <= Math.min(bh - 1, by + ring); cy++) {
        for (let cx = Math.max(0, bx - ring); cx <= Math.min(bw - 1, bx + ring); cx++) found.push(...buckets[cy * bw + cx]);
      }
    }
    near.push(Int32Array.from(found.filter((j) => j !== k).sort((a, b) => d(k, a) - d(k, b)).slice(0, NEAR)));
  }

  // A first route in the order a Hilbert curve visits them: never a long jump, since the curve keeps
  // near points near each other. Starting from nearest-unvisited instead strands a few dots that
  // have to be fetched across the page at the end - long jumps the straightening below can't
  // reach, looking only at each dot's nearest few.
  const ORDER = 1 << 16;
  const keyOf = (k: number) => {
    let x = Math.min(ORDER - 1, Math.floor(((px[k] - x0) / (x1 - x0 || 1)) * (ORDER - 1)));
    let y = Math.min(ORDER - 1, Math.floor(((py[k] - y0) / (y1 - y0 || 1)) * (ORDER - 1)));
    let key = 0;
    for (let s = ORDER >> 1; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0;
      const ry = (y & s) > 0 ? 1 : 0;
      key += s * s * ((3 * rx) ^ ry);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        [x, y] = [y, x];
      }
    }
    return key;
  };
  const keys = Float64Array.from({ length: count }, (_, k) => keyOf(k));
  Array.from({ length: count }, (_, k) => k).sort((a, b) => keys[a] - keys[b]).forEach((k, i) => (order[i] = k));

  // 2-opt, with a queue of points whose legs may still improve.
  const pos = new Int32Array(count);
  for (let i = 0; i < count; i++) pos[order[i]] = i;
  const succ = (k: number) => order[(pos[k] + 1) % count];
  const pred = (k: number) => order[(pos[k] - 1 + count) % count];
  // Turn round the stretch from position i to j, going forward and wrapping; whichever way round is shorter.
  const reverse = (i: number, j: number) => {
    let len = ((j - i + count) % count) + 1;
    if (len * 2 > count) {
      const ni = (j + 1) % count;
      j = (i - 1 + count) % count;
      i = ni;
      len = count - len;
    }
    for (let s = 0; s < len >> 1; s++) {
      const a = (i + s) % count;
      const b = (j - s + count) % count;
      const t = order[a];
      order[a] = order[b];
      order[b] = t;
      pos[order[a]] = a;
      pos[order[b]] = b;
    }
  };
  const queued = new Uint8Array(count).fill(1);
  const queue: number[] = Array.from(order);
  let moves = 0;
  for (let q = 0; q < queue.length && moves < count * 50; q++) {
    const a = queue[q];
    queued[a] = 0;
    let improved = false;
    for (const dir of [1, -1]) {
      const an = dir === 1 ? succ(a) : pred(a);
      const dA = d(a, an);
      for (const b of near[a]) {
        const gain = dA - d(a, b);
        if (gain <= 1e-12) break;
        const bn = dir === 1 ? succ(b) : pred(b);
        if (b === an || bn === a) continue;
        if (gain + d(b, bn) - d(an, bn) > 1e-12) {
          // Legs a-an and b-bn become a-b and an-bn.
          if (dir === 1) reverse(pos[an], pos[b]);
          else reverse(pos[b], pos[an]);
          for (const k of [a, an, b, bn]) if (!queued[k]) { queued[k] = 1; queue.push(k); }
          moves++;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return order;
}


// ---------- Scribble ----------

/**
 * Tone as scribbling: strokes that wander and curl at random, overlapping freely, laid down until each
 * part of the picture has about as much ink as it's dark. Ink is kept count of on a grid as it goes
 * down. Random lines a spacing apart on average cover only part of the paper - they overlap - so the
 * count aims at what random lines need for the darkness: -ln(1 - darkness) spacings' worth. A stroke
 * starts where ink is most wanted (picked at random, likelier the more is wanted), turns a little more
 * or less at every step, and leans toward whichever side still wants ink, so it keeps to the dark
 * parts and tangles there; it ends at its longest, at the box's edge, or once it has run a few
 * spacings through parts that have enough. A stroke shorter than the minimum is left out and its ink
 * taken back off the count, so others fill there instead. Strokes are tried until a long run of tries finds nothing
 * wanting. Random, but the same each time for the same layer and seed; each layer of a photo scribbles
 * its own way, so their lines don't fall together.
 */
function scribble(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const longest = Math.max(2, photo.scribbleLengthMm ?? SCRIBBLE_DEFAULTS.lengthMm) / 25.4;
  const shortest = Math.min(longest, Math.max(0, photo.scribbleMinMm ?? SCRIBBLE_DEFAULTS.minMm) / 25.4);
  const wiggle = Math.min(100, Math.max(0, photo.scribbleWiggle ?? SCRIBBLE_DEFAULTS.wiggle)) / 100;
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const n = (v: number) => Number(v.toFixed(4));
  // Random, from the seed and the layer: the same scribble every time it's worked out.
  let state = (photo.scribbleSeed ?? SCRIBBLE_DEFAULTS.seed) * 0x9e3779b1;
  for (const ch of layerOf(photo)) state = Math.imul(state ^ ch.charCodeAt(0), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  // The ink grid: each cell's ink wanted and laid, in spacings' worth of line across it.
  const cell = Math.max(spacing * 2, 1 / 25.4);
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const MOST = 3; // -ln(1 - 0.95): past that, random lines add little the eye sees
  const want = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = toneAt(Math.min(w, (c + 0.5) * cell), Math.min(h, (r + 0.5) * cell));
      want[r * cols + c] = t > 0 ? Math.min(MOST, -Math.log(1 - Math.min(0.999, t))) : 0;
    }
  }
  const laid = new Float32Array(cols * rows);
  const cellAt = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const need = (x: number, y: number) => (x < 0 || x > w || y < 0 || y > h ? -1 : want[cellAt(x, y)] - laid[cellAt(x, y)]);
  // A step of line `step` long, in spacings' worth across its cell.
  const step = Math.max(spacing, 0.4 / 25.4);
  const inkPerStep = (step * spacing) / (cell * cell);

  // How tightly it curls: about 30 mm across just above 0, 1 mm at 100 - and at 0, not at all: straight
  // lines, which don't lean toward the ink either. The turn wanders at random about
  // nothing, steadied each step, so it bends one way for a while and then the other.
  const curl = wiggle > 0 ? 1 / (30 / 25.4 * (1 / 30) ** wiggle) : 0;
  const steady = 0.85;
  const jolt = curl * Math.sqrt(1 - steady * steady);
  const look = Math.max(spacing * 3, 1.5 / 25.4);
  const slack = spacing * 4; // how far a stroke may run through what has enough before it stops

  const drawn: number[][][] = [];
  let misses = 0;
  const tries = 4000;
  for (let guard = 0; misses < tries && guard < 400000; guard++) {
    const sx = random() * w;
    const sy = random() * h;
    const wanted = need(sx, sy);
    if (wanted <= 0.05 || random() * MOST > wanted) {
      misses++;
      continue;
    }
    const missed = misses;
    misses = 0;
    let x = sx;
    let y = sy;
    let heading = random() * Math.PI * 2;
    let turn = gauss() * curl;
    const pts: number[][] = [[x, y]];
    const inked: number[] = []; // the cell each step laid its ink in, to take back if it's left out
    let length = 0;
    let idle = 0;
    while (length < longest) {
      // Lean toward the side that wants more ink, a little ahead.
      const toLeft = need(x + Math.cos(heading - 0.6) * look, y + Math.sin(heading - 0.6) * look);
      const toRight = need(x + Math.cos(heading + 0.6) * look, y + Math.sin(heading + 0.6) * look);
      turn = turn * steady + gauss() * jolt + Math.sign(toRight - toLeft) * Math.min(1, Math.abs(toRight - toLeft)) * curl * 0.5;
      heading += turn * step;
      const nx = x + Math.cos(heading) * step;
      const ny = y + Math.sin(heading) * step;
      const here = need(nx, ny);
      if (here < -0.5) break; // off the box, or outside the picture
      idle = here > 0 ? 0 : idle + step;
      if (idle > slack) break;
      const at = cellAt(nx, ny);
      laid[at] += inkPerStep;
      inked.push(at);
      x = nx;
      y = ny;
      pts.push([x, y]);
      length += step;
    }
    // Trailing steps through what had enough are taken back off.
    while (idle > 0 && pts.length > 1) {
      pts.pop();
      idle -= step;
    }
    // Too short once trimmed: left out, its ink given back, and counted as a miss so a spot only
    // that short a stroke fits doesn't keep the tries going.
    if (shortest > 0 && (pts.length - 1) * step < shortest) {
      for (const at of inked) laid[at] -= inkPerStep;
      misses = missed + 1;
      continue;
    }
    // A straight stroke needs only its ends.
    if (length >= spacing * 2 && pts.length > 2) drawn.push(curl ? pts : [pts[0], pts[pts.length - 1]]);
  }

  // Drawn nearest first, each from whichever end is nearer the pen, so it doesn't cross the page between them.
  const parts: string[] = [];
  const left = new Set(drawn.map((_, i) => i));
  let px = 0;
  let py = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (const i of left) {
      const a = drawn[i][0];
      const b = drawn[i][drawn[i].length - 1];
      const da = (a[0] - px) ** 2 + (a[1] - py) ** 2;
      const db = (b[0] - px) ** 2 + (b[1] - py) ** 2;
      if (da < bestD) [best, bestD, flip] = [i, da, false];
      if (db < bestD) [best, bestD, flip] = [i, db, true];
    }
    left.delete(best);
    const run = flip ? [...drawn[best]].reverse() : drawn[best];
    const kept = simplified(run, 0.02 / 25.4);
    parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
    [px, py] = run[run.length - 1];
  }
  return { passes: [parts.join("")], strokes: parts.length };
}

// ---------- Streamlines ----------

/**
 * Tone as streamlines, after Jobard and Lefer: lines that flow along the picture's own shapes - round
 * a cheek, down a fold - rather than straight across it, closer together where it's darker. Each line
 * runs on until it comes within half its spacing of another, then stops; the next starts its spacing
 * away from one already drawn, so they lie evenly, the way an engraver's do. Where the picture has no
 * shape to follow - sky, a flat wall - they settle to the layer's angle. A second pass runs across the
 * first for the deepest darks.
 */
function streamlines(tones: Tones, photo: Photo, w: number, h: number): PhotoMarks {
  const spacing = Math.max(0.05, photo.spacingMm) / 25.4;
  const widest = Math.max(spacing, (photo.streamWidestMm ?? STREAM_DEFAULTS.widestMm) / 25.4);
  const passCount = Math.min(2, Math.max(1, Math.round(photo.streamPasses ?? STREAM_DEFAULTS.passes)));
  // One look at the photo every half a spacing along a line: close enough that a neighbour can't slip
  // between two of them unseen.
  const step = spacing / 2;
  const shortest = Math.max(1 / 25.4, spacing * 4);
  // A band draws where the photo's tone is its own, at the whole photo's darkness, so bands together
  // draw what one layer would.
  const { toneAt } = toneSampler(tones, photo, w, h, true);
  const field = flowField(tones, photo, w, h);
  const n = (v: number) => Number(v.toFixed(4));

  // Every point drawn so far, filed by where it is, so the nearest are quick to find. Each grid square
  // keeps its last point; each point the one filed there before it.
  const cell = Math.max(spacing * 2, 0.4 / 25.4);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const head = new Int32Array(cols * rows).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const lineOf: number[] = [];
  const indexOf: number[] = [];
  const next: number[] = [];
  const cellOf = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const file = (x: number, y: number, line: number, index: number) => {
    const c = cellOf(x, y);
    xs.push(x);
    ys.push(y);
    lineOf.push(line);
    indexOf.push(index);
    next.push(head[c]);
    head[c] = xs.length - 1;
  };
  // Whether anything already drawn is nearer than `r` - leaving out this line's own points close along it.
  const crowded = (x: number, y: number, r: number, line = -1, index = 0, ownGap = 0) => {
    const r2 = r * r;
    const cx0 = Math.max(0, Math.floor((x - r) / cell));
    const cx1 = Math.min(cols - 1, Math.floor((x + r) / cell));
    const cy0 = Math.max(0, Math.floor((y - r) / cell));
    const cy1 = Math.min(rows - 1, Math.floor((y + r) / cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let i = head[cy * cols + cx]; i >= 0; i = next[i]) {
          if (lineOf[i] === line && Math.abs(indexOf[i] - index) <= ownGap) continue;
          const ddx = xs[i] - x;
          const ddy = ys[i] - y;
          if (ddx * ddx + ddy * ddy < r2) return true;
        }
      }
    }
    return false;
  };

  const passes: string[] = [];
  let strokes = 0;
  let lineCount = 0;
  for (let k = 0; k < passCount; k++) {
    // Each pass keeps its spacing from its own lines only: the second runs across the first.
    head.fill(-1);
    xs.length = ys.length = lineOf.length = indexOf.length = next.length = 0;
    // Each pass draws its share of the darkness: with two, the first fills in to the middle tones and
    // the second, across it, from there to black. The spacing is the closest spacing over that share,
    // so the ink laid down follows the tone; past the widest, it's paper.
    const sepAt = (x: number, y: number) => {
      const t = toneAt(x, y);
      if (t < 0) return Infinity;
      const share = Math.min(1, Math.max(0, t * passCount - k));
      const sep = share > 0 ? spacing / share : Infinity;
      return sep <= widest ? sep : Infinity;
    };
    const turn = k === 1;
    const dirAt = (x: number, y: number, fx: number, fy: number): [number, number] => {
      let [ux, uy] = field(x, y);
      if (turn) [ux, uy] = [-uy, ux];
      return ux * fx + uy * fy < 0 ? [-ux, -uy] : [ux, uy];
    };
    // A line from a seed, both ways, stopping at the edge, in paper, or near another line. Its points
    // are filed as it goes, so it can't run back into itself; if it comes out too short to keep, they
    // are taken out again - the last filed in each square, so the list stays whole.
    const grow = (sx: number, sy: number): number[][] | null => {
      const line = lineCount;
      const [u0x, u0y] = field(sx, sy);
      const start = turn ? [-u0y, u0x] : [u0x, u0y];
      const halves: number[][][] = [];
      let length = 0;
      file(sx, sy, line, 0);
      const filed: number[] = [xs.length - 1];
      for (const sign of [1, -1]) {
        const half: number[][] = [];
        let x = sx;
        let y = sy;
        let fx = start[0] * sign;
        let fy = start[1] * sign;
        for (let i = 1; i < 20000; i++) {
          const [ax, ay] = dirAt(x, y, fx, fy);
          const [bx, by] = dirAt(x + (ax * step) / 2, y + (ay * step) / 2, ax, ay);
          const nx = x + bx * step;
          const ny = y + by * step;
          if (nx < 0 || nx > w || ny < 0 || ny > h) break;
          const sep = sepAt(nx, ny);
          if (!Number.isFinite(sep)) break;
          const index = i * sign;
          if (crowded(nx, ny, sep / 2, line, index, Math.ceil((sep * 1.5) / step))) break;
          file(nx, ny, line, index);
          filed.push(xs.length - 1);
          half.push([nx, ny]);
          length += step;
          x = nx;
          y = ny;
          fx = bx;
          fy = by;
        }
        halves.push(half);
      }
      if (length < shortest) {
        for (let j = filed.length - 1; j >= 0; j--) {
          const i = filed[j];
          head[cellOf(xs[i], ys[i])] = next[i];
        }
        xs.length = ys.length = lineOf.length = indexOf.length = next.length = filed[0];
        return null;
      }
      lineCount++;
      return [...halves[1].reverse(), [sx, sy], ...halves[0]];
    };
    // A seed is good where there's something to draw and nothing already within its spacing.
    const seedable = (x: number, y: number) => {
      if (x < 0 || x > w || y < 0 || y > h) return false;
      const sep = sepAt(x, y);
      return Number.isFinite(sep) && !crowded(x, y, sep);
    };

    const drawn: number[][][] = [];
    // Each line kept seeds its neighbours, a spacing away either side, and they theirs, until the
    // area fills; then the search across the photo finds the next area that hasn't been reached.
    const spread = (first: number[][]) => {
      const queue = [first];
      drawn.push(first);
      for (let q = 0; q < queue.length; q++) {
        const pts = queue[q];
        for (let i = 0; i < pts.length; i += 2) {
          const [x, y] = pts[i];
          const [a, b] = pts[Math.min(pts.length - 1, i + 1)];
          const [c, d] = pts[Math.max(0, i - 1)];
          const len = Math.hypot(a - c, b - d) || 1;
          const nx = -(b - d) / len;
          const ny = (a - c) / len;
          const sep = sepAt(x, y);
          if (!Number.isFinite(sep)) continue;
          for (const side of [1, -1]) {
            const qx = x + nx * sep * side;
            const qy = y + ny * sep * side;
            if (!seedable(qx, qy)) continue;
            const grown = grow(qx, qy);
            if (grown) {
              drawn.push(grown);
              queue.push(grown);
            }
          }
        }
      }
    };
    const scan = spacing * 2;
    for (let y = scan / 2; y < h; y += scan) {
      for (let x = scan / 2; x < w; x += scan) {
        if (!seedable(x, y)) continue;
        const grown = grow(x, y);
        if (grown) spread(grown);
      }
    }

    // Drawn in the order they were made - each beside the last - and each turned to start at whichever
    // end is nearer where the pen is, so it doesn't cross the page between them.
    const parts: string[] = [];
    let px = 0;
    let py = 0;
    for (const pts of drawn) {
      const [ax, ay] = pts[0];
      const [bx, by] = pts[pts.length - 1];
      const run = (bx - px) ** 2 + (by - py) ** 2 < (ax - px) ** 2 + (ay - py) ** 2 ? [...pts].reverse() : pts;
      const kept = simplified(run, 0.01 / 25.4);
      parts.push(`M${kept.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`);
      [px, py] = run[run.length - 1];
      strokes++;
    }
    passes.push(parts.join(""));
  }
  return { passes, strokes };
}

/** The longer side of the grid the flow is worked out on. */
const FLOW_EDGE = 400;

/**
 * Which way the lines flow at each point of the photo's box, as a direction (either way along it):
 * along the edges and shapes of the picture - across the way it gets lighter or darker - smoothed by
 * `streamFlowMm` so the lines sweep rather than wander. Where there's no shape to follow, the layer's
 * angle. Worked out from the structure tensor: each point's gradient, doubled in angle so opposite
 * directions agree, averaged over the neighbourhood.
 */
function flowField(tones: Tones, photo: Photo, w: number, h: number) {
  const gw = Math.max(3, Math.round((FLOW_EDGE * w) / Math.max(w, h)));
  const gh = Math.max(3, Math.round((FLOW_EDGE * h) / Math.max(w, h)));
  const lift = photo.brightness / 200;
  const c = Math.max(-99, Math.min(99, photo.contrast)) / 100;
  const gain = c >= 0 ? 1 / (1 - c) : 1 + c;
  const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
  const dark = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) dark[y * gw + x] = darknessAt(tones, c0 + (x / (gw - 1)) * (c2 - c0), c1 + (y / (gh - 1)) * (c3 - c1), lift, gain);
  }
  blurGrid(dark, gw, gh, 1);
  const jxx = new Float32Array(gw * gh);
  const jxy = new Float32Array(gw * gh);
  const jyy = new Float32Array(gw * gh);
  const at = (x: number, y: number) => dark[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * gw + x;
      jxx[i] = gx * gx;
      jxy[i] = gx * gy;
      jyy[i] = gy * gy;
    }
  }
  const cellMm = (w * 25.4) / (gw - 1);
  const r = Math.max(0, photo.streamFlowMm ?? STREAM_DEFAULTS.flowMm) / cellMm;
  blurGrid(jxx, gw, gh, r);
  blurGrid(jxy, gw, gh, r);
  blurGrid(jyy, gw, gh, r);
  // The gradient's direction, doubled: (Jxx - Jyy, 2Jxy), as long as the shape is clear. A little of
  // the layer's own angle is added everywhere, so where the picture is flat that's what wins.
  const ex = new Float32Array(gw * gh);
  const ey = new Float32Array(gw * gh);
  let total = 0;
  for (let i = 0; i < ex.length; i++) {
    ex[i] = jxx[i] - jyy[i];
    ey[i] = 2 * jxy[i];
    total += Math.hypot(ex[i], ey[i]);
  }
  const quiet = (0.15 * total) / ex.length + 1e-9;
  // The gradient runs across the lines, so the angle it settles to is the layer's turned a right angle.
  const across = ((photo.angle + 90) * Math.PI) / 180;
  const qx = quiet * Math.cos(2 * across);
  const qy = quiet * Math.sin(2 * across);
  for (let i = 0; i < ex.length; i++) {
    const a = ex[i] + qx;
    const b = ey[i] + qy;
    const len = Math.hypot(a, b) || 1;
    ex[i] = a / len;
    ey[i] = b / len;
  }
  return (x: number, y: number): [number, number] => {
    const gx = Math.min(gw - 1, Math.max(0, (x / w) * (gw - 1)));
    const gy = Math.min(gh - 1, Math.max(0, (y / h) * (gh - 1)));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const mix = (v: Float32Array) =>
      (v[y0 * gw + x0] * (1 - fx) + v[y0 * gw + x1] * fx) * (1 - fy) + (v[y1 * gw + x0] * (1 - fx) + v[y1 * gw + x1] * fx) * fy;
    // Halved back to a direction, and turned a right angle: along the shape, not across it.
    const theta = Math.atan2(mix(ey), mix(ex)) / 2 + Math.PI / 2;
    return [Math.cos(theta), Math.sin(theta)];
  };
}

/** A line with the points dropped that lie within `tolerance` of the straight line past them (Douglas-Peucker). */
export function simplified(pts: number[][], tolerance: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let far = -1;
    let most = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Every style but hatching, which is what no style means: one list for writing and reading, so
// none is written that isn't read back, or the other way round.
const SAVED_STYLES = ["waves", "squiggle", "streamlines", "scribble", "oneline", "hilbert", "outlines", "centerlines", "silhouette", "edges", "paint"] as const;
const isSavedStyle = (v: unknown): v is (typeof SAVED_STYLES)[number] => (SAVED_STYLES as readonly unknown[]).includes(v);

/** A photo read back from a saved drawing: only a picture and numbers are kept, so check them on the way in. */
export function photoFromData(raw: Record<string, unknown>): Photo | null {
  const src = raw.src;
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    src,
    width: num(raw.width, 1),
    height: num(raw.height, 1),
    brightness: num(raw.brightness, PHOTO_DEFAULTS.brightness),
    contrast: num(raw.contrast, PHOTO_DEFAULTS.contrast),
    ...(num(raw.channel_brightness, 0) ? { channelBrightness: num(raw.channel_brightness, 0) } : {}),
    ...(num(raw.channel_contrast, 0) ? { channelContrast: num(raw.channel_contrast, 0) } : {}),
    ...(num(raw.channel_black_point, 0) ? { channelBlackPoint: num(raw.channel_black_point, 0) } : {}),
    ...(num(raw.black_point, 0) ? { blackPoint: num(raw.black_point, 0) } : {}),
    ...(typeof raw.profile === "string" && raw.profile ? {
      profile: raw.profile,
      ...(typeof raw.profile_name === "string" ? { profileName: raw.profile_name } : {}),
      ...([1, 2, 3].includes(Number(raw.profile_intent)) ? { profileIntent: Number(raw.profile_intent) } : {}),
      ...(raw.profile_bpc === true ? { profileBpc: true } : {}),
      profileInk: Math.max(0, Math.floor(num(raw.profile_ink, 0))),
    } : {}),
    angle: num(raw.angle, PHOTO_DEFAULTS.angle),
    spacingMm: num(raw.spacing_mm, 0.3),
    ...(typeof raw.source === "string" && raw.source ? { source: raw.source } : {}),
    ...(Number.isInteger(raw.source_channel) && Number(raw.source_channel) >= 0 ? { sourceChannel: Number(raw.source_channel) } : {}),
    ...([1, 2, 3].includes(Number(raw.quarter_turns)) ? { quarterTurns: Number(raw.quarter_turns) } : {}),
    ...(isPart(raw.cut) ? { cut: raw.cut } : {}),
    levels: num(raw.levels, PHOTO_DEFAULTS.levels),
    ...(typeof raw.group === "string" ? { group: raw.group } : {}),
    ...(typeof raw.link === "string" ? { link: raw.link } : {}),
    ...(Number.isFinite(Number(raw.edge_from)) && raw.edge_from !== undefined ? { edgeFrom: Number(raw.edge_from) } : {}),
    ...(Number.isFinite(Number(raw.edge_smooth_mm)) && raw.edge_smooth_mm !== undefined ? { edgeSmoothMm: Number(raw.edge_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.edge_shortest_mm)) && raw.edge_shortest_mm !== undefined ? { edgeShortestMm: Number(raw.edge_shortest_mm) } : {}),
    ...(typeof raw.edgeMask === "string" && raw.edgeMask.startsWith("data:image/") ? { edgeMask: raw.edgeMask } : {}),
    ...(typeof raw.edgeMaskName === "string" ? { edgeMaskName: raw.edgeMaskName } : {}),
    ...(raw.edgeMaskInvert === true ? { edgeMaskInvert: true } : {}),
    ...(edgeGenFromData(raw.edgeGen) ? { edgeGen: edgeGenFromData(raw.edgeGen) } : {}),
    ...(vignetteFromData(raw.vignette) ? { vignette: vignetteFromData(raw.vignette) } : {}),
    ...(Array.isArray(raw.edgeMaskSides) ? { edgeMaskSides: MASK_SIDES.filter((side) => (raw.edgeMaskSides as unknown[]).includes(side)) } : {}),
    ...(Array.isArray(raw.crop) && raw.crop.length === 4 && raw.crop.every((v) => Number.isFinite(Number(v)))
      ? { crop: raw.crop.map(Number) as [number, number, number, number] }
      : {}),
    ...(raw.fit === "fit" || raw.fit === "fill" ? { fit: raw.fit } : {}),
    ...(raw.align && typeof raw.align === "object"
      && [0, 0.5, 1].includes((raw.align as FitAlign).x) && [0, 0.5, 1].includes((raw.align as FitAlign).y)
      ? { align: { x: (raw.align as FitAlign).x, y: (raw.align as FitAlign).y } } : {}),
    ...(isSavedStyle(raw.style) ? { style: raw.style } : {}),
    ...(Number.isFinite(Number(raw.center_from)) && raw.center_from !== undefined ? { centerFrom: Number(raw.center_from) } : {}),
    ...(Number.isFinite(Number(raw.center_smooth_mm)) && raw.center_smooth_mm !== undefined ? { centerSmoothMm: Number(raw.center_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.center_shortest_mm)) && raw.center_shortest_mm !== undefined ? { centerShortestMm: Number(raw.center_shortest_mm) } : {}),
    ...(raw.center_mode === "curves" || raw.center_mode === "mixed" || raw.center_mode === "straight" ? { centerMode: raw.center_mode } : {}),
    ...(Number(raw.center_straight_mm) > 0 ? { centerStraightMm: Number(raw.center_straight_mm) } : {}),
    ...(Number(raw.center_long_mm) > 0 ? { centerLongMm: Number(raw.center_long_mm) } : {}),
    ...(Number(raw.center_corner_deg) > 0 ? { centerCornerDeg: Math.min(179, Number(raw.center_corner_deg)) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_from)) && raw.silhouette_from !== undefined ? { silhouetteFrom: Number(raw.silhouette_from) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_smooth_mm)) && raw.silhouette_smooth_mm !== undefined ? { silhouetteSmoothMm: Number(raw.silhouette_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.silhouette_smallest_mm)) && raw.silhouette_smallest_mm !== undefined ? { silhouetteSmallestMm: Number(raw.silhouette_smallest_mm) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_coarsest_mm)) && raw.hilbert_coarsest_mm !== undefined ? { hilbertCoarsestMm: Number(raw.hilbert_coarsest_mm) } : {}),
    ...(raw.hilbert_lift === true ? { hilbertLift: true } : {}),
    ...(raw.hilbert_curve === "peano" ? { hilbertCurve: "peano" as const } : {}),
    ...(Number.isFinite(Number(raw.hilbert_round)) && raw.hilbert_round !== undefined ? { hilbertRound: Number(raw.hilbert_round) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_blend)) && raw.hilbert_blend !== undefined ? { hilbertBlend: Number(raw.hilbert_blend) } : {}),
    ...(Number.isFinite(Number(raw.hilbert_angle)) && raw.hilbert_angle !== undefined ? { hilbertAngle: Number(raw.hilbert_angle) } : {}),
    ...Object.fromEntries((["line_curve", "line_angle", "line_bias", "line_grain", "line_contrast"] as const)
      .filter((k) => raw[k] !== undefined && Number.isFinite(Number(raw[k])))
      .map((k) => [{ line_curve: "lineCurve", line_angle: "lineAngle", line_bias: "lineBias", line_grain: "lineGrain", line_contrast: "lineContrast" }[k], Number(raw[k])])),
    ...(Number.isFinite(Number(raw.line_dots)) && raw.line_dots !== undefined ? { lineDots: Number(raw.line_dots) } : {}),
    ...(Number.isFinite(Number(raw.line_lift_mm)) && raw.line_lift_mm !== undefined ? { lineLiftMm: Number(raw.line_lift_mm) } : {}),
    ...(Number.isFinite(Number(raw.stream_widest_mm)) && raw.stream_widest_mm !== undefined ? { streamWidestMm: Number(raw.stream_widest_mm) } : {}),
    ...(Number.isFinite(Number(raw.scribble_length_mm)) && raw.scribble_length_mm !== undefined ? { scribbleLengthMm: Number(raw.scribble_length_mm) } : {}),
    ...(Number.isFinite(Number(raw.scribble_min_mm)) && raw.scribble_min_mm !== undefined ? { scribbleMinMm: Number(raw.scribble_min_mm) } : {}),
    ...(Number.isFinite(Number(raw.paint_smooth_mm)) && raw.paint_smooth_mm !== undefined ? { paintSmoothMm: Number(raw.paint_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.paint_smallest_mm)) && raw.paint_smallest_mm !== undefined ? { paintSmallestMm: Number(raw.paint_smallest_mm) } : {}),
    ...(raw.paint_outline === false ? { paintOutline: false } : {}),
    ...(Number.isFinite(Number(raw.scribble_wiggle)) && raw.scribble_wiggle !== undefined ? { scribbleWiggle: Number(raw.scribble_wiggle) } : {}),
    ...(Number.isFinite(Number(raw.scribble_seed)) && raw.scribble_seed !== undefined ? { scribbleSeed: Number(raw.scribble_seed) } : {}),
    ...(Number.isFinite(Number(raw.stream_passes)) && raw.stream_passes !== undefined ? { streamPasses: Number(raw.stream_passes) } : {}),
    ...(Number.isFinite(Number(raw.stream_flow_mm)) && raw.stream_flow_mm !== undefined ? { streamFlowMm: Number(raw.stream_flow_mm) } : {}),
    ...(Number.isFinite(Number(raw.contours)) && raw.contours !== undefined ? { contours: Number(raw.contours) } : {}),
    ...(Number.isFinite(Number(raw.smooth_mm)) && raw.smooth_mm !== undefined ? { smoothMm: Number(raw.smooth_mm) } : {}),
    ...(typeof raw.ink === "string" ? { ink: raw.ink } : {}),
    ...(Array.isArray(raw.offset_mm) && raw.offset_mm.length === 2 && raw.offset_mm.every((v) => Number.isFinite(Number(v)))
      ? { offsetMm: [Number(raw.offset_mm[0]), Number(raw.offset_mm[1])] as [number, number] }
      : {}),
    ...(Array.isArray(raw.regions) && raw.regions.every((v) => typeof v === "string") ? { regions: raw.regions as string[] } : {}),
    ...(Number.isInteger(Number(raw.region)) && raw.region !== undefined ? { region: Number(raw.region) } : {}),
    ...(typeof raw.fit_paper === "string" ? { fitPaper: raw.fit_paper } : {}),
    ...(Number.isFinite(Number(raw.pen_mm)) && raw.pen_mm !== undefined ? { penMm: Number(raw.pen_mm) } : {}),
    ...(raw.fit_pairs === true ? { fitPairs: true } : {}),
    ...(raw.fit_opaque === true ? { fitOpaque: true } : {}),
    ...(raw.key === true ? { key: true } : {}),
    ...(raw.modes && typeof raw.modes === "object" ? { modes: raw.modes as Photo["modes"] } : {}),
    ...(typeof raw.key_ink === "string" ? { keyInk: raw.key_ink } : {}),
    ...(Number.isFinite(Number(raw.key_strength)) && raw.key_strength !== undefined ? { keyStrength: Number(raw.key_strength) } : {}),
    ...(Number.isFinite(Number(raw.key_from)) && raw.key_from !== undefined ? { keyFrom: Number(raw.key_from) } : {}),
    ...(typeof raw.separation === "string" ? { separation: raw.separation } : {}),
    ...(typeof raw.plate === "string" && "cmykogrv".includes(raw.plate) && raw.plate.length === 1 ? { plate: raw.plate as Plate } : {}),
    ...(Array.isArray(raw.plates) && raw.plates.every((v) => typeof v === "string") ? { plates: raw.plates as string[] } : {}),
    ...(Number.isFinite(Number(raw.black_share)) && raw.black_share !== undefined ? { blackShare: Number(raw.black_share) } : {}),
    ...(Array.isArray(raw.region_inks) ? { regionInks: raw.region_inks.map((c) => (typeof c === "string" ? c : null)) } : {}),
    ...(Number.isFinite(Number(raw.row_mm)) && raw.row_mm !== undefined ? { rowMm: Number(raw.row_mm) } : {}),
    ...(Number.isFinite(Number(raw.wave_mm)) && raw.wave_mm !== undefined ? { waveMm: Number(raw.wave_mm) } : {}),
    ...(Number.isFinite(Number(raw.saturation)) && raw.saturation !== undefined && Number(raw.saturation) !== 0 ? { saturation: Number(raw.saturation) } : {}),
    ...(Number.isFinite(Number(raw.hatch_smooth_mm)) && raw.hatch_smooth_mm !== undefined ? { hatchSmoothMm: Number(raw.hatch_smooth_mm) } : {}),
    ...(Number.isFinite(Number(raw.hatch_shortest_mm)) && raw.hatch_shortest_mm !== undefined ? { hatchShortestMm: Math.max(0, Number(raw.hatch_shortest_mm)) } : {}),
    ...(Number.isFinite(Number(raw.squiggle_amp_mm)) && raw.squiggle_amp_mm !== undefined ? { squiggleAmpMm: Number(raw.squiggle_amp_mm) } : {}),
    ...(Number.isFinite(Number(raw.squiggle_height)) && raw.squiggle_height !== undefined ? { squiggleHeight: Number(raw.squiggle_height) } : {}),
    ...(raw.squiggle_join === true ? { squiggleJoin: true } : {}),
    ...(raw.angle_preset === "classic" || raw.angle_preset === "complementary" || raw.angle_preset === "cardinal" || raw.angle_preset === "golden" || raw.angle_preset === "uniform" ? { anglePreset: raw.angle_preset } : {}),
    ...(Number.isFinite(Number(raw.angle_turn)) && raw.angle_turn !== undefined ? { angleTurn: Number(raw.angle_turn) } : {}),
    ...(raw.squiggle_lift === true ? { squiggleLift: true } : {}),
    ...(Number.isFinite(Number(raw.squiggle_smooth)) && raw.squiggle_smooth !== undefined ? { squiggleSmooth: Number(raw.squiggle_smooth) } : {}),
    ...(raw.squiggle_draw && typeof raw.squiggle_draw === "object" ? { squiggleDraw: Object.fromEntries(Object.entries(raw.squiggle_draw as Record<string, unknown>).filter(([k, v]) => k in SQUIGGLE_DRAW && (k === "invert" ? typeof v === "boolean" : Number.isFinite(Number(v)))).map(([k, v]) => [k, k === "invert" ? v : Number(v)])) as Partial<SquiggleDraw> } : {}),
    ...(raw.squiggle_version === "inkscape" ? { squiggleVersion: "inkscape" as const } : {}),
    ...(Number.isFinite(Number(raw.squiggle_angle)) && raw.squiggle_angle !== undefined ? { squiggleAngle: Number(raw.squiggle_angle) } : {}),
    ...(raw.squiggle_inkscape && typeof raw.squiggle_inkscape === "object" ? { squiggleInkscape: Object.fromEntries(Object.entries(raw.squiggle_inkscape as Record<string, unknown>).filter(([k, v]) => k in SQUIGGLE_INKSCAPE && (k === "invert" ? typeof v === "boolean" : k === "path" ? v === "uni" || v === "bidi" || v === "join" : Number.isFinite(Number(v)))).map(([k, v]) => [k, k === "invert" || k === "path" ? v : Number(v)])) as Partial<SquiggleInkscape> } : {}),
    ...(Number.isFinite(Number(raw.bleed)) && raw.bleed !== undefined ? { bleed: Number(raw.bleed) } : {}),
    ...(Number.isFinite(Number(raw.margin)) && raw.margin !== undefined ? { margin: Number(raw.margin) } : {}),
    ...(raw.side === "dark" || raw.side === "light" ? { side: raw.side } : {}),
    ...(Array.isArray(raw.paper_tone) && raw.paper_tone.length === 2 && raw.paper_tone.every((v) => Number.isFinite(Number(v)))
      ? { paperTone: [Number(raw.paper_tone[0]), Number(raw.paper_tone[1])] as [number, number] }
      : {}),
    ...(raw.paper_tone_set === true ? { paperToneSet: true } : {}),
    ...(Array.isArray(raw.band) && raw.band.length === 2 && raw.band.every((v) => Number.isFinite(Number(v)))
      ? { band: [Number(raw.band[0]), Number(raw.band[1])] as [number, number] }
      : {}),
  };
}

/** A photo as the design block keeps it. */
export const photoData = (p: Photo) => ({
  src: p.src, width: p.width, height: p.height, brightness: p.brightness, contrast: p.contrast,
  ...(p.channelBrightness ? { channel_brightness: p.channelBrightness } : {}),
  ...(p.channelContrast ? { channel_contrast: p.channelContrast } : {}),
  ...(p.channelBlackPoint ? { channel_black_point: p.channelBlackPoint } : {}),
  ...(p.blackPoint ? { black_point: p.blackPoint } : {}),
  ...(p.profile ? { profile: p.profile, profile_name: p.profileName, profile_intent: p.profileIntent || undefined, profile_bpc: p.profileBpc || undefined, profile_ink: p.profileInk ?? 0 } : {}),
  angle: p.angle, spacing_mm: p.spacingMm, levels: p.levels,
  ...(p.source ? { source: p.source } : {}),
  ...(p.source && p.sourceChannel !== undefined ? { source_channel: p.sourceChannel } : {}),
  ...(p.quarterTurns ? { quarter_turns: p.quarterTurns } : {}),
  ...(p.cut ? { cut: p.cut } : {}),
  ...(p.group ? { group: p.group } : {}),
  ...(p.link ? { link: p.link } : {}),
  ...(p.edgeFrom !== undefined ? { edge_from: p.edgeFrom } : {}),
  ...(p.edgeSmoothMm !== undefined ? { edge_smooth_mm: p.edgeSmoothMm } : {}),
  ...(p.edgeShortestMm !== undefined ? { edge_shortest_mm: p.edgeShortestMm } : {}),
  ...(p.band ? { band: p.band } : {}),
  ...(p.side ? { side: p.side, paper_tone: p.paperTone, ...(p.paperToneSet ? { paper_tone_set: true } : {}) } : {}),
  ...(p.crop ? { crop: p.crop } : {}),
  ...(p.edgeMask ? { edgeMask: p.edgeMask, ...(p.edgeMaskName ? { edgeMaskName: p.edgeMaskName } : {}), ...(p.edgeMaskInvert ? { edgeMaskInvert: true } : {}) } : {}),
  ...(p.edgeGen ? { edgeGen: p.edgeGen } : {}),
  ...(p.vignette ? { vignette: p.vignette } : {}),
  ...((p.edgeMask || p.edgeGen) && p.edgeMaskSides ? { edgeMaskSides: p.edgeMaskSides } : {}),
  ...(p.fit ? { fit: p.fit } : {}),
  ...(p.align && (p.align.x !== 0.5 || p.align.y !== 0.5) ? { align: p.align } : {}),
  ...(isSavedStyle(p.style) ? { style: p.style } : {}),
  ...(p.centerFrom !== undefined ? { center_from: p.centerFrom } : {}),
  ...(p.centerSmoothMm !== undefined ? { center_smooth_mm: p.centerSmoothMm } : {}),
  ...(p.centerShortestMm !== undefined ? { center_shortest_mm: p.centerShortestMm } : {}),
  ...(p.centerMode ? { center_mode: p.centerMode } : {}),
  ...(p.centerStraightMm ? { center_straight_mm: p.centerStraightMm } : {}),
  ...(p.centerLongMm ? { center_long_mm: p.centerLongMm } : {}),
  ...(p.centerCornerDeg ? { center_corner_deg: p.centerCornerDeg } : {}),
  ...(p.silhouetteFrom !== undefined ? { silhouette_from: p.silhouetteFrom } : {}),
  ...(p.silhouetteSmoothMm !== undefined ? { silhouette_smooth_mm: p.silhouetteSmoothMm } : {}),
  ...(p.silhouetteSmallestMm !== undefined ? { silhouette_smallest_mm: p.silhouetteSmallestMm } : {}),
  ...(p.hilbertCoarsestMm !== undefined ? { hilbert_coarsest_mm: p.hilbertCoarsestMm } : {}),
  ...(p.hilbertLift ? { hilbert_lift: true } : {}),
  ...(p.hilbertCurve === "peano" ? { hilbert_curve: "peano" } : {}),
  ...(p.hilbertRound ? { hilbert_round: p.hilbertRound } : {}),
  ...(p.hilbertBlend ? { hilbert_blend: p.hilbertBlend } : {}),
  ...(p.hilbertAngle ? { hilbert_angle: p.hilbertAngle } : {}),
  ...(p.lineDots !== undefined ? { line_dots: p.lineDots } : {}),
  ...(p.lineCurve ? { line_curve: p.lineCurve } : {}),
  ...(p.lineAngle ? { line_angle: p.lineAngle } : {}),
  ...(p.lineBias ? { line_bias: p.lineBias } : {}),
  ...(p.lineGrain ? { line_grain: p.lineGrain } : {}),
  ...(p.lineContrast !== undefined ? { line_contrast: p.lineContrast } : {}),
  ...(p.lineLiftMm ? { line_lift_mm: p.lineLiftMm } : {}),
  ...(p.streamWidestMm !== undefined ? { stream_widest_mm: p.streamWidestMm } : {}),
  ...(p.scribbleLengthMm !== undefined ? { scribble_length_mm: p.scribbleLengthMm } : {}),
  ...(p.scribbleMinMm !== undefined ? { scribble_min_mm: p.scribbleMinMm } : {}),
  ...(p.paintSmoothMm !== undefined ? { paint_smooth_mm: p.paintSmoothMm } : {}),
  ...(p.paintSmallestMm !== undefined ? { paint_smallest_mm: p.paintSmallestMm } : {}),
  ...(p.paintOutline === false ? { paint_outline: false } : {}),
  ...(p.scribbleWiggle !== undefined ? { scribble_wiggle: p.scribbleWiggle } : {}),
  ...(p.scribbleSeed !== undefined ? { scribble_seed: p.scribbleSeed } : {}),
  ...(p.streamPasses !== undefined ? { stream_passes: p.streamPasses } : {}),
  ...(p.streamFlowMm !== undefined ? { stream_flow_mm: p.streamFlowMm } : {}),
  ...(p.contours !== undefined ? { contours: p.contours } : {}),
  ...(p.smoothMm !== undefined ? { smooth_mm: p.smoothMm } : {}),
  ...(p.ink ? { ink: p.ink, regions: p.regions, region: p.region } : {}),
  ...(p.fitPaper ? { fit_paper: p.fitPaper, pen_mm: p.penMm, ...(p.fitPairs ? { fit_pairs: true } : {}), ...(p.fitOpaque ? { fit_opaque: true } : {}) } : {}),
  // A plate's pen width: the separation works out its passes from it.
  ...(p.plate && p.penMm !== undefined ? { pen_mm: p.penMm } : {}),
  ...(p.key ? { key: true } : {}),
  ...(p.modes ? { modes: p.modes } : {}),
  ...(p.keyInk ? { key_ink: p.keyInk } : {}),
  ...(p.keyStrength !== undefined ? { key_strength: p.keyStrength } : {}),
  ...(p.keyFrom !== undefined ? { key_from: p.keyFrom } : {}),
  ...(p.plate ? { plate: p.plate, plates: p.plates } : {}),
  ...(p.separation ? { separation: p.separation } : {}),
  ...(p.blackShare !== undefined ? { black_share: p.blackShare } : {}),
  ...(p.regionInks ? { region_inks: p.regionInks } : {}),
  ...(p.offsetMm && (p.offsetMm[0] || p.offsetMm[1]) ? { offset_mm: p.offsetMm } : {}),
  ...(p.rowMm !== undefined ? { row_mm: p.rowMm } : {}),
  ...(p.waveMm !== undefined ? { wave_mm: p.waveMm } : {}),
  ...(p.hatchSmoothMm ? { hatch_smooth_mm: p.hatchSmoothMm } : {}),
  ...(p.hatchShortestMm !== undefined ? { hatch_shortest_mm: p.hatchShortestMm } : {}),
  ...(p.saturation ? { saturation: p.saturation } : {}),
  ...(p.squiggleAmpMm !== undefined ? { squiggle_amp_mm: p.squiggleAmpMm } : {}),
  ...(p.squiggleHeight !== undefined ? { squiggle_height: p.squiggleHeight } : {}),
  ...(p.squiggleJoin ? { squiggle_join: true } : {}),
  ...(p.anglePreset ? { angle_preset: p.anglePreset } : {}),
  ...(p.angleTurn ? { angle_turn: p.angleTurn } : {}),
  ...(p.squiggleLift ? { squiggle_lift: true } : {}),
  ...(p.squiggleSmooth !== undefined ? { squiggle_smooth: p.squiggleSmooth } : {}),
  ...(p.squiggleDraw && Object.keys(p.squiggleDraw).length ? { squiggle_draw: p.squiggleDraw } : {}),
  ...(p.squiggleVersion === "inkscape" ? { squiggle_version: "inkscape" } : {}),
  ...(p.squiggleAngle ? { squiggle_angle: p.squiggleAngle } : {}),
  ...(p.squiggleInkscape && Object.keys(p.squiggleInkscape).length ? { squiggle_inkscape: p.squiggleInkscape } : {}),
  ...(p.bleed ? { bleed: p.bleed } : {}),
  ...(p.margin !== undefined ? { margin: p.margin } : {}),
});

/** Where a photo layer's lines start on the page, in inches: its box's corner, moved by its offset. */
export const photoOrigin = (photo: Photo, x0: number, y0: number) => ({
  x: x0 + (photo.offsetMm?.[0] ?? 0) / 25.4,
  y: y0 + (photo.offsetMm?.[1] ?? 0) / 25.4,
});
