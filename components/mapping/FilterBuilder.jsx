"use client";

import { Filter, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import IssueList from "@/components/mapping/IssueList";
import { splitIssues } from "@/components/mapping/issues";
import { Button, IconButton, Input, Segmented, Select } from "@/components/ui";
import { createFilterGroup, createFilterRule, FILTER_OPERATORS } from "@/lib/schema";

const EMPTY = [];
const EMPTY_GROUP = createFilterGroup();
const COMBINATORS = [
  { value: "and", label: "All rules (AND)" },
  { value: "or", label: "Any rule (OR)" },
];
const OPERATORS = Object.entries(FILTER_OPERATORS);
const VALUE_HINTS = { number: "e.g. 100", date: "e.g. 2024-01-31" };

const encodeTarget = (target) => (target && target.ref ? `${target.kind === "field" ? "field" : "column"}:${target.ref}` : "");

function decodeTarget(value) {
  const cut = value.indexOf(":");
  if (cut < 0) return { kind: "column", ref: "" };
  return { kind: value.slice(0, cut) === "field" ? "field" : "column", ref: value.slice(cut + 1) };
}

/**
 * FilterBuilder (controlled): edits a FilterGroup.
 *
 *   value     FilterGroup { combinator: 'and' | 'or', rules: FilterRule[] }
 *   onChange  (nextGroup) => void
 *   columns   [{ name, type }]   source columns a rule can test (raw value)
 *   fields    [{ id, name }]     output fields a rule can test (value after transforms)
 *   issues    Issue[]            optional; scope 'filter' issues are shown on their rule (issue.id = rule id)
 *
 * It never reads the store, so the Outputs step reuses it for per-output overrides.
 */
export default function FilterBuilder({ value, onChange, columns = EMPTY, fields = EMPTY, issues }) {
  const group = value && Array.isArray(value.rules) ? value : EMPTY_GROUP;
  const rules = group.rules;
  const placed = useMemo(
    () =>
      splitIssues(
        issues,
        "filter",
        rules.map((rule) => rule.id),
      ),
    [issues, rules],
  );

  const emit = (next) => {
    if (onChange) onChange(next);
  };
  const patchRule = (id, patch) =>
    emit({ ...group, rules: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });

  return (
    <div className="@container flex flex-col gap-3">
      <IssueList issues={placed.rest} />

      {rules.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Keep a row when it matches</span>
          <Segmented
            label="How the rules combine"
            size="sm"
            options={COMBINATORS}
            value={group.combinator === "or" ? "or" : "and"}
            onChange={(combinator) => emit({ ...group, combinator })}
          />
        </div>
      ) : null}

      {rules.length ? (
        <ol className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const number = index + 1;
            const target = rule.target || { kind: "column", ref: "" };
            const encoded = encodeTarget(target);
            const column = target.kind === "column" ? columns.find((item) => item.name === target.ref) : null;
            const known = !target.ref || (target.kind === "field" ? fields.some((field) => field.id === target.ref) : Boolean(column));
            const spec = FILTER_OPERATORS[rule.operator] || FILTER_OPERATORS.equals;
            const ruleIssues = placed.byId.get(rule.id);
            const hasError = Boolean(ruleIssues && ruleIssues.some((issue) => issue.level === "error"));
            const missingValue = (spec.arity >= 1 && !rule.value) || (spec.arity === 2 && !rule.value2);
            const incomplete = !target.ref || missingValue;
            const placeholder = (column && VALUE_HINTS[column.type]) || "Value";
            return (
              <li key={rule.id} className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <span className="w-10 shrink-0 pt-2.5 text-xs font-medium text-muted">
                    {index === 0 ? "Where" : group.combinator === "or" ? "or" : "and"}
                  </span>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 @lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                    <Select
                      aria-label={`Rule ${number}: column or field to test`}
                      value={encoded}
                      invalid={!known || hasError}
                      onChange={(event) => patchRule(rule.id, { target: decodeTarget(event.target.value) })}
                    >
                      <option value="">Choose a column or field…</option>
                      {!known ? (
                        <option value={encoded}>
                          {target.kind === "field" ? "Deleted field" : `${target.ref} (not in this file)`}
                        </option>
                      ) : null}
                      {columns.length ? (
                        <optgroup label="Source columns">
                          {columns.map((item, i) => (
                            <option key={`${item.name}-${i}`} value={`column:${item.name}`}>
                              {item.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {fields.length ? (
                        <optgroup label="Output fields">
                          {fields.map((field) => (
                            <option key={field.id} value={`field:${field.id}`}>
                              {field.name || "(unnamed field)"}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                    <Select
                      aria-label={`Rule ${number}: condition`}
                      value={FILTER_OPERATORS[rule.operator] ? rule.operator : "equals"}
                      onChange={(event) => patchRule(rule.id, { operator: event.target.value })}
                    >
                      {OPERATORS.map(([operator, item]) => (
                        <option key={operator} value={operator}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                    {spec.arity === 1 ? (
                      <Input
                        aria-label={`Rule ${number}: value`}
                        placeholder={placeholder}
                        value={rule.value || ""}
                        onChange={(event) => patchRule(rule.id, { value: event.target.value })}
                      />
                    ) : null}
                    {spec.arity === 2 ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          aria-label={`Rule ${number}: from`}
                          placeholder="From"
                          value={rule.value || ""}
                          onChange={(event) => patchRule(rule.id, { value: event.target.value })}
                        />
                        <Input
                          aria-label={`Rule ${number}: to`}
                          placeholder="To"
                          value={rule.value2 || ""}
                          onChange={(event) => patchRule(rule.id, { value2: event.target.value })}
                        />
                      </div>
                    ) : null}
                  </div>
                  <IconButton
                    label={`Remove rule ${number}`}
                    icon={Trash2}
                    variant="dangerGhost"
                    onClick={() => emit({ ...group, rules: rules.filter((item) => item.id !== rule.id) })}
                  />
                </div>
                <IssueList issues={ruleIssues} className="pl-12" />
                {incomplete ? (
                  <p className="pl-12 text-xs text-muted">
                    {!target.ref
                      ? "Choose what to test. Until then this rule is ignored."
                      : spec.arity === 2
                        ? "Enter both values. Until then this rule is ignored."
                        : "Enter a value (or use “is empty”). Until then this rule is ignored."}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Filter className="size-4 shrink-0" aria-hidden="true" />
          No filter rules: every row is kept.
        </p>
      )}

      <div>
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => emit({ ...group, rules: [...rules, createFilterRule()] })}>
          Add rule
        </Button>
      </div>
    </div>
  );
}
