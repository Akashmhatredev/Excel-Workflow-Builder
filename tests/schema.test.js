import { describe, expect, it } from "vitest";
import {
  collectColumnRefs,
  createDefinition,
  createField,
  createFilterRule,
  createOutput,
  extractRefs,
  getResultColumns,
  matchColumns,
  normalizeDefinition,
  remapColumnRefs,
  sanitizeSheetName,
  uniqueName,
  validateTemplateShape,
} from "@/lib/schema";

describe("schema helpers", () => {
  it("extracts {Column} references in order without duplicates", () => {
    expect(extractRefs("{First} {Last} ({ First })")).toEqual(["First", "Last"]);
  });

  it("collects and remaps column references across fields and filters", () => {
    const definition = createDefinition({
      fields: [
        createField({ name: "Name", source: { kind: "combine", template: "{First} {Last}" } }),
        createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } }),
        createField({ name: "City", source: { kind: "column", column: "City" } }),
      ],
      filters: { combinator: "and", rules: [createFilterRule({ target: { kind: "column", ref: "Status" } })] },
    });
    expect(collectColumnRefs(definition)).toEqual(["First", "Last", "Qty", "Price", "City", "Status"]);
    const remapped = remapColumnRefs(definition, { First: "First Name", Status: "State", City: "Town" });
    expect(remapped.fields[0].source.template).toBe("{First Name} {Last}");
    expect(remapped.fields[2].source.column).toBe("Town");
    expect(remapped.filters.rules[0].target.ref).toBe("State");
    expect(definition.fields[0].source.template).toBe("{First} {Last}");
  });

  it("matches columns ignoring case and whitespace, then aliases, and suggests near misses", () => {
    const result = matchColumns(
      ["customer", "Order  Date", "Cust Name", "Amount (INR)"],
      ["Customer ", "order date", "Client", "Amount INR"],
      [{ from: "Cust Name", to: "Client" }],
    );
    expect(result.map).toEqual({ customer: "Customer ", "Order  Date": "order date", "Cust Name": "Client" });
    expect(result.missing).toEqual(["Amount (INR)"]);
    expect(result.suggestions["Amount (INR)"]).toBe("Amount INR");
  });

  it("describes result columns with and without grouping", () => {
    const a = createField({ name: "Region" });
    const b = createField({ name: "Sales" });
    const definition = createDefinition({ fields: [a, b] });
    const output = createOutput({ fieldIds: [b.id] });
    expect(getResultColumns(definition, output).map((c) => c.name)).toEqual(["Sales"]);
    const grouped = {
      ...definition,
      groupBy: { enabled: true, keys: [a.id], aggregations: [{ id: "agg_1", fieldId: b.id, fn: "sum", name: "" }] },
    };
    expect(getResultColumns(grouped, null).map((c) => [c.key, c.name, c.role])).toEqual([
      [a.id, "Region", "key"],
      ["agg_1", "Sum of Sales", "aggregation"],
    ]);
  });

  it("normalises partial definitions and rejects broken templates", () => {
    const definition = normalizeDefinition({ fields: [{ name: "A", source: { kind: "nope" }, transforms: [{ type: "bogus" }] }] });
    expect(definition.fields[0].source.kind).toBe("column");
    expect(definition.fields[0].transforms).toEqual([]);
    expect(definition.outputs).toEqual([]);
    expect(validateTemplateShape({ name: "", definition: { fields: "x" } }).length).toBeGreaterThan(0);
    expect(validateTemplateShape({ name: "Ok", definition })).toEqual([]);
  });

  it("builds unique names and safe sheet names", () => {
    expect(uniqueName("Output", ["output", "Output (2)"])).toBe("Output (3)");
    expect(sanitizeSheetName("Q1/Q2: [draft] with a very long name that goes on")).toHaveLength(31);
  });
});

describe("output overrides", () => {
  it("lets an enabled group-by override switch grouping off for one output", async () => {
    const { createGroupBy, resolveOutputConfig } = await import("@/lib/schema");
    const definition = createDefinition({ groupBy: createGroupBy({ enabled: true, keys: ["a"] }) });
    const output = createOutput({ overrides: { groupBy: { enabled: true, config: createGroupBy({ enabled: false }) } } });
    expect(resolveOutputConfig(definition, output).groupBy.enabled).toBe(false);
    expect(resolveOutputConfig(definition, createOutput()).groupBy.enabled).toBe(true);
  });
});
