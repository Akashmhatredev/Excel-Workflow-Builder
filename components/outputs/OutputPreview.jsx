"use client";

import { Upload } from "lucide-react";
import DataTable from "@/components/DataTable";
import { Button, Card, EmptyState, Notice, SectionHeader, Spinner } from "@/components/ui";
import { formatCount, plural } from "./helpers";
import IssueList from "./IssueList";

/**
 * Preview of one output: its first rows in a DataTable, a row-count caption and the output's issues.
 * `preview` is the usePreview() result; `rows` is the slice of it to show in the table.
 */
export default function OutputPreview({ output, preview, rows, issues, columnIssues, onGoToUpload }) {
  const { data, loading, error, hasData } = preview;

  let caption = "The first rows this output will contain.";
  if (hasData && data) {
    const shown = rows.length;
    const total = data.totalRows;
    caption =
      total === 0
        ? "This output has no rows."
        : shown < total
          ? `Showing the first ${formatCount(shown)} of ${plural(total, "row")}.`
          : `Showing all ${plural(total, "row")}.`;
    if (Number.isFinite(data.sourceRows) && data.sourceRows !== total) {
      caption += ` The source has ${plural(data.sourceRows, "row")}.`;
    }
  }

  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader
        as="h4"
        title="Preview"
        description={
          <span role="status" aria-live="polite">
            {caption}
          </span>
        }
        actions={hasData && loading ? <Spinner label="Updating the preview" /> : null}
      />

      <IssueList issues={issues} className="mt-4" />

      <div className="mt-4 min-w-0">
        {!hasData ? (
          <EmptyState
            icon={Upload}
            title="Upload a file to preview"
            description="You can keep editing this output without a file. The preview appears once a file is loaded."
            action={
              <Button variant="secondary" icon={Upload} onClick={onGoToUpload}>
                Go to Upload
              </Button>
            }
            className="rounded-lg border border-dashed border-line-strong"
          />
        ) : error ? (
          <Notice tone="error" title="The preview could not be built">
            {error}
          </Notice>
        ) : data ? (
          <DataTable
            columns={data.columns}
            rows={rows}
            maxHeight={360}
            loading={loading}
            columnIssues={columnIssues}
            caption={`Preview of ${output.name.trim() || "this output"}`}
            emptyMessage="No rows match this output's filters."
          />
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-line py-10 text-sm text-muted">
            <Spinner label="Building the preview" />
            Building the preview
          </div>
        )}
      </div>
    </Card>
  );
}
