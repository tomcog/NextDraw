// The edge masks Image's library started with (2026-10-12): black = paper, square, 1000 px. Each is
// written as a BMP into the folder given; turn them into JPEGs with macOS's sips and copy them into
// the library (iCloud Drive/NextDraw Studio/Edge masks):
//   node web/scripts/make-edge-masks.mjs /tmp/masks
//   for f in /tmp/masks/*.bmp; do sips -s format jpeg "$f" --out "${f%.bmp}.jpg"; done
// The seeds fix each one, so running it again makes the same pictures.
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = process.argv[2] ?? "masks";
mkdirSync(OUT, { recursive: true });
const N = 1000;
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noise2(seed) {
  const r = rng(seed), G = 256, g = new Float32Array(G * G).map(() => r() * 2 - 1);
  const at = (i, j) => g[((j % G + G) % G) * G + ((i % G + G) % G)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy; };
}
function fbm(seed, oct) { const ns = Array.from({ length: oct }, (_, k) => noise2(seed + k * 97));
  return (x, y) => { let v = 0, a = 1, f = 1, t = 0; for (const n of ns) { v += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2; } return v / t; }; }
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// keep(x, y) in 0..1 for a pixel 0..1 across; built from the distance to each side.
function mask(name, { base, wobble, wobbleFreq, rough, roughFreq, soft = 0.002, speck = 0, holes = 0, spray = 0, streak = 0, seed }) {
  const edge = fbm(seed, 5), grain = fbm(seed + 500, 6), fine = noise2(seed + 900), r = rng(seed + 7);
  const px = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    let inside = Infinity;
    // Each side: its depth wanders along it; the 2D grain roughens it.
    const sides = [[u, v, 0], [1 - u, v, 1], [v, u, 2], [1 - v, u, 3]];
    for (const [d, t, k] of sides) {
      const depth = base * (1 + wobble * edge(t * wobbleFreq, k * 31.7))
        + streak * base * fine(t * 400, k * 13 + d * 3);
      inside = Math.min(inside, d - depth);
    }
    inside += rough * grain(u * roughFreq, v * roughFreq);
    let keep;
    if (spray) {
      // A falloff dithered into specks, like spray paint dying away.
      const p = smooth(-spray * 0.4, spray, inside);
      keep = r() < p ? 1 : 0;
    } else keep = smooth(-soft, soft, inside);
    if (speck && inside > 0 && inside < speck && r() < 0.02 * (1 - inside / speck) && grain(u * 90, v * 90) > 0.05) keep = 0;
    if (holes && inside < 0 && inside > -holes && grain(u * 60 + 9, v * 60) > 0.25) keep = 1;
    px[y * N + x] = Math.round(keep * 255);
  }
  // Specks are single pixels; spread each dark one a touch so it reads at plotting size.
  if (speck || spray) { const out = px.slice(); for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (px[y * N + x] === 0) { out[y * N + x + 1] = 0; out[(y + 1) * N + x] = 0; out[(y + 1) * N + x + 1] = 0; } px.set(out); }
  const row = N * 3, size = 54 + row * N, b = Buffer.alloc(size);
  b.write("BM"); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(N, 18); b.writeInt32LE(-N, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * N, 34);
  for (let i = 0; i < N * N; i++) b.fill(px[i], 54 + i * 3, 57 + i * 3);
  writeFileSync(`${OUT}/${name}.bmp`, b);
}
mask("Torn paper", { base: 0.05, wobble: 0.9, wobbleFreq: 6, rough: 0.012, roughFreq: 40, soft: 0.0015, seed: 11 });
mask("Rough brush", { base: 0.06, wobble: 0.6, wobbleFreq: 10, rough: 0.02, roughFreq: 25, streak: 0.5, speck: 0.03, seed: 23 });
mask("Grunge", { base: 0.07, wobble: 0.7, wobbleFreq: 5, rough: 0.05, roughFreq: 8, speck: 0.06, holes: 0.03, seed: 37 });
mask("Spray", { base: 0.05, wobble: 0.4, wobbleFreq: 4, rough: 0.015, roughFreq: 12, spray: 0.07, seed: 41 });
mask("Thin rough", { base: 0.025, wobble: 0.8, wobbleFreq: 14, rough: 0.008, roughFreq: 50, speck: 0.015, seed: 53 });
mask("Dry brush", { base: 0.065, wobble: 0.5, wobbleFreq: 7, rough: 0.012, roughFreq: 30, streak: 1.2, holes: 0.04, seed: 67 });
