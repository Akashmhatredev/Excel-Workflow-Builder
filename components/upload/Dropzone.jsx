"use client";

import { FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The drop target shown while no file is loaded. The drag events are handled by
 * UploadStep (the whole step accepts a drop); this only reflects `dragging`.
 * "Choose a file" is the keyboard path to the same file picker.
 */
export default function Dropzone({ dragging = false, disabled = false, sampleLoading = false, onBrowse, onSample }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors sm:py-14",
        dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface",
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg">
        <FileSpreadsheet className="size-7" aria-hidden="true" />
      </span>
      <div>
        <p className="text-base font-semibold text-fg">
          {dragging ? "Drop the file to load it" : "Drag and drop your Excel or CSV file here"}
        </p>
        <p className="mt-1 text-sm text-muted">Supported formats: .xlsx, .xls and .csv</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" size="lg" icon={Upload} onClick={onBrowse} disabled={disabled}>
          Choose a file
        </Button>
        <Button variant="ghost" size="lg" icon={Sparkles} onClick={onSample} loading={sampleLoading} disabled={disabled}>
          Try the sample file
        </Button>
      </div>
    </div>
  );
}
