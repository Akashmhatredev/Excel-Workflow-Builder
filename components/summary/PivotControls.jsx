"use client";

import { Field, Select } from "@/components/ui";
import { AGGREGATIONS } from "@/lib/schema";

const FUNCTIONS = Object.entries(AGGREGATIONS);
const fieldLabel = (field) => field.name || "(unnamed field)";

/**
 * Pick what the summary shows (controlled):
 *   value     resolved settings { rowKey, columnKey, valueKey, fn } (see resolvePivot)
 *   onChange  (patch) => void
 *   fields    [{ id, name }]
 *   types     { [fieldId]: 'text' | 'number' | 'date' } from the preview, to pick a sensible value field
 */
export default function PivotControls({ value, onChange, fields, types = {} }) {
  const emit = (patch) => {
    if (onChange) onChange(patch);
  };
  const needsValue = value.fn !== "count" && !value.valueKey;

  const changeFunction = (fn) => {
    // Sum / average / min / max need a value field: start with the first number field.
    if (fn !== "count" && !value.valueKey) {
      const number = fields.find((field) => types[field.id] === "number" && field.id !== value.rowKey);
      emit({ fn, valueKey: number ? number.id : "" });
    } else {
      emit({ fn });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
      <Field label="Rows" hint="One row per value.">
        {(control) => (
          <Select
            {...control}
            value={value.rowKey}
            onChange={(event) => {
              const rowKey = event.target.value;
              emit(rowKey === value.columnKey ? { rowKey, columnKey: "" } : { rowKey });
            }}
          >
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {fieldLabel(field)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Columns" hint="Optional: one column per value.">
        {(control) => (
          <Select {...control} value={value.columnKey} onChange={(event) => emit({ columnKey: event.target.value })}>
            <option value="">None (one value column)</option>
            {fields
              .filter((field) => field.id !== value.rowKey)
              .map((field) => (
                <option key={field.id} value={field.id}>
                  {fieldLabel(field)}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Calculate">
        {(control) => (
          <Select {...control} value={value.fn} onChange={(event) => changeFunction(event.target.value)}>
            {FUNCTIONS.map(([fn, item]) => (
              <option key={fn} value={fn}>
                {item.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Of" error={needsValue ? "Choose the field to calculate." : undefined}>
        {(control) => (
          <Select {...control} value={value.valueKey} onChange={(event) => emit({ valueKey: event.target.value })}>
            <option value="">{value.fn === "count" ? "Rows" : "Choose a field…"}</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {fieldLabel(field)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
