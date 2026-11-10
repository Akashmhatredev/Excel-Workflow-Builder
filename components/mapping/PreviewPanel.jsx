"use client";

import { Table2, Upload } from "lucide-react";
import DataTable from "@/components/DataTable";
import { formatCount } from "@/components/upload/format";
import { Button, Card, EmptyState, Notice, SectionHeader, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

function describe(data) {
  const shown = data.rows.length;
  const total = Number.isFinite(data.totalRows) ? data.totalRows : shown;
  const text = `Showing ${formatCount(shown)} of ${formatCount(total)} ${total === 1 ? "row" : "rows"}`;
  if (!Number.isFinite(data.sourceRows)) return text;
  return `${text} (from ${formatCount(data.sourceRows)} source ${data.sourceRows === 1 ? "row" : "rows"})`;
}

/**
 * Live preview of the workflow-level result.
 * `preview` is the value returned by usePreview({ outputId: null }).
 */
export default function PreviewPanel({ preview, fieldCount, columnIssues, onGoToUpload, className }) {
  const { data, loading, error, hasData } = preview;
  const summary = data ? describe(data) : "The first rows of the result, recalculated as you edit.";

  let body;
  if (!hasData) {
    body = (
      <EmptyState
        icon={Upload}
        title="Upload a file to see a live preview"
        description="You can keep editing the mapping without one. The preview appears as soon as a file is loaded."
        action={
          <Button variant="secondary" onClick={onGoToUpload}>
            Go to Upload
          </Button>
        }
      />
    );
  } else if (!fieldCount) {
    body = <EmptyState icon={Table2} title="Nothing to preview yet" description="Add a field to see the first rows of the result." />;
  } else if (!data && error) {
    body = (
      <Notice tone="error" title="The preview could not be calculated">
        {error}
      </Notice>
    );
  } else if (!data) {
    body = (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Spinner label="Calculating the preview" />
        <span aria-hidden="true">Calculating the preview…</span>
      </div>
    );
  } else {
    body = (
      <DataTable
        columns={data.columns}
        rows={data.rows}
        loading={loading}
        columnIssues={columnIssues}
        caption={`Live preview. ${summary}`}
        emptyMessage={data.columns.length ? "No rows match the current filters." : "The result has no columns yet."}
      />
    );
  }

  return (
    <Card as="section" className={cn("flex min-w-0 flex-col gap-4 p-4 sm:p-5", className)}>
      <SectionHeader title="Live preview" description={summary} />
      {body}
    </Card>
  );
}
