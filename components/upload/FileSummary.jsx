"use client";

import { FileSpreadsheet, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes, plural } from "@/components/upload/format";
import { Button, Card } from "@/components/ui";

/** The loaded file at a glance, with "Replace file" and "Remove file". */
export default function FileSummary({ file, rowCount, columnCount, status, onReplace, onRemove }) {
  const details = [formatBytes(file.size)];
  if (status === "ready") details.push(`${plural(rowCount, "row")} × ${plural(columnCount, "column")}`);
  else if (status === "loading") details.push("Loading the sheet…");
  else if (status === "error") details.push("Not loaded");
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg">
        <FileSpreadsheet className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate font-medium text-fg" title={file.name}>
          {file.name}
        </p>
        <p className="text-sm text-muted" role="status">
          {details.filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={RefreshCw} onClick={onReplace}>
          Replace file
        </Button>
        <Button variant="dangerGhost" icon={Trash2} onClick={onRemove}>
          Remove file
        </Button>
      </div>
    </Card>
  );
}
