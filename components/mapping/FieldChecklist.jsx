"use client";

import { Checkbox } from "@/components/ui";

const EMPTY = [];

/**
 * A checklist of mapped fields (controlled). `value` is the list of chosen field ids, kept in
 * field order. Ids of deleted fields stay listed (as "Deleted field") until they are unticked,
 * so nothing disappears silently.
 *
 *   { legend, hint?, fields: [{ id, name }], value: string[], onChange(next: string[]) }
 */
export default function FieldChecklist({ legend, hint, fields = EMPTY, value = EMPTY, onChange }) {
  const chosen = Array.isArray(value) ? value : EMPTY;
  const known = new Set(fields.map((field) => field.id));
  const stale = chosen.filter((id) => !known.has(id));
  const selected = new Set(chosen);

  const toggle = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    const ordered = fields.map((field) => field.id).filter((fieldId) => next.has(fieldId));
    if (onChange) onChange([...ordered, ...stale.filter((staleId) => next.has(staleId))]);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-fg">{legend}</legend>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      {fields.length || stale.length ? (
        <div className="mt-2 grid max-h-56 grid-cols-1 gap-x-6 gap-y-2.5 overflow-y-auto p-0.5 sm:grid-cols-2">
          {fields.map((field) => (
            <Checkbox
              key={field.id}
              label={field.name || "(unnamed field)"}
              checked={selected.has(field.id)}
              onChange={(checked) => toggle(field.id, checked)}
              className="min-h-10 min-w-0 break-words sm:min-h-0"
            />
          ))}
          {stale.map((id) => (
            <Checkbox
              key={id}
              label="Deleted field"
              description="Untick to forget it."
              checked
              onChange={(checked) => toggle(id, checked)}
              className="min-h-10 min-w-0 sm:min-h-0"
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Add a field first.</p>
      )}
    </fieldset>
  );
}
