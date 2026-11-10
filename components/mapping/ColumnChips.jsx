"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import { normalizeName } from "@/lib/schema";

const SEARCH_FROM = 12;

/** Click-to-insert list of source columns. onInsert(columnName) adds "{Column Name}" to the template or formula. */
export default function ColumnChips({ columns, onInsert, label = "Insert a column" }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = normalizeName(query);
    return needle ? columns.filter((column) => normalizeName(column.name).includes(needle)) : columns;
  }, [columns, query]);

  if (!columns.length) {
    return <p className="text-xs text-muted">No source columns yet. Upload a file to insert its columns.</p>;
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {columns.length > SEARCH_FROM ? (
          <div className="w-44">
            <Input
              type="search"
              aria-label="Filter the column list"
              placeholder="Filter columns"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8!"
            />
          </div>
        ) : null}
      </div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
        {visible.map((column, index) => (
          <Button
            key={`${column.name}-${index}`}
            variant="secondary"
            size="sm"
            title={`Insert {${column.name}}`}
            aria-label={`Insert column ${column.name}`}
            onClick={() => onInsert(column.name)}
            className="h-10! max-w-full shrink! px-2! text-xs! font-normal! sm:h-7!"
          >
            <span className="truncate">{column.name}</span>
          </Button>
        ))}
        {!visible.length ? <span className="text-xs text-muted">No column matches “{query}”.</span> : null}
      </div>
    </div>
  );
}
