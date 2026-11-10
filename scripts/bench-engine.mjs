#!/usr/bin/env node
/**
 * Time the data engine on a file (make one with scripts/make-large-sample.mjs).
 *
 *   node scripts/bench-engine.mjs <file.xlsx|file.csv>
 *
 * Prints the time of each step: read, build the table, a plain mapping run, a
 * filter + group-by + sort run, a lookup merge, a cleaning run, a pivot, writing
 * xlsx (plain and styled) and csv. Nothing is written to disk.
 */

import { readFile } from "node:fs/promises";
import { highlightCells } from "../lib/conditional.js";
import { buildTable, readWorkbook, writeCsv, writeStyledXlsx, writeXlsx } from "../lib/excel.js";
import { joinLookup } from "../lib/lookup.js";
import { cellIssues, runPipeline, toDisplayRows } from "../lib/pipeline.js";
import { runPivot } from "../lib/pivot.js";
import {
  createAggregation,
  createCleaning,
  createConditionalFormat,
  createDefinition,
  createField,
  createFilterRule,
  createGroupBy,
  createLookup,
  createSortRule,
  createTransform,
} from "../lib/schema.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/bench-engine.mjs <file.xlsx|file.csv>");
  process.exit(1);
}

const timings = [];
function time(label, fn) {
  const started = performance.now();
  const value = fn();
  timings.push([label, performance.now() - started]);
  return value;
}
async function timeAsync(label, fn) {
  const started = performance.now();
  const value = await fn();
  timings.push([label, performance.now() - started]);
  return value;
}

const bytes = await readFile(target);
const workbook = time("readWorkbook", () => readWorkbook(bytes, target));
const table = time("buildTable", () => buildTable(workbook, {}));
console.log(`${table.rows.length.toLocaleString("en-US")} rows x ${table.columns.length} columns`);

const plainFields = table.columns.map((column) =>
  createField({ name: column.name, source: { kind: "column", column: column.name } }),
);
const plain = createDefinition({ fields: plainFields });
const plainResult = time("runPipeline (plain mapping)", () => runPipeline(table, plain));
time("toDisplayRows (first 20)", () => toDisplayRows(plainResult, 20));

const region = createField({
  name: "Region",
  source: { kind: "column", column: "Region" },
  transforms: [createTransform("trim"), createTransform("title")],
});
const customer = createField({
  name: "Customer",
  source: { kind: "combine", template: "{Customer First Name} {Customer Last Name}" },
});
const total = createField({
  name: "Line Total",
  source: { kind: "formula", expression: "ROUND({Qty} * {Unit Price} * (1 - {Discount %} / 100), 2)" },
  transforms: [createTransform("numberFormat", { decimals: 2, thousands: true, prefix: "₹" })],
});
const date = createField({
  name: "Order Date",
  source: { kind: "column", column: "Order Date" },
  transforms: [createTransform("dateFormat", { pattern: "DD MMM YYYY" })],
});
const sum = createAggregation({ fieldId: total.id, fn: "sum", name: "Sales" });
const count = createAggregation({ fn: "count", name: "Orders" });
const mapped = createDefinition({
  fields: [date, customer, region, total, ...plainFields],
  filters: {
    combinator: "and",
    rules: [createFilterRule({ target: { kind: "column", ref: "Status" }, operator: "notEquals", value: "Cancelled" })],
  },
  sort: [createSortRule({ key: total.id, direction: "desc" }), createSortRule({ key: customer.id })],
});
const mappedResult = time("runPipeline (transforms, formula, filter, sort)", () => runPipeline(table, mapped));
const grouped = {
  ...mapped,
  groupBy: createGroupBy({ enabled: true, keys: [region.id], aggregations: [sum, count] }),
  sort: [createSortRule({ key: sum.id, direction: "desc" })],
};
const groupedResult = time("runPipeline (filter + group-by + sort)", () => runPipeline(table, grouped));
console.log(`grouped into ${groupedResult.totalRows} rows`);

// Lookup: every other order id has a tracking row (a 50k-row lookup joined onto every row).
const idColumn = table.columns.find((column) => column.name === "Order ID");
if (idColumn) {
  const lookupTable = {
    columns: [
      { name: "Order ID", type: "text", index: 0 },
      { name: "Courier", type: "text", index: 1 },
      { name: "Shipping Cost", type: "number", index: 2 },
    ],
    rows: table.rows.filter((_, r) => r % 2 === 0).map((row, i) => [String(row[idColumn.index]).toLowerCase(), `Courier ${i % 7}`, i % 300]),
  };
  const joined = time("joinLookup (50k-row lookup)", () =>
    joinLookup(table, lookupTable, createLookup({ enabled: true, matchColumn: "Order ID", lookupColumn: "Order ID" })),
  );
  console.log(`lookup matched ${joined.info.matched.toLocaleString("en-US")} rows`);
}

const cleaned = {
  ...mapped,
  sort: [],
  cleaning: createCleaning({
    trimText: true,
    removeEmptyRows: true,
    removeDuplicates: { enabled: true, keys: [] },
    fillBlanks: { enabled: true, mode: "previous", fieldIds: [] },
  }),
};
const cleanedResult = time("runPipeline (all cleaning options)", () => runPipeline(table, cleaned));
console.log(`cleaning: ${JSON.stringify(cleanedResult.stats)}`);
time("cellIssues + highlights (first 50)", () => {
  cellIssues(cleanedResult, 50);
  highlightCells(cleanedResult, [createConditionalFormat({ columnKey: total.id, operator: "gt", value: "50000" })], 50);
});
time("runPivot (region x status, sum)", () =>
  runPivot(table, mapped, { rowKey: region.id, columnKey: plainFields.find((f) => f.name === "Status")?.id ?? null, valueKey: total.id, fn: "sum" }),
);

time("writeXlsx (plain mapping)", () => writeXlsx(plainResult, { sheetName: "Data" }));
time("writeXlsx (mapped result)", () => writeXlsx(mappedResult, { sheetName: "Data" }));
await timeAsync("writeStyledXlsx (mapped, styled + 2 rules)", () =>
  writeStyledXlsx(mappedResult, {
    sheetName: "Data",
    sheetStyle: { boldHeader: true, freezeHeader: true, autoFilter: true },
    conditionalFormats: [
      createConditionalFormat({ columnKey: total.id, operator: "gt", value: "50000", style: "green" }),
      createConditionalFormat({ columnKey: region.id, operator: "isEmpty", style: "grey" }),
    ],
  }),
);
time("writeCsv (mapped result)", () => writeCsv(mappedResult));

for (const [label, ms] of timings) console.log(`${label.padEnd(48)} ${Math.round(ms).toString().padStart(6)} ms`);
const memory = process.memoryUsage();
console.log(`heap used ${(memory.heapUsed / 1048576).toFixed(0)} MB, rss ${(memory.rss / 1048576).toFixed(0)} MB`);
