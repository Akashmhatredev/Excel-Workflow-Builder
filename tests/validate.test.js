import { describe, expect, it } from "vitest";
import {
  createAggregation,
  createDefinition,
  createField,
  createFilterRule,
  createGroupBy,
  createOutput,
  createSortRule,
  createTransform,
} from "@/lib/schema";
import { createColumnLookup, validateDefinition } from "@/lib/validate";

const COLUMNS = [
  { name: "Order ID", type: "text", index: 0 },
  { name: "Order Date", type: "date", index: 1 },
  { name: "Qty", type: "number", index: 2 },
  { name: "Price", type: "number", index: 3 },
  { name: "Region", type: "text", index: 4 },
];

const column = (name, columnName = name, transforms = []) =>
  createField({ name, source: { kind: "column", column: columnName }, transforms });
const codes = (issues) => issues.map((issue) => issue.code);
const find = (issues, code, id) => issues.find((issue) => issue.code === code && (id === undefined || issue.id === id));

describe("createColumnLookup", () => {
  it("finds columns exactly first, then ignoring case and spaces", () => {
    const lookup = createColumnLookup([
      { name: "Region", type: "text", index: 0 },
      { name: "region ", type: "number", index: 1 },
    ]);
    expect(lookup.size).toBe(2);
    expect(lookup.find("Region").index).toBe(0);
    expect(lookup.find("region ").index).toBe(1);
    expect(lookup.find("  REGION").index).toBe(0);
    expect(lookup.find("Nope")).toBeNull();
    expect(lookup.find("")).toBeNull();
  });

  it("falls back to the list position when a column has no index", () => {
    expect(createColumnLookup([{ name: "A" }, { name: "B" }]).find("B")).toEqual({ name: "B", type: "text", index: 1 });
  });
});

describe("validateDefinition: fields", () => {
  it("accepts a clean definition", () => {
    const qty = column("Qty");
    const definition = createDefinition({
      fields: [column("Order", "Order ID"), qty, column("Date", "order date")],
      outputs: [createOutput({ name: "All" })],
    });
    expect(validateDefinition(definition, COLUMNS)).toEqual([]);
  });

  it("needs a name, unique names and a source", () => {
    const unnamed = column("  ", "Qty");
    const first = column("Total", "Qty");
    const second = column(" total ", "Price");
    const noColumn = createField({ name: "A" });
    const noTemplate = createField({ name: "B", source: { kind: "combine", template: "  " } });
    const noExpression = createField({ name: "C", source: { kind: "formula", expression: "" } });
    const issues = validateDefinition(createDefinition({ fields: [unnamed, first, second, noColumn, noTemplate, noExpression] }), COLUMNS);
    expect(find(issues, "empty-name", unnamed.id)).toMatchObject({ level: "error", scope: "field" });
    expect(find(issues, "duplicate-name", first.id)).toBeTruthy();
    expect(find(issues, "duplicate-name", second.id).message).toBe('Another field is also named "total".');
    for (const field of [noColumn, noTemplate, noExpression]) expect(find(issues, "empty-source", field.id)).toBeTruthy();
  });

  it("reports source columns that do not exist", () => {
    const direct = column("A", "Customer");
    const combine = createField({ name: "B", source: { kind: "combine", template: "{Region} / {Zone}" } });
    const formula = createField({ name: "C", source: { kind: "formula", expression: "{Qty} * {Rate}" } });
    const issues = validateDefinition(createDefinition({ fields: [direct, combine, formula] }), COLUMNS);
    expect(issues.filter((issue) => issue.code === "missing-column").map((issue) => [issue.id, issue.message])).toEqual([
      [direct.id, 'Source column "Customer" was not found.'],
      [combine.id, 'Source column "Zone" was not found.'],
      [formula.id, 'Source column "Rate" was not found.'],
    ]);
  });

  it("does not check columns when nothing is known about the source", () => {
    const definition = createDefinition({ fields: [column("A", "Anything")], outputs: [createOutput()] });
    expect(validateDefinition(definition, [])).toEqual([]);
    expect(validateDefinition(definition, undefined)).toEqual([]);
  });

  it("reports formula syntax errors and bad regular expressions", () => {
    const formula = createField({ name: "F", source: { kind: "formula", expression: "{Qty} * (2" } });
    const regex = column("R", "Region", [createTransform("replace", { find: "(", useRegex: true })]);
    const literal = column("L", "Region", [createTransform("replace", { find: "(", useRegex: false })]);
    const issues = validateDefinition(createDefinition({ fields: [formula, regex, literal] }), COLUMNS);
    expect(find(issues, "formula-error", formula.id).message).toBe("Formula error: A closing bracket ) is missing.");
    expect(find(issues, "invalid-regex", regex.id)).toBeTruthy();
    expect(find(issues, "invalid-regex", literal.id)).toBeUndefined();
  });

  it("warns about formats that do not fit the column type", () => {
    const numberOnText = column("A", "Region", [createTransform("numberFormat")]);
    const dateOnNumber = column("B", "Qty", [createTransform("dateFormat")]);
    const numberOnDate = column("C", "Order Date", [createTransform("numberFormat")]);
    const fine = column("D", "Qty", [createTransform("numberFormat")]);
    const formula = createField({ name: "E", source: { kind: "formula", expression: "{Qty} * 2" }, transforms: [createTransform("numberFormat")] });
    const issues = validateDefinition(createDefinition({ fields: [numberOnText, dateOnNumber, numberOnDate, fine, formula] }), COLUMNS);
    const mismatches = issues.filter((issue) => issue.code === "type-mismatch");
    expect(mismatches.map((issue) => [issue.id, issue.level])).toEqual([
      [numberOnText.id, "warning"],
      [dateOnNumber.id, "warning"],
      [numberOnDate.id, "warning"],
    ]);
    expect(mismatches[0].message).toBe("Number format expects numbers, but this field holds text.");
    expect(mismatches[1].message).toBe("Date format expects dates, but this field holds numbers.");
  });
});

describe("validateDefinition: filters", () => {
  it("reports missing columns and deleted fields", () => {
    const field = column("Qty");
    const onColumn = createFilterRule({ target: { kind: "column", ref: "Status" }, value: "x" });
    const onField = createFilterRule({ target: { kind: "field", ref: "fld_gone" }, value: "x" });
    const ok = createFilterRule({ target: { kind: "column", ref: "region" }, value: "North" });
    const blank = createFilterRule();
    const definition = createDefinition({ fields: [field], filters: { combinator: "and", rules: [onColumn, onField, ok, blank] } });
    const issues = validateDefinition(definition, COLUMNS);
    expect(issues.map((issue) => [issue.scope, issue.id, issue.code])).toEqual([
      ["filter", onColumn.id, "missing-column"],
      ["filter", onField.id, "missing-field"],
    ]);
  });

  it("warns when a value does not fit the compared type", () => {
    const qty = column("Qty");
    const rules = [
      createFilterRule({ target: { kind: "column", ref: "Qty" }, operator: "gt", value: "lots" }),
      createFilterRule({ target: { kind: "column", ref: "Order Date" }, operator: "between", value: "01/01/2024", value2: "soon" }),
      createFilterRule({ target: { kind: "field", ref: qty.id }, operator: "lte", value: "1,000" }),
      createFilterRule({ target: { kind: "column", ref: "Qty" }, operator: "contains", value: "lots" }),
    ];
    const issues = validateDefinition(createDefinition({ fields: [qty], filters: { combinator: "or", rules } }), COLUMNS);
    expect(issues.map((issue) => [issue.id, issue.code, issue.level])).toEqual([
      [rules[0].id, "type-mismatch", "warning"],
      [rules[1].id, "type-mismatch", "warning"],
    ]);
    expect(issues[1].message).toBe('"soon" is not a date, but this rule compares dates.');
  });
});

describe("validateDefinition: grouping and sorting", () => {
  it("reports deleted fields, missing aggregation fields and numeric summaries of text", () => {
    const region = column("Region");
    const qty = column("Qty");
    const sumText = createAggregation({ fieldId: region.id, fn: "avg" });
    const sumGone = createAggregation({ fieldId: "fld_gone", fn: "sum" });
    const sumNothing = createAggregation({ fieldId: "", fn: "sum" });
    const countRows = createAggregation({ fieldId: "", fn: "count" });
    const minText = createAggregation({ fieldId: region.id, fn: "min" });
    const sumQty = createAggregation({ fieldId: qty.id, fn: "sum" });
    const definition = createDefinition({
      fields: [region, qty],
      groupBy: createGroupBy({ enabled: true, keys: [region.id, "fld_deleted"], aggregations: [sumText, sumGone, sumNothing, countRows, minText, sumQty] }),
    });
    const issues = validateDefinition(definition, COLUMNS);
    expect(issues.map((issue) => [issue.scope, issue.id, issue.code])).toEqual([
      ["groupBy", "fld_deleted", "missing-field"],
      ["groupBy", sumText.id, "type-mismatch"],
      ["groupBy", sumGone.id, "missing-field"],
      ["groupBy", sumNothing.id, "missing-field"],
    ]);
    expect(issues[1].message).toBe('Average needs numbers, but "Region" holds text.');
    expect(issues[3].message).toBe("Choose a field for Sum.");
  });

  it("flags duplicate column names in a grouped result", () => {
    const region = column("Region");
    const a = createAggregation({ fn: "count", name: "Region" });
    const issues = validateDefinition(
      createDefinition({ fields: [region], groupBy: createGroupBy({ enabled: true, keys: [region.id], aggregations: [a] }) }),
      COLUMNS,
    );
    expect(codes(issues)).toEqual(["duplicate-name"]);
  });

  it("warns about grouping that is on but empty, and ignores grouping that is off", () => {
    const off = createDefinition({ fields: [column("Qty")], groupBy: createGroupBy({ enabled: false, keys: ["fld_gone"] }) });
    expect(validateDefinition(off, COLUMNS)).toEqual([]);
    const empty = createDefinition({ fields: [column("Qty")], groupBy: createGroupBy({ enabled: true }) });
    expect(validateDefinition(empty, COLUMNS)).toMatchObject([{ level: "warning", scope: "groupBy", code: "empty-group" }]);
  });

  it("warns about sort keys that are not in the result", () => {
    const region = column("Region");
    const qty = column("Qty");
    const count = createAggregation({ fn: "count" });
    const byQty = createSortRule({ key: qty.id });
    const byCount = createSortRule({ key: count.id });
    const plain = createDefinition({ fields: [region, qty], sort: [byQty, byCount, createSortRule({ key: "" })] });
    expect(validateDefinition(plain, COLUMNS).map((issue) => [issue.id, issue.code])).toEqual([[byCount.id, "missing-field"]]);
    const grouped = { ...plain, groupBy: createGroupBy({ enabled: true, keys: [region.id], aggregations: [count] }) };
    expect(validateDefinition(grouped, COLUMNS).map((issue) => [issue.id, issue.code])).toEqual([[byQty.id, "missing-field"]]);
  });
});

describe("validateDefinition: outputs", () => {
  it("checks names, columns and deleted fields", () => {
    const qty = column("Qty");
    const unnamed = createOutput({ name: "  " });
    const empty = createOutput({ name: "Empty", fieldIds: [] });
    const stale = createOutput({ name: "Stale", fieldIds: [qty.id, "fld_a", "fld_b"] });
    const twinA = createOutput({ name: "Report" });
    const twinB = createOutput({ name: "report" });
    const csv = createOutput({ name: "Report", fileType: "csv" });
    const issues = validateDefinition(createDefinition({ fields: [qty], outputs: [unnamed, empty, stale, twinA, twinB, csv] }), COLUMNS);
    expect(issues.map((issue) => [issue.id, issue.code, issue.level])).toEqual([
      [unnamed.id, "empty-output-name", "error"],
      [empty.id, "no-fields", "error"],
      [stale.id, "missing-field", "warning"],
      [twinA.id, "duplicate-output-name", "warning"],
      [twinB.id, "duplicate-output-name", "warning"],
    ]);
    expect(issues[2].message).toBe("2 columns of this output no longer exist and are skipped.");
    for (const issue of issues) expect(issue.outputId).toBe(issue.id);
  });

  it("reports problems inside enabled overrides with the output id", () => {
    const region = column("Region");
    const qty = column("Qty");
    const badRule = createFilterRule({ target: { kind: "column", ref: "Nope" }, value: "x" });
    const badAgg = createAggregation({ fieldId: "fld_gone", fn: "max" });
    const badSort = createSortRule({ key: qty.id });
    const output = createOutput({
      name: "Summary",
      overrides: {
        filters: { enabled: true, group: { combinator: "and", rules: [badRule] } },
        groupBy: { enabled: true, config: createGroupBy({ enabled: true, keys: [region.id], aggregations: [badAgg] }) },
        sort: { enabled: true, rules: [badSort] },
      },
    });
    const disabled = createOutput({
      name: "Detail",
      overrides: { filters: { enabled: false, group: { combinator: "and", rules: [badRule] } } },
    });
    const issues = validateDefinition(createDefinition({ fields: [region, qty], outputs: [output, disabled] }), COLUMNS);
    expect(issues.map((issue) => [issue.scope, issue.id, issue.code, issue.outputId])).toEqual([
      ["filter", badRule.id, "missing-column", output.id],
      ["groupBy", badAgg.id, "missing-field", output.id],
      ["sort", badSort.id, "missing-field", output.id],
    ]);
  });

  it("does not report field selections of grouped outputs", () => {
    const region = column("Region");
    const output = createOutput({
      name: "Grouped",
      fieldIds: ["fld_gone"],
      overrides: { groupBy: { enabled: true, config: createGroupBy({ enabled: true, keys: [region.id] }) } },
    });
    expect(validateDefinition(createDefinition({ fields: [region], outputs: [output] }), COLUMNS)).toEqual([]);
  });

  it("never throws on junk", () => {
    expect(validateDefinition(null, COLUMNS)).toEqual([]);
    expect(validateDefinition({ fields: "x", outputs: [null, 3] }, COLUMNS)).toEqual([]);
    expect(() => validateDefinition({ fields: [{ id: "a" }], groupBy: { enabled: true, keys: "x" } }, null)).not.toThrow();
  });
});
