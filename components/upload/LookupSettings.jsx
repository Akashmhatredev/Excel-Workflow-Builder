"use client";

import { CheckCircle2, Loader2, Merge, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { columnSelection, describeLookupInfo, suggestKeyPair, toggleColumn } from "@/components/upload/lookup";
import { plural } from "@/components/upload/format";
import { Badge, Button, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { isLookupConfigured } from "@/lib/schema";
import { useWorkflowStore } from "@/store/useWorkflowStore";

/** Options for a column select, plus the current value when it is no longer in the list. */
function ColumnOptions({ columns, value, placeholder }) {
  const known = !value || columns.some((column) => column.name === value);
  return (
    <>
      <option value="">{placeholder}</option>
      {!known ? <option value={value}>{value} (not found)</option> : null}
      {columns.map((column, index) => (
        <option key={`${column.name}-${index}`} value={column.name}>
          {column.name}
        </option>
      ))}
    </>
  );
}

/**
 * Settings of a loaded lookup file: sheet, header row, the key pair and the columns to
 * bring in, then what the merge did (lookupInfo). Every change goes through setLookup,
 * which re-reads what it has to and re-joins the main table.
 *
 * The key pair is only sent once both columns are chosen (each change re-reads the main
 * table); until then the half-chosen pair is a local draft.
 */
export default function LookupSettings() {
  const lookup = useWorkflowStore((state) => state.definition.lookup);
  const allColumns = useWorkflowStore((state) => state.columns);
  const lookupSheets = useWorkflowStore((state) => state.lookupSheets);
  const lookupColumns = useWorkflowStore((state) => state.lookupColumns);
  const lookupInfo = useWorkflowStore((state) => state.lookupInfo);
  const mainStatus = useWorkflowStore((state) => state.status);
  const setLookup = useWorkflowStore((state) => state.setLookup);

  const [pending, setPending] = useState(0);
  const [pairDraft, setPairDraft] = useState(null); // { matchColumn, lookupColumn } while only one is chosen
  const [headerDraft, setHeaderDraft] = useState(null); // header row text being edited

  const mainColumns = useMemo(() => allColumns.filter((column) => column.origin !== "lookup"), [allColumns]);
  const pair = pairDraft || { matchColumn: lookup.matchColumn, lookupColumn: lookup.lookupColumn };
  const configured = isLookupConfigured(lookup);
  const busy = pending > 0 || mainStatus === "loading" || mainStatus === "parsing";
  const keyName = pair.lookupColumn || lookup.lookupColumn;
  const selection = useMemo(() => columnSelection(lookupColumns, keyName, lookup.columns), [lookupColumns, keyName, lookup.columns]);
  const suggestion = useMemo(
    () => (pair.matchColumn || pair.lookupColumn ? null : suggestKeyPair(mainColumns, lookupColumns)),
    [pair.matchColumn, pair.lookupColumn, mainColumns, lookupColumns],
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

  const changePair = (key, value) => {
    const next = { ...pair, [key]: value };
    if ((next.matchColumn && next.lookupColumn) || configured) {
      setPairDraft(null);
      apply(next);
    } else {
      setPairDraft(next);
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
      setPairDraft(null);
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
                  setPairDraft(null);
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

      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-fg">Match rows</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
          <span>where</span>
          <Select
            aria-label="Column of this file"
            value={pair.matchColumn}
            invalid={Boolean(pair.matchColumn) && !mainColumns.some((column) => column.name === pair.matchColumn)}
            onChange={(event) => changePair("matchColumn", event.target.value)}
          >
            <ColumnOptions columns={mainColumns} value={pair.matchColumn} placeholder="Column of this file…" />
          </Select>
          <span>equals</span>
          <Select
            aria-label="Column of the second file"
            value={pair.lookupColumn}
            invalid={Boolean(pair.lookupColumn) && !lookupColumns.some((column) => column.name === pair.lookupColumn)}
            onChange={(event) => changePair("lookupColumn", event.target.value)}
          >
            <ColumnOptions columns={lookupColumns} value={pair.lookupColumn} placeholder="Column of the second file…" />
          </Select>
        </div>
        <p className="mt-1.5 text-xs text-muted">Matching ignores upper/lower case and spaces at the ends.</p>
        {suggestion ? (
          <Button variant="soft" size="sm" icon={Wand2} className="mt-2" onClick={() => {
              setPairDraft(null);
              apply(suggestion);
            }}
          >
            Match on “{suggestion.matchColumn}”
            {suggestion.lookupColumn !== suggestion.matchColumn ? ` = “${suggestion.lookupColumn}”` : ""}
          </Button>
        ) : null}
        {pairDraft && !configured ? (
          <p className="mt-1.5 text-xs text-warning">Choose both columns to merge the files.</p>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-fg">Columns to bring in</legend>
        <p className="mt-0.5 text-xs text-muted">
          {selection.all
            ? `All ${plural(selection.candidates.length, "column")} of the second file${keyName ? ", except the key" : ""}.`
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
        <p className="text-sm text-muted">Choose the two key columns above to merge the files.</p>
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
          The table was loaded without the second file&apos;s columns. Check the two key columns.
        </Notice>
      )}
    </div>
  );
}
