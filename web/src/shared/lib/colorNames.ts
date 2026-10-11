// Colors by name, for reading what ink a separation's file is for - "Portrait_Peach.png" is drawn in
// peach before any pen is chosen for it. Lowercase, words apart by single spaces; looked for as whole
// words in a file's name. A name not here is asked of Claude by the server, when it has a key (see
// /api/color-names in server.py).

// The CSS colors.
const CSS: Record<string, string> = {
  "alice blue": "#f0f8ff", "antique white": "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4", azure: "#f0ffff",
  beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000", "blanched almond": "#ffebcd", blue: "#0000ff",
  "blue violet": "#8a2be2", brown: "#a52a2a", burlywood: "#deb887", "cadet blue": "#5f9ea0", chartreuse: "#7fff00",
  chocolate: "#d2691e", coral: "#ff7f50", "cornflower blue": "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", "dark blue": "#00008b", "dark cyan": "#008b8b", "dark goldenrod": "#b8860b", "dark gray": "#a9a9a9",
  "dark grey": "#a9a9a9", "dark green": "#006400", "dark khaki": "#bdb76b", "dark magenta": "#8b008b",
  "dark olive green": "#556b2f", "dark orange": "#ff8c00", "dark orchid": "#9932cc", "dark red": "#8b0000",
  "dark salmon": "#e9967a", "dark sea green": "#8fbc8f", "dark slate blue": "#483d8b", "dark slate gray": "#2f4f4f",
  "dark turquoise": "#00ced1", "dark violet": "#9400d3", "deep pink": "#ff1493", "deep sky blue": "#00bfff",
  "dim gray": "#696969", "dodger blue": "#1e90ff", firebrick: "#b22222", "floral white": "#fffaf0",
  "forest green": "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc", "ghost white": "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", grey: "#808080", green: "#008000", "green yellow": "#adff2f",
  honeydew: "#f0fff0", "hot pink": "#ff69b4", "indian red": "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", "lavender blush": "#fff0f5", "lawn green": "#7cfc00",
  "lemon chiffon": "#fffacd", "light blue": "#add8e6", "light coral": "#f08080", "light cyan": "#e0ffff",
  "light goldenrod yellow": "#fafad2", "light gray": "#d3d3d3", "light grey": "#d3d3d3", "light green": "#90ee90",
  "light pink": "#ffb6c1", "light salmon": "#ffa07a", "light sea green": "#20b2aa", "light sky blue": "#87cefa",
  "light slate gray": "#778899", "light steel blue": "#b0c4de", "light yellow": "#ffffe0", lime: "#00ff00",
  "lime green": "#32cd32", linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000",
  "medium aquamarine": "#66cdaa", "medium blue": "#0000cd", "medium orchid": "#ba55d3", "medium purple": "#9370db",
  "medium sea green": "#3cb371", "medium slate blue": "#7b68ee", "medium spring green": "#00fa9a",
  "medium turquoise": "#48d1cc", "medium violet red": "#c71585", "midnight blue": "#191970", "mint cream": "#f5fffa",
  "misty rose": "#ffe4e1", moccasin: "#ffe4b5", "navajo white": "#ffdead", navy: "#000080", "old lace": "#fdf5e6",
  olive: "#808000", "olive drab": "#6b8e23", orange: "#ffa500", "orange red": "#ff4500", orchid: "#da70d6",
  "pale goldenrod": "#eee8aa", "pale green": "#98fb98", "pale turquoise": "#afeeee", "pale violet red": "#db7093",
  "papaya whip": "#ffefd5", "peach puff": "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd",
  "powder blue": "#b0e0e6", purple: "#800080", "rebecca purple": "#663399", red: "#ff0000", "rosy brown": "#bc8f8f",
  "royal blue": "#4169e1", "saddle brown": "#8b4513", salmon: "#fa8072", "sandy brown": "#f4a460",
  "sea green": "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", silver: "#c0c0c0", "sky blue": "#87ceeb",
  "slate blue": "#6a5acd", "slate gray": "#708090", snow: "#fffafa", "spring green": "#00ff7f",
  "steel blue": "#4682b4", tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8", tomato: "#ff6347",
  turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff", "white smoke": "#f5f5f5",
  yellow: "#ffff00", "yellow green": "#9acd32",
};

// Everyday names - art, print and fashion: what someone calls an ink when they name a file after it.
const EVERYDAY: Record<string, string> = {
  peach: "#ffcba4", apricot: "#fbceb1", mustard: "#e1ad01", ochre: "#cc7722", ocher: "#cc7722", rust: "#b7410e",
  terracotta: "#e2725b", "terra cotta": "#e2725b", burgundy: "#800020", claret: "#7f1734", oxblood: "#4a0000",
  cherry: "#d2042d", ruby: "#e0115f", rose: "#ff007f", blush: "#de5d83", "dusty rose": "#dcae96", mauve: "#e0b0ff",
  lilac: "#c8a2c8", amethyst: "#9966cc", aubergine: "#3d0734", eggplant: "#614051", "royal purple": "#7851a9",
  raspberry: "#e30b5c", cerise: "#de3163", vermilion: "#e34234", vermillion: "#e34234", carmine: "#960018",
  "cadmium red": "#e30022", "cadmium yellow": "#fff600", "cadmium orange": "#ed872d", "lemon yellow": "#fff44f",
  lemon: "#fff700", canary: "#ffff99", butter: "#fff48c", cream: "#fffdd0", "off white": "#faf9f6", bone: "#e3dac9",
  sand: "#c2b280", camel: "#c19a6b", caramel: "#af6e4d", "burnt sienna": "#e97451", "raw sienna": "#d68a59",
  "burnt umber": "#8a3324", umber: "#635147", "raw umber": "#826644", sepia: "#704214", coffee: "#6f4e37",
  mocha: "#967969", espresso: "#4b3621", "chocolate brown": "#7b3f00", taupe: "#483c32", "olive green": "#708238",
  "army green": "#4b5320", sage: "#bcb88a", "sage green": "#9caf88", "moss green": "#8a9a5b", "mint green": "#98ff98",
  emerald: "#50c878", "emerald green": "#50c878", jade: "#00a86b", "bottle green": "#006a4e",
  "british racing green": "#004225", "grass green": "#3f9b0b", "leaf green": "#5ca904", "apple green": "#8db600",
  "pea green": "#8eab12", "neon lime": "#ccff00", "sea foam": "#93e9be", seafoam: "#93e9be", "teal blue": "#367588",
  petrol: "#005f6a", "duck egg": "#c3fbf4", "duck egg blue": "#c3fbf4", "robin egg blue": "#00cccc",
  "tiffany blue": "#0abab5", "baby blue": "#89cff0", sky: "#87ceeb", "ice blue": "#99ffff", cerulean: "#007ba7",
  cobalt: "#0047ab", "cobalt blue": "#0047ab", ultramarine: "#3f00ff", "ultramarine blue": "#4166f5",
  "prussian blue": "#003153", "phthalo blue": "#000f89", "phthalo green": "#123524", "navy blue": "#000080",
  denim: "#1560bd", periwinkle: "#ccccff", sapphire: "#0f52ba", "electric blue": "#7df9ff", "bright blue": "#0096ff",
  "process blue": "#0085ca", "process cyan": "#00b7eb", "process magenta": "#ff0090", "process yellow": "#ffef00",
  "process black": "#1a1a1a", "key black": "#1a1a1a", charcoal: "#36454f", graphite: "#383838", "slate grey": "#708090",
  ash: "#b2beb5", pewter: "#8e9294", "warm gray": "#8b8378", "warm grey": "#8b8378", "cool gray": "#8c92ac",
  "cool grey": "#8c92ac", "mid gray": "#808080", "mid grey": "#808080", "medium gray": "#808080",
  "medium grey": "#808080", "pale gray": "#d3d3d3", "pale grey": "#d3d3d3", "jet black": "#0a0a0a",
  "ink black": "#1a1a1a", "ivory black": "#231f20", "lamp black": "#1b1b1b", "snow white": "#fffafa",
  "titanium white": "#fafaf8", "chinese white": "#f8f8f8", flesh: "#ffcbb1", skin: "#e8b796", nude: "#e3bc9a",
  blond: "#faf0be", blonde: "#faf0be", "salmon pink": "#ff91a4", "coral pink": "#f88379", "shell pink": "#f9b7a0",
  bubblegum: "#ffc1cc", "baby pink": "#f4c2c2", "pastel pink": "#ffd1dc", "candy pink": "#e4717a",
  flamingo: "#fc8eac", "orange peel": "#ff9f00", marigold: "#eaa221", saffron: "#f4c430", amber: "#ffbf00",
  honey: "#eba937", golden: "#ffd700", brass: "#b5a642", bronze: "#cd7f32", "rose gold": "#b76e79",
  "metallic gold": "#d4af37", "metallic silver": "#aaa9ad", "brick red": "#cb4154", "tomato red": "#ff6347",
  "fire engine red": "#ce2029", "blood red": "#880808", "wine red": "#722f37", "pastel blue": "#aec6cf",
  "pastel green": "#77dd77", "pastel yellow": "#fdfd96", "pastel purple": "#b39eb5", "pastel orange": "#ffb347",
};

// Riso inks: what a Riso drum lays down, which a separation for one is named after - their published
// colors, as near as known. They win over the CSS and everyday colors of the same name (aqua, teal,
// mint…): a folder of separations named for its inks is far more often a Riso job than a web page.
const RISO: Record<string, string> = {
  aqua: "#5ec8e5", blue: "#0078bf", "bright red": "#f15060", burgundy: "#914e72", cornflower: "#62a8e5",
  cranberry: "#d1517a", "federal blue": "#3d5588", "flat gold": "#bb8b41", "fluorescent green": "#44d62c",
  "fluorescent orange": "#ff7477", "fluorescent pink": "#ff48b0", "fluorescent red": "#ff4c65",
  "fluorescent yellow": "#ffe916", "fluo green": "#44d62c", "fluo orange": "#ff7477", "fluo pink": "#ff48b0",
  "fluo yellow": "#ffe916", "neon green": "#44d62c", "neon orange": "#ff7477", "neon pink": "#ff48b0",
  "neon yellow": "#ffe916", grape: "#765ba7", green: "#00a95c", "hunter green": "#407060", "kelly green": "#67b346",
  lagoon: "#2f6165", lake: "#235ba8", "light lime": "#e3ed55", "light mauve": "#e6b5c9", "light teal": "#6eb9aa",
  marine: "#0074a2", "medium blue": "#3255a4", melon: "#ffae3b", metallic: "#9fa0a3", mint: "#82d8d5",
  mist: "#d5e4c0", moss: "#68724d", "ocean blue": "#00a6b6", orange: "#ff6c2f", pine: "#237e74", plum: "#845991",
  pumpkin: "#ff6f4c", purple: "#765ba7", "raspberry red": "#d1517a", red: "#ff665e", scarlet: "#f65058",
  "sea blue": "#0074a2", slate: "#5e695e", "smoky teal": "#5f8289", spruce: "#4a635d", steel: "#375e77",
  sunflower: "#ffb511", tangerine: "#ff6f4c", teal: "#00838a", wine: "#914e72", yellow: "#ffe800",
  "yellow ochre": "#c6942e", "bubble gum": "#f984ca", brick: "#a75154", copper: "#bd8c66",
};

export const COLOR_NAMES: Record<string, string> = { ...CSS, ...EVERYDAY, ...RISO };

/** The names, longest first by words then letters: so "light blue" is found before "blue". */
const BY_LENGTH = Object.keys(COLOR_NAMES).sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);

/**
 * The color a name's words name, if any: the longest color name found among them as whole words -
 * "portrait light blue 2" is light blue. `words` lowercase, in order.
 */
export function colorNamed(words: string[]): { name: string; color: string } | undefined {
  const spaced = ` ${words.join(" ")} `;
  const found = BY_LENGTH.find((n) => spaced.includes(` ${n} `));
  return found ? { name: found, color: COLOR_NAMES[found] } : undefined;
}
