import type { Settings } from "./types";

export const UNITS = 100; // preview drawing units per inch
export const MM = UNITS / 25.4; // preview drawing units per mm

export const DEFAULT_SETTINGS: Settings = {
  model: 10, // Bantam Tools NextDraw 2234
  handling: 1,
  speed_pendown: 25,
  speed_penup: 75,
  accel: 75,
  pen_pos_down: 45,
  pen_pos_up: 70,
  pen_setup: 60,
  pen_rate_lower: 50,
  pen_rate_raise: 75,
  copies: 1,
  page_delay: 15,
  reordering: 0,
  auto_rotate: true,
  hiding: false,
  random_start: false,
  return_home: true,
  paper_size: "letter",
  paper_w: 279.4,
  paper_h: 215.9,
  paper_x: 0,
  paper_y: 0,
  units: "mm",
};

// Settings saved in a pen preset (must match PRESET_NUMERIC in server.py). Paper isn't included.
export const PRESET_FIELDS = [
  "pen_pos_down", "pen_pos_up", "pen_setup", "pen_rate_lower", "pen_rate_raise",
  "speed_pendown", "speed_penup", "accel", "handling",
] as const satisfies readonly (keyof Settings)[];

// Width × height in mm, portrait. Shown landscape by default to suit the plotter.
export const PAPER_SIZES: { id: string; name: string; w?: number; h?: number }[] = [
  { id: "letter", name: "8.5 × 11 in", w: 215.9, h: 279.4 },
  { id: "11x14", name: "11 × 14 in", w: 279.4, h: 355.6 },
  { id: "11x17", name: "11 × 17 in", w: 279.4, h: 431.8 },
  { id: "12x18", name: "12 × 18 in", w: 304.8, h: 457.2 },
  { id: "14x17", name: "14 × 17 in", w: 355.6, h: 431.8 },
  { id: "18x24", name: "18 × 24 in", w: 457.2, h: 609.6 },
  { id: "24x36", name: "24 × 36 in", w: 609.6, h: 914.4 },
  { id: "custom", name: "Custom size" }, // shown when the width and height don't match a size above
];

// Carriage step sizes per unit, in that unit.
export const STEPS = { mm: [1, 10, 50], in: [0.05, 0.5, 2] } as const;

export const PLOTTING_STATES = ["preparing", "plotting", "stopping", "returning"];
export const BUSY_STATES = [...PLOTTING_STATES, "testing", "moving"];

export const STORAGE = {
  settings: "nextdraw-studio-settings",
  preset: "nextdraw-studio-preset",
  placement: "nextdraw-studio-placement",
  scale: "nextdraw-studio-scale",
  zoom: "nextdraw-studio-zoom",
};
