"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const PHASE_LABELS = {
  reading: "Reading the file",
  parsing: "Parsing the workbook",
  loading: "Loading the sheet",
  indexing: "Preparing the rows",
};

function phaseLabel(progress, status) {
  const phase = progress && progress.phase;
  if (phase && PHASE_LABELS[phase]) return PHASE_LABELS[phase];
  if (phase) return String(phase).charAt(0).toUpperCase() + String(phase).slice(1);
  return status === "loading" ? PHASE_LABELS.loading : PHASE_LABELS.reading;
}

/** Progress of a file being parsed or a sheet being loaded. `progress` = { phase, percent?, message? } | null. */
export default function LoadProgress({ fileName, progress, status, className }) {
  const raw = progress ? Number(progress.percent) : NaN;
  const percent = progress && progress.percent != null && Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
  const label = (progress && progress.message) || phaseLabel(progress, status);
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6", className)}>
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 shrink-0 animate-spin text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {fileName ? <p className="truncate font-medium text-fg">{fileName}</p> : null}
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {label}…
          </p>
        </div>
        {percent != null ? (
          <span className="shrink-0 text-sm font-medium text-fg tabular-nums" aria-hidden="true">
            {percent}%
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={fileName ? `Loading ${fileName}` : "Loading the file"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent == null ? undefined : percent}
        aria-valuetext={percent == null ? label : `${percent}%`}
        className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn("h-full rounded-full bg-brand transition-[width] duration-200", percent == null && "w-full animate-pulse")}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
