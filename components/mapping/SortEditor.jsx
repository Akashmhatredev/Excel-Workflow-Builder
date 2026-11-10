"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import IssueList from "@/components/mapping/IssueList";
import { splitIssues } from "@/components/mapping/issues";
import { Button, IconButton, Segmented, Select } from "@/components/ui";
import { createSortRule } from "@/lib/schema";

const EMPTY = [];
const DIRECTIONS = [
  { value: "asc", label: "A → Z" },
  { value: "desc", label: "Z → A" },
];

/**
 * SortEditor (controlled): edits an ordered list of sort rules.
 *
 *   value     SortRule[] { id, key, direction: 'asc' | 'desc' }
 *   onChange  (nextRules) => void
 *   options   [{ key, name }]   the result columns that can be sorted (getResultColumns)
 *   issues    Issue[]           optional; scope 'sort' issues are shown on their rule (issue.id = rule id)
 */
export default function SortEditor({ value, onChange, options = EMPTY, issues }) {
  const rules = Array.isArray(value) ? value : EMPTY;
  const placed = useMemo(
    () =>
      splitIssues(
        issues,
        "sort",
        rules.map((rule) => rule.id),
      ),
    [issues, rules],
  );

  const emit = (next) => {
    if (onChange) onChange(next);
  };
  const patchRule = (id, patch) => emit(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const move = (index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    const next = rules.slice();
    const [rule] = next.splice(index, 1);
    next.splice(to, 0, rule);
    emit(next);
  };
  const addRule = () => {
    const used = new Set(rules.map((rule) => rule.key));
    const free = options.find((option) => !used.has(option.key));
    emit([...rules, createSortRule({ key: free ? free.key : "" })]);
  };

  return (
    <div className="flex flex-col gap-3">
      <IssueList issues={placed.rest} />

      {rules.length ? (
        <ol className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const number = index + 1;
            const known = !rule.key || options.some((option) => option.key === rule.key);
            const ruleIssues = placed.byId.get(rule.id);
            return (
              <li key={rule.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-medium text-muted">{index === 0 ? "Sort by" : "then by"}</span>
                  <div className="min-w-40 flex-1">
                    <Select
                      aria-label={`Sort ${number}: column`}
                      value={rule.key || ""}
                      invalid={!known}
                      onChange={(event) => patchRule(rule.id, { key: event.target.value })}
                    >
                      <option value="">Choose a column…</option>
                      {!known ? <option value={rule.key}>Column no longer in the result</option> : null}
                      {options.map((option) => (
                        <option
                          key={option.key}
                          value={option.key}
                          disabled={option.key !== rule.key && rules.some((other) => other.key === option.key)}
                        >
                          {option.name || "(unnamed)"}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Segmented
                    label={`Sort ${number}: direction`}
                    options={DIRECTIONS}
                    value={rule.direction === "desc" ? "desc" : "asc"}
                    onChange={(direction) => patchRule(rule.id, { direction })}
                  />
                  <div className="flex items-center">
                    <IconButton
                      label={`Move sort ${number} up`}
                      icon={ArrowUp}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    />
                    <IconButton
                      label={`Move sort ${number} down`}
                      icon={ArrowDown}
                      disabled={index === rules.length - 1}
                      onClick={() => move(index, 1)}
                    />
                    <IconButton
                      label={`Remove sort ${number}`}
                      icon={Trash2}
                      variant="dangerGhost"
                      onClick={() => emit(rules.filter((item) => item.id !== rule.id))}
                    />
                  </div>
                </div>
                <IssueList issues={ruleIssues} className="sm:pl-16" />
                {!rule.key ? (
                  <p className="text-xs text-muted sm:pl-16">Choose a column. Until then this rule is ignored.</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <ArrowUpDown className="size-4 shrink-0" aria-hidden="true" />
          No sorting: rows keep the order of the source file.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={addRule} disabled={!options.length}>
          Add sort
        </Button>
        {!options.length ? <span className="text-xs text-muted">Add a field first.</span> : null}
      </div>
    </div>
  );
}
