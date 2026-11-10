import { describe, expect, it } from "vitest";
import { cellIssues, runPipeline } from "@/lib/pipeline";
import {
  createAggregation,
  createCleaning,
  createDefinition,
  createField,
  createGroupBy,
  createOutput,
  createSortRule,
  createTransform,
} from "@/lib/schema";

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const TABLE = {
  columns: [
    { name: "Item", type: "text", index: 0 },
    { name: "Qty", type: "text", index: 1 },
    { name: "Price", type: "number", index: 2 },
    { name: "When", type: "text", index: 3 },
  ],
  rows: [
    ["Pen", 2, 10, "2024-01-05"],
    ["Ink", "n/a", 5, "soon"],
    ["Pad", 4, null, null],
  ],
};

const column = (name, columnName = name, transforms = []) =>
  createField({ name, source: { kind: "column", column: columnName }, transforms });

describe("cellIssues", () => {
  it("marks blanks, failed formulas and values that do not fit the column format", () => {
    const item = column("Item");
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const qty = column("Qty", "Qty", [createTransform("numberFormat", { decimals: 0 })]);
    const when = column("When", "When", [createTransform("dateFormat", { pattern: "DD/MM/YYYY" })]);
    const result = runPipeline(TABLE, createDefinition({ fields: [item, total, qty, when] }));
    expect(cellIssues(result, 10)).toEqual([
      [1, 1, "error"], // "n/a" * 5
      [1, 2, "error"], // "n/a" with a number format
      [1, 3, "error"], // "soon" with a date format
      [2, 3, "blank"],
    ]);
    expect(result.rows[2][1]).toBe(0); // an empty cell counts as 0 in a formula
    expect(cellIssues(result, 1)).toEqual([]);
    expect(cellIssues(result, 0)).toEqual([]);
  });

  it("follows rows through sorting and column reordering", () => {
    const item = column("Item");
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const output = createOutput({ name: "Out", fieldIds: [total.id, item.id] });
    const definition = createDefinition({
      fields: [item, total],
      sort: [createSortRule({ key: item.id, direction: "asc" })],
      outputs: [output],
    });
    const result = runPipeline(TABLE, definition, { outputId: output.id });
    expect(result.rows.map((row) => row[1])).toEqual(["Ink", "Pad", "Pen"]);
    expect(cellIssues(result)).toEqual([[0, 0, "error"]]);
  });

  it("marks every cell of a broken field as an error", () => {
    const bad = createField({ name: "Bad", source: { kind: "formula", expression: "{Qty} *" } });
    const gone = column("Gone", "Nope");
    const unset = column("Unset", "");
    const result = runPipeline(TABLE, createDefinition({ fields: [bad, gone, unset] }));
    expect(result.brokenColumns).toEqual([0, 1]);
    expect(cellIssues(result, 1)).toEqual([
      [0, 0, "error"],
      [0, 1, "error"],
      [0, 2, "blank"],
    ]);
  });

  it("does not report a failed formula whose cell was filled by cleaning", () => {
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const definition = createDefinition({
      fields: [total],
      cleaning: createCleaning({ fillBlanks: { enabled: true, mode: "value", value: "-1" } }),
    });
    const result = runPipeline(TABLE, definition);
    expect(result.rows[1][0]).toBe(-1);
    expect(cellIssues(result)).toEqual([]);
  });

  it("marks blank keys and empty summaries of grouped results", () => {
    const when = column("When");
    const price = column("Price");
    const avg = createAggregation({ fieldId: price.id, fn: "avg", name: "Avg" });
    const definition = createDefinition({
      fields: [when, price],
      groupBy: createGroupBy({ enabled: true, keys: [when.id], aggregations: [avg] }),
    });
    const result = runPipeline(TABLE, definition);
    expect(result.rows).toEqual([
      ["2024-01-05", 10],
      ["soon", 5],
      [null, null],
    ]);
    expect(cellIssues(result)).toEqual([
      [2, 0, "blank"],
      [2, 1, "blank"],
    ]);
    expect(result.failures).toBeNull();
  });

  it("checks dates and numbers by their typed value", () => {
    const table = { columns: [{ name: "D", type: "date", index: 0 }], rows: [[day(2024, 1, 5)], [45296]] };
    const field = column("D", "D", [createTransform("dateFormat", { pattern: "YYYY" })]);
    const result = runPipeline(table, createDefinition({ fields: [field] }));
    expect(cellIssues(result)).toEqual([[1, 0, "error"]]);
  });
});
