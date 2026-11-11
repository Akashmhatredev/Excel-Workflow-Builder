import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTable, listSheets, readWorkbook } from "@/lib/excel";
import { runPipeline, toDisplayRows } from "@/lib/pipeline";
import {
  APP_ID,
  SCHEMA_VERSION,
  collectColumnRefs,
  matchColumns,
  normalizeDefinition,
  validateTemplateShape,
} from "@/lib/schema";
import { validateDefinition } from "@/lib/validate";

const sample = (name) => readFileSync(fileURLToPath(new URL(`../public/samples/${name}`, import.meta.url)));
const exported = JSON.parse(sample("sample-template.json").toString("utf8"));
const template = exported.template;
const definition = normalizeDefinition(template.definition);
const workbook = readWorkbook(sample("sample-data.xlsx"), "sample-data.xlsx");
const table = buildTable(workbook, { sheetNames: definition.source.sheetNames, headerRow: definition.source.headerRow });

describe("sample-template.json", () => {
  it("is a template export with a valid shape", () => {
    expect(exported).toMatchObject({ app: APP_ID, kind: "template", schemaVersion: SCHEMA_VERSION });
    expect(typeof exported.exportedAt).toBe("string");
    expect(validateTemplateShape(template)).toEqual([]);
    expect(template.definition.fields.length).toBeGreaterThanOrEqual(8);
    expect(template.definition.outputs).toHaveLength(2);
  });

  it("uses the features it is meant to show off", () => {
    const kinds = definition.fields.map((field) => field.source.kind);
    expect(kinds).toContain("combine");
    expect(kinds).toContain("formula");
    const types = definition.fields.flatMap((field) => field.transforms.map((t) => t.type));
    for (const type of ["trim", "upper", "title", "dateFormat", "numberFormat", "default"]) expect(types).toContain(type);
    expect(definition.filters.rules).toHaveLength(1);
    expect(definition.sort).toHaveLength(1);
    expect(definition.summary).toEqual({ rowKey: "fld_region", columnKey: "fld_status", valueKey: "fld_line_total", fn: "sum" });
    const summary = definition.outputs[1];
    expect(summary.overrides.groupBy.enabled).toBe(true);
    expect(summary.overrides.groupBy.config.aggregations.map((a) => a.fn)).toEqual(["sum", "count"]);
    expect(summary.report).toMatchObject({ enabled: true, theme: "brand" });
    expect(summary.report.title).not.toBe("");
    expect(summary.report.subtitle).not.toBe("");
  });

  it("matches the expected columns of sample-data.xlsx", () => {
    expect(definition.source.expectedColumns).toEqual(table.columns.map(({ name, type }) => ({ name, type })));
  });

  it("has no error-level issues against sample-data.xlsx", () => {
    const issues = validateDefinition(definition, table.columns);
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("produces rows for the workflow and for both outputs", () => {
    const all = runPipeline(table, definition);
    expect(all.totalRows).toBeGreaterThan(0);
    expect(all.totalRows).toBeLessThan(all.sourceRows);
    expect(all.issues).toEqual([]);
    const [detailOutput, summaryOutput] = definition.outputs;
    const detail = runPipeline(table, definition, { outputId: detailOutput.id });
    expect(detail.totalRows).toBe(all.totalRows);
    expect(detail.columns.map((c) => c.name)).toEqual(definition.fields.map((f) => f.name));
    const row = toDisplayRows(detail, 1)[0];
    expect(row[1]).toMatch(/^\d{2} [A-Z][a-z]{2} 2024$/);
    expect(row[6]).toMatch(/^₹[\d,]+\.\d{2}$/);
    const summary = runPipeline(table, definition, { outputId: summaryOutput.id });
    expect(summary.columns.map((c) => c.name)).toEqual(["Region", "Total Sales", "Orders"]);
    expect(summary.rows.map((r) => r[0]).sort()).toEqual(["East", "North", "South", "West"]);
    expect(summary.rows.reduce((total, r) => total + r[2], 0)).toBe(all.totalRows);
    const sales = summary.rows.map((r) => r[1]);
    expect([...sales].sort((a, b) => b - a)).toEqual(sales);
  });
});

describe("sample workbooks", () => {
  it("sample-data.xlsx has an Orders sheet of ~300 messy rows and a Returns sheet", () => {
    const sheets = listSheets(workbook);
    expect(sheets.map((s) => s.name)).toEqual(["Orders", "Returns"]);
    expect(table.rows.length).toBe(300);
    const byName = Object.fromEntries(table.columns.map((c) => [c.name, c]));
    expect(byName["Order Date"].type).toBe("date");
    expect(byName.Qty.type).toBe("number");
    const regions = new Set(table.rows.map((r) => r[byName.Region.index]));
    expect([...regions].some((value) => value && value !== value.trim())).toBe(true);
    expect([...regions].some((value) => value && value === value.toUpperCase())).toBe(true);
    expect(table.rows.some((r) => r[byName["Sales Rep"].index] === null)).toBe(true);
    const returns = buildTable(workbook, { sheetNames: ["Returns"] });
    expect(returns.rows.length).toBeGreaterThan(10);
  });

  it("sample-data-renamed.xlsx needs the Fix mapping step for some columns", () => {
    const renamed = buildTable(readWorkbook(sample("sample-data-renamed.xlsx"), "sample-data-renamed.xlsx"), {});
    const names = renamed.columns.map((c) => c.name);
    const match = matchColumns(collectColumnRefs(definition), names);
    expect(match.missing.length).toBeGreaterThan(0);
    expect(Object.keys(match.map).length).toBeGreaterThan(0);
    expect(match.suggestions.Qty).toBe("Quantity");
    const firstRow = renamed.rows[0][0];
    expect(table.rows.some((r) => r[0] === firstRow)).toBe(false);
  });
});
