// The numbers the picture effects start from, and the few limits they work inside: one file, so a
// default can be read - and changed - without opening six thousand lines of the thing that uses it
// (Tom, 2026-11-24). Nothing here computes anything or refers to anything else; that is the rule
// that decides what belongs, and what keeps it readable.
//
// photo.ts re-exports these, so a card that imports a default from there still gets it.

/** The plates, in order, of the set a photo's plates are. */
/** A plate set to None: its channel is left out - the others are separated without it, and it draws nothing. */
export const PLATE_OFF = "none";

/** Colours a photo is made of, to judge a set of plate pens by: skin, sky, leaves, shadow, and each hue. */
export const PEN_TEST_COLOURS: [number, number, number][] = [
  [225, 170, 140], [190, 130, 100], [120, 75, 55], [120, 170, 220], [60, 110, 50], [200, 40, 40],
  [240, 140, 40], [120, 60, 140], [128, 128, 128], [40, 30, 30], [240, 230, 180], [40, 130, 130],
  [230, 90, 150], [40, 60, 140], [250, 210, 60], [150, 200, 120],
];

/**
 * How near, on average in ΔE, hatching with these pens comes to the test colours - and to each plate's
 * own colour, so a red plate is judged on drawing red as well as on everything else.
 */

// Long enough to find inside a run-together name - "portraitcyan" - without "red" turning up in "colored".
export const FINDABLE = new Set(["cyan", "magenta", "yellow", "black", "orange", "green", "violet", "purple"]);

/** A file's name as lowercase words: its extension off, split at anything not a letter or digit and at camelCase. */

/** How much of the colours' shared grey goes to the black plate unless set: half, as print often does. */
export const BLACK_SHARE = 0.5;

/** One layer of a photo as it was split: the layer, the shape, and that layer's own settings. */

/** What each band is called, lightest first, for a photo split into this many. */
export const BAND_NAMES: Record<number, string[]> = {
  2: ["light", "dark"],
  3: ["light", "mid", "dark"],
  4: ["lightest", "light", "dark", "darkest"],
  5: ["lightest", "light", "mid", "dark", "darkest"],
  6: ["lightest", "lighter", "light", "dark", "darker", "darkest"],
};

/** The most tone layers a photo is split into. */

/** The most tone layers a photo is split into. */
export const MOST_LAYERS = 6;
/** The most layers on each side of the paper, split around it: three each, the most there are names for. */

/** The most layers on each side of the paper, split around it: three each, the most there are names for. */
export const MOST_SIDE_LAYERS = 3;

/** The most colors a photo is split into, by best fit or by the photo's own colors. */

/** The most colors a photo is split into, by best fit or by the photo's own colors. */
export const MOST_COLORS = 8;
/** Paint's flat regions take more colors than hatching mixes: its own, higher limit. */

/** Paint's flat regions take more colors than hatching mixes: its own, higher limit. */
export const MOST_PAINT_COLORS = 10;
/** The most colors an image split by color may have, drawn this way. */

/** The longer side of the working copy, in pixels: enough for lines a pen width apart across a big sheet. */
export const WORKING_EDGE = 1600;

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

export const CLASSIC = [45, 15, 75, 0, 30, 60];
/** The plate whose angle an extra ink shares in Complementary: the one opposite it on the color wheel. */

// Never between: a fifth layer goes back to 0°, sharing a direction rather than taking an odd one.
export const CARDINAL = [0, 90, 45, 135];

export const GOLDEN = 180 * (3 - Math.sqrt(5)); // 137.5077...°, the golden angle

/** The angle a preset gives the layer at `index` (bottom first), or the plate it is. */

/** The most passes hatching builds the darks in: two directions, each again between, then the diagonals. */
export const MOST_PASSES = 6;

/** What tone lines start from: rows a couple of millimetres apart, waves a millimetre long at black. */

/** What tone lines start from: rows a couple of millimetres apart, waves a millimetre long at black. */
export const WAVE_DEFAULTS = { rowMm: 2, waveMm: 1 };

/**
 * SquiggleDraw's controls, with the sketch's names, ranges and defaults (its Default button), in its
 * own units: rows to the photo's height; strength; detail, the step along a row (31 less it, in the
 * sketch's pixels); frequency; resolution scale, how many times the photo is scaled up; line width,
 * which caps how tight the waves get; the black and white points, 0 to 255; and invert.
 */

/**
 * SquiggleDraw's controls, with the sketch's names, ranges and defaults (its Default button), in its
 * own units: rows to the photo's height; strength; detail, the step along a row (31 less it, in the
 * sketch's pixels); frequency; resolution scale, how many times the photo is scaled up; line width,
 * which caps how tight the waves get; the black and white points, 0 to 255; and invert.
 */
export const SQUIGGLE_DRAW = { lines: 120, strength: 13, detail: 28, frequency: 128, scale: 3, lineWidth: 5, black: 0, white: 255, invert: false };

/**
 * SquiggleDraw for Inkscape's controls, with the extension's names, ranges and defaults: the grid's
 * rows and columns; frequency, waves to a cell; amplitude, 1 to 6; invert; and the path's
 * direction - each row left to right, back and forth, or back and forth joined into one line.
 */
export const SQUIGGLE_INKSCAPE = { rows: 50, cols: 50, freq: 2, amp: 2, invert: false, path: "uni" as "uni" | "bidi" | "join" };

export const SQUIGGLE_INKSCAPE_RANGES: Record<"rows" | "cols" | "freq" | "amp", { label: string; min: number; max: number; step: number }> = {
  rows: { label: "Rows", min: 10, max: 200, step: 1 },
  cols: { label: "Columns", min: 10, max: 200, step: 1 },
  freq: { label: "Frequency", min: 1, max: 6, step: 1 },
  amp: { label: "Amplitude", min: 1, max: 6, step: 1 },
};
/** A photo's SquiggleDraw for Inkscape settings: its own over the extension's defaults, each kept in its range. */

/** What outlines start from: a handful of contours, a millimetre's detail smoothed away. */
/** The Hilbert curve's coarsest square to start with, in mm. */
export const HILBERT_DEFAULTS = { coarsestMm: 6 };
/** The longer side of the grid the Hilbert curve reads the tone from. */

/** The longer side of the grid the Hilbert curve reads the tone from. */
export const HILBERT_EDGE = 1024;

/** One line's starting number of dots, and the most it allows. */

/** One line's starting number of dots, and the most it allows. */
export const ONE_LINE_DEFAULTS = { dots: 5000 };

export const ONE_LINE_MOST = 30000;
/** The longer side of the grid the dots are spread on, and how many times they're spread. */

/** The longer side of the grid the dots are spread on, and how many times they're spread. */
export const ONE_LINE_EDGE = 500;

export const ONE_LINE_SPREAD = 12;

/** Streamlines' starting numbers: widest spacing in mm, passes, and how broadly the flow is read, in mm. */

/** Streamlines' starting numbers: widest spacing in mm, passes, and how broadly the flow is read, in mm. */
export const STREAM_DEFAULTS = { widestMm: 3, passes: 1, flowMm: 2 };

/** What a scribble starts from: strokes up to 60 mm long, none too short, curling moderately - loops of about 5 mm. */

/** What a scribble starts from: strokes up to 60 mm long, none too short, curling moderately - loops of about 5 mm. */
export const SCRIBBLE_DEFAULTS = { lengthMm: 60, minMm: 0, wiggle: 50, segmentMm: 0, seed: 1 };

export const OUTLINE_DEFAULTS = { contours: 6, smoothMm: 1 };

/** What centerlines start from: anything darker than half-way is a line; a fifth of a millimetre smoothed. */

/** What centerlines start from: anything darker than half-way is a line; a fifth of a millimetre smoothed. */
export const CENTER_DEFAULTS = { from: 0.5, smoothMm: 0.2, shortestMm: 1, straightMm: 0.3, longMm: 3 };
/** Edges' starting numbers: a quarter of the sharpest change of tone, smoothed half a millimetre, 3 mm the shortest edge. */

/** Edges' starting numbers: a quarter of the sharpest change of tone, smoothed half a millimetre, 3 mm the shortest edge. */
export const EDGE_DEFAULTS = { from: 0.25, smoothMm: 0.5, shortestMm: 3 };

/** How a photo's centerlines are drawn: as set, or straight for a drawing saved with only a tolerance, before mixed. */

/** What a silhouette starts from: paper is lighter than 88% in every colour; a third of a millimetre smoothed; loops under 3 mm left out. */
export const SILHOUETTE_DEFAULTS = { from: 0.88, smoothMm: 0.3, smallestMm: 3 };

// ---------- Reading the photo ----------

/** A picture whose file doesn't say how big it is: 72 pixels to the inch, as Photoshop takes it. */
export const DEFAULT_DPI = 72;

/**
 * The pixels to the inch a picture file says it is, or null where it doesn't say: a JPEG's JFIF or
 * Exif resolution, a PNG's pHYs, a TIFF's XResolution, a Photoshop file's ResolutionInfo.
 */

/** The longer side of a mask of tone: enough to judge by eye, quick to redo on every change. */
export const MASK_EDGE = 600;

/**
 * How much light a channel value stops: its optical density, which adds as inks are layered. Held
 * to where an ink reads as solid - past about a tenth of the light through, more density is nothing
 * the eye sees, and left unheld a yellow's near-empty blue would count for more than all the rest.
 */
export const MAX_DENSITY = 2.3;

/** The longer side the photo's colour areas are worked out at: finer than any pen, and quick to redo. */
export const COVER_EDGE = 800;

/** sRGB to CIELAB, where a distance is near enough how different two colours look. */

/** Most of the way to black a black point goes: 90%, past which a plate would be nothing but ink. */
export const MOST_BLACK_POINT = 90;

/**
 * A separation as its lines see it: its own brightness and contrast, then its own black point, then
 * the whole image's three, made one brightness and contrast. Each is a straight line on the tones -
 * a stretch and a lift - so any number in a row are one. A photo with none of a plate's own settings
 * and no black point comes back as it is.
 */

/**
 * A colour group this light and this nearly grey is the paper showing, and gets no layer of its own.
 * Both: a bright yellow is nearly as light as white, but it's a colour to draw, not paper.
 */
export const PAPER_LIGHTNESS = 92;

export const PAPER_CHROMA = 12;

/** The most colours a picture can be flattened to: past this it is no longer a flattening. */
export const FLATTEN_MOST = 24;
/** How many colours Flatten starts at: enough for a face to hold together, few enough to read as flat. */

/** How many colours Flatten starts at: enough for a face to hold together, few enough to read as flat. */
export const FLATTEN_DEFAULT = 6;
/** With less of a picture inside flat areas than this, its colours are read from all of it instead. */

/** With less of a picture inside flat areas than this, its colours are read from all of it instead. */
export const FLATTEN_LEAST_FLAT = 0.25;
/** A colour holding less of what was gathered than this is noise, not a colour to flatten to. */

/** A colour holding less of what was gathered than this is noise, not a colour to flatten to. */
export const FLATTEN_LEAST = 0.001;
/** The most pixels sampled when a picture has no flat insides to read: enough, and quick. */

/** The most pixels sampled when a picture has no flat insides to read: enough, and quick. */
export const FLATTEN_SAMPLE = 400_000;

/** A pixel whose four neighbours all match it this nearly, per channel, is inside a flat area rather
 *  than on the antialiased border between two. An area carries a little noise; a border doesn't. */
export const FLAT_NEAR = 3;
/** Two flat colours nearer than this in CIELAB are one colour read twice, through that noise. */

/** Two flat colours nearer than this in CIELAB are one colour read twice, through that noise. */
export const FLAT_MERGE = 8;
/** A colour holding less of the flat area than this is a stray, not one the picture is drawn in. */

/** A colour holding less of the flat area than this is a stray, not one the picture is drawn in. */
export const FLAT_LEAST = 0.01;
/** Asked for a number of colours, a candidate this small isn't one: it is the smear round an edge. */

/** Asked for a number of colours, a candidate this small isn't one: it is the smear round an edge. */
export const FLAT_LEAST_ASKED = 0.001;
/** The most candidates merged down to a number asked for: plenty, and it bounds the work. */

/** The most candidates merged down to a number asked for: plenty, and it bounds the work. */
export const FLAT_MOST_CANDIDATES = 64;
/**
 * Below this much of its flat area accounted for, a picture isn't drawn in flat colours and this isn't
 * the way to read it. Not `share`: a photograph's gentle gradients change by less than a level from
 * one pixel to the next, so nearly all of it counts as flat, and it is `covered` that gives it away -
 * its colours are slices of a ramp, each with a little area, and together they account for nothing
 * like the whole. Flat art covers almost all of itself with a handful of colours.
 */

/**
 * Below this much of its flat area accounted for, a picture isn't drawn in flat colours and this isn't
 * the way to read it. Not `share`: a photograph's gentle gradients change by less than a level from
 * one pixel to the next, so nearly all of it counts as flat, and it is `covered` that gives it away -
 * its colours are slices of a ramp, each with a little area, and together they account for nothing
 * like the whole. Flat art covers almost all of itself with a handful of colours.
 */
export const FLAT_ENOUGH = 0.85;

/** Bleed, as a share, in CIELAB units: how much further a group may be than the nearest and still draw. */
export const BLEED_LAB = 100;

/**
 * Whether a point of the photo is in this group's area: its colour nearest this group's - or, with
 * bleed, nearly as near as the nearest, so where colours blend two groups both draw.
 */

/** How far apart two neighbouring colours are, in ΔE, before they count as an edge and are solved afresh. */
export const EDGE_DE = 12;
/** What ink costs, in ΔE per whole paper covered: a tie-breaker, so none is spent where it doesn't help. */

/** What ink costs, in ΔE per whole paper covered: a tie-breaker, so none is spent where it doesn't help. */
export const INK_COST = 1;

/** The tone a plate's hatching draws the nearest number of passes to `cover` at: 0 for none. */

/** Dark enough, and near enough to grey, for an ink to be the one black generation gives the greys to. */
export const BLACK_LIGHTEST = 45;

export const BLACK_CHROMA = 22;

/**
 * Which ink of a set is its black, or -1 where it has none: the darkest of those near enough to grey
 * to stand for grey. Found rather than assumed, so a set that is not CMYK - an ink set of a pen's own
 * colours, say, red, black, pink and lime - gives its greys to its actual black, and one with no
 * black at all does no black generation rather than pouring its fourth ink into every grey.
 *
 * Near enough to grey matters as much as dark: a deep violet is darker than many blacks and would win
 * on lightness alone, but grey drawn in violet is violet.
 */

/** How dark a part of a photo is, 0 to 1, before its key starts to shade it, unless set. */
export const KEY_FROM = 0.35;

/**
 * A layer of a photo split by colour, read at a point of the photo (u and v, 0 to 1): -1 where it
 * draws nothing, otherwise how much of its ink. A colour layer draws its group's area - widened by
 * the bleed - as much of its pen as comes nearest the photo there. The key shades over all of them.
 */

/** The longer side of the grid outlines are traced on: fine enough for a pen, quick to trace. */
export const OUTLINE_EDGE = 480;

/** A blur of a grid, a box three times over - near enough a gaussian - `r` cells either way. */

/** The longer side of the grid centerlines are traced on, at most: fine enough for a line a pen draws. */
export const CENTER_EDGE = 1000;

/** How far a centerline's curves may stray from the traced points, in grid steps: past a pixel's jag, short of the picture's own bends. */

/** How far a centerline's curves may stray from the traced points, in grid steps: past a pixel's jag, short of the picture's own bends. */
export const FIT_CELLS = 1.5;

/** The eight neighbours of a grid point, clockwise from above, as steps across and down. */

/** The eight neighbours of a grid point, clockwise from above, as steps across and down. */
export const RING: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * A black-and-white grid worn down to lines one point wide, down the middle of each dark stroke:
 * Zhang-Suen thinning, which peels a point off a stroke's edge only where that leaves the stroke
 * in one piece and doesn't shorten its ends, from each side in turn until nothing more comes off.
 */

/** What a painting starts from: borders smoothed over a millimetre, nothing smaller than a 3 mm square kept, a line round each region. */
export const PAINT_DEFAULTS = { smoothMm: 1, smallestMm: 3, outline: true };

/**
 * What a painting of flat art starts from instead. A photo's colour areas have ragged borders and
 * specks, which smoothing and a smallest region tidy away; flat art's borders are already clean and
 * meant to be hard, and its small shapes - a star's points, a spike of hair, the catchlight in an eye
 * - are drawn on purpose. So barely any smoothing, and nothing dropped that a pen can still draw.
 */

/**
 * What a painting of flat art starts from instead. A photo's colour areas have ragged borders and
 * specks, which smoothing and a smallest region tidy away; flat art's borders are already clean and
 * meant to be hard, and its small shapes - a star's points, a spike of hair, the catchlight in an eye
 * - are drawn on purpose. So barely any smoothing, and nothing dropped that a pen can still draw.
 */
export const PAINT_FLAT_DEFAULTS = { smoothMm: 0.2, smallestMm: 0.8, outline: true };

/** What a painting of this picture starts from: flat art's, or a photo's. */

/** The longer side of the grid the flow is worked out on. */
export const FLOW_EDGE = 400;

/**
 * Which way the lines flow at each point of the photo's box, as a direction (either way along it):
 * along the edges and shapes of the picture - across the way it gets lighter or darker - smoothed by
 * `streamFlowMm` so the lines sweep rather than wander. Where there's no shape to follow, the layer's
 * angle. Worked out from the structure tensor: each point's gradient, doubled in angle so opposite
 * directions agree, averaged over the neighbourhood.
 */

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

export type SquiggleInkscape = typeof SQUIGGLE_INKSCAPE;

/**
 * DrawingBotV3's Sketch Lines settings, with its names, ranges and numbers - its defaults, but for Line
 * Density, which is the Edge Trace preset's 55. Its lengths are in its pixels: here a pixel is the
 * layer's Pixel size (its spacing), about a pen line wide, as DrawingBot draws one pixel wide.
 * Erase Min and Max are how much each line lightens what it crosses, 0 to 255; Tone curves between them.
 */
export const SKETCH_LINES = {
  seed: 0, lineDensity: 55, lineMin: 2, lineMax: 40, lineLimit: -1, angleTests: 20, unlimitedTests: false,
  squiggleMin: 25, squiggleMax: 500, squiggleDeviation: 25, liftPen: true, deltaAngle: 360,
  shading: false, startAngleMin: -72, startAngleMax: -52, shadingThreshold: 50, shadingDeltaAngle: 180,
  eraseMin: 50, eraseMax: 125, tone: 50,
  /** Ours, not DrawingBot's: how strongly the picture's edges are darkened for the lines to find, 0 to 100. */
  edges: 0,
};

export type SketchLines = typeof SKETCH_LINES;

export type SketchNumber = { [K in keyof SketchLines]: SketchLines[K] extends number ? K : never }[keyof SketchLines];

export const SKETCH_RANGES: Record<SketchNumber, { label: string; min: number; max: number; step: number }> = {
  seed: { label: "Random Seed", min: 0, max: 1000, step: 1 },
  lineDensity: { label: "Line Density", min: 0, max: 100, step: 1 },
  lineMin: { label: "Line Min Length", min: 2, max: 500, step: 1 },
  lineMax: { label: "Line Max Length", min: 2, max: 500, step: 1 },
  lineLimit: { label: "Line Max Limit", min: -1, max: 1000000, step: 100 },
  angleTests: { label: "Angle Tests", min: 1, max: 360, step: 1 },
  squiggleMin: { label: "Squiggle Min Length", min: 0, max: 5000, step: 1 },
  squiggleMax: { label: "Squiggle Max Length", min: 1, max: 5000, step: 10 },
  squiggleDeviation: { label: "Squiggle Max Deviation", min: 0, max: 100, step: 1 },
  deltaAngle: { label: "Drawing Delta Angle", min: -360, max: 360, step: 5 },
  startAngleMin: { label: "Start Angle Min", min: -360, max: 360, step: 1 },
  startAngleMax: { label: "Start Angle Max", min: -360, max: 360, step: 1 },
  shadingThreshold: { label: "Shading Threshold", min: 0, max: 100, step: 1 },
  shadingDeltaAngle: { label: "Shading Delta Angle", min: -360, max: 360, step: 5 },
  eraseMin: { label: "Erase Min", min: 1, max: 255, step: 1 },
  eraseMax: { label: "Erase Max", min: 1, max: 255, step: 1 },
  tone: { label: "Tone", min: 0, max: 100, step: 1 },
  edges: { label: "Edges", min: 0, max: 100, step: 5 },
};
/** A photo's Sketch lines settings: its own over DrawingBot's defaults, each kept in its range. */
