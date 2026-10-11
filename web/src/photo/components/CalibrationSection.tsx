import { useRef, type ReactNode } from "react";
import { Button } from "@tomcoggia/ui";
import { Section } from "../../shared/components/controls/Section";
import controls from "../../shared/components/controls/controls.module.css";
import { listOf } from "../../shared/lib/format";
import type { Preset } from "../../shared/lib/types";
import { CALIBRATION_COVERS } from "../lib/calibration";
import styles from "../App.module.css";

interface Props {
  /** The drawing tool being calibrated, and its name as chosen. */
  tool: Preset | null;
  toolName: string;
  busy: boolean;
  /** Whether a calibration sheet is open, and whether it is of this tool's pens. */
  sheetOpen: boolean;
  sheetIsTool: boolean;
  /** Pens on the open sheet that aren't this tool's. */
  strangers: string[];
  onNewSheet: () => void;
  /** Make a sheet of the tool's pens two at a time, hatched over each other. */
  onNewPairs: () => void;
  /** Open a sheet saved before, to read a photo of it. */
  onOpenSheet: () => void;
  /** The sheet in hand: its name, Save and Send to Plot. Left out while there is none. */
  sheetFile?: ReactNode;
  onReadPhoto: (file: File | undefined) => void;
  /** The question asked before a new drawing replaces one with unsaved work, when it's being asked. */
  confirm: ReactNode;
}

/**
 * Setup's calibration: a sheet of every pen at four strengths, plotted and photographed, read back as
 * each pen really comes out - and what was measured, pen by pen. Moved from Studio's Setup on
 * 2026-10-06; the sheet is shown on Photo's stage rather than opened as a drawing.
 */
export function CalibrationSection({ tool, toolName, busy, sheetOpen, sheetIsTool, strangers, onNewSheet, onNewPairs, onOpenSheet, sheetFile, onReadPhoto, confirm }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const calibrated = tool?.calibration;
  return (
    <Section
      title="Calibration"
      collapsibleKey="calibration"
      action={<span className={controls.toolInTitle}>{calibrated ? `Measured ${calibrated.measured}` : "Not measured"}</span>}
    >
      <p className={controls.hint}>
        1. Make the sheet: every {tool?.name ?? "pen"} color at four strengths, on this paper. Save it and plot it on the paper you’ll use.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !tool?.palette?.length}
        title={tool?.palette?.length ? undefined : "This pen has no colors yet"}
        onClick={onNewSheet}
      >
        New calibration sheet
      </Button>
      {confirm}
      {sheetFile}
      <p className={controls.hint}>
        2. Photograph the plotted sheet flat and evenly lit, with the whole sheet in view, and read it in with its sheet made or opened here.
      </p>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onOpenSheet}>
        Open a sheet
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !sheetIsTool}
        title={!sheetOpen ? "Make or open the calibration sheet first" : !sheetIsTool ? `This sheet isn’t of ${toolName || "this pen"}’s colors: choose the pen it was made for` : undefined}
        onClick={() => input.current?.click()}
      >
        Read an image of the sheet
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onReadPhoto(e.target.files?.[0]);
          e.target.value = ""; // so the same photo can be read again
        }}
      />
      {sheetOpen && !sheetIsTool && tool && (
        <p className={controls.hint}>The open sheet is of other pens than {tool.name}’s ({strangers.length > 3 ? `${strangers.slice(0, 3).join(", ")} and ${strangers.length - 3} more` : listOf(strangers)}).</p>
      )}
      <p className={controls.hint}>
        Color pairs: a spread of {tool?.name ?? "the pen"}’s colors two at a time, the lighter hatched first and the darker across it, to see what overlaid hatching makes on paper.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || (tool?.palette?.length ?? 0) < 2}
        title={(tool?.palette?.length ?? 0) < 2 ? "This pen needs at least two colors" : undefined}
        onClick={onNewPairs}
      >
        New color pairs sheet
      </Button>
      {calibrated && tool && (
        <ul className={styles.calibration} aria-label={`${tool.name} as measured`}>
          <li className={styles.calibrationRow}>
            <span className={styles.calibrationHead}>Pen</span>
            <span className={styles.calibrationHead} title="The palette's color">Pal.</span>
            {CALIBRATION_COVERS.map((c) => <span key={c} className={styles.calibrationHead}>{Math.round(c * 1000) / 10}</span>)}
          </li>
          {(tool.palette ?? []).map((pen) => {
            const covers = calibrated.pens[pen.name];
            return (
              <li key={pen.name} className={styles.calibrationRow}>
                <span title={pen.name}>{pen.name}</span>
                <span className={styles.swatch} data-palette="true" style={{ background: pen.color }} title={`${pen.name}: palette ${pen.color}`} />
                {CALIBRATION_COVERS.map((c) => {
                  const key = `${Math.round(c * 1000) / 10}`;
                  const hex = covers?.[key];
                  return <span key={key} className={styles.swatch} style={{ background: hex ?? "transparent" }} title={hex ? `${pen.name} at ${key}%: ${hex}` : "Not measured"} />;
                })}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
