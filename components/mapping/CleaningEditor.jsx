"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import FieldChecklist from "@/components/mapping/FieldChecklist";
import { describeCleaningStats } from "@/components/mapping/cleaning";
import { Field, Input, Segmented, Switch } from "@/components/ui";
import { createCleaning, FILL_MODES, isCleaningActive } from "@/lib/schema";

const EMPTY = [];
const DEFAULT_CLEANING = createCleaning();
const FILL_OPTIONS = Object.entries(FILL_MODES).map(([value, mode]) => ({ value, label: mode.label }));
const COMPARE_OPTIONS = [
  { value: "row", label: "Whole row" },
  { value: "fields", label: "Chosen fields" },
];
const SCOPE_OPTIONS = [
  { value: "all", label: "Every field" },
  { value: "fields", label: "Chosen fields" },
];

function Options({ children }) {
  return <div className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-3 sm:pl-4">{children}</div>;
}

function Choice({ label, options, value, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg" aria-hidden="true">
        {label}
      </span>
      <Segmented label={label} options={options} value={value} onChange={onChange} size="sm" className="max-w-full flex-wrap self-start" />
    </div>
  );
}

/**
 * CleaningEditor (controlled): edits a Cleaning (lib/schema.js).
 *
 *   value     Cleaning { trimText, removeEmptyRows, removeDuplicates{ enabled, keys }, fillBlanks{ enabled, mode, value, fieldIds } }
 *   onChange  (patch) => void   a partial Cleaning, as the store's setCleaning expects
 *   fields    [{ id, name }]
 *   stats     runPreview's { emptyRowsRemoved, duplicatesRemoved, blanksFilled } or null
 *   hasData   a file is loaded (stats can be shown)
 *   loading   the preview is recalculating
 *
 * "Chosen fields" with nothing ticked yet behaves like "Whole row" / "Every field" (an empty
 * list means all), so that choice is kept locally until a field is ticked.
 */
export default function CleaningEditor({ value, onChange, fields = EMPTY, stats = null, hasData = false, loading = false }) {
  const cleaning = value && typeof value === "object" ? value : DEFAULT_CLEANING;
  const duplicates = cleaning.removeDuplicates || DEFAULT_CLEANING.removeDuplicates;
  const blanks = cleaning.fillBlanks || DEFAULT_CLEANING.fillBlanks;
  const keys = Array.isArray(duplicates.keys) ? duplicates.keys : EMPTY;
  const fillIds = Array.isArray(blanks.fieldIds) ? blanks.fieldIds : EMPTY;
  const [compareChoice, setCompareChoice] = useState(null);
  const [scopeChoice, setScopeChoice] = useState(null);

  // A non-empty list always means "chosen fields"; an empty one means "all" unless the user just picked "chosen".
  const compare = keys.length ? "fields" : compareChoice || "row";
  const scope = fillIds.length ? "fields" : scopeChoice || "all";
  const emit = (patch) => {
    if (onChange) onChange(patch);
  };

  const active = isCleaningActive(cleaning);
  const summary = describeCleaningStats(stats);
  let result = null;
  if (active && !hasData) result = "Upload a file to see what cleaning changes.";
  else if (active && stats) result = summary ? `In the whole result: ${summary}.` : "Nothing needed cleaning in the current result.";
  else if (active && loading) result = "Checking the rows…";

  return (
    <div className="flex flex-col gap-4">
      <Switch
        label="Trim spaces"
        description="Remove spaces at the start and end of text values and collapse repeated spaces."
        checked={Boolean(cleaning.trimText)}
        onChange={(trimText) => emit({ trimText })}
      />
      <Switch
        label="Remove empty rows"
        description="Drop rows where every field is empty."
        checked={Boolean(cleaning.removeEmptyRows)}
        onChange={(removeEmptyRows) => emit({ removeEmptyRows })}
      />

      <div>
        <Switch
          label="Remove duplicate rows"
          description="Keep the first row of each set of duplicates."
          checked={Boolean(duplicates.enabled)}
          onChange={(enabled) => emit({ removeDuplicates: { enabled } })}
        />
        {duplicates.enabled ? (
          <Options>
            <Choice
              label="Rows are duplicates when they match on"
              options={COMPARE_OPTIONS}
              value={compare}
              onChange={(next) => {
                setCompareChoice(next);
                if (next === "row" && keys.length) emit({ removeDuplicates: { keys: [] } });
              }}
            />
            {compare === "fields" ? (
              <FieldChecklist
                legend="Fields to compare"
                hint={keys.length ? undefined : "Until a field is ticked, the whole row is compared."}
                fields={fields}
                value={keys}
                onChange={(next) => emit({ removeDuplicates: { keys: next } })}
              />
            ) : null}
          </Options>
        ) : null}
      </div>

      <div>
        <Switch
          label="Fill blank cells"
          description="Replace empty values with a fixed value or the value from the row above."
          checked={Boolean(blanks.enabled)}
          onChange={(enabled) => emit({ fillBlanks: { enabled } })}
        />
        {blanks.enabled ? (
          <Options>
            <Choice
              label="Fill with"
              options={FILL_OPTIONS}
              value={FILL_MODES[blanks.mode] ? blanks.mode : "value"}
              onChange={(mode) => emit({ fillBlanks: { mode } })}
            />
            {blanks.mode !== "previous" ? (
              <Field label="Value to fill in" hint="Leave it empty to keep the cells blank.">
                {(control) => (
                  <Input
                    {...control}
                    value={blanks.value == null ? "" : String(blanks.value)}
                    placeholder="e.g. N/A or 0"
                    onChange={(event) => emit({ fillBlanks: { value: event.target.value } })}
                  />
                )}
              </Field>
            ) : null}
            <Choice
              label="Fill blanks in"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={(next) => {
                setScopeChoice(next);
                if (next === "all" && fillIds.length) emit({ fillBlanks: { fieldIds: [] } });
              }}
            />
            {scope === "fields" ? (
              <FieldChecklist
                legend="Fields to fill"
                hint={fillIds.length ? undefined : "Until a field is ticked, every field is filled."}
                fields={fields}
                value={fillIds}
                onChange={(next) => emit({ fillBlanks: { fieldIds: next } })}
              />
            ) : null}
          </Options>
        ) : null}
      </div>

      <div role="status" aria-live="polite">
        {result ? (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>{result}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
