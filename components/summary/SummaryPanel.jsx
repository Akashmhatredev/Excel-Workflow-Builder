"use client";

import { ChartColumn, Download, Table2, Upload } from "lucide-react";
import { useMemo } from "react";
import DataTable from "@/components/DataTable";
import PivotControls from "@/components/summary/PivotControls";
import { describePivot, resolvePivot, summaryFileName, toCsv } from "@/components/summary/pivot";
import { usePivot } from "@/components/summary/usePivot";
import { formatCount, plural } from "@/components/upload/format";
import { Button, EmptyState, Notice, Spinner } from "@/components/ui";
import { downloadText } from "@/lib/download";
import { logRun } from "@/lib/history";
import { toast } from "@/lib/toast";
import { selectHasData, useWorkflowStore } from "@/store/useWorkflowStore";

const EMPTY = [];

/**
 * The "Summary" tab of the Mapping result: a pivot of the workflow-level rows (after
 * mapping, filters and cleaning; before grouping), with totals and a CSV download.
 *
 *   settings          { rowKey, columnKey, valueKey, fn } (kept by the parent so they survive a tab switch)
 *   onSettingsChange  (patch) => void
 *   fields            [{ id, name }]
 *   types             { [fieldId]: type } from the preview
 */
export default function SummaryPanel({ settings, onSettingsChange, fields = EMPTY, types, onGoToUpload }) {
  const hasData = useWorkflowStore(selectHasData);
  const templateName = useWorkflowStore((state) => state.templateName);
  const resolved = useMemo(() => resolvePivot(settings, fields, types), [settings, fields, types]);
  const { rowKey, columnKey, valueKey, fn, ready } = resolved;
  const request = useMemo(() => (ready ? { rowKey, columnKey, valueKey, fn } : null), [ready, rowKey, columnKey, valueKey, fn]);
  const pivot = usePivot({ request });
  const title = describePivot(resolved, fields);

  if (!hasData) {
    return (
      <EmptyState
        icon={Upload}
        title="Upload a file to see a summary"
        description="Totals, counts and averages per value of a field, with the file's real rows."
        action={
          <Button variant="secondary" onClick={onGoToUpload}>
            Go to Upload
          </Button>
        }
      />
    );
  }
  if (!fields.length) {
    return <EmptyState icon={Table2} title="Nothing to summarise yet" description="Add a field to summarise its values." />;
  }

  const data = pivot.data;
  const columns = (data && data.columns) || EMPTY;
  const rows = (data && data.rows) || EMPTY;
  const groupsShown = Math.max(0, rows.length - 1);
  const totalGroups = data && Number.isFinite(data.totalRows) ? data.totalRows : groupsShown;
  const canDownload = Boolean(data) && rows.length > 0 && !pivot.loading;

  const download = () => {
    if (!canDownload) return;
    try {
      const fileName = summaryFileName(title);
      downloadText(toCsv(columns, rows), fileName, "text/csv;charset=utf-8");
      logRun({ kind: "file", templateName, fileName, outputs: [{ name: title, fileType: "csv", rowCount: groupsShown }] });
      toast.success("Summary downloaded", { description: fileName });
    } catch (error) {
      toast.error("Could not download the summary", { description: (error && error.message) || "Please try again." });
    }
  };

  let body;
  if (!ready) {
    body = <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-muted">Choose the field to calculate.</p>;
  } else if (pivot.error) {
    body = (
      <Notice tone="error" title="The summary could not be calculated">
        <p>{pivot.error}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={pivot.retry}>
          Try again
        </Button>
      </Notice>
    );
  } else if (!data) {
    body = (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Spinner label="Calculating the summary" />
        <span aria-hidden="true">Calculating the summary…</span>
      </div>
    );
  } else {
    body = (
      <DataTable
        columns={columns}
        rows={rows}
        loading={pivot.loading}
        rowNumbers={false}
        totalsRow
        totalsColumn={columns.length > 2}
        caption={`Summary: ${title}`}
        emptyMessage="No rows to summarise. Check the filters."
      />
    );
  }

  return (
    <div className="@container flex flex-col gap-4">
      <PivotControls value={resolved} onChange={onSettingsChange} fields={fields} types={types} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted" role="status" aria-live="polite">
          <ChartColumn className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-fg">{title}</span>
            {data && !pivot.error ? ` · ${plural(totalGroups, "group")}` : ""}
          </span>
        </p>
        <Button variant="secondary" size="sm" icon={Download} onClick={download} disabled={!canDownload}>
          Download as CSV
        </Button>
      </div>
      {data && !pivot.error && (groupsShown < totalGroups || data.truncatedColumns) ? (
        <Notice tone="info" title="Part of the summary is shown">
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {groupsShown < totalGroups ? (
              <li>
                The first {formatCount(groupsShown)} of {plural(totalGroups, "group")} are listed; the totals cover every row.
              </li>
            ) : null}
            {data.truncatedColumns ? <li>The column field has too many values, so only the first ones get a column.</li> : null}
          </ul>
          <p className="mt-1">The CSV download contains what is shown here.</p>
        </Notice>
      ) : null}
      {body}
    </div>
  );
}
