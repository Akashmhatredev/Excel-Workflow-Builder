"use client";

import { CheckCircle2, KeyRound, Loader2, Merge } from "lucide-react";
import { useMemo, useState } from "react";
import KeyBuilder from "@/components/upload/KeyBuilder";
import { columnSelection, describeLookupInfo, toggleColumn } from "@/components/upload/lookup";
import { plural } from "@/components/upload/format";
import { Badge, Button, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { getLookupKeys, isLookupConfigured } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * Settings of a loaded lookup file: sheet, header row, the merge key (KeyBuilder: one or
 * several columns per side, a separator, optionally added as a column) and the columns to
 * bring in, then what the merge did (lookupInfo). Every change goes through setLookup,
 * which re-reads what it has to and re-joins the main table.
 */
export default function LookupSettings() {
  const lookup = useWorkflowStore((state) => state.definition.lookup);
  const allColumns = useWorkflowStore((state) => state.columns);
  const lookupSheets = useWorkflowStore((state) => state.lookupSheets);
  const lookupColumns = useWorkflowStore((state) => state.lookupColumns);
  const lookupInfo = useWorkflowStore((state) => state.lookupInfo);
  const previewRows = useWorkflowStore((state) => state.previewRows);
  const mainStatus = useWorkflowStore((state) => state.status);
  const setLookup = useWorkflowStore((state) => state.setLookup);

  const [pending, setPending] = useState(0);
  const [headerDraft, setHeaderDraft] = useState(null); // header row text being edited
  const [keyVersion, setKeyVersion] = useState(0); // remounts KeyBuilder (drops its draft) when the sheet changes

  // Columns of this file that can be key parts: not the ones the merge itself adds.
  const mainColumns = useMemo(
    () => allColumns.filter((column) => column.origin !== "lookup" && column.origin !== "key"),
    [allColumns],
  );
  const configured = isLookupConfigured(lookup);
  const busy = pending > 0 || mainStatus === "loading" || mainStatus === "parsing";
  const lookupKeyNames = getLookupKeys(lookup).lookup;
  const keyNamesText = lookupKeyNames.join("\u0000");
  const selection = useMemo(
    () => columnSelection(lookupColumns, keyNamesText ? keyNamesText.split("\u0000") : [], lookup.columns),
    [lookupColumns, keyNamesText, lookup.columns],
  );
  const summary = describeLookupInfo(lookupInfo);

  const apply = async (patch) => {
    setPending((count) => count + 1);
    try {
      await setLookup(patch);
    } finally {
      setPending((count) => count - 1);
    }
  };

  const headerText = headerDraft === null ? String(lookup.headerRow || 1) : headerDraft;
  const headerNumber = Number(headerText);
  const headerValid = headerText.trim() !== "" && Number.isInteger(headerNumber) && headerNumber >= 1;
  const commitHeader = () => {
    if (!headerValid) {
      setHeaderDraft(null);
      return;
    }
    setHeaderDraft(null);
    if (headerNumber !== (lookup.headerRow || 1)) {
      setKeyVersion((version) => version + 1);
      apply({ headerRow: headerNumber });
    }
  };

  const toggle = (name, checked) => {
    const columns = toggleColumn(selection, name, checked);
    if (columns) apply({ columns });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        {lookupSheets.length > 1 ? (
          <Field label="Sheet of the second file">
            {(control) => (
              <Select
                {...control}
                value={lookup.sheetName}
                onChange={(event) => {
                  setKeyVersion((version) => version + 1);
                  apply({ sheetName: event.target.value });
                }}
              >
                {lookupSheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({plural(sheet.rowCount, "row")})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Sheet of the second file</p>
            <p className="mt-1.5 truncate text-sm text-muted">{lookup.sheetName || (lookupSheets[0] && lookupSheets[0].name)}</p>
          </div>
        )}
        <Field
          label="Header row"
          hint="The row with the column names."
          error={headerDraft !== null && !headerValid ? "Enter a whole number, 1 or higher." : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={headerText}
              onChange={(event) => setHeaderDraft(event.target.value)}
              onBlur={commitHeader}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitHeader();
                }
              }}
            />
          )}
        </Field>
      </div>

      <KeyBuilder
        key={keyVersion}
        lookup={lookup}
        mainColumns={mainColumns}
        lookupColumns={lookupColumns}
        previewColumns={allColumns}
        previewRows={previewRows}
        onApply={apply}
      />

      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-fg">Columns to bring in</legend>
        <p className="mt-0.5 text-xs text-muted">
          {selection.all
            ? `All ${plural(selection.candidates.length, "column")} of the second file${lookupKeyNames.length ? ", except the key columns" : ""}.`
            : `${selection.selected.size} of ${plural(selection.candidates.length, "column")}.`}{" "}
          A name that already exists here gets “(lookup)” added.
        </p>
        {selection.candidates.length ? (
          <div className="mt-2.5 grid max-h-64 grid-cols-1 gap-x-6 gap-y-2.5 overflow-y-auto p-0.5 sm:grid-cols-2">
            {selection.candidates.map((name) => {
              const checked = selection.selected.has(name);
              const only = checked && selection.selected.size === 1;
              return (
                <Checkbox
                  key={name}
                  label={name}
                  checked={checked}
                  disabled={only}
                  title={only ? "At least one column has to be brought in" : undefined}
                  onChange={(next) => toggle(name, next)}
                  className="min-h-10 min-w-0 break-words sm:min-h-0"
                />
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">The second file has no other columns.</p>
        )}
        {!selection.all ? (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => apply({ columns: [] })}>
            Bring in every column
          </Button>
        ) : null}
      </fieldset>

      {!configured ? (
        <p className="text-sm text-muted">Choose the key columns of both files above to merge them.</p>
      ) : busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Merging the files…
        </p>
      ) : summary ? (
        <div role="status" className="rounded-lg border border-brand/30 bg-brand-soft px-3.5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-fg">
            <CheckCircle2 className="size-4 shrink-0 text-brand" aria-hidden="true" />
            {summary.headline}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
            <Badge tone={summary.unique.main ? "brand" : "warning"}>
              <KeyRound className="size-3" aria-hidden="true" />
              {summary.unique.main ? "Unique in this file" : "Repeats in this file"}
            </Badge>
            <Badge tone={summary.unique.lookup ? "brand" : "warning"}>
              <KeyRound className="size-3" aria-hidden="true" />
              {summary.unique.lookup ? "Unique in the second file" : "Repeats in the second file"}
            </Badge>
            {summary.keyColumn ? <Badge tone="info">Key column “{summary.keyColumn}” added</Badge> : null}
          </div>
          {summary.details.length ? (
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-10 text-muted">
              {summary.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          {summary.added.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
              <span className="text-xs text-muted">Added:</span>
              {summary.added.map((name) => (
                <Badge key={name} tone="neutral" className="border border-line-strong">
                  <Merge className="size-3" aria-hidden="true" />
                  {name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <Notice tone="warning" title="Nothing was merged">
          The table was loaded without the second file&apos;s columns. Check the key columns of both files.
        </Notice>
      )}
    </div>
  );
}
