/**
 * lib/pipeline.js (owner: Agent A): turns a table + workflow definition into result rows.
 *
 * Order: map fields -> filter -> clean (lib/cleaning.js) -> group / aggregate -> sort -> project columns.
 *
 * Everything that depends on the definition (column accessors, formulas, transform
 * chains, filter predicates) is compiled once per run; the per-row work is array
 * reads and closure calls. Rows hold typed values (string | number | boolean | Date |
 * null); `toDisplayRows` turns them into the strings the UI shows and `cellIssues`
 * marks the cells that are empty or could not be computed.
 *
 * Run-time problems never throw: they are counted and returned as `issues`
 * (codes: formula-failed, format-skipped, non-numeric).
 */

import { compileCleaning } from "./cleaning.js";
import { compareText, compileFilterGroup, isRuleComplete } from "./filters.js";
import { FORMULA_ERROR, compileFormula, compileTemplate } from "./formula.js";
import { AGGREGATIONS, getResultColumns, isGroupingActive, normalizeDefinition, resolveOutputConfig } from "./schema.js";
import {
  cleanNumber,
  compileTransforms,
  formatDisplay,
  isEmpty,
  splitTrailingFormat,
  toDate,
  toNumber,
  toText,
} from "./transforms.js";
import { createColumnLookup } from "./validate.js";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const plural = (count, one, many) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* fields                                                               */
/* ------------------------------------------------------------------ */

/**
 * Compile one mapping field.
 * @returns {{ field, direct: number, get: (row) => any, format: object|null, fallbackType: string,
 *             broken: boolean, failed: { n, last }, unformatted: { n, last } }}
 *   direct >= 0 means "copy source column `direct` as is" (no closure call needed).
 *   broken means no row can be computed (the formula does not compile, or the source column is missing).
 *   A formula that fails on a row pushes `slotIndex` onto `run.failed`.
 */
function compileField(field, lookup, run, slotIndex) {
  const source = field.source || {};
  const { head, format } = splitTrailingFormat(field.transforms);
  const chain = head.length ? compileTransforms(head) : null;
  const failed = { n: 0, last: -1 };
  const unformatted = { n: 0, last: -1 };
  const accessor = (name) => {
    const column = lookup.find(name);
    if (!column) return () => null;
    const index = column.index;
    return (row) => row[index];
  };

  let read = () => null;
  let direct = -1;
  let isFormula = false;
  let broken = false;
  let fallbackType = "text";
  if (source.kind === "combine") {
    read = compileTemplate(source.template).bind(accessor);
  } else if (source.kind === "formula") {
    const compiled = compileFormula(source.expression);
    if (compiled.ok) {
      read = compiled.bind(accessor);
      isFormula = true;
    } else {
      broken = String(source.expression ?? "").trim() !== "";
    }
  } else {
    const column = lookup.find(source.column);
    if (column) {
      direct = column.index;
      read = (row) => row[direct];
      if (!head.length) fallbackType = column.type || "text";
    } else {
      broken = Boolean(source.column);
    }
  }
  if (format) fallbackType = format.type === "numberFormat" ? "number" : "date";

  if (!chain && !format && !isFormula) {
    return { field, direct, get: read, format: null, fallbackType, broken, failed, unformatted };
  }

  const wantsNumber = Boolean(format) && format.type === "numberFormat";
  const wantsDate = Boolean(format) && format.type === "dateFormat";
  const get = (row) => {
    let value = read(row);
    if (value === FORMULA_ERROR) {
      value = null;
      failed.n += 1;
      failed.last = run.row;
      run.failed.push(slotIndex);
    }
    if (chain) value = chain(value);
    if (value === null || value === undefined) return null;
    if (wantsNumber) {
      if (typeof value !== "number") {
        const n = toNumber(value);
        if (n !== null) return n;
        if (!isEmpty(value)) {
          unformatted.n += 1;
          unformatted.last = run.row;
        }
      }
    } else if (wantsDate && !(value instanceof Date)) {
      const date = toDate(value);
      if (date) return date;
      if (!isEmpty(value)) {
        unformatted.n += 1;
        unformatted.last = run.row;
      }
    }
    return value;
  };
  return { field, direct: -1, get, format, fallbackType, broken, failed, unformatted };
}

/* ------------------------------------------------------------------ */
/* grouping                                                             */
/* ------------------------------------------------------------------ */

function keyPart(value) {
  if (typeof value === "string") return value === "" || value.trim() === "" ? "\u0000" : value;
  if (value === null || value === undefined) return "\u0000";
  if (typeof value === "number") return Number.isNaN(value) ? "\u0000" : `\u0000n${value}`;
  if (value instanceof Date) return `\u0000d${value.getTime()}`;
  return `\u0000b${String(value)}`;
}

/** Total order across kinds: numbers (and numeric text), then dates, then text. Empty values are not expected. */
export function compareMixed(a, b) {
  const numberA = typeof a === "number" ? a : toNumber(a);
  const numberB = typeof b === "number" ? b : toNumber(b);
  if (numberA !== null && numberB !== null) return numberA < numberB ? -1 : numberA > numberB ? 1 : 0;
  if (numberA !== null) return -1;
  if (numberB !== null) return 1;
  const dateA = toDate(a);
  const dateB = toDate(b);
  if (dateA && dateB) return dateA.getTime() < dateB.getTime() ? -1 : dateA.getTime() > dateB.getTime() ? 1 : 0;
  if (dateA) return -1;
  if (dateB) return 1;
  return compareText(toText(a).trim(), toText(b).trim());
}

/** Per-group state for one aggregation. `slot` is -1 when the aggregation has no (existing) field. */
function createAggregator(aggregation, slot) {
  const fn = aggregation.fn;
  if (fn === "count") {
    const counts = [];
    const countRows = !aggregation.fieldId;
    return {
      skipped: () => 0,
      open: () => counts.push(0),
      add: countRows
        ? (group) => {
            counts[group] += 1;
          }
        : (group, row) => {
            if (slot >= 0 && !isEmpty(row[slot])) counts[group] += 1;
          },
      value: (group) => counts[group],
    };
  }
  if (fn === "min" || fn === "max") {
    const best = [];
    const sign = fn === "min" ? 1 : -1;
    return {
      skipped: () => 0,
      open: () => best.push(null),
      add: (group, row) => {
        if (slot < 0) return;
        const value = row[slot];
        if (isEmpty(value)) return;
        const current = best[group];
        if (current === null || sign * compareMixed(value, current) < 0) best[group] = value;
      },
      value: (group) => best[group],
    };
  }
  const sums = [];
  const counts = [];
  let skipped = 0;
  return {
    skipped: () => skipped,
    open: () => {
      sums.push(0);
      counts.push(0);
    },
    add: (group, row) => {
      if (slot < 0) return;
      const value = row[slot];
      const n = typeof value === "number" ? value : toNumber(value);
      if (n !== null && !Number.isNaN(n)) {
        sums[group] += n;
        counts[group] += 1;
      } else if (!isEmpty(value)) {
        skipped += 1;
      }
    },
    value:
      fn === "avg"
        ? (group) => (counts[group] ? cleanNumber(sums[group] / counts[group]) : null)
        : (group) => cleanNumber(sums[group]),
  };
}

/* ------------------------------------------------------------------ */
/* sorting                                                              */
/* ------------------------------------------------------------------ */

const KIND_NUMBER = 0;
const KIND_DATE = 1;
const KIND_TEXT = 2;
const KIND_EMPTY = 3;

/** Pre-compute a comparable (kind, value) pair per row for one sort column. */
function buildSortKey(rows, index, direction) {
  const count = rows.length;
  const kinds = new Uint8Array(count);
  const values = new Float64Array(count);
  const texts = new Map(); // trimmed text -> rows that hold it
  for (let r = 0; r < count; r += 1) {
    const value = rows[r][index];
    if (value === null || value === undefined) {
      kinds[r] = KIND_EMPTY;
    } else if (typeof value === "number") {
      if (Number.isNaN(value)) kinds[r] = KIND_EMPTY;
      else values[r] = value;
    } else if (value instanceof Date) {
      const time = value.getTime();
      if (Number.isNaN(time)) kinds[r] = KIND_EMPTY;
      else {
        kinds[r] = KIND_DATE;
        values[r] = time;
      }
    } else {
      const text = toText(value).trim();
      if (text === "") {
        kinds[r] = KIND_EMPTY;
        continue;
      }
      const n = typeof value === "string" ? toNumber(text) : null;
      if (n !== null) {
        values[r] = n;
        continue;
      }
      const date = typeof value === "string" ? toDate(text) : null;
      if (date) {
        kinds[r] = KIND_DATE;
        values[r] = date.getTime();
        continue;
      }
      kinds[r] = KIND_TEXT;
      const holders = texts.get(text);
      if (holders) holders.push(r);
      else texts.set(text, [r]);
    }
  }
  if (texts.size) {
    // Rank the distinct texts once instead of collating on every comparison.
    const distinct = [...texts.keys()].sort(compareText);
    let rank = 0;
    for (let i = 0; i < distinct.length; i += 1) {
      if (i > 0 && compareText(distinct[i - 1], distinct[i]) !== 0) rank += 1;
      const holders = texts.get(distinct[i]);
      for (let j = 0; j < holders.length; j += 1) values[holders[j]] = rank;
    }
  }
  return { kinds, values, direction: direction === "desc" ? -1 : 1 };
}

/**
 * Stable multi-key sort. Like Excel, ascending order is numbers, then dates, then text
 * and descending reverses that; empty values go last in both directions.
 */
function sortRows(rows, keys) {
  if (!keys.length || rows.length < 2) return rows;
  const count = rows.length;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  const keyCount = keys.length;
  order.sort((a, b) => {
    for (let k = 0; k < keyCount; k += 1) {
      const key = keys[k];
      const kindA = key.kinds[a];
      const kindB = key.kinds[b];
      if (kindA !== kindB) {
        if (kindA === KIND_EMPTY) return 1;
        if (kindB === KIND_EMPTY) return -1;
        return key.direction * (kindA - kindB);
      }
      if (kindA === KIND_EMPTY) continue;
      const valueA = key.values[a];
      const valueB = key.values[b];
      if (valueA !== valueB) return valueA < valueB ? -key.direction : key.direction;
    }
    return a - b;
  });
  const sorted = new Array(count);
  for (let i = 0; i < count; i += 1) sorted[i] = rows[order[i]];
  return sorted;
}

/* ------------------------------------------------------------------ */
/* result columns                                                       */
/* ------------------------------------------------------------------ */

function inferType(rows, index, fallback) {
  let type = null;
  for (let r = 0; r < rows.length; r += 1) {
    const value = rows[r][index];
    if (value === null || value === undefined || value === "") continue;
    let kind;
    if (typeof value === "number") {
      if (Number.isNaN(value)) continue;
      kind = "number";
    } else if (value instanceof Date) {
      kind = "date";
    } else {
      if (typeof value === "string" && value.trim() === "") continue;
      return "text";
    }
    if (type === null) type = kind;
    else if (type !== kind) return "text";
  }
  return type || fallback || "text";
}

/* ------------------------------------------------------------------ */
/* the pipeline                                                         */
/* ------------------------------------------------------------------ */

/**
 * The per-run state shared by runPipeline and scanRows: the source rows, a column finder
 * and the "slots" (the fields this run computes, in a fixed order). `need(fieldId)` reserves
 * the slot of a field and returns its index (-1 for an unknown field).
 */
function createRun(table, def) {
  const lookup = createColumnLookup((table && table.columns) || []);
  const run = { row: 0, failed: [] };
  const fieldById = new Map(def.fields.map((field) => [field.id, field]));
  const slotOf = new Map();
  const slots = [];
  const need = (fieldId) => {
    const field = fieldById.get(fieldId);
    if (!field) return -1;
    let slot = slotOf.get(fieldId);
    if (slot === undefined) {
      slot = slots.length;
      slotOf.set(fieldId, slot);
      slots.push(compileField(field, lookup, run, slot));
    }
    return slot;
  };
  return {
    def,
    source: (table && Array.isArray(table.rows) && table.rows) || [],
    lookup,
    run,
    slots,
    slotOf,
    need,
  };
}

/**
 * Compile the filter and the cleaning of a run. Both may reserve slots, so call this after the
 * result columns and the sort keys have reserved theirs; no slot may be added afterwards.
 */
function prepareScan(ctx, filters, cleaning) {
  const { lookup, need, slots } = ctx;
  const activeRules = ((filters && filters.rules) || []).filter(isRuleComplete);
  const predicate = compileFilterGroup(filters, (target) => {
    if (target.kind === "field") {
      const slot = need(target.ref);
      return slot < 0 ? () => null : (row, mapped) => mapped[slot];
    }
    const column = lookup.find(target.ref);
    if (!column) return () => null;
    const index = column.index;
    return (row) => row[index];
  });
  const clean = compileCleaning(cleaning, ctx.def.fields, need, slots);
  return {
    predicate,
    filterReadsFields: activeRules.some((rule) => rule.target.kind === "field"),
    clean: clean.apply,
    stats: clean.stats,
  };
}

/**
 * One pass over the source: map every slot, filter, clean, then `onRow(mapped, failedSlots)`.
 * With `reuse` the same `mapped` array is passed for every row (the caller must not keep it);
 * otherwise each row gets a new array. `failedSlots` lists the slots whose formula failed on this row
 * (it is reused too: copy it to keep it).
 */
function scanSource(ctx, scan, reuse, onRow) {
  const { source, slots, run } = ctx;
  const { predicate, filterReadsFields, clean } = scan;
  const slotCount = slots.length;
  const direct = slots.map((slot) => slot.direct);
  const getters = slots.map((slot) => slot.get);
  const counters = [];
  for (const slot of slots) counters.push(slot.failed, slot.unformatted);
  // A row dropped after its fields were computed must not count in the run-time issues.
  const undo = (rowNumber) => {
    for (let i = 0; i < counters.length; i += 1) {
      const counter = counters[i];
      if (counter.last === rowNumber) {
        counter.n -= 1;
        counter.last = -1;
      }
    }
  };
  const failed = run.failed;
  const scratch = reuse ? new Array(slotCount) : null;
  const sourceCount = source.length;
  for (let r = 0; r < sourceCount; r += 1) {
    const row = source[r];
    if (!row) continue;
    run.row = r;
    if (predicate && !filterReadsFields && !predicate(row, null)) continue;
    if (failed.length) failed.length = 0;
    const mapped = scratch || new Array(slotCount);
    for (let s = 0; s < slotCount; s += 1) {
      const index = direct[s];
      const value = index >= 0 ? row[index] : getters[s](row);
      mapped[s] = value === undefined ? null : value;
    }
    if (predicate && filterReadsFields && !predicate(row, mapped)) {
      undo(r);
      continue;
    }
    if (clean && !clean(mapped)) {
      undo(r);
      continue;
    }
    onRow(mapped, failed);
  }
}

/**
 * @param {{ columns: { name: string, type: string, index: number }[], rows: any[][] }} table
 * @param {object} definition  WorkflowDefinition
 * @param {{ outputId?: string | null }} [options]  null = the workflow-level result (mapping step)
 * @returns {{ columns: { key: string, name: string, type: 'text'|'number'|'date', format: object|null }[],
 *             rows: any[][], totalRows: number, sourceRows: number, issues: object[],
 *             stats: { emptyRowsRemoved: number, duplicatesRemoved: number, blanksFilled: number },
 *             brokenColumns: number[], failures: WeakMap<any[], number[]> | null }}
 *   brokenColumns: indexes of columns no cell of which could be computed. failures: result row -> column
 *   indexes whose formula failed on that row (only without grouping). Both feed `cellIssues`.
 * @throws an Error with code INVALID_DEFINITION when `outputId` does not exist
 */
export function runPipeline(table, definition, options = {}) {
  const def = normalizeDefinition(definition);
  const outputId = (options && options.outputId) || null;
  const output = outputId ? def.outputs.find((candidate) => candidate.id === outputId) : null;
  if (outputId && !output) throw codedError("INVALID_DEFINITION", "That output no longer exists.");

  const ctx = createRun(table, def);
  const { slots, slotOf, need } = ctx;
  const sourceCount = ctx.source.length;
  const config = resolveOutputConfig(def, output);
  const grouping = isGroupingActive(config.groupBy);
  const resultColumns = getResultColumns(def, output);
  const issues = [];

  const keySlots = [];
  const aggregators = [];
  if (grouping) {
    for (const column of resultColumns) if (column.role === "key") keySlots.push(need(column.fieldId));
    for (const aggregation of config.groupBy.aggregations || []) {
      const slot = aggregation.fieldId ? need(aggregation.fieldId) : -1;
      aggregators.push({ aggregation, slot, state: createAggregator(aggregation, slot) });
    }
  } else {
    for (const column of resultColumns) need(column.fieldId);
  }

  /* sort plan (also reserves slots for fields that are only sorted on) */
  const sortPlan = [];
  const sortSeen = new Set();
  for (const rule of config.sort || []) {
    if (!rule || !rule.key || sortSeen.has(rule.key)) continue;
    let index = -1;
    if (grouping) index = resultColumns.findIndex((column) => column.key === rule.key);
    else index = need(rule.key);
    if (index < 0) continue;
    sortSeen.add(rule.key);
    sortPlan.push({ index, direction: rule.direction });
  }

  /* filter + cleaning (they may reserve the last slots) */
  const scan = prepareScan(ctx, config.filters, def.cleaning);
  const slotCount = slots.length;

  /* map + filter + clean (+ group) in one pass over the source */
  let rows = [];
  const failures = grouping ? null : new WeakMap();
  let anyFailure = false;
  const groupIndex = new Map();
  const groupKeys = [];
  const keyCount = keySlots.length;

  scanSource(ctx, scan, grouping, (mapped, failed) => {
    if (!grouping) {
      rows.push(mapped);
      if (failed.length) {
        failures.set(mapped, failed.slice());
        anyFailure = true;
      }
      return;
    }
    let key = "";
    for (let k = 0; k < keyCount; k += 1) {
      const part = keyPart(mapped[keySlots[k]]);
      key = k === 0 ? part : `${key}\u0001${part}`;
    }
    let group = groupIndex.get(key);
    if (group === undefined) {
      group = groupKeys.length;
      groupIndex.set(key, group);
      const values = new Array(keyCount);
      for (let k = 0; k < keyCount; k += 1) {
        const value = mapped[keySlots[k]];
        values[k] = isEmpty(value) ? null : value;
      }
      groupKeys.push(values);
      for (let a = 0; a < aggregators.length; a += 1) aggregators[a].state.open();
    }
    for (let a = 0; a < aggregators.length; a += 1) aggregators[a].state.add(group, mapped);
  });

  /* shape the result */
  const columns = [];
  if (grouping) {
    if (keyCount === 0 && groupKeys.length === 0) {
      groupKeys.push([]);
      for (const entry of aggregators) entry.state.open();
    }
    rows = new Array(groupKeys.length);
    for (let g = 0; g < groupKeys.length; g += 1) {
      const out = new Array(keyCount + aggregators.length);
      const keys = groupKeys[g];
      for (let k = 0; k < keyCount; k += 1) out[k] = keys[k];
      for (let a = 0; a < aggregators.length; a += 1) {
        const value = aggregators[a].state.value(g);
        out[keyCount + a] = value === undefined ? null : value;
      }
      rows[g] = out;
    }
    const groupOutputId = output && output.overrides.groupBy.enabled ? output.id : null;
    let keyAt = 0;
    let aggregationAt = 0;
    for (const column of resultColumns) {
      if (column.role === "key") {
        const slot = slots[keySlots[keyAt]];
        keyAt += 1;
        columns.push({
          key: column.key,
          name: column.name,
          format: slot.format,
          fallback: slot.fallbackType,
          broken: slot.broken,
        });
        continue;
      }
      const entry = aggregators[aggregationAt];
      aggregationAt += 1;
      const fn = entry.aggregation.fn;
      const slot = entry.slot >= 0 ? slots[entry.slot] : null;
      let format = null;
      if (slot && slot.format) {
        if (fn === "min" || fn === "max") format = slot.format;
        else if ((fn === "sum" || fn === "avg") && slot.format.type === "numberFormat") format = slot.format;
      }
      const fallback = fn === "min" || fn === "max" ? (slot ? slot.fallbackType : "text") : "number";
      columns.push({ key: column.key, name: column.name, format, fallback, broken: Boolean(slot && slot.broken) });
      const skipped = entry.state.skipped();
      if (skipped) {
        const label = (AGGREGATIONS[fn] && AGGREGATIONS[fn].label) || "Summary";
        const issue = {
          level: "warning",
          scope: "groupBy",
          id: entry.aggregation.id,
          code: "non-numeric",
          message: `${label} skipped ${plural(skipped, "value that is not a number", "values that are not numbers")}.`,
        };
        if (groupOutputId) issue.outputId = groupOutputId;
        issues.push(issue);
      }
    }
  } else {
    for (const column of resultColumns) {
      const slot = slots[slotOf.get(column.fieldId)];
      columns.push({
        key: column.key,
        name: column.name,
        format: slot.format,
        fallback: slot.fallbackType,
        broken: slot.broken,
      });
    }
  }

  if (sortPlan.length) {
    rows = sortRows(
      rows,
      sortPlan.map((plan) => buildSortKey(rows, plan.index, plan.direction)),
    );
  }

  if (!grouping) {
    const plan = resultColumns.map((column) => slotOf.get(column.fieldId));
    const width = plan.length;
    const inOrder = plan.every((slot, index) => slot === index);
    if (!inOrder) {
      for (let r = 0; r < rows.length; r += 1) {
        const mapped = rows[r];
        const out = new Array(width);
        for (let c = 0; c < width; c += 1) out[c] = mapped[plan[c]];
        rows[r] = out;
        // Failed slots -> the result columns that show them (a field can appear twice).
        const failedSlots = anyFailure ? failures.get(mapped) : undefined;
        if (failedSlots) {
          const failedColumns = [];
          for (let c = 0; c < width; c += 1) if (failedSlots.includes(plan[c])) failedColumns.push(c);
          if (failedColumns.length) failures.set(out, failedColumns);
        }
      }
    } else if (slotCount > width) {
      for (let r = 0; r < rows.length; r += 1) rows[r].length = width;
    }
  }

  for (const slot of slots) {
    if (slot.failed.n) {
      issues.push({
        level: "warning",
        scope: "field",
        id: slot.field.id,
        code: "formula-failed",
        message: `Formula failed on ${plural(slot.failed.n, "row", "rows")} (text used as a number, or a division by zero). Those cells are left empty.`,
      });
    }
    if (slot.unformatted.n) {
      const numeric = slot.format && slot.format.type === "numberFormat";
      issues.push({
        level: "warning",
        scope: "field",
        id: slot.field.id,
        code: "format-skipped",
        message: numeric
          ? `${plural(slot.unformatted.n, "value is not a number", "values are not numbers")}, so the number format was not applied there.`
          : `${plural(slot.unformatted.n, "value is not a date", "values are not dates")}, so the date format was not applied there.`,
      });
    }
  }

  return {
    columns: columns.map((column, index) => ({
      key: column.key,
      name: column.name,
      type: inferType(rows, index, column.fallback),
      format: column.format || null,
    })),
    rows,
    totalRows: rows.length,
    sourceRows: sourceCount,
    issues,
    stats: { ...scan.stats },
    brokenColumns: columns.flatMap((column, index) => (column.broken ? [index] : [])),
    failures: anyFailure ? failures : null,
  };
}

/**
 * Map, filter and clean the workflow-level rows (definition.filters and definition.cleaning;
 * grouping, sorting and outputs are ignored) and call `onRow(values)` for every row that is kept.
 * `values[i]` is the value of `fieldIds[i]` (null for an unknown id); the array is reused.
 *
 * @returns {{ fields: ({ id: string, name: string, format: object|null, fallbackType: string } | null)[],
 *             stats: { emptyRowsRemoved: number, duplicatesRemoved: number, blanksFilled: number },
 *             sourceRows: number }}
 */
export function scanRows(table, definition, fieldIds, onRow) {
  const def = normalizeDefinition(definition);
  const ctx = createRun(table, def);
  const wanted = (fieldIds || []).map((id) => ctx.need(id));
  const scan = prepareScan(ctx, def.filters, def.cleaning);
  const count = wanted.length;
  const values = new Array(count);
  scanSource(ctx, scan, true, (mapped) => {
    for (let i = 0; i < count; i += 1) values[i] = wanted[i] >= 0 ? mapped[wanted[i]] : null;
    onRow(values);
  });
  return {
    fields: wanted.map((slot) => {
      if (slot < 0) return null;
      const { field, format, fallbackType } = ctx.slots[slot];
      return { id: field.id, name: field.name, format: format || null, fallbackType };
    }),
    stats: { ...scan.stats },
    sourceRows: ctx.source.length,
  };
}

/**
 * Cell marks for the first `limit` result rows: [rowIndex, columnIndex, 'error' | 'blank'].
 *   'error': the value could not be computed (a formula failed, or the field's formula / source column
 *            is broken), or it does not fit the column format (text in a number-formatted column,
 *            a value that is not a date in a date-formatted column)
 *   'blank': the cell is empty
 * @returns {[number, number, 'error' | 'blank'][]}
 */
export function cellIssues(result, limit) {
  const rows = (result && result.rows) || [];
  const columns = (result && result.columns) || [];
  const failures = (result && result.failures) || null;
  const broken = new Set((result && result.brokenColumns) || []);
  const wanted = typeof limit === "number" && limit >= 0 ? Math.floor(limit) : rows.length;
  const count = Math.min(rows.length, wanted);
  const width = columns.length;
  // 0 plain, 1 number format, 2 date format, 3 broken
  const kinds = columns.map((column, index) => {
    if (broken.has(index)) return 3;
    if (column.format && column.format.type === "numberFormat") return 1;
    if (column.format && column.format.type === "dateFormat") return 2;
    return 0;
  });
  const out = [];
  for (let r = 0; r < count; r += 1) {
    const row = rows[r];
    const failed = failures ? failures.get(row) : undefined;
    for (let c = 0; c < width; c += 1) {
      const kind = kinds[c];
      const value = row[c];
      if (kind === 3) out.push([r, c, "error"]);
      else if (isEmpty(value)) out.push([r, c, failed && failed.includes(c) ? "error" : "blank"]);
      else if (kind === 1 && typeof value !== "number") out.push([r, c, "error"]);
      else if (kind === 2 && !(value instanceof Date)) out.push([r, c, "error"]);
    }
  }
  return out;
}

/**
 * The first `limit` result rows as display strings (all rows when `limit` is omitted).
 * @returns {string[][]}
 */
export function toDisplayRows(result, limit) {
  const rows = (result && result.rows) || [];
  const columns = (result && result.columns) || [];
  const wanted = typeof limit === "number" && limit >= 0 ? Math.floor(limit) : rows.length;
  const count = Math.min(rows.length, wanted);
  const width = columns.length;
  const formats = columns.map((column) => column.format || null);
  const out = new Array(count);
  for (let r = 0; r < count; r += 1) {
    const row = rows[r];
    const cells = new Array(width);
    for (let c = 0; c < width; c += 1) {
      const format = formats[c];
      cells[c] = format ? formatDisplay(row[c], format) : toText(row[c]);
    }
    out[r] = cells;
  }
  return out;
}
