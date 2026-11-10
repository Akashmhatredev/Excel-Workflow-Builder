"use client";

import { History, Merge, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import DetectedColumns from "@/components/upload/DetectedColumns";
import Dropzone from "@/components/upload/Dropzone";
import FileSummary from "@/components/upload/FileSummary";
import HeaderRowField from "@/components/upload/HeaderRowField";
import LoadProgress from "@/components/upload/LoadProgress";
import LookupCard from "@/components/upload/LookupCard";
import PrivacyNote from "@/components/upload/PrivacyNote";
import SheetPicker from "@/components/upload/SheetPicker";
import SourcePreview from "@/components/upload/SourcePreview";
import { plural } from "@/components/upload/format";
import { Button, Card, IconButton, Notice, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { selectLookupNeeded, useWorkflowStore } from "@/store/useWorkflowStore";

const ACCEPT = ".xlsx,.xls,.csv";
const SAMPLE_URL = "/samples/sample-data.xlsx";
const SAMPLE_NAME = "sample-data.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const isFileDrag = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files");
// The lookup card takes its own drops (the second file); the step must not treat them as the main file.
const inLookupCard = (event) =>
  typeof Element !== "undefined" && event.target instanceof Element && Boolean(event.target.closest("[data-lookup-drop]"));

/**
 * Step 1: load a spreadsheet. The file is parsed in the worker; this step only
 * shows what the store knows about it (sheets, columns, the first rows).
 */
export default function UploadStep() {
  const file = useWorkflowStore((state) => state.file);
  const sheets = useWorkflowStore((state) => state.sheets);
  const columns = useWorkflowStore((state) => state.columns);
  const rowCount = useWorkflowStore((state) => state.rowCount);
  const warnings = useWorkflowStore((state) => state.warnings);
  const status = useWorkflowStore((state) => state.status);
  const progress = useWorkflowStore((state) => state.progress);
  const error = useWorkflowStore((state) => state.error);
  const draftRestored = useWorkflowStore((state) => state.draftRestored);
  const lookupNeeded = useWorkflowStore(selectLookupNeeded);
  const loadFile = useWorkflowStore((state) => state.loadFile);
  const clearData = useWorkflowStore((state) => state.clearData);
  const dismissDraftNotice = useWorkflowStore((state) => state.dismissDraftNotice);

  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);

  // A file dropped next to the drop area would otherwise make the browser open it and discard the workflow.
  useEffect(() => {
    const prevent = (event) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const openPicker = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const loadFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 1) {
      toast.info("One file at a time", { description: `Loading “${files[0].name}” and ignoring the rest.` });
    }
    loadFile(files[0]);
  };

  const loadSample = async () => {
    setSampleLoading(true);
    try {
      const response = await fetch(SAMPLE_URL);
      if (!response.ok) throw new Error(`The sample file is not available (HTTP ${response.status}).`);
      const blob = await response.blob();
      await loadFile(new File([blob], SAMPLE_NAME, { type: XLSX_MIME, lastModified: Date.now() }));
    } catch (failure) {
      toast.error("Could not load the sample file", {
        description: (failure && failure.message) || "Check your connection and try again.",
      });
    } finally {
      setSampleLoading(false);
    }
  };

  const dropHandlers = {
    onDragEnter: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDragging(!inLookupCard(event));
    },
    onDragOver: (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (inLookupCard(event)) {
        setDragging(false);
        return;
      }
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
      if (inLookupCard(event)) return;
      loadFiles(event.dataTransfer.files);
    },
  };

  const hasSheets = sheets.length > 0;
  // A new file resets the unapplied sheet selection and header row drafts.
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const busy = status === "parsing" || status === "loading";
  const failedToRead = Boolean(file) && !hasSheets && status === "error";
  const showDropzone = !file || failedToRead;
  // While a sheet is re-read (another sheet or header row) the current table stays visible underneath.
  const showTable = hasSheets && (status === "ready" || (status === "loading" && columns.length > 0));
  const showProgress = Boolean(file) && busy && !showTable;
  // Also shown after a failed reload, so a merge that broke the table can still be changed or removed.
  const showLookup = Boolean(file) && hasSheets && (showTable || status === "error");

  return (
    <div className="relative flex flex-col gap-5" {...dropHandlers}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          loadFiles(event.target.files);
          event.target.value = ""; // picking the same file again must fire a change
        }}
      />

      {draftRestored && !file ? (
        <Notice
          tone="info"
          icon={History}
          title="Your unsaved workflow was restored"
          actions={<IconButton label="Dismiss" icon={X} size="sm" onClick={dismissDraftNotice} />}
        >
          The mapping and outputs are back, but files are never stored. Upload the file again to continue.
        </Notice>
      ) : null}

      {failedToRead ? (
        <Notice tone="error" title={`Could not read “${file.name}”`}>
          <p>{error || "The file could not be read."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={openPicker}>
              Choose another file
            </Button>
            <Button variant="ghost" size="sm" onClick={clearData}>
              Dismiss
            </Button>
          </div>
        </Notice>
      ) : null}

      {lookupNeeded && !showLookup ? (
        <Notice tone="info" icon={Merge} title="This workflow also merges a second file">
          Load the main file first. You can then add the second file in “Merge columns from a second file”.
        </Notice>
      ) : null}

      {showDropzone ? (
        <Dropzone dragging={dragging} sampleLoading={sampleLoading} onBrowse={openPicker} onSample={loadSample} />
      ) : null}

      {showProgress && !hasSheets ? <LoadProgress fileName={file.name} progress={progress} status={status} /> : null}

      {file && hasSheets ? (
        <>
          <FileSummary
            file={file}
            rowCount={rowCount}
            columnCount={columns.length}
            status={status}
            onReplace={openPicker}
            onRemove={clearData}
          />

          {showProgress ? <LoadProgress progress={progress} status={status} /> : null}

          {status === "error" ? (
            <Notice tone="error" title="This sheet could not be loaded">
              <p>{error || "The sheet could not be loaded."}</p>
              <p className="mt-1">
                {sheets.length > 1 ? "Pick another sheet or change the header row below, or " : "Change the header row below, or "}
                choose another file.
              </p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={openPicker}>
                Choose another file
              </Button>
            </Notice>
          ) : null}

          <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
            <SectionHeader title="Sheet and header row" description="Tell the app where the table starts." />
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
              <SheetPicker key={`sheets:${fileKey}`} />
              <HeaderRowField key={`header:${fileKey}`} />
            </div>
          </Card>

          {warnings.length ? (
            <Notice tone="warning" title={warnings.length === 1 ? "One thing to check" : `${warnings.length} things to check`}>
              <ul className={cn("flex flex-col gap-1", warnings.length > 1 && "list-disc pl-4")}>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {showLookup ? <LookupCard /> : null}

          {showTable ? (
            <>
              <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
                <SectionHeader
                  title={`Detected columns (${columns.length})`}
                  description={`${plural(columns.length, "column")} with the type inferred from the values.`}
                />
                <DetectedColumns columns={columns} />
              </Card>
              <SourcePreview />
            </>
          ) : null}
        </>
      ) : null}

      <PrivacyNote />

      {dragging && !showDropzone ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand-soft/90 p-6 text-center text-base font-semibold text-brand-soft-fg"
        >
          Drop the file to replace the current one
        </div>
      ) : null}
    </div>
  );
}
