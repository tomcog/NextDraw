export type Units = "mm" | "in";

export interface Settings {
  model: number;
  handling: number;
  speed_pendown: number;
  speed_penup: number;
  accel: number;
  pen_pos_down: number;
  pen_pos_up: number;
  pen_setup: number;
  pen_rate_lower: number;
  pen_rate_raise: number;
  copies: number;
  page_delay: number;
  reordering: number;
  auto_rotate: boolean;
  hiding: boolean;
  random_start: boolean;
  return_home: boolean;
  paper_size: string;
  paper_w: number; // mm
  paper_h: number; // mm
  paper_x: number; // mm from home
  paper_y: number; // mm from home
  units: Units;
}

export interface PlotterModel {
  id: number;
  name: string;
  travel_in: [number, number];
  auto_home: boolean;
}

export interface Handling {
  id: number;
  name: string;
}

export interface Info {
  models: PlotterModel[];
  handling: Handling[];
  walk_supported: boolean;
}

export interface Carriage {
  known: boolean;
  x: number; // mm from home
  y: number;
  origin_known: boolean;
  origin_x: number;
  origin_y: number;
  pen_up: boolean | null;
  motors_on: boolean | null;
  verified: boolean;
}

export type JobState =
  | "idle" | "preparing" | "plotting" | "stopping" | "returning"
  | "finished" | "stopped" | "error" | "testing" | "moving";

export interface Status {
  state: JobState;
  message: string;
  done_mm: number;
  total_mm: number;
  estimate_s: number;
  elapsed_s: number;
  started: boolean;
  log: string[];
  carriage: Carriage;
  plotter_found: boolean;
  file: string | null;
}

export interface Estimate {
  estimate_s: number;
  pendown_m: number;
  total_m: number;
  pen_lifts: number;
  doc_in: [number, number];
  rotated: boolean;
  warnings: string[];
  preview_svg: string | null;
}

export interface Preset {
  name: string;
  settings: Partial<Settings>;
}

export interface Placement {
  x: number; // mm from home
  y: number;
}

export type Tone = "error" | "ok" | undefined;

export interface Message {
  text: string;
  tone?: Tone;
}
