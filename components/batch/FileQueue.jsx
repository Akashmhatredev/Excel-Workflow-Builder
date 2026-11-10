"use client";

import { FileSpreadsheet, FolderOpen, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { formatBytes, plural } from "@/components/batch/format";
import { Button, IconButton } from "@/components/ui";
import { BATCH_ACCEPT, BATCH_MAX_FILES } from "@/lib/batch";
import { cn } from "@/lib/cn";

const hasFiles = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files");

/**
 * The files of a batch: a drop zone with a "Choose files" button, then the queued files.
 *   { entries: { id, file }[], onAdd(files: File[]), onRemove(id), onClear(), disabled }
 */
export default function FileQueue({ entries, onAdd, onRemove, onClear, disabled = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const totalSize = entries.reduce((sum, entry) => sum + (entry.file.size || 0), 0);
  const full = entries.length >= BATCH_MAX_FILES;

  const pick = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const onPicked = (event) => {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = ""; // picking the same files again must fire "change" again
    if (files.length) onAdd(files);
  };

  const dropProps = disabled
    ? {}
    : {
        onDragEnter: (event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragOver: (event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
        },
        onDrop: (event) => {
          event.preventDefault();
          setDragging(false);
          const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
          if (files.length) onAdd(files);
        },
      };

  return (
    <div className="flex flex-col gap-3">
      <div
        {...dropProps}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2",
          disabled && "opacity-60",
        )}
      >
        <Upload className="size-6 text-muted" aria-hidden="true" />
        <p className="text-sm text-fg">
          <span className="font-medium">Drop Excel or CSV files here</span>
          <span className="block text-xs text-muted">.xlsx, .xls, .xlsm, .csv or .tsv, up to {BATCH_MAX_FILES} files</span>
        </p>
        <Button icon={FolderOpen} disabled={disabled || full} onClick={pick}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={BATCH_ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPicked}
        />
      </div>

      {entries.length ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted" role="status">
              {plural(entries.length, "file")} queued ({formatBytes(totalSize)})
            </p>
            <Button variant="ghost" size="sm" icon={X} disabled={disabled} onClick={onClear}>
              Remove all
            </Button>
          </div>
          <ul aria-label="Queued files" className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {entries.map((entry, index) => (
              <li key={entry.id} className="flex min-w-0 items-center gap-3 py-1.5 pr-1.5 pl-3">
                <FileSpreadsheet className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg" title={entry.file.name}>
                    <span className="sr-only">{index + 1}. </span>
                    {entry.file.name}
                  </span>
                  <span className="block text-xs text-muted">{formatBytes(entry.file.size)}</span>
                </span>
                <IconButton
                  label={`Remove ${entry.file.name}`}
                  icon={Trash2}
                  variant="dangerGhost"
                  disabled={disabled}
                  onClick={() => onRemove(entry.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">No files yet. The files are processed in the order shown here.</p>
      )}
    </div>
  );
}
