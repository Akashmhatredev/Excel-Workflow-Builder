"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import IssueList from "@/components/mapping/IssueList";
import { splitIssues } from "@/components/mapping/issues";
import { Button, IconButton, Input, Select, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AGGREGATIONS, aggregationLabel, createAggregation, createGroupBy } from "@/lib/schema";

const EMPTY = [];
const EMPTY_GROUP_BY = createGroupBy();
const FUNCTIONS = Object.entries(AGGREGATIONS);

/**
 * GroupByEditor (controlled): edits a GroupBy.
 *
 *   value     GroupBy { enabled, keys: fieldId[], aggregations: [{ id, fieldId, fn, name }] }
 *   onChange  (nextGroupBy) => void
 *   fields    [{ id, name }]   the mapped fields
 *   issues    Issue[]          optional; scope 'groupBy' issues are shown on their aggregation (issue.id) or above the editor
 *
 * The result has one column per key field followed by one per aggregation.
 * "Count" may leave the field empty to count rows.
 */
export default function GroupByEditor({ value, onChange, fields = EMPTY, issues }) {
  const groupBy = value && typeof value === "object" ? value : EMPTY_GROUP_BY;
  const keys = Array.isArray(groupBy.keys) ? groupBy.keys : EMPTY;
  const aggregations = Array.isArray(groupBy.aggregations) ? groupBy.aggregations : EMPTY;
  const placed = useMemo(
    () =>
      splitIssues(
        issues,
        "groupBy",
        aggregations.map((aggregation) => aggregation.id),
      ),
    [issues, aggregations],
  );

  const emit = (patch) => {
    if (onChange) onChange({ ...groupBy, keys, aggregations, ...patch });
  };
  const patchAggregation = (id, patch) =>
    emit({ aggregations: aggregations.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  const addAggregation = () => {
    const countsRows = aggregations.some((item) => item.fn === "count" && !item.fieldId);
    emit({ aggregations: [...aggregations, createAggregation(countsRows ? { fn: "sum" } : { fn: "count" })] });
  };

  const fieldName = (id) => {
    const field = fields.find((item) => item.id === id);
    return field ? field.name || "(unnamed field)" : null;
  };
  const freeFields = fields.filter((field) => !keys.includes(field.id));

  return (
    <div className="@container flex flex-col gap-4">
      <Switch
        label="Group rows"
        description="Combine rows that share the same values into one row with totals."
        checked={Boolean(groupBy.enabled)}
        onChange={(enabled) => emit({ enabled })}
      />

      {groupBy.enabled ? (
        <>
          <IssueList issues={placed.rest} />

          <fieldset className="min-w-0">
            <legend className="text-sm font-medium text-fg">Group by</legend>
            <div className="mt-0.5 flex flex-col gap-2">
              <p className="text-xs text-muted">One result row per unique combination of these fields.</p>
              {keys.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {keys.map((key) => {
                    const name = fieldName(key);
                    return (
                      <li
                        key={key}
                        className={cn(
                          "inline-flex max-w-full items-center gap-0.5 rounded-lg border py-0.5 pr-0.5 pl-2.5 text-sm",
                          name === null ? "border-danger bg-danger-soft text-danger" : "border-line bg-surface-2 text-fg",
                        )}
                      >
                        <span className="truncate">{name === null ? "Deleted field" : name}</span>
                        <IconButton
                          label={`Stop grouping by ${name === null ? "the deleted field" : name}`}
                          icon={X}
                          size="sm"
                          onClick={() => emit({ keys: keys.filter((item) => item !== key) })}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="max-w-xs">
                <Select
                  aria-label="Add a field to group by"
                  value=""
                  disabled={!freeFields.length}
                  onChange={(event) => {
                    if (event.target.value) emit({ keys: [...keys, event.target.value] });
                  }}
                >
                  <option value="">
                    {!fields.length ? "Add a field first" : freeFields.length ? "Add a field to group by…" : "Every field is used"}
                  </option>
                  {freeFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name || "(unnamed field)"}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="text-sm font-medium text-fg">Aggregations</legend>
            <div className="mt-0.5 flex flex-col gap-2">
              <p className="text-xs text-muted">Each one becomes a column calculated over the rows of a group.</p>
              {aggregations.length ? (
                <ol className="flex flex-col gap-3">
                  {aggregations.map((aggregation, index) => {
                    const number = index + 1;
                    const isCount = aggregation.fn === "count";
                    const known = !aggregation.fieldId || fields.some((field) => field.id === aggregation.fieldId);
                    const needsField = !isCount && !aggregation.fieldId;
                    const itemIssues = placed.byId.get(aggregation.id);
                    return (
                      <li key={aggregation.id} className="flex flex-col gap-1.5">
                        <div className="flex items-start gap-2">
                          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 @md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Select
                              aria-label={`Aggregation ${number}: function`}
                              value={AGGREGATIONS[aggregation.fn] ? aggregation.fn : "sum"}
                              onChange={(event) => patchAggregation(aggregation.id, { fn: event.target.value })}
                            >
                              {FUNCTIONS.map(([fn, item]) => (
                                <option key={fn} value={fn}>
                                  {item.label}
                                </option>
                              ))}
                            </Select>
                            <Select
                              aria-label={`Aggregation ${number}: field`}
                              value={aggregation.fieldId || ""}
                              invalid={!known || needsField}
                              onChange={(event) => patchAggregation(aggregation.id, { fieldId: event.target.value })}
                            >
                              <option value="">{isCount ? "All rows" : "Choose a field…"}</option>
                              {!known ? <option value={aggregation.fieldId}>Deleted field</option> : null}
                              {fields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.name || "(unnamed field)"}
                                </option>
                              ))}
                            </Select>
                            <Input
                              aria-label={`Aggregation ${number}: column name (optional)`}
                              placeholder={aggregationLabel({ ...aggregation, name: "" }, fields)}
                              value={aggregation.name || ""}
                              onChange={(event) => patchAggregation(aggregation.id, { name: event.target.value })}
                            />
                          </div>
                          <IconButton
                            label={`Remove aggregation ${number}`}
                            icon={Trash2}
                            variant="dangerGhost"
                            onClick={() => emit({ aggregations: aggregations.filter((item) => item.id !== aggregation.id) })}
                          />
                        </div>
                        <IssueList issues={itemIssues} />
                        {needsField && !itemIssues ? (
                          <p className="text-xs text-muted">Choose the field to calculate. Only Count works without one.</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <div>
                <Button variant="secondary" size="sm" icon={Plus} onClick={addAggregation}>
                  Add aggregation
                </Button>
              </div>
            </div>
          </fieldset>

          {!keys.length && !aggregations.length ? (
            <p className="text-xs text-muted" role="status">
              Nothing is grouped yet: pick a field to group by or add an aggregation.
            </p>
          ) : (
            <p className="text-xs text-muted">
              The result keeps only the group-by fields and the aggregations, in that order.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
