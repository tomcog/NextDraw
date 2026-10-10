import type { CSSProperties, ReactNode } from "react";
import { inkLayer } from "../lib/ink";

/**
 * The ink: what the pen will put on the paper, in the structure Plot's preview uses and painted by the
 * same rules in index.css - which is what makes a drawing look the same in every app rather than
 * merely similar. Outline is the rules' hairline: one screen pixel whatever the zoom, flat, no
 * blending - the paths themselves. Preview is the ink, at the pen's real width.
 */
export function InkGroup({ sim, penIn, build, className, children }: { sim: boolean; penIn: number; build: number; className?: string; children: ReactNode }) {
  return (
    <g
      className={`pv-colored ${sim ? "pv-true-width" : "pv-hairline pv-flat"}${className ? ` ${className}` : ""}`}
      style={{ "--pen-art": String(penIn), "--ink-build-alpha": String(build) } as CSSProperties}
    >
      {children}
    </g>
  );
}

interface LayerProps {
  /** The layer's id, which the preview rules and the loupe find it by. */
  id?: string;
  /** The pen's colour: everything on the layer draws in it. */
  color: string;
  /** Previewing the ink rather than outlining the paths. */
  sim: boolean;
  /** How solid the ink is: strokes multiply, so crossings darken. */
  opacity: number;
  /** 0 to 1: how much darker the ink gets where it crosses its own strokes. */
  build: number;
  /** More of the same ink darkens (a brush); gel ink saturates and adds nothing. */
  builds: boolean;
  /** The ink covers what's under it, rather than blending. */
  opaque: boolean;
  hidden?: boolean;
  skipped?: boolean;
  children: ReactNode;
}

/** One layer of ink in its pen, and - where its ink builds - the same marks again, multiplying, so a crossing darkens. */
export function InkLayer({ id, color, sim, opacity, build, builds, opaque, hidden, skipped, children }: LayerProps) {
  const { base, buildPass } = inkLayer(color, build, builds && !opaque, sim);
  return (
    <g
      id={id}
      className="pv-layer"
      data-builds={String(builds && sim)}
      data-opaque={String(opaque && sim)}
      data-hidden={hidden ? "true" : undefined}
      data-skipped={skipped ? "true" : undefined}
      style={{ "--layer-color": base, "--ink-opacity": String(opacity) } as CSSProperties}
    >
      {children}
      {buildPass && (
        <g className="pv-build" style={{ "--layer-color": buildPass } as CSSProperties}>
          {children}
        </g>
      )}
    </g>
  );
}
