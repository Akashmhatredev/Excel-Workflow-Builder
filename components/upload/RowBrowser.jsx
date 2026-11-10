"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useState } from "react";
import DataTable from "@/components/DataTable";
import { formatCount } from "@/components/upload/format";
import { Button, IconButton, Notice } from "@/components/ui";
import { toast } from "@/lib/toast";
import { getRows } from "@/lib/workerClient";

const PAGE_SIZE = 200;
const EMPTY = [];

/**
 * Pages through every row of the loaded table. Rows come from the worker one page
 * at a time, so the full dataset never reaches the UI thread.
 * Mount it with key={dataVersion} so a new table starts again from the first page.
 */
export default function RowBrowser({ columns, total }) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(null); // { offset, attempt, rows, total, error }

  useEffect(() => {
    let cancelled = false;
    getRows({ offset, limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setPage({ offset, attempt, rows: result.rows || EMPTY, total: result.total, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error.message || "These rows could not be loaded.";
        setPage({ offset, attempt, rows: EMPTY, total: null, error: message });
        toast.error("Could not load the rows", { description: message });
      });
    return () => {
      cancelled = true;
    };
  }, [offset, attempt]);

  const fresh = Boolean(page) && page.offset === offset && page.attempt === attempt;
  const loading = !fresh;
  const error = fresh ? page.error : null;
  const rows = page ? page.rows : EMPTY; // the previous page stays visible while the next one loads
  const shownOffset = page ? page.offset : 0;
  const totalRows = page && Number.isFinite(page.total) ? page.total : total;
  const lastOffset = Math.max(0, Math.floor((totalRows - 1) / PAGE_SIZE) * PAGE_SIZE);
  const from = totalRows ? Math.min(offset + 1, totalRows) : 0;
  const to = Math.min(offset + PAGE_SIZE, totalRows);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Notice tone="error" title="Could not load these rows">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Notice>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          startIndex={shownOffset}
          loading={loading}
          maxHeight={520}
          caption={`Rows ${formatCount(from)} to ${formatCount(to)} of the loaded sheet`}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" role="status" aria-live="polite">
          Rows {formatCount(from)}–{formatCount(to)} of {formatCount(totalRows)}
        </p>
        <div className="flex items-center gap-1">
          <IconButton label="First page" icon={ChevronsLeft} variant="secondary" disabled={offset === 0} onClick={() => setOffset(0)} />
          <IconButton
            label="Previous page"
            icon={ChevronLeft}
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          />
          <IconButton
            label="Next page"
            icon={ChevronRight}
            variant="secondary"
            disabled={offset >= lastOffset}
            onClick={() => setOffset(Math.min(lastOffset, offset + PAGE_SIZE))}
          />
          <IconButton
            label="Last page"
            icon={ChevronsRight}
            variant="secondary"
            disabled={offset >= lastOffset}
            onClick={() => setOffset(lastOffset)}
          />
        </div>
      </div>
    </div>
  );
}
