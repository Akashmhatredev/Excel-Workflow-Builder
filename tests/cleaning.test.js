import { describe, expect, it } from "vitest";
import { runPipeline, scanRows, toDisplayRows } from "@/lib/pipeline";
import {
  createAggregation,
  createCleaning,
  createDefinition,
  createField,
  createFilterRule,
  createGroupBy,
  createOutput,
  createTransform,
} from "@/lib/schema";
import { validateDefinition } from "@/lib/validate";

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const TABLE = {
  columns: [
    { name: "Region", type: "text", index: 0 },
    { name: "Customer", type: "text", index: 1 },
    { name: "Amount", type: "number", index: 2 },
    { name: "Date", type: "date", index: 3 },
  ],
  rows: [
    ["  North ", "Asha   Rao", 100, day(2024, 1, 5)],
    [null, "Ravi", 50, null],
    [null, "  ", null, null],
    ["South", "asha rao", 100, day(2024, 1, 5)],
    ["North", "Asha Rao", 100, day(2024, 1, 5)],
    [null, "Neha", null, day(2024, 2, 1)],
    ["East", "Karan", 75, null],
  ],
};

const column = (name, columnName = name, transforms = []) =>
  createField({ name, source: { kind: "column", column: columnName }, transforms });
const region = column("Region");
const customer = column("Customer");
const amount = column("Amount");
const date = column("Date", "Date", [createTransform("dateFormat", { pattern: "DD/MM/YYYY" })]);
const fields = [region, customer, amount, date];
const run = (cleaning, extra = {}) => runPipeline(TABLE, createDefinition({ fields, cleaning, ...extra }));

describe("cleaning", () => {
  it("does nothing and reports zeros when switched off", () => {
    const result = run(createCleaning());
    expect(result.totalRows).toBe(7);
    expect(result.stats).toEqual({ emptyRowsRemoved: 0, duplicatesRemoved: 0, blanksFilled: 0 });
    expect(toDisplayRows(result, 1)).toEqual([["  North ", "Asha   Rao", "100", "05/01/2024"]]);
  });

  it("trims and collapses spaces in text values, and empties whitespace-only text", () => {
    const result = run(createCleaning({ trimText: true }));
    expect(result.rows[0].slice(0, 2)).toEqual(["North", "Asha Rao"]);
    expect(result.rows[2]).toEqual([null, null, null, null]);
    expect(result.rows[0][2]).toBe(100);
  });

  it("removes rows whose mapped fields are all empty", () => {
    expect(run(createCleaning({ removeEmptyRows: true })).stats.emptyRowsRemoved).toBe(1); // whitespace-only text is empty
    const result = run(createCleaning({ trimText: true, removeEmptyRows: true }));
    expect(result.totalRows).toBe(6);
    expect(result.stats.emptyRowsRemoved).toBe(1);
  });

  it("removes duplicates over the whole row, ignoring case, first row wins", () => {
    const result = run(createCleaning({ trimText: true, removeDuplicates: { enabled: true, keys: [] } }));
    // row 5 repeats row 1 after trimming; "asha rao" in the South is a different row
    expect(result.stats.duplicatesRemoved).toBe(1);
    expect(result.rows.map((row) => row[1])).toEqual(["Asha Rao", "Ravi", null, "asha rao", "Neha", "Karan"]);
  });

  it("removes duplicates on chosen key fields only", () => {
    const result = run(createCleaning({ trimText: true, removeDuplicates: { enabled: true, keys: [customer.id] } }));
    expect(result.rows.map((row) => row[1])).toEqual(["Asha Rao", "Ravi", null, "Neha", "Karan"]);
    expect(result.stats.duplicatesRemoved).toBe(2);
  });

  it("fills blanks with a typed fixed value for chosen fields", () => {
    const result = run(createCleaning({ fillBlanks: { enabled: true, mode: "value", value: "0", fieldIds: [amount.id] } }));
    expect(result.rows.map((row) => row[2])).toEqual([100, 50, 0, 100, 100, 0, 75]);
    expect(result.stats.blanksFilled).toBe(2);
    const dates = run(createCleaning({ fillBlanks: { enabled: true, mode: "value", value: "2024-12-31", fieldIds: [date.id] } }));
    expect(dates.rows[1][3]).toEqual(day(2024, 12, 31));
    expect(toDisplayRows(dates, 2)[1][3]).toBe("31/12/2024");
  });

  it("fills blanks from the row above, for every field when none are chosen", () => {
    const result = run(createCleaning({ trimText: true, removeEmptyRows: true, fillBlanks: { enabled: true, mode: "previous" } }));
    expect(toDisplayRows(result)).toEqual([
      ["North", "Asha Rao", "100", "05/01/2024"],
      ["North", "Ravi", "50", "05/01/2024"],
      ["South", "asha rao", "100", "05/01/2024"],
      ["North", "Asha Rao", "100", "05/01/2024"],
      ["North", "Neha", "100", "01/02/2024"],
      ["East", "Karan", "75", "01/02/2024"],
    ]);
    expect(result.stats).toEqual({ emptyRowsRemoved: 1, duplicatesRemoved: 0, blanksFilled: 5 });
  });

  it("fills before removing duplicates, and does not count fills on removed rows", () => {
    const table = {
      columns: TABLE.columns.slice(0, 2),
      rows: [
        ["North", "A"],
        [null, "A"],
        ["South", "B"],
      ],
    };
    const definition = createDefinition({
      fields: [region, customer],
      cleaning: createCleaning({ fillBlanks: { enabled: true, mode: "previous" }, removeDuplicates: { enabled: true, keys: [] } }),
    });
    const result = runPipeline(table, definition);
    expect(result.rows).toEqual([
      ["North", "A"],
      ["South", "B"],
    ]);
    expect(result.stats).toEqual({ emptyRowsRemoved: 0, duplicatesRemoved: 1, blanksFilled: 0 });
  });

  it("runs after the filter and before grouping", () => {
    const sum = createAggregation({ fieldId: amount.id, fn: "sum", name: "Total" });
    const rows = createAggregation({ fn: "count", name: "Rows" });
    const result = run(createCleaning({ trimText: true, removeDuplicates: { enabled: true, keys: [] } }), {
      filters: { combinator: "and", rules: [createFilterRule({ target: { kind: "column", ref: "Customer" }, operator: "notEquals", value: "Karan" })] },
      groupBy: createGroupBy({ enabled: true, keys: [region.id], aggregations: [sum, rows] }),
    });
    expect(toDisplayRows(result)).toEqual([
      ["North", "100", "1"],
      ["", "50", "3"],
      ["South", "100", "1"],
    ]);
    expect(result.stats.duplicatesRemoved).toBe(1);
  });

  it("cleans on every field even when an output keeps only some of them", () => {
    const narrow = createOutput({ name: "Names", fieldIds: [customer.id] });
    const definition = createDefinition({ fields, outputs: [narrow], cleaning: createCleaning({ trimText: true, removeDuplicates: { enabled: true, keys: [] } }) });
    const result = runPipeline(TABLE, definition, { outputId: narrow.id });
    expect(result.rows.map((row) => row[0])).toEqual(["Asha Rao", "Ravi", null, "asha rao", "Neha", "Karan"]);
  });

  it("ignores deleted fields and switches an option off when all of its fields are gone", () => {
    const result = run(createCleaning({ removeDuplicates: { enabled: true, keys: ["fld_gone"] }, fillBlanks: { enabled: true, mode: "value", value: "x", fieldIds: ["fld_gone"] } }));
    expect(result.totalRows).toBe(7);
    expect(result.stats).toEqual({ emptyRowsRemoved: 0, duplicatesRemoved: 0, blanksFilled: 0 });
  });

  it("does not count formula failures on rows that cleaning removed", () => {
    const ratio = createField({ name: "Ratio", source: { kind: "formula", expression: "{Amount} / 0" } });
    const definition = createDefinition({ fields: [customer, ratio], cleaning: createCleaning({ removeDuplicates: { enabled: true, keys: [customer.id] }, trimText: true }) });
    const result = runPipeline(TABLE, definition);
    expect(result.issues).toHaveLength(1);
    // 7 rows fail, 2 of them are removed as duplicates
    expect(result.issues[0].message).toMatch(/^Formula failed on 5 rows/);
  });

  it("exposes the cleaned workflow-level rows through scanRows", () => {
    const seen = [];
    const out = scanRows(TABLE, createDefinition({ fields, cleaning: createCleaning({ trimText: true, removeEmptyRows: true }) }), [customer.id, "nope"], (values) => seen.push([...values]));
    expect(seen.map((values) => values[0])).toEqual(["Asha Rao", "Ravi", "asha rao", "Asha Rao", "Neha", "Karan"]);
    expect(seen.every((values) => values[1] === null)).toBe(true);
    expect(out.stats.emptyRowsRemoved).toBe(1);
    expect(out.fields).toEqual([{ id: customer.id, name: "Customer", format: null, fallbackType: "text" }, null]);
  });
});

describe("cleaning validation", () => {
  it("reports cleaning options that use deleted fields", () => {
    const columns = TABLE.columns;
    const all = validateDefinition(createDefinition({ fields, cleaning: createCleaning({ removeDuplicates: { enabled: true, keys: ["gone"] } }) }), columns);
    expect(all).toEqual([
      {
        level: "warning",
        scope: "cleaning",
        id: "removeDuplicates",
        code: "missing-field",
        message: "Remove duplicates uses a field that no longer exists, so it does nothing. Choose the fields again.",
      },
    ]);
    const some = validateDefinition(
      createDefinition({ fields, cleaning: createCleaning({ fillBlanks: { enabled: true, fieldIds: [amount.id, "a", "b"] } }) }),
      columns,
    );
    expect(some).toEqual([
      { level: "warning", scope: "cleaning", id: "fillBlanks", code: "missing-field", message: "Fill blanks: 2 of its fields no longer exist and are skipped." },
    ]);
    const off = createCleaning({ removeDuplicates: { enabled: false, keys: ["gone"] } });
    expect(validateDefinition(createDefinition({ fields, cleaning: off }), columns)).toEqual([]);
  });
});
