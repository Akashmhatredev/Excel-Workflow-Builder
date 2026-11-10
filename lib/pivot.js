/**
 * lib/pivot.js: pivot / summary tables of the workflow-level rows.
 *
 * Rows come from the pipeline after mapping, the workflow filter and cleaning, before grouping
 * (`scanRows` in lib/pipeline.js). Output settings, grouping and sorting are ignored.
 *
 * Layout of the result (display strings, like every preview):
 *   - the first column holds the row labels (one row per distinct value of `rowKey`, sorted:
 *     numbers, then dates, then text; "(blank)" last)
 *   - with `columnKey`, one column per distinct value of that field (same order, at most
 *     PIVOT_MAX_COLUMNS; `truncatedColumns` says when more exist) and a last "Total" column
 *   - without `columnKey`, a single value column, which is also the row total
 *   - the last row is "Total": the column totals and the grand total
 * Totals always cover all the data, including rows beyond `limit` and columns beyond the cap.
 * Cells with no data are "". Sum, average, min and max use the value field's format.
 */

import { compareMixed, scanRows } from "./pipeline.js";
import { AGGREGATIONS, normalizeDefinition } from "./schema.js";
import { cleanNumber, formatDisplay, isEmpty, toNumber, toText } from "./transforms.js";

export const PIVOT_MAX_COLUMNS = 50;
export const PIVOT_BLANK_LABEL = "(blank)";

function fail(message) {
  const error = new Error(message);
  error.code = "INVALID_DEFINITION";
  return error;
}

function labelKey(value) {
  if (isEmpty(value)) return "\u0000";
  if (typeof value === "number") return `\u0000n${value}`;
  if (value instanceof Date) return `\u0000d${value.getTime()}`;
  return typeof value === "string" ? value : `\u0000b${String(value)}`;
}

/** Distinct labels in display order (blank last). Returns the ids of `labels` sorted. */
function sortLabels(labels) {
  const ids = labels.map((_, index) => index);
  ids.sort((a, b) => {
    const x = labels[a];
    const y = labels[b];
    const emptyX = isEmpty(x);
    const emptyY = isEmpty(y);
    if (emptyX || emptyY) return emptyX === emptyY ? 0 : emptyX ? 1 : -1;
    return compareMixed(x, y) || a - b;
  });
  return ids;
}

/** Accumulators for `size` cells. */
function createCells(fn, size, countRows) {
  const seen = new Uint32Array(size); // rows that reached the cell
  const counts = new Uint32Array(size); // numeric (sum / avg) or non-empty (count) values
  const sums = fn === "sum" || fn === "avg" ? new Float64Array(size) : null;
  const best = fn === "min" || fn === "max" ? new Array(size).fill(null) : null;
  const sign = fn === "min" ? 1 : -1;
  return {
    add(cell, value) {
      seen[cell] += 1;
      if (fn === "count") {
        if (countRows || !isEmpty(value)) counts[cell] += 1;
      } else if (sums) {
        const n = typeof value === "number" ? value : toNumber(value);
        if (n !== null && !Number.isNaN(n)) {
          sums[cell] += n;
          counts[cell] += 1;
        }
      } else if (!isEmpty(value)) {
        const current = best[cell];
        if (current === null || sign * compareMixed(value, current) < 0) best[cell] = value;
      }
    },
    /** The typed result of a cell, or undefined when no row reached it. */
    value(cell) {
      if (!seen[cell]) return undefined;
      if (fn === "count") return counts[cell];
      if (fn === "sum") return cleanNumber(sums[cell]);
      if (fn === "avg") return counts[cell] ? cleanNumber(sums[cell] / counts[cell]) : null;
      return best[cell];
    },
  };
}

function inferLabelType(labels) {
  let type = null;
  for (const value of labels) {
    if (isEmpty(value)) continue;
    const kind = typeof value === "number" ? "number" : value instanceof Date ? "date" : "text";
    if (type === null) type = kind;
    else if (type !== kind) return "text";
  }
  return type || "text";
}

/**
 * @param {{ columns: object[], rows: any[][] }} table
 * @param {object} definition  WorkflowDefinition
 * @param {{ rowKey: string, columnKey?: string|null, valueKey?: string|null,
 *           fn?: 'sum'|'count'|'avg'|'min'|'max', limit?: number }} options  keys are field ids
 * @returns {{ columns: { key: string, name: string, type: 'text'|'number'|'date' }[], rows: string[][],
 *             totalRows: number, truncatedColumns: boolean }}
 *   totalRows = the number of distinct row labels (the rows shown are capped at `limit`, plus the Total row)
 * @throws an Error with code INVALID_DEFINITION for a missing row field, value field or function
 */
export function runPivot(table, definition, options = {}) {
  const def = normalizeDefinition(definition);
  const fieldById = new Map(def.fields.map((field) => [field.id, field]));
  const { rowKey, columnKey = null, valueKey = null } = options || {};
  const fn = (options && options.fn) || "count";
  const limitValue = Math.floor(Number(options && options.limit));
  const limit = Number.isFinite(limitValue) && limitValue >= 0 ? limitValue : 200;

  if (!AGGREGATIONS[fn]) throw fail("Choose how to summarise the values.");
  if (!rowKey || !fieldById.has(rowKey)) throw fail("Choose a field for the rows of the summary.");
  if (columnKey && !fieldById.has(columnKey)) throw fail("The column field of the summary no longer exists.");
  if (valueKey && !fieldById.has(valueKey)) throw fail("The value field of the summary no longer exists.");
  if (!valueKey && fn !== "count") throw fail(`Choose a field for ${AGGREGATIONS[fn].label}.`);

  const hasColumns = Boolean(columnKey);
  const countRows = fn === "count" && !valueKey;

  /* one pass: label ids per row, kept with the value */
  const rowIndex = new Map();
  const rowLabels = [];
  const colIndex = new Map();
  const colLabels = [];
  const rowIds = [];
  const colIds = [];
  const values = [];
  const scanned = scanRows(table, def, [rowKey, columnKey, valueKey], (row) => {
    const rowValue = row[0];
    let rowId = rowIndex.get(labelKey(rowValue));
    if (rowId === undefined) {
      rowId = rowLabels.length;
      rowIndex.set(labelKey(rowValue), rowId);
      rowLabels.push(isEmpty(rowValue) ? null : rowValue);
    }
    let colId = 0;
    if (hasColumns) {
      const colValue = row[1];
      colId = colIndex.get(labelKey(colValue));
      if (colId === undefined) {
        colId = colLabels.length;
        colIndex.set(labelKey(colValue), colId);
        colLabels.push(isEmpty(colValue) ? null : colValue);
      }
    }
    rowIds.push(rowId);
    colIds.push(colId);
    values.push(row[2]);
  });
  const [rowField, colField, valueField] = scanned.fields;

  /* order and cap the labels */
  const rowOrder = sortLabels(rowLabels);
  const shownRows = rowOrder.slice(0, limit);
  const rowPosition = new Int32Array(rowLabels.length).fill(-1);
  shownRows.forEach((id, position) => {
    rowPosition[id] = position;
  });
  const colOrder = hasColumns ? sortLabels(colLabels) : [];
  const shownCols = colOrder.slice(0, PIVOT_MAX_COLUMNS);
  const colPosition = new Int32Array(colLabels.length).fill(-1);
  shownCols.forEach((id, position) => {
    colPosition[id] = position;
  });
  const R = shownRows.length;
  const C = shownCols.length;

  /* aggregate */
  const cells = createCells(fn, R * C, countRows);
  const rowTotals = createCells(fn, R, countRows);
  const colTotals = createCells(fn, C, countRows);
  const grand = createCells(fn, 1, countRows);
  for (let i = 0; i < rowIds.length; i += 1) {
    const value = values[i];
    const r = rowPosition[rowIds[i]];
    const c = hasColumns ? colPosition[colIds[i]] : -1;
    grand.add(0, value);
    if (r >= 0) rowTotals.add(r, value);
    if (c >= 0) {
      colTotals.add(c, value);
      if (r >= 0) cells.add(r * C + c, value);
    }
  }

  /* display */
  const valueFormat = valueField && valueField.format;
  const format =
    fn === "min" || fn === "max"
      ? valueFormat
      : (fn === "sum" || fn === "avg") && valueFormat && valueFormat.type === "numberFormat"
        ? valueFormat
        : null;
  const show = (value) => {
    if (value === undefined || value === null) return "";
    return format ? formatDisplay(value, format) : toText(value);
  };
  const labelText = (value, field) => {
    if (value === null) return PIVOT_BLANK_LABEL;
    return field && field.format ? formatDisplay(value, field.format) : toText(value);
  };

  let valueType = "number";
  if (fn === "min" || fn === "max") {
    if (valueFormat) valueType = valueFormat.type === "dateFormat" ? "date" : "number";
    else valueType = valueField ? valueField.fallbackType || "text" : "text";
  }
  const valueName =
    fn === "count" && !valueField ? "Count" : `${AGGREGATIONS[fn].label} of ${(valueField && valueField.name) || "field"}`;

  const columns = [{ key: "label", name: rowField.name || "Rows", type: inferLabelType(rowLabels) }];
  if (hasColumns) {
    shownCols.forEach((id, position) => {
      columns.push({ key: `col_${position}`, name: labelText(colLabels[id], colField), type: valueType });
    });
    columns.push({ key: "total", name: "Total", type: valueType });
  } else {
    columns.push({ key: "value", name: valueName, type: valueType });
  }

  const rows = [];
  for (let r = 0; r < R; r += 1) {
    const out = [labelText(rowLabels[shownRows[r]], rowField)];
    for (let c = 0; c < C; c += 1) out.push(show(cells.value(r * C + c)));
    out.push(show(rowTotals.value(r)));
    rows.push(out);
  }
  const totals = ["Total"];
  for (let c = 0; c < C; c += 1) totals.push(show(colTotals.value(c)));
  totals.push(show(grand.value(0)));
  rows.push(totals);

  return { columns, rows, totalRows: rowLabels.length, truncatedColumns: colLabels.length > PIVOT_MAX_COLUMNS };
}
