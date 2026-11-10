/**
 * Pure helpers shared by the Outputs and Export steps (owner: Agent C).
 * No React and no DOM in here, so everything is easy to reason about and to test.
 */

import { FILTER_OPERATORS, getResultColumns, isGroupingActive } from "@/lib/schema";

const countFormat = new Intl.NumberFormat("en-US");

/** 12345 -> "12,345" (fixed locale so server and client render the same text). */
export function formatCount(value) {
  const n = Number(value);
  return countFormat.format(Number.isFinite(n) ? n : 0);
}

/** plural(1, "row") -> "1 row", plural(2500, "row") -> "2,500 rows". */
export function plural(count, one, many = `${one}s`) {
  return `${formatCount(count)} ${Number(count) === 1 ? one : many}`;
}

/** 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The issues that belong to one output (CONTRACTS.md: Issue.outputId, or scope "output" with that id). */
export function issuesForOutput(issues, outputId) {
  return (Array.isArray(issues) ? issues : []).filter(
    (issue) => issue && (issue.outputId === outputId || (issue.scope === "output" && issue.id === outputId)),
  );
}

/** Errors first, then warnings, keeping the engine's order inside each level. */
export function sortIssues(issues) {
  const list = Array.isArray(issues) ? issues : [];
  return [...list.filter((issue) => issue.level === "error"), ...list.filter((issue) => issue.level !== "error")];
}

/* ------------------------------------------------------------------ */
/* field selection (Output.fieldIds)                                    */
/* ------------------------------------------------------------------ */

/**
 * How an output's field selection should be shown.
 *
 * - `included`: the selected field ids in output order.
 * - `custom`: the user reordered them (they no longer follow the Mapping order).
 * - `display`: every field id in the order the checklist lists them. While the order is the
 *   default one the checklist simply follows Mapping, so ticking a box never moves a row; after
 *   a reorder the included fields come first (in output order), then the excluded ones.
 */
export function describeFieldSelection(fields, fieldIds) {
  const allIds = (fields || []).map((field) => field.id);
  if (!Array.isArray(fieldIds)) return { included: allIds, custom: false, display: allIds, all: true };
  const known = new Set(allIds);
  const included = [];
  const seen = new Set();
  for (const id of fieldIds) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      included.push(id);
    }
  }
  const natural = allIds.filter((id) => seen.has(id));
  const custom = natural.some((id, index) => id !== included[index]);
  const display = custom ? [...included, ...allIds.filter((id) => !seen.has(id))] : allIds;
  return { included, custom, display, all: included.length === allIds.length };
}

/** `null` when the selection is "every field in Mapping order" (so new fields keep being included). */
export function toFieldIds(fields, included) {
  const allIds = (fields || []).map((field) => field.id);
  const everything = included.length === allIds.length && included.every((id, index) => id === allIds[index]);
  return everything ? null : included;
}

/** Tick or untick one field. A newly ticked field lands at its Mapping position unless the order is custom. */
export function toggleField(fields, fieldIds, fieldId, checked) {
  const { included, custom } = describeFieldSelection(fields, fieldIds);
  let next;
  if (!checked) next = included.filter((id) => id !== fieldId);
  else if (included.includes(fieldId)) next = included;
  else if (custom) next = [...included, fieldId];
  else {
    const wanted = new Set([...included, fieldId]);
    next = (fields || []).map((field) => field.id).filter((id) => wanted.has(id));
  }
  return toFieldIds(fields, next);
}

/** Move an included field one place earlier (-1) or later (1) in the output. */
export function moveIncludedField(fields, fieldIds, fieldId, direction) {
  const { included } = describeFieldSelection(fields, fieldIds);
  const from = included.indexOf(fieldId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= included.length) return fieldIds;
  const next = included.slice();
  next.splice(from, 1);
  next.splice(to, 0, fieldId);
  return toFieldIds(fields, next);
}

/* ------------------------------------------------------------------ */
/* one-line summaries of the workflow-level settings                    */
/* ------------------------------------------------------------------ */

function joinNames(names, limit = 3) {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function isCompleteRule(rule) {
  if (!rule || !rule.target || !rule.target.ref) return false;
  const spec = FILTER_OPERATORS[rule.operator];
  if (!spec) return false;
  if (spec.arity >= 1 && String(rule.value ?? "") === "") return false;
  if (spec.arity >= 2 && String(rule.value2 ?? "") === "") return false;
  return true;
}

function describeRule(rule, fields) {
  const field = rule.target.kind === "field" ? (fields || []).find((f) => f.id === rule.target.ref) : null;
  const target = rule.target.kind === "field" ? (field ? field.name || "Untitled field" : "a removed field") : rule.target.ref;
  const spec = FILTER_OPERATORS[rule.operator];
  if (spec.arity === 0) return `${target} ${spec.label}`;
  if (spec.arity === 2) return `${target} ${spec.label} ${rule.value} and ${rule.value2}`;
  return `${target} ${spec.label} "${rule.value}"`;
}

/** "Status equals "Paid" and Amount greater than (>) "100"" */
export function summarizeFilters(group, fields) {
  const rules = ((group && group.rules) || []).filter(isCompleteRule);
  if (!rules.length) return "No filters: every row is included.";
  const joiner = group.combinator === "or" ? " or " : " and ";
  const shown = rules.slice(0, 2).map((rule) => describeRule(rule, fields));
  const rest = rules.length - shown.length;
  return `${shown.join(joiner)}${rest > 0 ? `${joiner}${plural(rest, "more rule")}` : ""}.`;
}

/** "Amount (descending), then Name (ascending)" using the columns the output really has. */
export function summarizeSort(rules, options) {
  const names = new Map((options || []).map((option) => [option.key, option.name || "Untitled"]));
  const known = (rules || []).filter((rule) => rule && names.has(rule.key));
  if (!known.length) return "No sorting: rows keep the order of the source file.";
  const parts = known.map((rule) => `${names.get(rule.key)} (${rule.direction === "desc" ? "descending" : "ascending"})`);
  return `Sorted by ${parts.join(", then ")}.`;
}

/** "Grouped by Region, City with Sum of Amount, Count." */
export function summarizeGroupBy(definition, groupBy) {
  if (!isGroupingActive(groupBy)) return "No grouping: one row per source row.";
  const columns = getResultColumns({ ...definition, groupBy }, null);
  const keys = columns.filter((column) => column.role === "key").map((column) => column.name || "Untitled field");
  const aggregations = columns.filter((column) => column.role === "aggregation").map((column) => column.name);
  const by = keys.length ? `Grouped by ${joinNames(keys)}` : "All rows combined into one";
  return aggregations.length ? `${by} with ${joinNames(aggregations)}.` : `${by}.`;
}
