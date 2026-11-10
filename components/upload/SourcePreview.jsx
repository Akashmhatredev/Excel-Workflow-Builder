"use client";

import { Rows3, TableProperties } from "lucide-react";
import { useState } from "react";
import DataTable from "@/components/DataTable";
import RowBrowser from "@/components/upload/RowBrowser";
import { formatCount, plural } from "@/components/upload/format";
import { Button, Card, SectionHeader } from "@/components/ui";
import { useWorkflowStore } from "@/store/useWorkflowStore";

/** The first rows of the loaded table, with an optional pager over every row. */
export default function SourcePreview() {
  const columns = useWorkflowStore((state) => state.columns);
  const previewRows = useWorkflowStore((state) => state.previewRows);
  const rowCount = useWorkflowStore((state) => state.rowCount);
  const dataVersion = useWorkflowStore((state) => state.dataVersion);
  const reloading = useWorkflowStore((state) => state.status === "loading");
  const [browseAll, setBrowseAll] = useState(false);

  const canBrowse = rowCount > previewRows.length;
  const browsing = browseAll && canBrowse && !reloading;
  const description = browsing
    ? `All ${plural(rowCount, "row")}, one page at a time.`
    : canBrowse
      ? `The first ${formatCount(previewRows.length)} of ${plural(rowCount, "row")}, exactly as they were read.`
      : `All ${plural(rowCount, "row")}, exactly as they were read.`;

  return (
    <Card as="section" className="flex flex-col gap-4 p-4 sm:p-5">
      <SectionHeader
        title="Preview"
        description={description}
        actions={
          canBrowse ? (
            <Button
              variant="secondary"
              size="sm"
              icon={browsing ? TableProperties : Rows3}
              disabled={reloading}
              onClick={() => setBrowseAll(!browsing)}
            >
              {browsing ? "Show the first rows" : "Browse all rows"}
            </Button>
          ) : null
        }
      />
      {browsing ? (
        <RowBrowser key={dataVersion} columns={columns} total={rowCount} />
      ) : (
        <DataTable
          columns={columns}
          rows={previewRows}
          loading={reloading}
          caption="Preview of the loaded sheet"
          emptyMessage="This sheet has no data rows below the header row."
        />
      )}
    </Card>
  );
}
