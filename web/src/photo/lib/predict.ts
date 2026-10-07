import { photoMarks, tonesOf, type Photo } from "../../shared/lib/drawing/photo";

// The predicted print: what a photo's lines should look like on paper, worked out from each pen's
// real colour, and how close that comes to the photo itself.
//
// The model, checked against the EnerGel calibration sheet on 2026-10-06: a patch of hatching looks
// like its line colour over the share of the paper the lines cover, mixed in linear light - not in
// sRGB values, which came out four times worse. Read that way the measured 50, 25 and 12.5% patches
// were predicted to within 1.8 ΔE on average, about the least difference an eye can tell. Inks laid
// over each other act as filters: each passes its own share of the light through, so the paper's
// light is multiplied by each layer's in turn. An opaque ink instead covers what is under it.

/** One layer of the photo, bottom first: its photo settings, and the pen's line colour on paper. */
export interface PrintPart {
  photo: Photo;
  /** The colour of the pen's line itself, as it comes out on the paper it was measured on. */
  line: string;
}

export interface PrintOptions {
  /** The real width of the pen's line, which with the spacing sets how much of the paper is covered. */
  penWidthMm: number;
  /** The paper being printed on, and the paper the line colours were measured on. */
  paper: string;
  measuredOn: string;
  /** An ink that covers what's under it rather than letting it show through (Pentel MATTEHOP). */
  opaque: boolean;
}

export interface Prediction {
  /** The predicted print as a picture, the size of the photo's box. */
  url: string;
  /** How far the predicted print is from the photo: the average ΔE over patches 4 mm across. */
  score: number;
}

/** Patches the score compares, in inches: about how far hatching blurs into a tone at arm's length. */
const CELL = 4 / 25.4;
/** The longer side the print is drawn at, in pixels: fine enough for the lines to keep their width. */
const LONG_SIDE = 1600;

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toByte = (l: number) => {
  const c = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
const hexLinear = (hex: string) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(toLinear);
};
/** Linear RGB to CIELAB, where a distance is near enough how different two colours look. */
function lab([R, G, B]: number[]): [number, number, number] {
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** How much of each pixel a layer's lines cover, 0 to 1, drawn at `scale` pixels to the inch. */
function coverage(marks: string[], width: number, height: number, scale: number, penIn: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = penIn;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // One pen on one layer: where its own lines cross it lays no more ink (a gel pen), so the layer is
  // the union of its lines.
  for (const d of marks) if (d) ctx.stroke(new Path2D(d));
  const px = ctx.getImageData(0, 0, width, height).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] / 255;
  return out;
}

/**
 * The print predicted for these layers of a photo in a box `w` by `h` inches, beside the photo `source`
 * (the layer whose picture is shown), or null while the photo hasn't been read.
 */
export function predictPrint(parts: PrintPart[], source: Photo, w: number, h: number, opts: PrintOptions): Prediction | null {
  const tones = tonesOf(source.src);
  if (!tones || w <= 0 || h <= 0) return null;
  const marks = parts.map((part) => photoMarks(part.photo, w, h));
  if (marks.some((m) => !m)) return null;

  const scale = LONG_SIDE / Math.max(w, h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const penIn = opts.penWidthMm / 25.4;

  // Each layer: how much it covers, and the colour it passes (a filter) or lays down (opaque).
  const paper = hexLinear(opts.paper);
  const measuredOn = hexLinear(opts.measuredOn);
  const layers = parts.map((part, k) => {
    const line = hexLinear(part.line);
    return {
      cover: coverage(marks[k]!.passes, width, height, scale, penIn),
      // The share of the light the ink lets through, against the paper it was measured on.
      pass: line.map((c, i) => Math.min(1, c / Math.max(1e-4, measuredOn[i]))),
      line,
    };
  });

  // The print, pixel by pixel, in linear light.
  const lit = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    let r = paper[0];
    let g = paper[1];
    let b = paper[2];
    for (const layer of layers) {
      const c = layer.cover[p];
      if (!c) continue;
      if (opts.opaque) {
        r = r * (1 - c) + layer.line[0] * c;
        g = g * (1 - c) + layer.line[1] * c;
        b = b * (1 - c) + layer.line[2] * c;
      } else {
        r *= 1 - c + c * layer.pass[0];
        g *= 1 - c + c * layer.pass[1];
        b *= 1 - c + c * layer.pass[2];
      }
    }
    lit[p * 3] = r;
    lit[p * 3 + 1] = g;
    lit[p * 3 + 2] = b;
  }

  // As a picture.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  for (let p = 0; p < width * height; p++) {
    img.data[p * 4] = toByte(lit[p * 3]);
    img.data[p * 4 + 1] = toByte(lit[p * 3 + 1]);
    img.data[p * 4 + 2] = toByte(lit[p * 3 + 2]);
    img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // The score: print and photo each averaged over patches 4 mm across, in linear light, and compared.
  const cols = Math.max(1, Math.round(w / CELL));
  const rows = Math.max(1, Math.round(h / CELL));
  const printSum = new Float64Array(cols * rows * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y / height) * rows));
    for (let x = 0; x < width; x++) {
      const cell = (row * cols + Math.min(cols - 1, Math.floor((x / width) * cols))) * 4;
      const p = (y * width + x) * 3;
      printSum[cell] += lit[p];
      printSum[cell + 1] += lit[p + 1];
      printSum[cell + 2] += lit[p + 2];
      printSum[cell + 3]++;
    }
  }
  // The photo's pixels over the same box: its crop, if it's cropped, stretched over the box as drawn.
  const [c0, c1, c2, c3] = source.crop ?? [0, 0, 1, 1];
  const x0 = Math.floor(c0 * tones.w);
  const x1 = Math.max(x0 + 1, Math.ceil(c2 * tones.w));
  const y0 = Math.floor(c1 * tones.h);
  const y1 = Math.max(y0 + 1, Math.ceil(c3 * tones.h));
  const photoSum = new Float64Array(cols * rows * 4);
  for (let y = y0; y < y1; y++) {
    const row = Math.min(rows - 1, Math.floor(((y - y0) / (y1 - y0)) * rows));
    for (let x = x0; x < x1; x++) {
      const cell = (row * cols + Math.min(cols - 1, Math.floor(((x - x0) / (x1 - x0)) * cols))) * 4;
      const p = (y * tones.w + x) * 4;
      photoSum[cell] += toLinear(tones.rgba[p]);
      photoSum[cell + 1] += toLinear(tones.rgba[p + 1]);
      photoSum[cell + 2] += toLinear(tones.rgba[p + 2]);
      photoSum[cell + 3]++;
    }
  }
  let total = 0;
  let counted = 0;
  for (let cell = 0; cell < cols * rows * 4; cell += 4) {
    if (!printSum[cell + 3] || !photoSum[cell + 3]) continue;
    const a = lab([printSum[cell] / printSum[cell + 3], printSum[cell + 1] / printSum[cell + 3], printSum[cell + 2] / printSum[cell + 3]]);
    const b = lab([photoSum[cell] / photoSum[cell + 3], photoSum[cell + 1] / photoSum[cell + 3], photoSum[cell + 2] / photoSum[cell + 3]]);
    total += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    counted++;
  }

  return { url: canvas.toDataURL("image/png"), score: counted ? total / counted : 0 };
}
