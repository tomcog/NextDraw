import { parsePreview, type Preview } from "./preview";

// The pen-down paths of the plot in progress (server.py save_plot_paths): one path in plot order,
// "Mx y x y x y …" in absolute coordinates, with a new subpath each time the pen lowers.
export interface PlotPaths {
  preview: Preview;
  xMm: number; // where the plot sits on the plotter
  yMm: number;
  subpaths: Float64Array[]; // x, y pairs
  ends: number[]; // pen-down distance at the end of each subpath
  drawn: SVGPathElement; // the part already drawn
  left: SVGPathElement; // the part still to draw
}

const fmt = (n: number) => n.toFixed(3);

export function parsePlotPaths(svgText: string): PlotPaths | null {
  const preview = parsePreview(svgText);
  if (!preview) return null;
  const source = preview.node.querySelector<SVGPathElement>(".pv-down path");
  if (!source) return null;

  const subpaths: Float64Array[] = [];
  const ends: number[] = [];
  let total = 0;
  for (const chunk of (source.getAttribute("d") || "").split("M")) {
    const nums = chunk.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length < 4 || nums.some(Number.isNaN)) continue;
    const pts = Float64Array.from(nums.length % 2 ? nums.slice(0, -1) : nums);
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    subpaths.push(pts);
    ends.push(total);
  }

  // Replace the one path with a drawn part and a part left to draw, styled in index.css.
  const drawn = source.cloneNode() as SVGPathElement;
  const left = source.cloneNode() as SVGPathElement;
  drawn.classList.add("pv-drawn");
  left.classList.add("pv-left");
  source.replaceWith(left, drawn);

  const root = preview.node;
  return {
    preview,
    xMm: Number(root.getAttribute("data-x-mm")) || 0,
    yMm: Number(root.getAttribute("data-y-mm")) || 0,
    subpaths,
    ends,
    drawn,
    left,
  };
}

// Split the paths at a fraction (0-1) of their pen-down length.
export function showProgress(paths: PlotPaths, fraction: number) {
  const total = paths.ends[paths.ends.length - 1] ?? 0;
  const at = Math.max(0, Math.min(1, fraction)) * total;
  const drawn: string[] = [];
  const left: string[] = [];
  let start = 0;
  paths.subpaths.forEach((pts, i) => {
    const end = paths.ends[i];
    const out = end <= at ? drawn : start >= at ? left : null;
    if (out) {
      out.push(`M${Array.from(pts, fmt).join(" ")}`);
    } else {
      // The pen is partway along this one: cut it where the drawn distance runs out.
      let run = start;
      const head = [fmt(pts[0]), fmt(pts[1])];
      for (let j = 2; j < pts.length; j += 2) {
        const seg = Math.hypot(pts[j] - pts[j - 2], pts[j + 1] - pts[j - 1]);
        if (run + seg >= at) {
          const t = seg > 0 ? (at - run) / seg : 0;
          const cx = fmt(pts[j - 2] + (pts[j] - pts[j - 2]) * t);
          const cy = fmt(pts[j - 1] + (pts[j + 1] - pts[j - 1]) * t);
          drawn.push(`M${head.join(" ")} ${cx} ${cy}`);
          const tail = [cx, cy];
          for (let k = j; k < pts.length; k += 2) tail.push(fmt(pts[k]), fmt(pts[k + 1]));
          left.push(`M${tail.join(" ")}`);
          break;
        }
        run += seg;
        head.push(fmt(pts[j]), fmt(pts[j + 1]));
      }
    }
    start = end;
  });
  paths.drawn.setAttribute("d", drawn.join(" "));
  paths.left.setAttribute("d", left.join(" "));
}
