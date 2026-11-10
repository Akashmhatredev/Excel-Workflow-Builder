"use client";

import FieldRow from "@/components/mapping/FieldRow";
import { NO_ISSUES } from "@/components/mapping/issues";

/**
 * The ordered list of output fields. Rows are memoized and collapsed by default,
 * so long lists (40+ fields) stay quick to scroll and edit. The list is a size
 * container: rows switch to a one-line layout when it is wide enough.
 */
export default function FieldList({ fields, columns, issuesByField, expanded, lastAddedId, onToggle, onAdded }) {
  return (
    <ol className="@container flex flex-col gap-2">
      {fields.map((field, index) => (
        <FieldRow
          key={field.id}
          field={field}
          index={index}
          count={fields.length}
          columns={columns}
          issues={issuesByField.get(field.id) || NO_ISSUES}
          expanded={expanded.has(field.id)}
          autoFocus={field.id === lastAddedId}
          onToggle={onToggle}
          onAdded={onAdded}
        />
      ))}
    </ol>
  );
}
