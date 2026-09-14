import { useEffect, useRef, useState } from "react";
import { Button, ButtonRound, InputText } from "@tomcoggia/ui";
import { RotateCcw } from "lucide-react";
import styles from "./controls.module.css";
import { Section } from "./Section";
import { fmtLen, trimNum } from "../../lib/format";
import type { Preview } from "../../lib/preview";
import type { Units } from "../../lib/types";

interface Props {
  fileName: string | null;
  busy: boolean;
  preview: Preview | null;
  previewScale: number; // percent the preview was made at
  scale: number; // percent chosen now (the preview may still be catching up)
  units: Units;
  onScale: (percent: number) => void;
  onChoose: (file: File | undefined) => void;
  onClear: () => void;
}

export function FileSection({ fileName, busy, preview, previewScale, scale, units, onScale, onChoose, onClear }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(trimNum(scale, 1));
  useEffect(() => setDraft(trimNum(scale, 1)), [scale]);

  const commit = (text: string) => {
    const n = Number(text);
    if (text === "" || Number.isNaN(n) || n <= 0) {
      setDraft(trimNum(scale, 1));
      return;
    }
    const next = Math.min(1000, Math.max(1, n));
    setDraft(trimNum(next, 1));
    if (next !== scale) onScale(next);
  };

  // The preview is scaled, so the original size is the preview divided by the scale it was made at.
  // The resized size is worked out from that, so it follows the field immediately.
  const size = (w: number, h: number) => `${fmtLen(w * 25.4, units, false)} × ${fmtLen(h * 25.4, units)}`;
  const originalIn = preview ? [preview.widthIn / (previewScale / 100), preview.heightIn / (previewScale / 100)] : null;
  const original = originalIn ? size(originalIn[0], originalIn[1]) : null;
  const resized = originalIn && scale !== 100 ? size(originalIn[0] * scale / 100, originalIn[1] * scale / 100) : null;

  return (
    <Section title="File">
      <div className={styles.fileRow}>
        <span className={styles.fileName} data-has-file={Boolean(fileName)} title={fileName ?? undefined}>
          {fileName ?? "No file loaded"}
        </span>
        {fileName && (
          <Button size="md" variant="ghost" tone="danger" disabled={busy} onClick={onClear}>Clear</Button>
        )}
        <Button size="md" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>Choose SVG</Button>
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            onChoose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {fileName && (
        <div className={styles.scaleRow}>
          <InputText
            className={styles.scaleField}
            label="Scale (%)"
            type="number"
            inputMode="decimal"
            min={1}
            max={1000}
            step={1}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const stepBy = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
                commit(String((Number(draft) || scale) + stepBy));
              }
            }}
          />
          {original && (
            <div className={styles.dimensions}>
              <p>{`Original ${original}`}</p>
              {resized && <p>{`At ${trimNum(scale, 1)}%: ${resized}`}</p>}
            </div>
          )}
          {scale !== 100 && (
            <ButtonRound
              size="sm"
              icon={<RotateCcw />}
              aria-label="Reset scale to 100%"
              title="Reset scale to 100%"
              disabled={busy}
              onClick={() => onScale(100)}
            />
          )}
        </div>
      )}
    </Section>
  );
}
