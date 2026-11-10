import { describe, expect, it } from "vitest";
import { joinLookup, lookupKey } from "@/lib/lookup";
import { runPipeline, toDisplayRows } from "@/lib/pipeline";
import { createDefinition, createField, createLookup } from "@/lib/schema";

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const mainTable = () => ({
  columns: [
    { name: "Order", type: "text", index: 0 },
    { name: "SKU", type: "text", index: 1 },
    { name: "Name", type: "text", index: 2 },
  ],
  rows: [
    ["SO-1", " ab-1 ", "first"],
    ["SO-2", 101, "second"],
    ["SO-3", "00101", "third"],
    ["SO-4", null, "fourth"],
    ["SO-5", "zz", "fifth"],
  ],
  warnings: [],
});

const lookupTable = () => ({
  columns: [
    { name: "Code", type: "text", index: 0 },
    { name: "Name", type: "text", index: 1 },
    { name: "Price", type: "number", index: 2 },
    { name: "Since", type: "date", index: 3 },
  ],
  rows: [
    ["AB-1", "Pen", 10, day(2024, 1, 5)],
    ["101.0", "Ink", 5, null],
    ["ab-1", "Pen (old)", 9, null],
    [null, "No code", 1, null],
  ],
});

const config = (overrides = {}) => createLookup({ enabled: true, matchColumn: "SKU", lookupColumn: "Code", ...overrides });

describe("lookupKey", () => {
  it("trims, ignores case and matches numbers by value", () => {
    expect(lookupKey("  Ab   1 ")).toBe(lookupKey("ab 1"));
    expect(lookupKey(101)).toBe(lookupKey("101.0"));
    expect(lookupKey("1,200")).toBe(lookupKey(1200));
    expect(lookupKey(0.1 + 0.2)).toBe(lookupKey("0.3"));
    expect(lookupKey("00101")).not.toBe(lookupKey(101));
    expect(lookupKey(day(2024, 1, 5))).toBe(lookupKey("2024-01-05"));
    expect(lookupKey(null)).toBeNull();
    expect(lookupKey("   ")).toBeNull();
    expect(lookupKey(Number.NaN)).toBeNull();
  });
});

describe("joinLookup", () => {
  it("appends every column except the key, renames clashes and counts matches", () => {
    const table = mainTable();
    const { info, warnings } = joinLookup(table, lookupTable(), config());
    expect(warnings).toEqual([]);
    expect(info).toEqual({ applied: true, matched: 2, unmatched: 3, addedColumns: ["Name (lookup)", "Price", "Since"], duplicateKeys: 1 });
    expect(table.columns.slice(3)).toEqual([
      { name: "Name (lookup)", type: "text", index: 3, origin: "lookup" },
      { name: "Price", type: "number", index: 4, origin: "lookup" },
      { name: "Since", type: "date", index: 5, origin: "lookup" },
    ]);
    expect(table.rows).toEqual([
      ["SO-1", " ab-1 ", "first", "Pen", 10, day(2024, 1, 5)],
      ["SO-2", 101, "second", "Ink", 5, null],
      ["SO-3", "00101", "third", null, null, null],
      ["SO-4", null, "fourth", null, null, null],
      ["SO-5", "zz", "fifth", null, null, null],
    ]);
  });

  it("adds only the chosen columns, matched loosely by name", () => {
    const table = mainTable();
    const { info, warnings } = joinLookup(table, lookupTable(), config({ columns: ["price", "Missing", "Price"] }));
    expect(info.addedColumns).toEqual(["Price"]);
    expect(warnings).toEqual(['The lookup column "Missing" was not found in the lookup file.']);
    expect(table.rows.map((row) => row[3])).toEqual([10, 5, null, null, null]);
  });

  it("is not applied when a key column is missing or the lookup table is not loaded", () => {
    const table = mainTable();
    expect(joinLookup(table, null, config()).warnings).toEqual(["The lookup file is not loaded, so its columns were not added."]);
    const noMatch = joinLookup(table, lookupTable(), config({ matchColumn: "Item" }));
    expect(noMatch.info).toEqual({ applied: false, matched: 0, unmatched: 0, addedColumns: [], duplicateKeys: 0 });
    expect(noMatch.warnings[0]).toMatch(/match column "Item" was not found/);
    expect(joinLookup(table, lookupTable(), config({ lookupColumn: "Id" })).warnings[0]).toMatch(/key column "Id" was not found in the lookup file/);
    expect(table.columns).toHaveLength(3);
  });

  it("feeds lookup columns to the pipeline like any source column", () => {
    const table = mainTable();
    joinLookup(table, lookupTable(), config({ columns: ["Name", "Price"] }));
    const product = createField({ name: "Product", source: { kind: "column", column: "Name (lookup)" } });
    const total = createField({ name: "Double", source: { kind: "formula", expression: "{Price} * 2" } });
    const result = runPipeline(table, createDefinition({ fields: [product, total] }));
    expect(toDisplayRows(result, 3)).toEqual([
      ["Pen", "20"],
      ["Ink", "10"],
      ["", "0"],
    ]);
  });
});

describe("loadTable with a lookup", () => {
  const fakeFile = (text, name) => {
    const bytes = new TextEncoder().encode(text);
    return { name, size: bytes.length, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer };
  };
  const ctx = { progress: () => {} };
  const MAIN = "Order,SKU,Qty\nSO-1,A1,2\nSO-2,b2,5\nSO-3,C3,1\n";
  const LOOKUP = "Code,Product,Price\nA1,Pen,10\nB2,Ink,5\nA1,Duplicate,0\n";

  async function setup() {
    const { handlers, resetDatasets } = await import("@/workers/parse.worker");
    resetDatasets();
    await handlers.parseFile({ file: fakeFile(MAIN, "orders.csv"), datasetId: "main" }, ctx);
    return handlers;
  }

  it("joins the lookup dataset and reports what happened", async () => {
    const handlers = await setup();
    await handlers.parseFile({ file: fakeFile(LOOKUP, "products.csv"), datasetId: "lookup" }, ctx);
    const lookupLoaded = await handlers.loadTable({ datasetId: "lookup", sheetNames: [], headerRow: 1, previewLimit: 0, lookup: config() }, ctx);
    expect(lookupLoaded.previewRows).toEqual([]);
    expect(lookupLoaded.rowCount).toBe(3);
    expect(lookupLoaded.lookupInfo).toBeNull(); // the lookup file is never joined onto itself

    const main = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, previewLimit: 0, lookup: config() }, ctx);
    expect(main.previewRows).toEqual([]);
    expect(main.columns.map((column) => [column.name, column.type, column.origin])).toEqual([
      ["Order", "text", undefined],
      ["SKU", "text", undefined],
      ["Qty", "number", undefined],
      ["Product", "text", "lookup"],
      ["Price", "number", "lookup"],
    ]);
    expect(main.lookupInfo).toEqual({ applied: true, matched: 2, unmatched: 1, addedColumns: ["Product", "Price"], duplicateKeys: 1 });
    expect((await handlers.getRows({ datasetId: "main", offset: 0, limit: 3 })).rows).toEqual([
      ["SO-1", "A1", "2", "Pen", "10"],
      ["SO-2", "b2", "5", "Ink", "5"],
      ["SO-3", "C3", "1", "", ""],
    ]);

    const plain = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, lookup: null }, ctx);
    expect(plain.lookupInfo).toBeNull();
    expect(plain.columns).toHaveLength(3);

    await handlers.parseFile({ file: fakeFile(MAIN, "batch.csv"), datasetId: "batch" }, ctx);
    const batch = await handlers.loadTable({ datasetId: "batch", sheetNames: [], headerRow: 1, previewLimit: 0, lookup: config({ columns: ["Price"] }) }, ctx);
    expect(batch.lookupInfo).toMatchObject({ applied: true, matched: 2, addedColumns: ["Price"] });
  });

  it("warns and leaves the table alone when the lookup file is missing or not configured", async () => {
    const handlers = await setup();
    const missing = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, lookup: config() }, ctx);
    expect(missing.lookupInfo).toEqual({ applied: false, matched: 0, unmatched: 0, addedColumns: [], duplicateKeys: 0 });
    expect(missing.warnings).toEqual(["The lookup file is not loaded, so its columns were not added."]);
    const unset = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, lookup: config({ lookupColumn: "" }) }, ctx);
    expect(unset.lookupInfo.applied).toBe(false);
    expect(unset.warnings[0]).toMatch(/Choose the match column/);
    const off = await handlers.loadTable({ datasetId: "main", sheetNames: [], headerRow: 1, lookup: config({ enabled: false }) }, ctx);
    expect(off.lookupInfo).toBeNull();
    expect(off.warnings).toEqual([]);
  });
});
