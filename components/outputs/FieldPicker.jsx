"use client";

import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, IconButton, Notice, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeFieldSelection, moveIncludedField, toggleField } from "./helpers";
import { useRestoreFocus } from "./hooks";

/**
 * "Fields to include": which mapped fields this output contains, and in which order.
 *
 * `fieldIds === null` means every field in Mapping order, and it stays null while that is what is
 * selected, so fields added later are included automatically. A grouped output ignores the
 * selection (it emits its group keys and aggregations), so the checklist is disabled then.
 */
export default function FieldPicker({ output, fields, grouped, resultColumns, onChange, onGoToMapping }) {
  const restoreFocus = useRestoreFocus();
  const selection = useMemo(() => describeFieldSelection(fields, output.fieldIds), [fields, output.fieldIds]);
  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const includedIndex = useMemo(
    () => new Map(selection.included.map((id, index) => [id, index])),
    [selection.included],
  );
  const count = selection.included.length;
  const focusKey = (fieldId, control) => `field:${output.id}:${fieldId}:${control}`;

  const move = (fieldId, direction) => {
    const first = direction < 0 ? "up" : "down";
    const second = direction < 0 ? "down" : "up";
    restoreFocus(focusKey(fieldId, first), focusKey(fieldId, second));
    onChange(moveIncludedField(fields, output.fieldIds, fieldId, direction));
  };

  const toggle = (fieldId, checked) => {
    restoreFocus(focusKey(fieldId, "check"));
    onChange(toggleField(fields, output.fieldIds, fieldId, checked));
  };

  return (
    <Card as="section" className="p-4 sm:p-5">
      <SectionHeader
        as="h4"
        title="Fields to include"
        description={
          grouped
            ? "Not used while this output is grouped."
            : selection.all && !selection.custom
              ? "All fields, in Mapping order. Fields you add later are included automatically."
              : `${count} of ${fields.length} fields, in the order shown.`
        }
        actions={
          fields.length && !grouped ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="max-sm:h-10"
                disabled={selection.all && !selection.custom}
                onClick={() => onChange(null)}
              >
                Select all
              </Button>
              <Button variant="ghost" size="sm" className="max-sm:h-10" disabled={count === 0} onClick={() => onChange([])}>
                Select none
              </Button>
            </>
          ) : null
        }
      />

      {grouped ? (
        <Notice tone="info" title="Grouped outputs contain the group keys and aggregations" className="mt-4">
          <p>Grouping replaces the field selection. This output will have these columns:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Columns of this output">
            {resultColumns.map((column) => (
              <li key={column.key}>
                <Badge tone={column.role === "key" ? "neutral" : "brand"}>{column.name || "Untitled"}</Badge>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {!fields.length ? (
        <EmptyState
          icon={Columns3}
          title="No fields yet"
          description="Fields are the columns of your outputs. Add them in the Mapping step."
          action={
            <Button variant="secondary" onClick={onGoToMapping}>
              Go to Mapping
            </Button>
          }
        />
      ) : (
        <fieldset disabled={grouped} className={cn("mt-4 min-w-0", grouped && "opacity-60")}>
          <legend className="sr-only">Fields to include in this output</legend>
          <ul className="flex max-h-96 flex-col overflow-y-auto rounded-lg border border-line">
            {selection.display.map((fieldId) => {
              const field = byId.get(fieldId);
              const position = includedIndex.get(fieldId);
              const included = position !== undefined;
              const name = field.name.trim() || "Untitled field";
              return (
                <li
                  key={fieldId}
                  className="flex min-h-11 items-center gap-1 border-b border-line py-0.5 pr-1 pl-3 last:border-b-0"
                >
                  <Checkbox
                    className="min-w-0 flex-1 py-2 [&_label]:min-w-0 [&_label]:break-words"
                    label={name}
                    checked={included}
                    data-focus-key={focusKey(fieldId, "check")}
                    onChange={(checked) => toggle(fieldId, checked)}
                  />
                  {included ? (
                    <span className="shrink-0 px-1 text-xs text-muted tabular-nums" aria-hidden="true">
                      {position + 1}
                    </span>
                  ) : null}
                  <IconButton
                    label={`Move ${name} earlier`}
                    icon={ArrowUp}
                    disabled={!included || position === 0}
                    data-focus-key={focusKey(fieldId, "up")}
                    onClick={() => move(fieldId, -1)}
                  />
                  <IconButton
                    label={`Move ${name} later`}
                    icon={ArrowDown}
                    disabled={!included || position === count - 1}
                    data-focus-key={focusKey(fieldId, "down")}
                    onClick={() => move(fieldId, 1)}
                  />
                </li>
              );
            })}
          </ul>
          {!grouped && count === 0 ? (
            <p className="mt-2 text-sm text-warning" role="status">
              No fields are selected, so this output would be empty.
            </p>
          ) : null}
        </fieldset>
      )}
    </Card>
  );
}
