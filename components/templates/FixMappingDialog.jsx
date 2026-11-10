"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Field, Modal, Notice, Select } from "@/components/ui";
import { saveAlias } from "@/lib/aliases";
import { collectColumnRefs } from "@/lib/schema";
import { columnUsage } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The body of the dialog. Mounted fresh for every new set of missing columns
 * (see the `key` below), so its choices always start from the suggestions.
 */
function FixMappingForm({ formId, columnFix }) {
  const columns = useWorkflowStore((state) => state.columns);
  const definition = useWorkflowStore((state) => state.definition);
  const resolveColumnFix = useWorkflowStore((state) => state.resolveColumnFix);

  const missing = columnFix.missing;
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const suggestions = useMemo(() => {
    const available = new Set(columnNames);
    const out = {};
    for (const name of missing) {
      const suggestion = columnFix.suggestions ? columnFix.suggestions[name] : null;
      out[name] = suggestion && available.has(suggestion) ? suggestion : "";
    }
    return out;
  }, [missing, columnFix.suggestions, columnNames]);
  const usage = useMemo(() => {
    const out = {};
    for (const name of missing) out[name] = columnUsage(definition, name);
    return out;
  }, [missing, definition]);
  const nothingMatched = useMemo(() => {
    const expected = collectColumnRefs(definition).length;
    return missing.length > 1 && missing.length >= expected;
  }, [missing, definition]);

  const [choices, setChoices] = useState({}); // only what the user changed; the rest follows the suggestions
  const [remember, setRemember] = useState(true);

  const chosen = (name) => (name in choices ? choices[name] : suggestions[name]);
  const chosenCount = missing.filter((name) => chosen(name)).length;

  const onSubmit = (event) => {
    event.preventDefault();
    const map = {};
    for (const name of missing) map[name] = chosen(name) || "";
    if (remember) {
      for (const name of missing) {
        if (map[name]) saveAlias(name, map[name]);
      }
    }
    resolveColumnFix(map);
    const left = missing.length - chosenCount;
    if (chosenCount) {
      toast.success(`${plural(chosenCount, "column")} matched`, {
        description: left ? `${plural(left, "column")} left unmapped. You can fix them in the Mapping step.` : undefined,
      });
    } else {
      toast.info("Nothing was changed", { description: "Columns that are still missing are flagged in the Mapping step." });
    }
  };

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        This workflow expects {missing.length === 1 ? "a column that is" : "columns that are"} not in the file you loaded. Matching
        already ignores upper and lower case and extra spaces, so {missing.length === 1 ? "this header was" : "these headers were"}{" "}
        probably renamed or removed. Choose the column to use instead.
      </p>

      {nothingMatched ? (
        <Notice tone="warning" icon={TriangleAlert} title="None of the expected columns were found">
          Check that you picked the right file, sheet and header row before matching the columns one by one.
        </Notice>
      ) : null}

      <ul className="flex flex-col gap-3">
        {missing.map((name) => {
          const value = chosen(name);
          const usedBy = usage[name] || [];
          const isSuggested = Boolean(suggestions[name]) && value === suggestions[name];
          return (
            <li
              key={name}
              className="grid gap-x-4 gap-y-2 rounded-lg border border-line bg-surface-2/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-medium break-words text-fg">{name}</p>
                <p className="mt-0.5 text-xs break-words text-muted">
                  {usedBy.length ? `Used by: ${usedBy.join(", ")}` : "Not used by any field or filter"}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Field label={`Column to use for "${name}"`} hideLabel>
                  {(props) => (
                    <Select
                      {...props}
                      value={value}
                      onChange={(event) => setChoices((current) => ({ ...current, [name]: event.target.value }))}
                    >
                      <option value="">Leave unmapped</option>
                      {columnNames.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {isSuggested ? (
                  <Badge tone="brand" className="self-start">
                    Suggested match
                  </Badge>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Checkbox
        label="Remember these matches for next time"
        description="The next file with the same headers is matched automatically, in every workflow."
        checked={remember}
        onChange={setRemember}
      />
    </form>
  );
}

/**
 * FixMappingDialog (owner: Agent D). No props. Shown while useWorkflowStore.columnFix
 * is set: the loaded file does not have every column the workflow refers to.
 * "Apply" remaps the definition to the chosen columns; "Skip for now" (or closing
 * the dialog) leaves it as it is.
 */
export default function FixMappingDialog() {
  const formId = useId();
  const columnFix = useWorkflowStore((state) => state.columnFix);
  const dismissColumnFix = useWorkflowStore((state) => state.dismissColumnFix);
  const missing = columnFix && Array.isArray(columnFix.missing) ? columnFix.missing : [];
  const open = missing.length > 0;

  return (
    <Modal
      open={open}
      onClose={dismissColumnFix}
      title="Fix mapping"
      description={open ? `${plural(missing.length, "column")} could not be found in this file.` : undefined}
      size="lg"
      footer={
        <>
          <Button onClick={dismissColumnFix}>Skip for now</Button>
          <Button variant="primary" type="submit" form={formId}>
            Apply
          </Button>
        </>
      }
    >
      {open ? <FixMappingForm key={missing.join("\u0000")} formId={formId} columnFix={columnFix} /> : null}
    </Modal>
  );
}
