"use client";

import { ChevronDown, FileSpreadsheet, Loader2, Merge, RefreshCw, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import LookupSettings from "@/components/upload/LookupSettings";
import { formatBytes, plural } from "@/components/upload/format";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeKey, getLookupKeys, isLookupConfigured } from "@/lib/schema";
import { toast } from "@/lib/toast";
import { selectLookupNeeded, useWorkflowStore } from "@/store/useWorkflowStore";

const ACCEPT = ".xlsx,.xls,.csv";
const isFileDrag = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files");

/** "It matches on “Order ID” and adds Reason and Refund Amount." for a template that expects a lookup file. */
function describeExpected(lookup) {
  const keys = getLookupKeys(lookup);
  const names = lookup.columns.length
    ? lookup.columns
    : lookup.expectedColumns.map((column) => column.name).filter((name) => !keys.lookup.includes(name));
  const shown = names.slice(0, 4).map((name) => `“${name}”`);
  const more = names.length > shown.length ? ` and ${names.length - shown.length} more` : "";
  const adds = shown.length ? ` and adds ${shown.join(", ")}${more}` : "";
  return `It matches rows on “${describeKey(keys.main, lookup.keySeparator)}”${adds}.`;
}

/**
 * "Merge columns from a second file": a left join of a lookup table onto the main one
 * (like VLOOKUP). Shown on the Upload step once the main file is loaded. Collapsed by
 * default unless a merge is set up or expected by the template.
 *
 * The card is its own drop target (`data-lookup-drop`): UploadStep ignores drops inside it,
 * so a file dropped here never replaces the main file.
 */
export default function LookupCard() {
  const lookup = useWorkflowStore((state) => state.definition.lookup);
  const lookupFile = useWorkflowStore((state) => state.lookupFile);
  const lookupStatus = useWorkflowStore((state) => state.lookupStatus);
  const lookupError = useWorkflowStore((state) => state.lookupError);
  const lookupRowCount = useWorkflowStore((state) => state.lookupRowCount);
  const lookupColumnCount = useWorkflowStore((state) => state.lookupColumns.length);
  const lookupInfo = useWorkflowStore((state) => state.lookupInfo);
  const needed = useWorkflowStore(selectLookupNeeded);
  const loadLookupFile = useWorkflowStore((state) => state.loadLookupFile);
  const clearLookup = useWorkflowStore((state) => state.clearLookup);
  const setLookup = useWorkflowStore((state) => state.setLookup);

  const inputRef = useRef(null);
  const panelId = useId();
  const [userOpen, setUserOpen] = useState(null); // null = follow the workflow (open when a merge is in play)
  const [dragging, setDragging] = useState(false);

  const configured = isLookupConfigured(lookup);
  const inPlay = needed || Boolean(lookupFile) || configured;
  const open = userOpen ?? inPlay;
  const merged = configured && lookupStatus === "ready" && Boolean(lookupInfo && lookupInfo.applied);

  const openPicker = () => {
    setUserOpen(true);
    if (inputRef.current) inputRef.current.click();
  };

  const loadFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 1) toast.info("One file at a time", { description: `Using “${files[0].name}” as the second file.` });
    setUserOpen(true);
    loadLookupFile(files[0]);
  };

  const remove = async () => {
    await clearLookup();
    toast.info("Second file removed", { description: "Its columns are no longer merged into the table." });
  };

  const dropHandlers = {
    onDragEnter: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setDragging(false);
    },
    onDrop: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDragging(false);
      loadFiles(event.dataTransfer.files);
    },
  };

  let status = null;
  if (needed) status = <Badge tone="warning">File needed</Badge>;
  else if (merged) status = <Badge tone="brand">Merged</Badge>;
  else if (lookupStatus === "error") status = <Badge tone="danger">Not loaded</Badge>;

  return (
    <Card as="section" data-lookup-drop="" className="relative flex flex-col p-4 sm:p-5" {...dropHandlers}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          loadFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
          <Merge className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setUserOpen(!open)}
              className="tap-target inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left usable-hover:text-brand"
            >
              <span>Merge columns from a second file</span>
              <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
            </button>
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Like VLOOKUP: match each row to a row of another file by a key (one column, or several combined) and bring its columns in.
          </p>
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>

      {open ? (
        <div id={panelId} className="mt-4 flex flex-col gap-4">
          {needed ? (
            <Notice
              tone="warning"
              title="This workflow merges a second file"
              actions={
                lookupStatus === "parsing" ? null : (
                  <Button variant="ghost" size="sm" onClick={() => setLookup({ enabled: false })}>
                    Skip the merge
                  </Button>
                )
              }
            >
              {describeExpected(lookup)} Add that file to bring those columns in.
            </Notice>
          ) : null}

          {lookupStatus === "idle" || !lookupFile ? (
            <div
              className={cn(
                "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface",
              )}
            >
              <p className="text-sm text-muted">
                {dragging ? "Drop the file to use it as the second file" : "Drop the second Excel or CSV file here, or"}
              </p>
              <Button variant="secondary" icon={Upload} onClick={openPicker}>
                Choose the second file
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg">
                {lookupStatus === "parsing" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium text-fg" title={lookupFile.name}>
                  {lookupFile.name}
                </p>
                <p className="text-xs text-muted" role="status" aria-live="polite">
                  {lookupStatus === "parsing"
                    ? "Reading the file…"
                    : lookupStatus === "error"
                      ? "Not loaded"
                      : [formatBytes(lookupFile.size), `${plural(lookupRowCount, "row")} × ${plural(lookupColumnCount, "column")}`]
                          .filter(Boolean)
                          .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={openPicker} disabled={lookupStatus === "parsing"}>
                  Replace
                </Button>
                <Button variant="dangerGhost" size="sm" icon={Trash2} onClick={remove}>
                  Remove
                </Button>
              </div>
            </div>
          )}

          {lookupStatus === "error" ? (
            <Notice tone="error" title="The second file could not be read">
              <p>{lookupError || "The file could not be read."}</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={openPicker}>
                Choose another file
              </Button>
            </Notice>
          ) : null}

          {lookupStatus === "ready" ? (
            <LookupSettings key={lookupFile ? `${lookupFile.name}:${lookupFile.size}` : "none"} />
          ) : null}
        </div>
      ) : null}

      {dragging && !(open && (lookupStatus === "idle" || !lookupFile)) ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-soft/90 p-4 text-center text-sm font-semibold text-brand-soft-fg"
        >
          {lookupFile ? "Drop to replace the second file" : "Drop to use this as the second file"}
        </div>
      ) : null}
    </Card>
  );
}
