import { describe, expect, it } from "vitest";
import { runPipeline, toDisplayRows } from "@/lib/pipeline";
import {
  createAggregation,
  createDefinition,
  createField,
  createFilterRule,
  createGroupBy,
  createOutput,
  createSortRule,
  createTransform,
  getResultColumns,
} from "@/lib/schema";

const day = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

const TABLE = {
  columns: [
    { name: "Order ID", type: "text", index: 0 },
    { name: "Date", type: "date", index: 1 },
    { name: "First", type: "text", index: 2 },
    { name: "Last", type: "text", index: 3 },
    { name: "Region", type: "text", index: 4 },
    { name: "Qty", type: "number", index: 5 },
    { name: "Price", type: "number", index: 6 },
    { name: "Status", type: "text", index: 7 },
  ],
  rows: [
    ["SO-1", day(2024, 1, 5), "asha", "rao", "North", 2, 100, "Delivered"],
    ["SO-2", day(2024, 1, 3), "Vikram", null, " south ", 1, 250.5, "pending"],
    ["SO-3", day(2024, 2, 1), "Neha", "Iyer", "NORTH", 5, 20, "Cancelled"],
    ["SO-4", null, "Karan", "Das", "East", "n/a", 75, "Delivered"],
    ["SO-5", day(2023, 12, 31), "Meera", "Khan", null, 3, 10.1, "Delivered"],
  ],
};

const column = (name, columnName = name, transforms = []) =>
  createField({ name, source: { kind: "column", column: columnName }, transforms });
const rule = (target, operator, value, value2 = "") => createFilterRule({ target, operator, value, value2 });
const display = (result, limit) => toDisplayRows(result, limit);

describe("runPipeline: mapping", () => {
  it("copies, combines and calculates fields, in field order", () => {
    const id = column("ID", "Order ID");
    const name = createField({ name: "Customer", source: { kind: "combine", template: "{First} {Last}" }, transforms: [createTransform("title")] });
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const result = runPipeline(TABLE, createDefinition({ fields: [id, name, total] }));
    expect(result.columns).toEqual([
      { key: id.id, name: "ID", type: "text", format: null },
      { key: name.id, name: "Customer", type: "text", format: null },
      { key: total.id, name: "Total", type: "number", format: null },
    ]);
    expect(result.rows.map((row) => row[2])).toEqual([200, 250.5, 100, null, 30.3]);
    expect(display(result)).toEqual([
      ["SO-1", "Asha Rao", "200"],
      ["SO-2", "Vikram", "250.5"],
      ["SO-3", "Neha Iyer", "100"],
      ["SO-4", "Karan Das", ""],
      ["SO-5", "Meera Khan", "30.3"],
    ]);
    expect(result.totalRows).toBe(5);
    expect(result.sourceRows).toBe(5);
  });

  it("counts rows a formula could not compute as one issue", () => {
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const result = runPipeline(TABLE, createDefinition({ fields: [total] }));
    expect(result.issues).toEqual([
      {
        level: "warning",
        scope: "field",
        id: total.id,
        code: "formula-failed",
        message: "Formula failed on 1 row (text used as a number, or a division by zero). Those cells are left empty.",
      },
    ]);
  });

  it("keeps typed values for a trailing format and stringifies formats elsewhere", () => {
    const typed = column("Price", "Price", [createTransform("numberFormat", { decimals: 2, thousands: true, prefix: "₹" })]);
    const text = column("Price text", "Price", [createTransform("numberFormat", { decimals: 0 }), createTransform("trim")]);
    const date = column("Date", "Date", [createTransform("dateFormat", { pattern: "DD MMM YYYY" })]);
    const result = runPipeline(TABLE, createDefinition({ fields: [typed, text, date] }));
    expect(result.rows[0]).toEqual([100, "100", day(2024, 1, 5)]);
    expect(result.columns.map((c) => [c.type, c.format && c.format.type])).toEqual([
      ["number", "numberFormat"],
      ["text", null],
      ["date", "dateFormat"],
    ]);
    expect(display(result, 2)).toEqual([
      ["₹100.00", "100", "05 Jan 2024"],
      ["₹250.50", "251", "03 Jan 2024"],
    ]);
  });

  it("converts text to the type a trailing format wants and reports what it could not", () => {
    const table = { columns: [{ name: "Amount", type: "text", index: 0 }], rows: [["1,200"], ["n/a"], [null], ["05/01/2024"]] };
    const amount = column("Amount", "Amount", [createTransform("numberFormat", { decimals: 0, thousands: true })]);
    const result = runPipeline(table, createDefinition({ fields: [amount] }));
    expect(result.rows.map((row) => row[0])).toEqual([1200, "n/a", null, "05/01/2024"]);
    expect(result.columns[0].type).toBe("text");
    expect(display(result)).toEqual([["1,200"], ["n/a"], [""], ["05/01/2024"]]);
    expect(result.issues).toMatchObject([
      { code: "format-skipped", id: amount.id, message: "2 values are not numbers, so the number format was not applied there." },
    ]);
    const asDate = column("When", "Amount", [createTransform("dateFormat", { pattern: "D/M/YYYY" })]);
    const dates = runPipeline(table, createDefinition({ fields: [asDate] }));
    expect(display(dates)).toEqual([["1,200"], ["n/a"], [""], ["5/1/2024"]]);
  });

  it("leaves cells of missing columns empty", () => {
    const ghost = column("Ghost", "Nope");
    const combine = createField({ name: "C", source: { kind: "combine", template: "{Nope}-{Region}" } });
    const result = runPipeline(TABLE, createDefinition({ fields: [ghost, combine] }));
    expect(result.rows[0]).toEqual([null, "-North"]);
    expect(result.columns[0].type).toBe("text");
  });

  it("finds columns ignoring case and spaces", () => {
    const result = runPipeline(TABLE, createDefinition({ fields: [column("Q", " qty ")] }));
    expect(result.rows[0]).toEqual([2]);
  });

  it("handles an empty table and an empty definition", () => {
    expect(runPipeline({ columns: [], rows: [] }, createDefinition())).toMatchObject({ columns: [], rows: [], totalRows: 0, sourceRows: 0 });
    const empty = runPipeline(null, createDefinition({ fields: [column("Qty")] }));
    expect(empty.rows).toEqual([]);
    expect(empty.columns[0].type).toBe("text");
  });

  it("ignores definition parts it does not use yet", () => {
    const definition = {
      ...createDefinition({ fields: [column("Qty")] }),
      cleaning: { trimText: true, removeDuplicates: { enabled: true, keys: [] } },
      lookup: { enabled: true, matchColumn: "Order ID", lookupColumn: "Code" },
    };
    expect(runPipeline(TABLE, definition).totalRows).toBe(5);
  });
});

describe("runPipeline: filters", () => {
  const region = column("Region", "Region", [createTransform("trim"), createTransform("title")]);
  const qty = column("Qty");

  it("filters on raw source columns", () => {
    const definition = createDefinition({
      fields: [column("ID", "Order ID")],
      filters: { combinator: "and", rules: [rule({ kind: "column", ref: "Status" }, "equals", "delivered")] },
    });
    expect(display(runPipeline(TABLE, definition))).toEqual([["SO-1"], ["SO-4"], ["SO-5"]]);
  });

  it("filters on mapped field values (after transforms)", () => {
    const raw = createDefinition({
      fields: [region],
      filters: { combinator: "and", rules: [rule({ kind: "column", ref: "Region" }, "equals", "South")] },
    });
    expect(runPipeline(TABLE, raw).totalRows).toBe(1);
    const mapped = createDefinition({
      fields: [column("ID", "Order ID")],
      filters: { combinator: "and", rules: [rule({ kind: "field", ref: region.id }, "startsWith", "No")] },
    });
    // the filter field is not part of the output, but still computed for the filter
    mapped.fields.push(region);
    mapped.outputs = [createOutput({ fieldIds: [mapped.fields[0].id] })];
    expect(display(runPipeline(TABLE, mapped, { outputId: mapped.outputs[0].id }))).toEqual([["SO-1"], ["SO-3"]]);
  });

  it("combines rules with OR and ignores incomplete ones", () => {
    const definition = createDefinition({
      fields: [qty],
      filters: {
        combinator: "or",
        rules: [
          rule({ kind: "column", ref: "Qty" }, "gte", "5"),
          rule({ kind: "column", ref: "Region" }, "isEmpty", ""),
          rule({ kind: "column", ref: "Status" }, "equals", ""),
          rule({ kind: "column", ref: "" }, "equals", "x"),
        ],
      },
    });
    expect(runPipeline(TABLE, definition).rows).toEqual([[5], [3]]);
  });

  it("does not count formula failures of rows that were filtered out", () => {
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const keepTotals = createDefinition({
      fields: [total],
      filters: { combinator: "and", rules: [rule({ kind: "field", ref: total.id }, "notEmpty", "")] },
    });
    const result = runPipeline(TABLE, keepTotals);
    expect(result.totalRows).toBe(4);
    expect(result.issues).toEqual([]);
  });

  it("uses an output's filter override instead of the workflow filter", () => {
    const output = createOutput({
      overrides: { filters: { enabled: true, group: { combinator: "and", rules: [rule({ kind: "column", ref: "Qty" }, "lt", "2")] } } },
    });
    const definition = createDefinition({
      fields: [qty],
      filters: { combinator: "and", rules: [rule({ kind: "column", ref: "Qty" }, "gt", "2")] },
      outputs: [output],
    });
    expect(runPipeline(TABLE, definition).rows).toEqual([[5], [3]]);
    expect(runPipeline(TABLE, definition, { outputId: output.id }).rows).toEqual([[1]]);
  });
});

describe("runPipeline: grouping", () => {
  const region = column("Region", "Region", [createTransform("trim"), createTransform("title")]);
  const status = column("Status", "Status", [createTransform("upper")]);
  const total = createField({
    name: "Total",
    source: { kind: "formula", expression: "{Qty} * {Price}" },
    transforms: [createTransform("numberFormat", { decimals: 1, thousands: true, prefix: "$" })],
  });
  const date = column("Date", "Date", [createTransform("dateFormat", { pattern: "DD/MM/YYYY" })]);

  function grouped(keys, aggregations, extra = {}) {
    return createDefinition({
      fields: [region, status, total, date],
      groupBy: createGroupBy({ enabled: true, keys, aggregations }),
      ...extra,
    });
  }

  it("groups by mapped values and aggregates", () => {
    const sum = createAggregation({ fieldId: total.id, fn: "sum" });
    const avg = createAggregation({ fieldId: total.id, fn: "avg", name: "Average" });
    const rows = createAggregation({ fn: "count" });
    const filled = createAggregation({ fieldId: total.id, fn: "count", name: "With total" });
    const first = createAggregation({ fieldId: date.id, fn: "min", name: "First" });
    const last = createAggregation({ fieldId: date.id, fn: "max", name: "Last" });
    const definition = grouped([region.id], [sum, avg, rows, filled, first, last]);
    const result = runPipeline(TABLE, definition);
    expect(result.columns.map((c) => [c.name, c.type, c.format && c.format.type])).toEqual([
      ["Region", "text", null],
      ["Sum of Total", "number", "numberFormat"],
      ["Average", "number", "numberFormat"],
      ["Count", "number", null],
      ["With total", "number", null],
      ["First", "date", "dateFormat"],
      ["Last", "date", "dateFormat"],
    ]);
    expect(result.columns.map((c) => c.key)).toEqual(getResultColumns(definition).map((c) => c.key));
    expect(display(result)).toEqual([
      ["North", "$300.0", "$150.0", "2", "2", "05/01/2024", "01/02/2024"],
      ["South", "$250.5", "$250.5", "1", "1", "03/01/2024", "03/01/2024"],
      ["East", "$0.0", "", "1", "0", "", ""],
      ["", "$30.3", "$30.3", "1", "1", "31/12/2023", "31/12/2023"],
    ]);
    expect(result.totalRows).toBe(4);
    expect(result.sourceRows).toBe(5);
  });

  it("supports several keys and no keys at all", () => {
    const count = createAggregation({ fn: "count" });
    const byTwo = runPipeline(TABLE, grouped([region.id, status.id], [count]));
    expect(display(byTwo)).toEqual([
      ["North", "DELIVERED", "1"],
      ["South", "PENDING", "1"],
      ["North", "CANCELLED", "1"],
      ["East", "DELIVERED", "1"],
      ["", "DELIVERED", "1"],
    ]);
    const sum = createAggregation({ fieldId: total.id, fn: "sum" });
    expect(display(runPipeline(TABLE, grouped([], [count, sum])))).toEqual([["5", "$580.8"]]);
    const nothing = runPipeline({ columns: TABLE.columns, rows: [] }, grouped([], [count]));
    expect(display(nothing)).toEqual([["0"]]);
    expect(runPipeline({ columns: TABLE.columns, rows: [] }, grouped([region.id], [count])).rows).toEqual([]);
  });

  it("warns when numeric summaries skip text values", () => {
    const sumStatus = createAggregation({ fieldId: status.id, fn: "sum" });
    const result = runPipeline(TABLE, grouped([], [sumStatus]));
    expect(result.rows).toEqual([[0]]);
    expect(result.issues).toMatchObject([
      { scope: "groupBy", id: sumStatus.id, code: "non-numeric", message: "Sum skipped 5 values that are not numbers." },
    ]);
  });

  it("filters before grouping and sorts grouped results by result columns", () => {
    const sum = createAggregation({ fieldId: total.id, fn: "sum" });
    const definition = grouped([region.id], [sum], {
      filters: { combinator: "and", rules: [rule({ kind: "field", ref: status.id }, "notEquals", "cancelled")] },
      sort: [createSortRule({ key: sum.id, direction: "desc" }), createSortRule({ key: date.id })],
    });
    expect(display(runPipeline(TABLE, definition))).toEqual([
      ["South", "$250.5"],
      ["North", "$200.0"],
      ["", "$30.3"],
      ["East", "$0.0"],
    ]);
  });

  it("uses an output's grouping override and ignores its field selection", () => {
    const count = createAggregation({ fn: "count", name: "Orders" });
    const output = createOutput({
      fieldIds: [date.id],
      overrides: {
        groupBy: { enabled: true, config: createGroupBy({ keys: [status.id], aggregations: [count] }) },
        sort: { enabled: true, rules: [createSortRule({ key: count.id, direction: "desc" })] },
      },
    });
    const definition = createDefinition({ fields: [region, status, total, date], outputs: [output] });
    const result = runPipeline(TABLE, definition, { outputId: output.id });
    expect(result.columns.map((c) => c.name)).toEqual(["Status", "Orders"]);
    expect(display(result)).toEqual([
      ["DELIVERED", "3"],
      ["PENDING", "1"],
      ["CANCELLED", "1"],
    ]);
    expect(runPipeline(TABLE, definition).columns).toHaveLength(4);
  });
});

describe("runPipeline: sorting and projection", () => {
  const id = column("ID", "Order ID");
  const qty = column("Qty");
  const date = column("Date");
  const region = column("Region");

  const ids = (definition, options) => runPipeline(TABLE, definition, options).rows.map((row) => row[0]);

  it("sorts numbers, dates and text, with empty values last in both directions", () => {
    expect(ids(createDefinition({ fields: [id, qty], sort: [createSortRule({ key: qty.id })] }))).toEqual(["SO-2", "SO-1", "SO-5", "SO-3", "SO-4"]);
    expect(ids(createDefinition({ fields: [id, date], sort: [createSortRule({ key: date.id, direction: "desc" })] }))).toEqual([
      "SO-3",
      "SO-1",
      "SO-2",
      "SO-5",
      "SO-4",
    ]);
    expect(ids(createDefinition({ fields: [id, region], sort: [createSortRule({ key: region.id })] }))).toEqual(["SO-4", "SO-1", "SO-3", "SO-2", "SO-5"]);
    expect(ids(createDefinition({ fields: [id, region], sort: [createSortRule({ key: region.id, direction: "desc" })] }))).toEqual([
      "SO-2",
      "SO-1",
      "SO-3",
      "SO-4",
      "SO-5",
    ]);
  });

  it("is stable and applies keys in order", () => {
    const table = {
      columns: [
        { name: "K", type: "text", index: 0 },
        { name: "N", type: "number", index: 1 },
        { name: "Pos", type: "number", index: 2 },
      ],
      rows: [
        ["b", 1, 1],
        ["a", 2, 2],
        ["b", 1, 3],
        ["a", 1, 4],
        ["B", 2, 5],
      ],
    };
    const k = column("K");
    const n = column("N");
    const pos = column("Pos");
    const result = runPipeline(table, createDefinition({ fields: [k, n, pos], sort: [createSortRule({ key: k.id }), createSortRule({ key: n.id, direction: "desc" })] }));
    expect(result.rows.map((row) => row[2])).toEqual([2, 4, 5, 1, 3]);
  });

  it("orders numeric text numerically and mixed kinds numbers, dates, then text", () => {
    const table = { columns: [{ name: "V", type: "text", index: 0 }], rows: [["10"], ["9"], ["apple"], [day(2024, 1, 1)], [3], [""], ["2024-01-02"]] };
    const v = column("V");
    const result = runPipeline(table, createDefinition({ fields: [v], sort: [createSortRule({ key: v.id })] }));
    expect(display(result).map((row) => row[0])).toEqual(["3", "9", "10", "2024-01-01", "2024-01-02", "apple", ""]);
  });

  it("can sort by a field the output does not include, and ignores unknown keys", () => {
    const output = createOutput({ fieldIds: [id.id] });
    const definition = createDefinition({
      fields: [id, qty],
      sort: [createSortRule({ key: "fld_unknown" }), createSortRule({ key: qty.id, direction: "desc" }), createSortRule({ key: "" })],
      outputs: [output],
    });
    const result = runPipeline(TABLE, definition, { outputId: output.id });
    expect(result.columns.map((c) => c.name)).toEqual(["ID"]);
    // like Excel: descending puts text ("n/a") before numbers; only empty cells stay last
    expect(result.rows).toEqual([["SO-4"], ["SO-3"], ["SO-5"], ["SO-1"], ["SO-2"]]);
  });

  it("projects an output's fields in its own order and skips deleted ones", () => {
    const output = createOutput({ fieldIds: [qty.id, "fld_gone", id.id] });
    const definition = createDefinition({ fields: [id, qty, region], outputs: [output] });
    const result = runPipeline(TABLE, definition, { outputId: output.id });
    expect(result.columns.map((c) => c.name)).toEqual(["Qty", "ID"]);
    expect(result.rows[0]).toEqual([2, "SO-1"]);
    const all = createOutput({ fieldIds: null });
    expect(runPipeline(TABLE, { ...definition, outputs: [all] }, { outputId: all.id }).columns).toHaveLength(3);
  });

  it("uses an output's sort override instead of the workflow sort", () => {
    const output = createOutput({ overrides: { sort: { enabled: true, rules: [createSortRule({ key: id.id, direction: "desc" })] } } });
    const definition = createDefinition({ fields: [id, qty], sort: [createSortRule({ key: qty.id })], outputs: [output] });
    expect(ids(definition, { outputId: output.id })).toEqual(["SO-5", "SO-4", "SO-3", "SO-2", "SO-1"]);
  });

  it("rejects an unknown output", () => {
    expect(() => runPipeline(TABLE, createDefinition({ fields: [id] }), { outputId: "out_nope" })).toThrow(
      expect.objectContaining({ code: "INVALID_DEFINITION" }),
    );
  });
});

describe("toDisplayRows", () => {
  it("formats typed values and limits the rows", () => {
    const result = {
      columns: [
        { key: "a", name: "A", type: "number", format: { type: "numberFormat", decimals: 1, thousands: true, prefix: "", suffix: "" } },
        { key: "b", name: "B", type: "date", format: null },
        { key: "c", name: "C", type: "text", format: null },
      ],
      rows: [
        [1234, day(2024, 1, 5, 9), null],
        [0.1 + 0.2, null, "x"],
      ],
    };
    expect(toDisplayRows(result)).toEqual([
      ["1,234.0", "2024-01-05 09:00", ""],
      ["0.3", "", "x"],
    ]);
    expect(toDisplayRows(result, 1)).toHaveLength(1);
    expect(toDisplayRows(result, 0)).toEqual([]);
    expect(toDisplayRows(null, 5)).toEqual([]);
  });
});

describe("runPipeline: scale", () => {
  it("maps, filters, groups and sorts 50,000 rows quickly", () => {
    const rows = [];
    for (let i = 0; i < 50000; i += 1) rows.push([`R${i}`, ["North", "South", "East", "West"][i % 4], i % 17, (i * 7) % 1000]);
    const table = {
      columns: [
        { name: "ID", type: "text", index: 0 },
        { name: "Region", type: "text", index: 1 },
        { name: "Qty", type: "number", index: 2 },
        { name: "Price", type: "number", index: 3 },
      ],
      rows,
    };
    const region = column("Region", "Region", [createTransform("upper")]);
    const total = createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } });
    const sum = createAggregation({ fieldId: total.id, fn: "sum" });
    const definition = createDefinition({
      fields: [column("ID"), region, total],
      filters: { combinator: "and", rules: [rule({ kind: "column", ref: "Qty" }, "gt", "0")] },
      groupBy: createGroupBy({ enabled: true, keys: [region.id], aggregations: [sum] }),
      sort: [createSortRule({ key: sum.id, direction: "desc" })],
    });
    const started = performance.now();
    const result = runPipeline(table, definition);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.totalRows).toBe(4);
    const plain = runPipeline(table, { ...definition, groupBy: createGroupBy(), sort: [createSortRule({ key: total.id })] });
    expect(plain.totalRows).toBe(50000 - Math.ceil(50000 / 17));
  });
});
