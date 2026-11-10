import { describe, expect, it } from "vitest";
import { PIVOT_MAX_COLUMNS, runPivot } from "@/lib/pivot";
import { createCleaning, createDefinition, createField, createFilterRule, createGroupBy, createTransform } from "@/lib/schema";

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const TABLE = {
  columns: [
    { name: "Region", type: "text", index: 0 },
    { name: "Status", type: "text", index: 1 },
    { name: "Amount", type: "number", index: 2 },
    { name: "Date", type: "date", index: 3 },
  ],
  rows: [
    ["North", "Open", 100, day(2024, 1, 5)],
    ["South", "Closed", 50.5, day(2024, 1, 3)],
    ["North", "Closed", 25, day(2024, 2, 1)],
    [null, "Open", 10, null],
    ["North", "Open", 0.1, day(2023, 12, 31)],
    ["East", null, "n/a", null],
  ],
};

const column = (name, transforms = []) => createField({ name, source: { kind: "column", column: name }, transforms });
const region = column("Region");
const status = column("Status");
const amount = column("Amount", [createTransform("numberFormat", { decimals: 2, thousands: true, prefix: "₹" })]);
const date = column("Date", [createTransform("dateFormat", { pattern: "DD MMM YYYY" })]);
const definition = createDefinition({ fields: [region, status, amount, date] });

describe("runPivot", () => {
  it("counts rows per label with a totals row", () => {
    const pivot = runPivot(TABLE, definition, { rowKey: region.id, fn: "count" });
    expect(pivot.columns).toEqual([
      { key: "label", name: "Region", type: "text" },
      { key: "value", name: "Count", type: "number" },
    ]);
    expect(pivot.rows).toEqual([
      ["East", "1"],
      ["North", "3"],
      ["South", "1"],
      ["(blank)", "1"],
      ["Total", "6"],
    ]);
    expect(pivot.totalRows).toBe(4);
    expect(pivot.truncatedColumns).toBe(false);
  });

  it("spreads values over columns with row and column totals, in the value field's format", () => {
    const pivot = runPivot(TABLE, definition, { rowKey: region.id, columnKey: status.id, valueKey: amount.id, fn: "sum" });
    expect(pivot.columns.map((c) => [c.key, c.name, c.type])).toEqual([
      ["label", "Region", "text"],
      ["col_0", "Closed", "number"],
      ["col_1", "Open", "number"],
      ["col_2", "(blank)", "number"],
      ["total", "Total", "number"],
    ]);
    expect(pivot.rows).toEqual([
      ["East", "", "", "₹0.00", "₹0.00"],
      ["North", "₹25.00", "₹100.10", "", "₹125.10"],
      ["South", "₹50.50", "", "", "₹50.50"],
      ["(blank)", "", "₹10.00", "", "₹10.00"],
      ["Total", "₹75.50", "₹110.10", "₹0.00", "₹185.60"],
    ]);
  });

  it("averages, counts values and finds min / max", () => {
    const avg = runPivot(TABLE, definition, { rowKey: status.id, valueKey: amount.id, fn: "avg" });
    expect(avg.columns[1].name).toBe("Average of Amount");
    expect(avg.rows).toEqual([
      ["Closed", "₹37.75"],
      ["Open", "₹36.70"],
      ["(blank)", ""],
      ["Total", "₹37.12"],
    ]);
    const counted = runPivot(TABLE, definition, { rowKey: status.id, valueKey: date.id, fn: "count" });
    expect(counted.rows.map((row) => row[1])).toEqual(["2", "2", "0", "4"]);
    const latest = runPivot(TABLE, definition, { rowKey: region.id, valueKey: date.id, fn: "max" });
    expect(latest.columns[1]).toEqual({ key: "value", name: "Max of Date", type: "date" });
    expect(latest.rows).toEqual([
      ["East", ""],
      ["North", "01 Feb 2024"],
      ["South", "03 Jan 2024"],
      ["(blank)", ""],
      ["Total", "01 Feb 2024"],
    ]);
    const earliest = runPivot(TABLE, definition, { rowKey: region.id, valueKey: date.id, fn: "min" });
    expect(earliest.rows[1]).toEqual(["North", "31 Dec 2023"]);
  });

  it("sorts and formats date and number labels", () => {
    const pivot = runPivot(TABLE, definition, { rowKey: date.id, fn: "count", limit: 2 });
    expect(pivot.columns[0]).toEqual({ key: "label", name: "Date", type: "date" });
    expect(pivot.rows).toEqual([
      ["31 Dec 2023", "1"],
      ["03 Jan 2024", "1"],
      ["Total", "6"],
    ]);
    expect(pivot.totalRows).toBe(5);
  });

  it("uses the workflow filter and cleaning, but not grouping", () => {
    const filtered = createDefinition({
      fields: [region, status, amount, date],
      filters: { combinator: "and", rules: [createFilterRule({ target: { kind: "column", ref: "Status" }, operator: "equals", value: "open" })] },
      cleaning: createCleaning({ removeDuplicates: { enabled: true, keys: [region.id] } }),
      groupBy: createGroupBy({ enabled: true, keys: [status.id] }),
    });
    const pivot = runPivot(TABLE, filtered, { rowKey: region.id, valueKey: amount.id, fn: "sum" });
    expect(pivot.rows).toEqual([
      ["North", "₹100.00"],
      ["(blank)", "₹10.00"],
      ["Total", "₹110.00"],
    ]);
  });

  it("caps the number of columns and keeps the totals complete", () => {
    const rows = Array.from({ length: PIVOT_MAX_COLUMNS + 5 }, (_, i) => ["A", `c${String(i).padStart(3, "0")}`, 1, null]);
    const pivot = runPivot({ columns: TABLE.columns, rows }, definition, { rowKey: region.id, columnKey: status.id, fn: "count" });
    expect(pivot.truncatedColumns).toBe(true);
    expect(pivot.columns).toHaveLength(PIVOT_MAX_COLUMNS + 2);
    expect(pivot.rows[0].at(-1)).toBe(String(PIVOT_MAX_COLUMNS + 5));
    expect(pivot.rows.at(-1).at(-1)).toBe(String(PIVOT_MAX_COLUMNS + 5));
  });

  it("refuses requests without a row field or value field", () => {
    const code = (options) => {
      try {
        runPivot(TABLE, definition, options);
      } catch (error) {
        return [error.code, error.message];
      }
      return null;
    };
    expect(code({ rowKey: "gone" })).toEqual(["INVALID_DEFINITION", "Choose a field for the rows of the summary."]);
    expect(code({ rowKey: region.id, fn: "sum" })).toEqual(["INVALID_DEFINITION", "Choose a field for Sum."]);
    expect(code({ rowKey: region.id, fn: "median" })[0]).toBe("INVALID_DEFINITION");
    expect(code({ rowKey: region.id, columnKey: "gone" })[1]).toMatch(/column field/);
  });

  it("is reachable through the worker", async () => {
    const { handlers, resetDatasets } = await import("@/workers/parse.worker");
    resetDatasets();
    const csv = new TextEncoder().encode("Region,Amount\nNorth,10\nSouth,5\nNorth,2\n");
    const file = { name: "a.csv", size: csv.length, lastModified: 0, arrayBuffer: async () => csv.slice().buffer };
    const ctx = { progress: () => {} };
    await handlers.parseFile({ file, datasetId: "main" }, ctx);
    await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1 }, ctx);
    const r = column("Region");
    const a = column("Amount");
    const pivot = await handlers.runPivot({ datasetId: "main", definition: createDefinition({ fields: [r, a] }), rowKey: r.id, valueKey: a.id, fn: "sum" }, ctx);
    expect(pivot.rows).toEqual([
      ["North", "12"],
      ["South", "5"],
      ["Total", "17"],
    ]);
  });
});
