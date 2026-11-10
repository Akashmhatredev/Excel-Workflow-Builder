"use client";

import { useMemo, useState } from "react";
import { plural } from "@/components/upload/format";
import { Button, Checkbox } from "@/components/ui";
import { pickSheetNames } from "@/lib/schema";
import { selectIsBusy, useWorkflowStore } from "@/store/useWorkflowStore";

function describe(sheet) {
  if (!sheet.rowCount) return "Empty";
  return `${plural(sheet.rowCount, "row")} · ${plural(sheet.colCount, "column")}`;
}

/**
 * Which sheet(s) of the workbook to read. A workbook with one sheet just names it;
 * several sheets become checkboxes that are applied together with one click, so
 * switching from one sheet to another costs a single reload.
 */
export default function SheetPicker() {
  const sheets = useWorkflowStore((state) => state.sheets);
  const sheetNames = useWorkflowStore((state) => state.definition.source.sheetNames);
  const failed = useWorkflowStore((state) => state.status === "error");
  const busy = useWorkflowStore(selectIsBusy);
  const selectSheets = useWorkflowStore((state) => state.selectSheets);
  // null = showing the sheets in use; a list = an edited selection that is not applied yet
  const [draft, setDraft] = useState(null);

  // The same rule the store uses to decide which sheets to read.
  const applied = useMemo(() => pickSheetNames(sheets, sheetNames), [sheets, sheetNames]);

  if (!sheets.length) return null;

  if (sheets.length === 1) {
    return (
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">Sheet</p>
        <p className="mt-1.5 text-sm text-muted">
          <span className="font-medium text-fg">{sheets[0].name}</span> · {describe(sheets[0])}
        </p>
      </div>
    );
  }

  const selected = draft || applied;
  const selectedSet = new Set(selected);
  const changed = selected.length !== applied.length || applied.some((name) => !selectedSet.has(name));
  const canApply = !busy && selected.length > 0 && (changed || failed);

  const toggle = (name, checked) => {
    const next = new Set(selected);
    if (checked) next.add(name);
    else next.delete(name);
    // keep workbook order so stacked sheets always come out the same way
    setDraft(sheets.filter((sheet) => next.has(sheet.name)).map((sheet) => sheet.name));
  };

  const apply = async () => {
    const ok = await selectSheets(selected);
    if (ok) setDraft(null);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-fg">Sheets to use</legend>
      <p className="mt-0.5 text-xs text-muted">
        Several sheets are stacked into one table by column name, with a “Source Sheet” column added.
      </p>
      <div className="mt-2.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {sheets.map((sheet) => (
          <Checkbox
            key={sheet.name}
            label={sheet.name}
            description={describe(sheet)}
            checked={selectedSet.has(sheet.name)}
            disabled={busy}
            onChange={(checked) => toggle(sheet.name, checked)}
            className="min-h-10 min-w-0 break-words"
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" size="sm" onClick={apply} disabled={!canApply} loading={busy && draft !== null}>
          {selected.length === 1 ? "Use selected sheet" : "Use selected sheets"}
        </Button>
        {changed && !busy ? (
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Reset
          </Button>
        ) : null}
        <p className="text-xs text-muted" role="status">
          {selected.length === 0 ? "Select at least one sheet." : changed ? "Selection not applied yet." : ""}
        </p>
      </div>
    </fieldset>
  );
}
