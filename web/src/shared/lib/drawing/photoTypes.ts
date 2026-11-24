// What a picture IS, as types: the Photo a drawing carries, the tones read out of it, the marks an
// effect makes of them, and the small shapes those are built from. No code, and nothing imported
// from photo.ts - which is what lets an effect be moved into a file of its own without the two
// importing each other in a circle (Tom, 2026-11-24).
//
// photo.ts re-exports the ones other files use, so an import from there still works.

import type { FitAlign } from "../geometry";
import type { EdgeGen } from "./edgeMask";
import type { Vignette } from "./vignette";
import type { SketchLines, SquiggleDraw, SquiggleInkscape } from "./photoDefaults";

/** What a photo shape keeps: its working copy, and how it is turned into lines. */
export interface Photo {
  /** The working copy, as a data URL: a JPEG no longer than WORKING_EDGE pixels on its longer side. */
  src: string;
  /** The working copy's size in pixels, so its proportions are known before it has been read. */
  width: number;
  height: number;
  /**
   * The working copy's pixels to the inch at the size its file says it is - the file's own resolution,
   * scaled as the copy was - so the picture can come in at that size, and be put back to it (100%).
   * Absent from drawings made before it was kept.
   */
  ppi?: number;
  /** The file it was made from, where it was opened from NextDraw's own file browser: what Reload reads again. */
  source?: string;
  /** A channel of a Multichannel Photoshop `source`, counted from 0: what Reload reads it from. */
  sourceChannel?: number;
  /**
   * A Multichannel `source`'s channels joined into one colour picture, each in its ink, by channel:
   * what Reload joins them in again. Absent, the file is read as one picture.
   */
  channelInks?: string[];
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
  /**
   * The picture cut down to this many flat colours before anything reads it, 2 to FLATTEN_MOST
   * (2026-11-22). The whole picture's, like its brightness: every effect and every ink set then works
   * from a picture of flat areas with hard borders, so hatching a flattened photograph hatches flat
   * areas, and a split of one finds the colours it was flattened to.
   *
   * An adjustment, not a way of splitting: it says what the picture is, not which pens draw it. Art
   * that is already flat barely changes under it; a photograph becomes a poster. Absent, as it is.
   */
  flatten?: number;
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
  /**
   * Baked, and waiting for the next effect: its lines were made into layers of their own (Bake), and it
   * draws nothing until an effect is picked again. Its picture, place and split stay.
   */
  idle?: boolean;
  style?: "hatch" | "waves" | "squiggle" | "streamlines" | "scribble" | "sketch" | "oneline" | "hilbert" | "outlines" | "centerlines" | "silhouette" | "edges" | "paint";
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
  /** Scribble: how far a stroke runs straight before it turns, in mm - its curls made of straight lines. 0, smooth. */
  scribbleSegmentMm?: number;
  scribbleSeed?: number;
  /** Sketch lines: DrawingBotV3's Sketch Lines settings, those changed from its defaults - see SKETCH_LINES. */
  sketchLines?: Partial<SketchLines>;
  /**
   * Paint: how far the borders between colors are smoothed, in mm; the smallest region kept, as the
   * side of a square in mm - a smaller one takes its biggest neighbor's color; and whether each
   * region has a line round it (absent, it has). Absent, the defaults (paintDefaultsOf).
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
   * Split by flat colour (2026-11-22): `regions` are the colours the picture is already drawn in,
   * read from it by flatColours rather than gathered into a number of groups asked for. For art made
   * of flat areas - a poster, a print, a logo - where the colours are a fact of the picture and the
   * borders between them are meant to be hard. Everything else is the colour split: each layer draws
   * its region's area in its pen, `ink`.
   */
  flat?: boolean;
  /**
   * Split by flat colour: how many colours to flatten the picture to, when that is not to be the
   * picture's own number of them. The nearest colours are joined until this many are left.
   */
  flatCount?: number;
  /**
   * Split by flat colour: each layer keeps the colour read from the picture, rather than taking the
   * palette's nearest pen. For a drawing whose inks aren't a tool's palette - mixed, or chosen later -
   * and so that a flattened picture can be looked at in its own colours before any pen is picked.
   */
  flatOwn?: boolean;
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
  modes?: Partial<Record<"value" | "colour" | "flat" | "cmyk" | "separations", PhotoPart[]>>;
  /** Split by colour: every group's pen, by group, and the key's, so each layer can be worked out alongside the rest. */
  regionInks?: (string | null)[];
  keyInk?: string;
  /** How heavy the key's shading gets at black, 0 to 1. The whole photo's. Absent, full. */
  keyStrength?: number;
  /** How dark, 0 to 1, a part of the photo is before the key shades it. The whole photo's. */
  keyFrom?: number;
  /**
   * Split into a set of inks of your own (2026-11-22): the set itself, kept with the drawing so it
   * travels with it, and this layer's place in it. A built-in set needs neither - `plate` and the
   * number of `plates` say which set and which ink - but a set of your own is yours, and a drawing
   * that named it alone would open on another machine with nothing to look it up in.
   */
  inkSet?: InkSet;
  inkAt?: number;
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
  /** From drawings made before the size was left to the user: once said the photo was sized to the
   *  page, and sized again with it. Read and written back as it was, but nothing sizes a photo by it. */
  fit?: "fit" | "fill";
  /** The margin, in inches, it is fitted or filled inside. */
  margin?: number;
  /** The margin at the foot of the page, in inches, where it's deeper than the rest. Absent, the margin. */
  marginBottom?: number;
  /** Where a fitted photo sits in the room the margin leaves: against an edge, or centred. Absent, centred. */
  align?: FitAlign;
}

/** How a photo is split: by value, into colour groups, into CMYK plates, or already split into separations elsewhere. */
// "cmyk" is what this mode has always been called in a saved drawing's `modes`, so it stays the key
// even though the mode is now any set of inks: renaming it would lose what every drawing kept.

/** The four plates of a CMYK split, in the order they're worked out. */
export type Plate = "c" | "m" | "y" | "k" | "o" | "g" | "r" | "v";
/** Print's four plates: what separations made elsewhere are, and the first four of every plate set. */

/**
 * The plate sets a photo can be separated into: CMYK, and CMYK with more inks for truer, brighter
 * colour - Hexachrome's orange and green, today's extended gamut's orange, green and violet, and
 * those with red too. Black is always fourth. More plates, fewer colours left to mixing.
 */
export type PlateSet = "cmyk" | "cmykog" | "cmykogv" | "cmykogrv";

/**
 * One ink of a set: what it is called, the colour it stands for, and the angle its hatching runs at.
 *
 * A built-in set's colour is an aim - the colour to find a tool's nearest pen to - so CMYK works with
 * any pen in the drawer. A set of your own names pens you picked from a tool's palette, so its colour
 * is that pen's own and nothing is matched or approximated.
 */
export interface SetInk { name: string; color: string; angle: number }

/**
 * A set of inks a picture is separated into, and the thing the app once called a colour mode. CMYK is
 * one of these; so is CMYK with orange and green; so is a set of four pens of your own. What differs
 * between them is only which inks, and whether they are aims or pens - not how the separating works,
 * which is the same solve over whatever inks it is given (solveSeparation).
 */

/**
 * A set of inks a picture is separated into, and the thing the app once called a colour mode. CMYK is
 * one of these; so is CMYK with orange and green; so is a set of four pens of your own. What differs
 * between them is only which inks, and whether they are aims or pens - not how the separating works,
 * which is the same solve over whatever inks it is given (solveSeparation).
 */
export interface InkSet {
  key: string;
  label: string;
  about?: string;
  inks: SetInk[];
  /** A set of your own: its inks are pens already chosen, used as they are rather than matched. */
  own?: boolean;
}

/** The sets the app ships with: print's plates and the extended-gamut sets, as ink sets. */

export interface PhotoPart {
  layerName: string;
  layerColor: string;
  shapeName: string;
  photo: Partial<Photo>;
}

/** The settings a layer of a photo keeps as its own, as opposed to the photo's: what a mode remembers. */

export type MaskSide = "top" | "right" | "bottom" | "left";

export type AnglePreset = "classic" | "complementary" | "cardinal" | "golden" | "uniform";

export interface Tones {
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
  /** A copy cut down to this many flat colours, kept in what's worked out from it likewise. */
  flat?: number;
}

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

export interface FlatColours {
  /** The colours the picture is drawn in, lightest first: as many as it has, or as many as asked for. */
  colours: string[];
  /** How much of the picture is inside a flat area rather than on a border between two. */
  share: number;
  /** How much of that flat area the colours found account for, the paper counted. */
  covered: number;
}

/** A colour gathered from the picture: where it sits, and how much of the flat area is it. */

/** A colour gathered from the picture: where it sits, and how much of the flat area is it. */
export interface FlatColour { lab: [number, number, number]; r: number; g: number; b: number; n: number }

/** A bucket of pixels that are nearly one colour: their colour summed, and how many. */

/** A bucket of pixels that are nearly one colour: their colour summed, and how many. */
export interface Bucket { r: number; g: number; b: number; n: number }

/** Where in the 32x32x32 buckets a colour falls: an eighth of each channel. */

export interface Areas {
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

/** What a split by best fit is fitted with: the paper, the cover of 0, 1, 2… passes, and whether pens may be paired. */
export interface Fit {
  paper: string;
  steps: number[];
  pairs: boolean;
  opaque: boolean;
}

/** A photo layer's best fit, or undefined when it isn't split that way. */

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

export interface Separation { w: number; h: number; maps: Float32Array[] }

/** What a separation off the page is asked: the photo at its separating size, and how to separate it. */
export interface SeparationRequest {
  rgb: Uint8ClampedArray; w: number; h: number; plates: string[]; brightness: number; contrast: number; blackShare: number;
  /** The hatching the plates are drawn in: passes, the pen's line width and the closest spacing, in mm. */
  levels: number; penMm: number; spacingMm: number;
}

export interface Run {
  pts: number[];
  /** What each end meets: a junction's number, or -1 at a free end. */
  ends: [number, number];
  closed: boolean;
}

/**
 * The thinned lines walked into runs, from junction to junction or free end to free end, and the
 * loops that have neither. A junction is the points of three or more lines' meeting, taken together.
 */

export interface PaintRegions { gw: number; gh: number; cell: number; cellY: number; labels: Uint8Array; mine: number }
