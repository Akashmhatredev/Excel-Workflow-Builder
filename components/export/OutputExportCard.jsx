"use client";

import { CircleCheck, Download, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { issuesForOutput, plural, sortIssues } from "@/components/outputs/helpers";
import IssueList from "@/components/outputs/IssueList";
import { Badge, Button, Card, Notice, Spinner } from "@/components/ui";
import { downloadBytes } from "@/lib/download";
import { FILE_TYPES, outputFileName } from "@/lib/schema";
import { toast } from "@/lib/toast";
import { buildOutput } from "@/lib/workerClient";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import ReportImagePanel from "./ReportImagePanel";
import { useOutputSnapshot } from "./useOutputSnapshot";

/**
 * One output on the Export step: its file name, type and row count, a Download button, and the
 * image section when the output has a report.
 */
export default function OutputExportCard({ output }) {
  const report = output.report;
  // One worker run gives the row count, the issues and (for a report) the rows of the image.
  const snapshot = useOutputSnapshot({ outputId: output.id, limit: report.enabled ? report.maxRows : 1 });
  const { data, loading, error: snapshotError, hasData } = snapshot;
  const [download, setDownload] = useState({ status: "idle" }); // idle | building | done | error

  const fileName = outputFileName(output);
  const Icon = output.fileType === "csv" ? FileText : FileSpreadsheet;
  const issues = useMemo(
    () => (data ? sortIssues(issuesForOutput(data.issues, output.id)) : []),
    [data, output.id],
  );
  const rowCount = download.status === "done" ? download.rowCount : data ? data.totalRows : null;

  const handleDownload = async () => {
    setDownload({ status: "building", progress: null });
    try {
      // The store's current definition, in case it changed after this card rendered.
      const definition = useWorkflowStore.getState().definition;
      const result = await buildOutput({
        definition,
        outputId: output.id,
        onProgress: (progress) =>
          setDownload((current) => (current.status === "building" ? { ...current, progress } : current)),
      });
      const name = result.fileName || fileName;
      downloadBytes(result.bytes, name, result.mime || FILE_TYPES[output.fileType].mime);
      setDownload({ status: "done", rowCount: result.rowCount, fileName: name });
      toast.success(`Downloaded ${name}`, {
        description: Number.isFinite(result.rowCount) ? plural(result.rowCount, "row") : undefined,
      });
    } catch (error) {
      const message = (error && error.message) || "The file could not be built.";
      setDownload({ status: "error", error: message });
      toast.error(`Could not build ${fileName}`, { description: message });
    }
  };

  const building = download.status === "building";
  const progress = building && download.progress ? download.progress : null;

  return (
    <Card as="article" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-label={fileName}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/* The 15rem basis makes the Download button wrap below the title on narrow cards. */}
        <div className="flex min-w-0 flex-[1_1_15rem] items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold wrap-anywhere text-fg">{fileName}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <Badge tone="neutral">{output.fileType === "csv" ? "CSV" : "XLSX"}</Badge>
              {report.enabled ? <Badge tone="brand">Report image</Badge> : null}
              <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
                {rowCount !== null ? (
                  plural(rowCount, "row")
                ) : !hasData ? (
                  "Upload a file to export"
                ) : loading ? (
                  <>
                    <Spinner className="size-3.5" label="Counting rows" />
                    Counting rows
                  </>
                ) : (
                  "Row count unavailable"
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <Button variant="primary" icon={Download} loading={building} disabled={!hasData} onClick={handleDownload}>
            {building ? "Building" : "Download"}
          </Button>
          <p className="min-h-4 text-xs text-muted" role="status" aria-live="polite">
            {progress ? (
              [progress.message || progress.phase, Number.isFinite(progress.percent) ? `${Math.round(progress.percent)}%` : ""]
                .filter(Boolean)
                .join(" ")
            ) : download.status === "done" ? (
              <span className="inline-flex items-center gap-1">
                <CircleCheck className="size-3.5 text-brand" aria-hidden="true" />
                Downloaded
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {download.status === "error" ? (
        <Notice
          tone="error"
          title="This file could not be built"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} className="max-sm:h-10" onClick={handleDownload}>
              Try again
            </Button>
          }
        >
          {download.error}
        </Notice>
      ) : null}

      {snapshotError && !report.enabled ? (
        <p className="text-sm text-muted">The row count could not be read: {snapshotError}</p>
      ) : null}

      <IssueList issues={issues} />

      {report.enabled ? <ReportImagePanel output={output} snapshot={snapshot} /> : null}
    </Card>
  );
}
