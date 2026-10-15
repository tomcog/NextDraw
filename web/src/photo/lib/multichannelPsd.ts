// A Multichannel Photoshop file, written here: a grayscale channel per ink, each named and given its
// ink's color - what Photoshop itself makes of a photo split into a printer's inks, and what Image
// opens as separations (server.py, psd_channels, reads exactly this back). macOS can't write one, and
// can't split a photo into seven inks to begin with, which is why Image does both.

export interface PsdChannel {
  /** The ink's name: Cyan, Orange... */
  name: string;
  /** The ink's color, as #rrggbb: how Photoshop shows the channel - or exactly, as Lab, where known. */
  color: string;
  lab?: [number, number, number];
  /** A byte a pixel, a row after another: 255 no ink, 0 all of it. */
  plane: Uint8Array;
}

const MULTICHANNEL = 7;

/** The file: 8 bits a channel, each channel run-length packed (PackBits), as Photoshop saves it. */
export function multichannelPsd(width: number, height: number, channels: PsdChannel[]): Uint8Array {
  if (!channels.length) throw new Error("No channels to write");
  if (width > 30000 || height > 30000) throw new Error("Too big for a Photoshop file: 30,000 pixels a side at most");
  const out = new Bytes();
  // Header.
  out.ascii("8BPS");
  out.u16(1);
  out.zeros(6);
  out.u16(channels.length);
  out.u32(height);
  out.u32(width);
  out.u16(8);
  out.u16(MULTICHANNEL);
  // No color mode data: Multichannel has none.
  out.u32(0);
  // Image resources: the channels' names and their inks.
  const resources = new Bytes();
  // 1045, the names in Unicode - what Photoshop reads.
  const names = new Bytes();
  for (const ch of channels) {
    names.u32(ch.name.length);
    for (let i = 0; i < ch.name.length; i++) names.u16(ch.name.charCodeAt(i));
  }
  resource(resources, 1045, names.bytes());
  // 1006, the same as Pascal strings, for older readers.
  const pascal = new Bytes();
  for (const ch of channels) {
    const name = ch.name.slice(0, 255);
    pascal.u8(name.length);
    for (let i = 0; i < name.length; i++) pascal.u8(name.charCodeAt(i) & 0xff);
  }
  resource(resources, 1006, pascal.bytes());
  // 1077, each channel's display: its color, solidity 0, and a spot ink - as Photoshop writes a
  // conversion to a profile of inks. Solidity 0 is transparent ink: the channels show mixed, each
  // over the others, as they print. At 100 each covers those before it, and the picture looks
  // blown out - Orange laid flat over a red towel - though not one pixel of a channel is different.
  const display = new Bytes();
  display.u32(1);
  for (const ch of channels) {
    if (ch.lab) {
      // Lab: L in hundredths, a and b signed hundredths.
      display.u16(7);
      display.u16(Math.round(ch.lab[0] * 100));
      display.u16(Math.round(ch.lab[1] * 100) & 0xffff);
      display.u16(Math.round(ch.lab[2] * 100) & 0xffff);
    } else {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ch.color.slice(i, i + 2), 16) || 0);
      display.u16(0);
      display.u16(r * 257);
      display.u16(g * 257);
      display.u16(b * 257);
    }
    display.u16(0);
    display.u16(0);
    display.u8(2);
  }
  resource(resources, 1077, display.bytes());
  const res = resources.bytes();
  out.u32(res.length);
  out.raw(res);
  // No layers: the merged image is the picture.
  out.u32(0);
  // The merged image: every row's packed length, then the rows, a channel after another.
  out.u16(1);
  const rows: Uint8Array[] = [];
  for (const ch of channels) {
    if (ch.plane.length < width * height) throw new Error(`${ch.name} is smaller than the picture`);
    for (let y = 0; y < height; y++) rows.push(packBits(ch.plane.subarray(y * width, (y + 1) * width)));
  }
  for (const row of rows) out.u16(row.length);
  for (const row of rows) out.raw(row);
  return out.bytes();
}

/** One image resource: 8BIM, its id, an empty name padded to even, then its data padded to even. */
function resource(out: Bytes, id: number, data: Uint8Array) {
  out.ascii("8BIM");
  out.u16(id);
  out.u16(0);
  out.u32(data.length);
  out.raw(data);
  if (data.length % 2) out.u8(0);
}

/** A row in Photoshop's run-length packing: runs of three or more the same as a repeat, the rest literal. */
export function packBits(row: Uint8Array): Uint8Array {
  const out = new Bytes();
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 3) {
      out.u8(257 - run);
      out.u8(row[i]);
      i += run;
      continue;
    }
    // Literal bytes, up to where a run of three begins.
    const start = i;
    while (i < row.length && i - start < 128) {
      if (i + 2 < row.length && row[i] === row[i + 1] && row[i] === row[i + 2]) break;
      i++;
    }
    out.u8(i - start - 1);
    out.raw(row.subarray(start, i));
  }
  return out.bytes();
}

/** A growing big-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(1024);
  private n = 0;
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  u8(v: number) { this.room(1); this.buf[this.n++] = v & 0xff; }
  u16(v: number) { this.room(2); this.buf[this.n++] = (v >> 8) & 0xff; this.buf[this.n++] = v & 0xff; }
  u32(v: number) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  zeros(k: number) { this.room(k); this.n += k; }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  raw(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  bytes() { return this.buf.slice(0, this.n); }
}
