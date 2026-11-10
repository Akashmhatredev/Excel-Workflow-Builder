"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { selectIsBusy, useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * The 1-based row that holds the column names. The table is only reloaded when the
 * value is committed (blur, Enter or the Apply button), never on each keystroke.
 */
export default function HeaderRowField() {
  const headerRow = useWorkflowStore((state) => state.definition.source.headerRow);
  const failed = useWorkflowStore((state) => state.status === "error");
  const busy = useWorkflowStore(selectIsBusy);
  const setHeaderRow = useWorkflowStore((state) => state.setHeaderRow);
  const [draft, setDraft] = useState(null); // text being edited, or null to show the applied row
  const [tried, setTried] = useState(null); // last row that failed to load, so a blur does not retry it

  const text = draft === null ? String(headerRow) : draft;
  const row = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(row) && row >= 1;
  const canApply = !busy && valid && (row !== headerRow || failed);

  const commit = async (explicit) => {
    if (selectIsBusy(useWorkflowStore.getState())) return;
    if (!valid) {
      if (!explicit) setDraft(null);
      return;
    }
    const unchanged = row === headerRow;
    if (explicit ? unchanged && !failed : unchanged || row === tried) {
      if (unchanged) setDraft(null);
      return;
    }
    setTried(row);
    const ok = await setHeaderRow(row);
    if (ok) {
      setDraft(null);
      setTried(null);
    }
  };

  return (
    <Field
      label="Header row"
      hint="The row that holds the column names. Rows above it are skipped."
      error={draft !== null && !valid ? "Enter a whole number, 1 or higher." : undefined}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <div className="w-24 shrink-0">
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={text}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commit(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(true);
                }
              }}
            />
          </div>
          <Button variant="secondary" onClick={() => commit(true)} disabled={!canApply}>
            Apply
          </Button>
        </div>
      )}
    </Field>
  );
}
