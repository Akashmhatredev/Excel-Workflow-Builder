"use client";

import { FileArchive, FileOutput, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import OutputExportCard from "@/components/export/OutputExportCard";
import { plural } from "@/components/outputs/helpers";
import { Button, Card, EmptyState, Notice, SectionHeader } from "@/components/ui";
import { downloadBytes } from "@/lib/download";
import { sanitizeFileName } from "@/lib/schema";
import { toast } from "@/lib/toast";
import { buildZip } from "@/lib/workerClient";
import { selectHasData, useWorkflowStore } from "@/store/useWorkflowStore";

/** "Monthly sales.zip" from the template name, else "<source file> outputs.zip". */
function zipFileName(templateName, file) {
  const fromTemplate = String(templateName || "").trim();
  if (fromTemplate) return `${sanitizeFileName(fromTemplate, "outputs")}.zip`;
  const source = file && file.name ? String(file.name).replace(/\.[^.]+$/, "").trim() : "";
  return source ? `${sanitizeFileName(`${source} outputs`, "outputs")}.zip` : "outputs.zip";
}

function ZipCard({ outputCount, hasData }) {
  const templateName = useWorkflowStore((state) => state.templateName);
  const file = useWorkflowStore((state) => state.file);
  const [zip, setZip] = useState({ status: "idle" }); // idle | building | done | error
  const zipName = zipFileName(templateName, file);
  const reason = !outputCount ? "Add at least one output first." : !hasData ? "Upload a file to export." : "";
  const building = zip.status === "building";

  const handleZip = async () => {
    setZip({ status: "building", progress: null });
    try {
      const definition = useWorkflowStore.getState().definition;
      const result = await buildZip({
        definition,
        outputIds: null,
        zipName,
        onProgress: (progress) => setZip((current) => (current.status === "building" ? { ...current, progress } : current)),
      });
      const name = result.fileName || zipName;
      downloadBytes(result.bytes, name, result.mime || "application/zip");
      const files = Array.isArray(result.files) ? result.files : [];
      setZip({ status: "done", fileName: name, files });
      toast.success(`Downloaded ${name}`, { description: files.length ? plural(files.length, "file") : undefined });
    } catch (error) {
      const message = (error && error.message) || "The zip could not be built.";
      setZip({ status: "error", error: message });
      toast.error("Could not build the zip", { description: message });
    }
  };

  const progress = building && zip.progress ? zip.progress : null;

  return (
    <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
      <SectionHeader
        as="h3"
        title="Download everything"
        description={`${plural(outputCount, "file")} in one zip. Everything is built in your browser: nothing is uploaded.`}
        actions={
          <Button
            variant="primary"
            icon={FileArchive}
            loading={building}
            disabled={Boolean(reason)}
            onClick={handleZip}
            aria-describedby="export-zip-status"
          >
            {building ? "Building the zip" : "Download all as .zip"}
          </Button>
        }
      />
      <p id="export-zip-status" className="text-sm text-muted empty:hidden" role="status" aria-live="polite">
        {reason
          ? reason
          : progress
            ? [progress.message || progress.phase, Number.isFinite(progress.percent) ? `${Math.round(progress.percent)}%` : ""]
                .filter(Boolean)
                .join(" ")
            : zip.status === "done"
              ? `Downloaded ${zip.fileName}.`
              : `Will be saved as ${zipName}.`}
      </p>
      {zip.status === "done" && zip.files.length ? (
        <ul className="flex flex-col gap-1 text-sm text-muted" aria-label="Files in the zip">
          {zip.files.map((entry, index) => (
            <li key={`${entry.fileName}-${index}`} className="flex flex-wrap justify-between gap-x-4">
              <span className="min-w-0 wrap-anywhere text-fg">{entry.fileName}</span>
              {Number.isFinite(entry.rowCount) ? <span>{plural(entry.rowCount, "row")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {zip.status === "error" ? (
        <Notice
          tone="error"
          title="The zip could not be built"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} className="max-sm:h-10" onClick={handleZip}>
              Try again
            </Button>
          }
        >
          {zip.error}
        </Notice>
      ) : null}
    </Card>
  );
}

/**
 * ExportStep (owner: Agent C). Step 4 of the wizard: download each output, all of them as a zip,
 * and (for outputs with a report) the PNG image with sharing. No props; reads useWorkflowStore.
 * Files are built by the worker (buildOutput / buildZip) and saved with lib/download.
 */
export default function ExportStep() {
  const outputs = useWorkflowStore((state) => state.definition.outputs);
  const hasData = useWorkflowStore(selectHasData);
  const setStep = useWorkflowStore((state) => state.setStep);

  if (!outputs.length) {
    return (
      <Card>
        <EmptyState
          icon={FileOutput}
          title="Nothing to export yet"
          description="Add at least one output in the Outputs step. Each output becomes a file you can download here."
          action={
            <Button variant="primary" onClick={() => setStep(2)}>
              Go to Outputs
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!hasData ? (
        <Notice
          tone="warning"
          title="No file is loaded"
          actions={
            <Button variant="secondary" size="sm" icon={Upload} className="max-sm:h-10" onClick={() => setStep(0)}>
              Go to Upload
            </Button>
          }
        >
          The outputs are built from your file. Upload it to download and share them.
        </Notice>
      ) : null}

      <ZipCard outputCount={outputs.length} hasData={hasData} />

      <ul className="flex min-w-0 flex-col gap-4" aria-label="Outputs to download">
        {outputs.map((output) => (
          <li key={output.id} className="min-w-0">
            <OutputExportCard output={output} />
          </li>
        ))}
      </ul>
    </div>
  );
}
