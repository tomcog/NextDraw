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
  file_path: string | null;
  printed_layers: string[]; // ids of layers that finished plotting since the drawing was opened // where the loaded drawing lives; null for an uploaded copy
  file_folder: string | null; // that folder, for display (e.g. "~/Desktop")
  sibling_ai: string | null; // an Illustrator file with the same name next to it
  resume: { done_mm: number; total_mm: number } | null; // a stopped plot that can be resumed
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
  layers: Layer[];
  superseded?: boolean; // a newer estimate was asked for before this one ran
}

// A layer as found in the drawing file, in file order.
export interface Layer {
  index: number;
  id: string;
  name: string;
  color: string | null; // the most common stroke color on the layer
  colors: string[];
  shapes: number;
  skipped: boolean; // name starts with %, so NextDraw won't plot it
  hidden: boolean; // hidden in the file (display:none); not shown or plotted
}

// A layer as shown in the Layers card, after the operator's renames.
export interface LayerView extends Layer {
  originalName: string;
  renamed: boolean;
}

// The operator's changes to a drawing's layers, kept until they're saved into the file.
export interface LayerEdits {
  order: string[]; // layer ids, bottom layer first
  names: Record<string, string>;
  hidden: Record<string, boolean>;
  colors: Record<string, string>; // pen colors picked from the drawing tool's palette
}

// The page's choices saved inside a drawing file, restored when it's opened again.
export interface Studio {
  placement?: Placement;
  scale?: number;
  rotation?: number; // quarter turns clockwise, in degrees
  tool?: string;
  paper?: Partial<Pick<Settings, "paper_size" | "paper_w" | "paper_h" | "paper_x" | "paper_y">>;
}

export interface Preset {
  name: string;
  settings: Partial<Settings>;
  palette?: PenColor[]; // the drawing tool's colors, set up by hand in presets.json
}

export interface PenColor {
  name: string;
  color: string; // #rrggbb
}

export interface Placement {
  x: number; // mm from home
  y: number;
}

export type Tone = "error" | "ok" | undefined;

// A question shown in the page before a consequential action.
export interface Confirmation {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export interface Message {
  text: string;
  tone?: Tone;
}
