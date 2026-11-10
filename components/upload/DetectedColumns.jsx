"use client";

import { Merge } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";

const TYPE_TONES = { text: "neutral", number: "info", date: "brand" };
const COLLAPSED_COUNT = 24;

/**
 * The columns found in the loaded table, each with its inferred type. Columns merged in
 * from the lookup file (`origin === 'lookup'`) carry a "lookup" badge.
 */
export default function DetectedColumns({ columns }) {
  const [showAll, setShowAll] = useState(false);
  if (!columns.length) return <p className="text-sm text-muted">No columns were found in this sheet.</p>;
  const visible = showAll ? columns : columns.slice(0, COLLAPSED_COUNT);
  const hidden = columns.length - visible.length;
  return (
    <div className="flex flex-col items-start gap-3">
      <ul className="flex flex-wrap gap-1.5">
        {visible.map((column, index) => (
          <li
            key={`${column.name}-${index}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface py-1 pr-1 pl-2 text-sm text-fg"
          >
            <span className="truncate" title={column.name}>
              {column.name}
            </span>
            {column.origin === "lookup" ? (
              <Badge tone="neutral" title="Merged in from the second file" className="border border-line-strong">
                <Merge className="size-3" aria-hidden="true" />
                lookup
              </Badge>
            ) : null}
            <Badge tone={TYPE_TONES[column.type] || "neutral"}>{column.type || "text"}</Badge>
          </li>
        ))}
      </ul>
      {columns.length > COLLAPSED_COUNT ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? "Show fewer columns" : `Show all ${columns.length} columns (${hidden} more)`}
        </Button>
      ) : null}
    </div>
  );
}
