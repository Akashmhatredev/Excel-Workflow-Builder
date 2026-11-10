"use client";

import { Table2, Upload } from "lucide-react";
import { useMemo } from "react";
import DataTable from "@/components/DataTable";
import { formatCount, plural } from "@/components/upload/format";
import { Button, EmptyState, Notice, Spinner, Switch } from "@/components/ui";

const EMPTY = [];
// Same hatching DataTable uses for blank cells.
const HATCH = { backgroundImage: "repeating-linear-gradient(135deg, var(--line-strong) 0 1px, transparent 1px 7px)" };

function describePreview(data) {
  const shown = data.rows.length;
  const total = Number.isFinite(data.totalRows) ? data.totalRows : shown;
  const text = `Showing ${formatCount(shown)} of ${formatCount(total)} ${total === 1 ? "row" : "rows"}`;
  if (!Number.isFinite(data.sourceRows)) return text;
  return `${text} (from ${formatCount(data.sourceRows)} source ${data.sourceRows === 1 ? "row" : "rows"})`;
}

function countMarks(cellIssues) {
  let errors = 0;
  let blanks = 0;
  for (const mark of cellIssues) {
    if (!Array.isArray(mark)) continue;
    if (mark[2] === "error") errors += 1;
    else if (mark[2] === "blank") blanks += 1;
  }
  return { errors, blanks };
}

/** The highlight key: an error swatch with its corner marker and a hatched blank swatch, with counts. */
function HighlightLegend({ counts }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Highlight legend">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="relative inline-block size-4 shrink-0 overflow-hidden rounded-sm border border-danger/40 bg-danger-soft">
            <span className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-danger border-l-transparent" />
          </span>
          <span>
            <span className="font-medium text-fg">{plural(counts.errors, "error")}</span>: the value could not be calculated or does
            not fit the column type
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-sm border border-line-strong bg-surface" style={HATCH} />
          <span>
            <span className="font-medium text-fg">{plural(counts.blanks, "blank cell")}</span>
          </span>
        </li>
      </ul>
      <p>Counted in the rows shown.</p>
    </div>
  );
}

/**
 * The "Preview" tab of the Mapping result: the first rows of the workflow-level result.
 *   preview    usePreview({ outputId: null }) result
 *   highlight  show runPreview's cellIssues on the cells; onHighlightChange toggles it
 */
export default function PreviewPanel({ preview, fieldCount, columnIssues, highlight = false, onHighlightChange, onGoToUpload }) {
  const { data, loading, error, hasData } = preview;
  const cellIssues = (data && data.cellIssues) ?? EMPTY;
  const counts = useMemo(() => countMarks(cellIssues), [cellIssues]);
  const summary = data ? describePreview(data) : "The first rows of the result, recalculated as you edit.";

  if (!hasData) {
    return (
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
  }
  if (!fieldCount) {
    return <EmptyState icon={Table2} title="Nothing to preview yet" description="Add a field to see the first rows of the result." />;
  }
  if (!data && error) {
    return (
      <Notice tone="error" title="The preview could not be calculated">
        {error}
      </Notice>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Spinner label="Calculating the preview" />
        <span aria-hidden="true">Calculating the preview…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-sm text-muted" role="status" aria-live="polite">
          {summary}
        </p>
        <Switch label="Highlight problems" checked={highlight} onChange={onHighlightChange} className="shrink-0" />
      </div>
      {highlight ? <HighlightLegend counts={counts} /> : null}
      <DataTable
        columns={data.columns}
        rows={data.rows}
        loading={loading}
        columnIssues={columnIssues}
        cellMarks={highlight ? cellIssues : undefined}
        caption={`Live preview. ${summary}`}
        emptyMessage={data.columns.length ? "No rows match the current filters." : "The result has no columns yet."}
      />
    </div>
  );
}
