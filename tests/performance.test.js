import { describe, expect, it } from "vitest";
import { highlightCells } from "@/lib/conditional";
import { joinLookup } from "@/lib/lookup";
import { cellIssues, runPipeline, toDisplayRows } from "@/lib/pipeline";
import { runPivot } from "@/lib/pivot";
import {
  createAggregation,
  createCleaning,
  createConditionalFormat,
  createDefinition,
  createField,
  createGroupBy,
  createLookup,
  createOutput,
  createTransform,
} from "@/lib/schema";

const ROWS = 100_000;
const PRODUCTS = 20_000;

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTables() {
  const next = random(7);
  const regions = [" North", "south ", "East", "West  ", null];
  const main = {
    columns: ["Order", "Date", "Region", "Customer", "SKU", "Qty", "Price", "Status", "Note", "Code"].map((name, index) => ({
      name,
      type: ["Qty", "Price"].includes(name) ? "number" : name === "Date" ? "date" : "text",
      index,
    })),
    rows: new Array(ROWS),
    warnings: [],
  };
  for (let r = 0; r < ROWS; r += 1) {
    const duplicate = r % 50 === 49; // every 50th row repeats the one before it
    const previous = duplicate ? main.rows[r - 1] : null;
    main.rows[r] = previous
      ? previous.slice()
      : [
          `SO-${r}`,
          new Date(Date.UTC(2024, 0, 1 + Math.floor(next() * 365))),
          regions[Math.floor(next() * regions.length)],
          `Customer   ${Math.floor(next() * 5000)}`,
          `sku-${Math.floor(next() * PRODUCTS * 1.1)}`,
          next() < 0.02 ? null : 1 + Math.floor(next() * 20),
          Math.round(next() * 100000) / 100,
          next() < 0.1 ? "Cancelled" : "Delivered",
          next() < 0.5 ? null : "  some   note  ",
          Math.floor(next() * 1e6),
        ];
  }
  const lookup = {
    columns: [
      { name: "SKU", type: "text", index: 0 },
      { name: "Product", type: "text", index: 1 },
      { name: "Category", type: "text", index: 2 },
      { name: "Cost", type: "number", index: 3 },
    ],
    rows: Array.from({ length: PRODUCTS }, (_, i) => [`SKU-${i}`, `Product ${i}`, `Cat ${i % 40}`, i / 10]),
  };
  return { main, lookup };
}

describe("100k rows: cleaning + lookup", () => {
  it("stays fast and bounded", () => {
    const { main, lookup } = makeTables();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();

    const { info } = joinLookup(main, lookup, createLookup({ enabled: true, matchColumn: "SKU", lookupColumn: "SKU" }));
    const joined = performance.now();
    expect(info.applied).toBe(true);
    expect(info.matched + info.unmatched).toBe(ROWS);
    expect(info.matched).toBeGreaterThan(ROWS * 0.8);

    const column = (name, transforms = []) => createField({ name, source: { kind: "column", column: name }, transforms });
    const fields = [
      column("Order"),
      column("Date", [createTransform("dateFormat", { pattern: "DD MMM YYYY" })]),
      column("Region", [createTransform("title")]),
      column("Customer"),
      column("Product"),
      column("Category"),
      createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" }, transforms: [createTransform("numberFormat", { decimals: 2 })] }),
      column("Status"),
      column("Note"),
      column("Code"),
    ];
    const total = fields[6];
    const output = createOutput({
      name: "Detail",
      conditionalFormats: [createConditionalFormat({ columnKey: total.id, operator: "gt", value: "10000", style: "green" })],
    });
    const definition = createDefinition({
      fields,
      cleaning: createCleaning({
        trimText: true,
        removeEmptyRows: true,
        removeDuplicates: { enabled: true, keys: [] },
        fillBlanks: { enabled: true, mode: "previous", fieldIds: [fields[2].id] },
      }),
      outputs: [output],
    });
    const result = runPipeline(main, definition, { outputId: output.id });
    const cleaned = performance.now();
    expect(result.stats.duplicatesRemoved).toBe(Math.floor(ROWS / 50));
    expect(result.stats.blanksFilled).toBeGreaterThan(0);
    expect(result.totalRows).toBe(ROWS - result.stats.duplicatesRemoved);
    expect(toDisplayRows(result, 50)).toHaveLength(50);
    expect(cellIssues(result, 50).length).toBeGreaterThan(0);
    expect(highlightCells(result, output.conditionalFormats, 50).length).toBeGreaterThan(0);

    const grouped = runPipeline(main, {
      ...definition,
      groupBy: createGroupBy({ enabled: true, keys: [fields[5].id], aggregations: [createAggregation({ fieldId: total.id, fn: "sum" })] }),
    });
    expect(grouped.totalRows).toBeGreaterThan(30);
    const pivot = runPivot(main, definition, { rowKey: fields[5].id, columnKey: fields[2].id, valueKey: total.id, fn: "sum" });
    expect(pivot.rows.length).toBeGreaterThan(30);
    const finished = performance.now();

    const heapGrowth = (process.memoryUsage().heapUsed - heapBefore) / 1048576;
    // Generous bounds: a sanity check against accidental quadratic work or runaway memory, not a benchmark.
    expect(joined - started).toBeLessThan(2000);
    expect(cleaned - joined).toBeLessThan(5000);
    expect(finished - started).toBeLessThan(12000);
    expect(heapGrowth).toBeLessThan(800);
  }, 60_000);
});
