/**
 * lib/validate.js (owner: Agent A): static checks of a workflow definition.
 *
 * Pure and cheap: no data is read, so the UI can call it on every change, also when
 * no file is loaded (then `columns` are the template's expected columns). The worker
 * adds run-time issues (a formula failing on N rows...) on top of these.
 *
 * Issue = { level: 'error' | 'warning', scope: 'field' | 'filter' | 'groupBy' | 'sort' | 'output',
 *           id, outputId?, code, message }
 *   id        the field / filter rule / aggregation / sort rule / output the issue belongs to
 *   outputId  set when the issue comes from one output (its own settings or its overrides)
 *
 * Codes: empty-name, duplicate-name, empty-source, missing-column, formula-error,
 *        invalid-regex, type-mismatch, missing-field, empty-group, no-fields,
 *        empty-output-name, duplicate-output-name.
 *        (Run-time codes added by the pipeline: formula-failed, format-skipped, non-numeric.)
 *
 * Errors mean the result would be wrong or incomplete; warnings mean a setting is
 * ignored or may not do what it says.
 */

import { isRuleComplete } from "./filters.js";
import { compileFormula, compileTemplate } from "./formula.js";
import {
  AGGREGATIONS,
  aggregationLabel,
  getResultColumns,
  isGroupingActive,
  normalizeName,
  outputFileName,
  resolveOutputConfig,
} from "./schema.js";
import { buildReplacePattern, isStrictNumeric, toDate, toNumber } from "./transforms.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * Find source columns by name: exact match first, then ignoring case and extra spaces
 * (the same rule `matchColumns` in lib/schema.js uses). The pipeline uses this too,
 * so validation and execution always agree on what "missing" means.
 *
 * @returns {{ size: number, find: (name: string) => { name: string, type: string, index: number } | null }}
 */
export function createColumnLookup(columns) {
  const exact = new Map();
  const loose = new Map();
  list(columns).forEach((column, position) => {
    if (!isObject(column) || typeof column.name !== "string") return;
    const entry = {
      name: column.name,
      type: column.type || "text",
      index: Number.isInteger(column.index) ? column.index : position,
    };
    if (!exact.has(entry.name)) exact.set(entry.name, entry);
    const key = normalizeName(entry.name);
    if (!loose.has(key)) loose.set(key, entry);
  });
  return {
    size: exact.size,
    find: (name) => {
      if (name === null || name === undefined || name === "") return null;
      return exact.get(name) || loose.get(normalizeName(name)) || null;
    },
  };
}

const COMPARING_OPERATORS = new Set(["equals", "notEquals", "gt", "gte", "lt", "lte", "between"]);
const TYPE_WORDS = { text: "text", number: "numbers", date: "dates" };

/**
 * @param {object} definition  a WorkflowDefinition (lib/schema.js)
 * @param {{ name: string, type: 'text'|'number'|'date' }[]} columns  the source columns; when
 *   empty, column references are not checked (nothing is known about the source yet)
 * @returns {{ level: 'error'|'warning', scope: string, id: string|null, outputId?: string, code: string, message: string }[]}
 */
export function validateDefinition(definition, columns) {
  const issues = [];
  const base = isObject(definition) ? definition : {};
  const fields = list(base.fields).filter(isObject);
  const outputs = list(base.outputs).filter(isObject);
  const def = { ...base, fields, outputs };
  const lookup = createColumnLookup(columns);
  const checkColumns = lookup.size > 0;

  const add = (level, scope, id, code, message, outputId) => {
    const issue = { level, scope, id: id === undefined || id === "" ? null : id, code, message };
    if (outputId) issue.outputId = outputId;
    issues.push(issue);
  };

  /* ---------------- fields ---------------- */

  const fieldById = new Map();
  const fieldTypes = new Map(); // field id -> 'text' | 'number' | 'date' | 'unknown'
  const nameCounts = new Map();
  for (const field of fields) {
    fieldById.set(field.id, field);
    const key = normalizeName(field.name);
    if (key) nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  for (const field of fields) {
    const id = field.id;
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) add("error", "field", id, "empty-name", "Give this field a name.");
    else if (nameCounts.get(normalizeName(name)) > 1) {
      add("error", "field", id, "duplicate-name", `Another field is also named "${name}".`);
    }

    const source = isObject(field.source) ? field.source : {};
    const missing = (ref) => {
      if (checkColumns && !lookup.find(ref)) {
        add("error", "field", id, "missing-column", `Source column "${ref}" was not found.`);
      }
    };
    let type = "unknown";
    if (source.kind === "combine") {
      const template = String(source.template ?? "");
      type = "text";
      if (template.trim() === "") {
        add("error", "field", id, "empty-source", "Add a template, for example {First} {Last}.");
      } else {
        compileTemplate(template).refs.forEach(missing);
      }
    } else if (source.kind === "formula") {
      const expression = String(source.expression ?? "");
      if (expression.trim() === "") {
        add("error", "field", id, "empty-source", "Write a formula, for example {Qty} * {Price}.");
      } else {
        const compiled = compileFormula(expression);
        if (!compiled.ok) add("error", "field", id, "formula-error", `Formula error: ${compiled.error}`);
        compiled.refs.forEach(missing);
      }
    } else if (!source.column) {
      add("error", "field", id, "empty-source", "Choose a source column.");
    } else {
      const column = lookup.find(source.column);
      if (column) type = column.type;
      else missing(source.column);
    }

    const transforms = list(field.transforms).filter(isObject);
    transforms.forEach((transform, index) => {
      const last = index === transforms.length - 1;
      switch (transform.type) {
        case "numberFormat":
          if (type === "text" || type === "date") {
            add(
              "warning",
              "field",
              id,
              "type-mismatch",
              `Number format expects numbers, but this field holds ${TYPE_WORDS[type]}.`,
            );
          }
          type = !last ? "text" : type === "number" || type === "unknown" ? "number" : "unknown";
          break;
        case "dateFormat":
          if (type === "text" || type === "number") {
            add(
              "warning",
              "field",
              id,
              "type-mismatch",
              `Date format expects dates, but this field holds ${TYPE_WORDS[type]}.`,
            );
          }
          type = !last ? "text" : type === "date" || type === "unknown" ? "date" : "unknown";
          break;
        case "default": {
          const value = String(transform.value ?? "");
          if (value.trim() === "" || type === "text") break;
          if (!(type === "number" && isStrictNumeric(value))) type = "unknown";
          break;
        }
        case "split":
          type = "unknown";
          break;
        case "replace":
          type = "unknown";
          if (transform.useRegex) {
            try {
              buildReplacePattern(transform);
            } catch {
              add(
                "error",
                "field",
                id,
                "invalid-regex",
                "Find and replace: the pattern is not a valid regular expression.",
              );
            }
          }
          break;
        default:
          break;
      }
    });
    fieldTypes.set(id, type);
  }

  /* ---------------- filters ---------------- */

  const checkFilters = (group, outputId) => {
    for (const rule of list(group && group.rules)) {
      if (!isObject(rule) || !isObject(rule.target) || !rule.target.ref) continue;
      const ref = rule.target.ref;
      let type = "unknown";
      if (rule.target.kind === "field") {
        if (!fieldById.has(ref)) {
          add("error", "filter", rule.id, "missing-field", "This filter uses a field that no longer exists.", outputId);
          continue;
        }
        type = fieldTypes.get(ref) || "unknown";
      } else {
        const column = lookup.find(ref);
        if (!column) {
          if (checkColumns) {
            add("error", "filter", rule.id, "missing-column", `Source column "${ref}" was not found.`, outputId);
          }
          continue;
        }
        type = column.type;
      }
      if (!isRuleComplete(rule) || !COMPARING_OPERATORS.has(rule.operator)) continue;
      const operands = rule.operator === "between" ? [rule.value, rule.value2] : [rule.value];
      for (const operand of operands) {
        const text = String(operand).trim();
        if (type === "number" && toNumber(text) === null) {
          add(
            "warning",
            "filter",
            rule.id,
            "type-mismatch",
            `"${text}" is not a number, but this rule compares numbers.`,
            outputId,
          );
          break;
        }
        if (type === "date" && !toDate(text)) {
          add(
            "warning",
            "filter",
            rule.id,
            "type-mismatch",
            `"${text}" is not a date, but this rule compares dates.`,
            outputId,
          );
          break;
        }
      }
    }
  };

  /* ---------------- grouping ---------------- */

  const checkGroupBy = (groupBy, outputId) => {
    if (!isObject(groupBy) || !groupBy.enabled) return;
    const keys = list(groupBy.keys);
    const aggregations = list(groupBy.aggregations).filter(isObject);
    if (!keys.length && !aggregations.length) {
      add(
        "warning",
        "groupBy",
        null,
        "empty-group",
        "Grouping is on but has no group-by fields or summaries yet, so it is ignored.",
        outputId,
      );
      return;
    }
    const names = new Map();
    const countName = (name) => {
      const key = normalizeName(name);
      if (key) names.set(key, (names.get(key) || 0) + 1);
    };
    for (const key of keys) {
      const field = fieldById.get(key);
      if (!field) {
        add("error", "groupBy", key, "missing-field", "Grouping uses a field that no longer exists.", outputId);
      } else {
        countName(field.name);
      }
    }
    // Broken aggregations are reported once (missing field), not also as duplicate names.
    const isBroken = (aggregation) =>
      aggregation.fieldId ? !fieldById.has(aggregation.fieldId) : aggregation.fn !== "count";
    for (const aggregation of aggregations) {
      if (!isBroken(aggregation)) countName(aggregationLabel(aggregation, fields));
    }
    for (const aggregation of aggregations) {
      const fn = aggregation.fn;
      const fnLabel = (AGGREGATIONS[fn] && AGGREGATIONS[fn].label) || "Summary";
      const label = aggregationLabel(aggregation, fields);
      if (!isBroken(aggregation) && names.get(normalizeName(label)) > 1) {
        add(
          "error",
          "groupBy",
          aggregation.id,
          "duplicate-name",
          `Another column of the grouped result is also named "${label}".`,
          outputId,
        );
      }
      if (!aggregation.fieldId) {
        if (fn !== "count") {
          add("error", "groupBy", aggregation.id, "missing-field", `Choose a field for ${fnLabel}.`, outputId);
        }
        continue;
      }
      const field = fieldById.get(aggregation.fieldId);
      if (!field) {
        add(
          "error",
          "groupBy",
          aggregation.id,
          "missing-field",
          `${fnLabel} uses a field that no longer exists.`,
          outputId,
        );
        continue;
      }
      const type = fieldTypes.get(field.id);
      if ((fn === "sum" || fn === "avg") && (type === "text" || type === "date")) {
        add(
          "warning",
          "groupBy",
          aggregation.id,
          "type-mismatch",
          `${fnLabel} needs numbers, but "${field.name || "this field"}" holds ${TYPE_WORDS[type]}.`,
          outputId,
        );
      }
    }
  };

  /* ---------------- sort ---------------- */

  const sortableKeys = (output) => {
    const { groupBy } = resolveOutputConfig(def, output);
    if (isGroupingActive(groupBy)) return new Set(getResultColumns(def, output).map((column) => column.key));
    return new Set(fields.map((field) => field.id));
  };

  const checkSort = (rules, output, outputId) => {
    let valid = null;
    for (const rule of list(rules)) {
      if (!isObject(rule) || !rule.key) continue;
      if (!valid) valid = sortableKeys(output);
      if (!valid.has(rule.key)) {
        add(
          "warning",
          "sort",
          rule.id,
          "missing-field",
          "This sort uses a column that is not in the result, so it is ignored.",
          outputId,
        );
      }
    }
  };

  checkFilters(def.filters);
  checkGroupBy(def.groupBy);
  checkSort(def.sort, null);

  /* ---------------- outputs ---------------- */

  const fileNames = new Map();
  for (const output of outputs) {
    const key = outputFileName(output).toLowerCase();
    fileNames.set(key, (fileNames.get(key) || 0) + 1);
  }

  for (const output of outputs) {
    const id = output.id;
    const name = typeof output.name === "string" ? output.name.trim() : "";
    if (!name) add("error", "output", id, "empty-output-name", "Give this output a name.", id);
    else if (fileNames.get(outputFileName(output).toLowerCase()) > 1) {
      add("warning", "output", id, "duplicate-output-name", `Another output is also saved as "${outputFileName(output)}".`, id);
    }

    const overrides = isObject(output.overrides) ? output.overrides : {};
    if (isObject(overrides.filters) && overrides.filters.enabled) checkFilters(overrides.filters.group, id);
    if (isObject(overrides.groupBy) && overrides.groupBy.enabled) {
      checkGroupBy({ ...(isObject(overrides.groupBy.config) ? overrides.groupBy.config : {}), enabled: true }, id);
    }
    if (isObject(overrides.sort) && overrides.sort.enabled) checkSort(overrides.sort.rules, output, id);

    const grouping = isGroupingActive(resolveOutputConfig(def, output).groupBy);
    if (!grouping && Array.isArray(output.fieldIds)) {
      const gone = output.fieldIds.filter((fieldId) => !fieldById.has(fieldId)).length;
      if (gone) {
        add(
          "warning",
          "output",
          id,
          "missing-field",
          gone === 1
            ? "One column of this output no longer exists and is skipped."
            : `${gone} columns of this output no longer exist and are skipped.`,
          id,
        );
      }
    }
    if (!getResultColumns(def, output).length) {
      add("error", "output", id, "no-fields", "This output has no columns.", id);
    }
  }

  return issues;
}
