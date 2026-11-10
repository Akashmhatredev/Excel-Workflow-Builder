import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefinition, createField, createLookup, createOutput } from "@/lib/schema";

/*
 * lib/batch.js with a fake worker. Each fake "file" describes what the worker would find in it:
 *   { name, sheets: [{ name, rowCount }], columns: string[], rows: number, fail?: 'parse' | 'load', warnings? }
 * buildOutput returns the definition it was given (as JSON bytes) so the tests can check the remapping.
 */

const worker = vi.hoisted(() => ({ files: new Map(), current: null, calls: [], failOutputs: new Set() }));

vi.mock("@/lib/workerClient", () => ({
  parseFile: vi.fn(async (file, options) => {
    worker.calls.push(["parseFile", file.name, options.datasetId]);
    const spec = worker.files.get(file.name);
    if (!spec || spec.fail === "parse") throw Object.assign(new Error("This file is damaged."), { code: "CORRUPT_FILE" });
    worker.current = spec;
    return { datasetId: options.datasetId, fileName: file.name, sheets: spec.sheets };
  }),
  loadTable: vi.fn(async (args) => {
    worker.calls.push(["loadTable", args]);
    const spec = worker.current;
    if (spec.fail === "load") throw Object.assign(new Error("The sheet is empty."), { code: "EMPTY_SHEET" });
    return {
      columns: spec.columns.map((name, index) => ({ name, type: "text", index })),
      rowCount: spec.rows,
      previewRows: [],
      sheetNames: args.sheetNames,
      headerRow: args.headerRow,
      warnings: spec.warnings || [],
    };
  }),
  buildOutput: vi.fn(async ({ datasetId, definition, outputId }) => {
    worker.calls.push(["buildOutput", datasetId, outputId]);
    const output = definition.outputs.find((item) => item.id === outputId);
    if (worker.failOutputs.has(output.name)) throw new Error("Too many rows for one sheet.");
    const columns = definition.fields.map((field) => field.source.column);
    return {
      fileName: `${output.name}.${output.fileType}`,
      mime: "application/octet-stream",
      bytes: new TextEncoder().encode(JSON.stringify({ file: worker.current.name, columns })),
      rowCount: worker.current.rows,
    };
  }),
  disposeDataset: vi.fn(async (datasetId) => {
    worker.calls.push(["disposeDataset", datasetId]);
    return { ok: true };
  }),
}));

const { runBatch, BATCH_DATASET, isSpreadsheetFile } = await import("@/lib/batch");

const fakeFile = (name) => ({ name, size: 10, lastModified: 0 });

function addFile(spec) {
  worker.files.set(spec.name, { sheets: [{ name: "Sales", rowCount: spec.rows || 0, colCount: 3 }], rows: 0, ...spec });
  return fakeFile(spec.name);
}

function salesDefinition(overrides = {}) {
  const customer = createField({ name: "Customer", source: { kind: "column", column: "Customer" } });
  const amount = createField({ name: "Amount", source: { kind: "column", column: "Amount" } });
  return createDefinition({
    source: { sheetNames: ["Sales"], headerRow: 2, expectedColumns: [] },
    fields: [customer, amount],
    outputs: [createOutput({ name: "Detail", fileType: "xlsx" }), createOutput({ name: "Summary", fileType: "csv" })],
    ...overrides,
  });
}

async function unzip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const entries = {};
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) entries[path] = JSON.parse(await entry.async("string"));
  }
  return entries;
}

describe("runBatch", () => {
  beforeEach(() => {
    worker.files.clear();
    worker.calls.length = 0;
    worker.failOutputs.clear();
    worker.current = null;
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("builds every output of every file into one zip, one folder per file", async () => {
    const files = [
      addFile({ name: "january.xlsx", columns: ["Customer", "Amount"], rows: 3 }),
      addFile({ name: "february.xlsx", columns: ["customer ", "AMOUNT"], rows: 5 }),
    ];
    const result = await runBatch({ files, definition: salesDefinition(), zipName: "Monthly sales" });

    expect(result.fileName).toBe("Monthly sales.zip");
    expect(result.mime).toBe("application/zip");
    expect(result.cancelled).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ fileName: "january.xlsx", ok: true, rowCount: 3, sheetNames: ["Sales"], warnings: [] }),
      expect.objectContaining({ fileName: "february.xlsx", ok: true, rowCount: 5 }),
    ]);
    expect(result.results[0].outputs).toEqual([
      expect.objectContaining({ name: "Detail", fileType: "xlsx", fileName: "Detail.xlsx", rowCount: 3 }),
      expect.objectContaining({ name: "Summary", fileType: "csv", fileName: "Summary.csv", rowCount: 3 }),
    ]);
    expect(result.results[1].missing).toBeUndefined();
    expect(result.summary).toEqual({
      files: 2,
      succeeded: 2,
      failed: 0,
      withMissingColumns: 0,
      outputs: [
        { name: "Detail", fileType: "xlsx", rowCount: 8 },
        { name: "Summary", fileType: "csv", rowCount: 8 },
      ],
    });

    const entries = await unzip(result.bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "february/Detail.xlsx",
      "february/Summary.csv",
      "january/Detail.xlsx",
      "january/Summary.csv",
    ]);
    // each file's definition was remapped to that file's own spelling of the columns
    expect(entries["february/Detail.xlsx"]).toEqual({ file: "february.xlsx", columns: ["customer ", "AMOUNT"] });
    expect(entries["january/Detail.xlsx"]).toEqual({ file: "january.xlsx", columns: ["Customer", "Amount"] });
  });

  it("works in the 'batch' dataset, one file at a time, and frees it at the end", async () => {
    const files = [addFile({ name: "a.csv", columns: ["Customer", "Amount"], rows: 1 }), addFile({ name: "b.csv", columns: ["Customer", "Amount"], rows: 1 })];
    await runBatch({ files, definition: salesDefinition() });
    const sequence = worker.calls.map((call) => (call[0] === "loadTable" ? "loadTable" : `${call[0]}:${call[1]}`));
    expect(sequence).toEqual([
      "parseFile:a.csv",
      "loadTable",
      `buildOutput:${BATCH_DATASET}`,
      `buildOutput:${BATCH_DATASET}`,
      "parseFile:b.csv",
      "loadTable",
      `buildOutput:${BATCH_DATASET}`,
      `buildOutput:${BATCH_DATASET}`,
      `disposeDataset:${BATCH_DATASET}`,
    ]);
    const load = worker.calls.find((call) => call[0] === "loadTable")[1];
    expect(load).toMatchObject({ datasetId: "batch", sheetNames: ["Sales"], headerRow: 2, previewLimit: 0, lookup: null });
    expect(worker.calls.filter((call) => call[0] === "parseFile").every((call) => call[2] === "batch")).toBe(true);
  });

  it("uses saved aliases, in both directions, to find renamed columns", async () => {
    const storage = new Map([["ewb:v1:aliases", JSON.stringify([{ from: "Cust Name", to: "Customer" }, { from: "Amount", to: "Total" }])]]);
    globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: () => {}, removeItem: () => {}, length: 0 } };
    const files = [addFile({ name: "renamed.xlsx", columns: ["Cust Name", "Total"], rows: 2 })];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.results[0].missing).toBeUndefined();
    const entries = await unzip(result.bytes);
    expect(entries["renamed/Detail.xlsx"].columns).toEqual(["Cust Name", "Total"]);
  });

  it("lists missing columns but still builds the outputs", async () => {
    const files = [addFile({ name: "partial.xlsx", columns: ["Customer", "Price"], rows: 4 })];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.results[0]).toMatchObject({ ok: true, missing: ["Amount"] });
    expect(result.results[0].outputs).toHaveLength(2);
    expect(result.summary.withMissingColumns).toBe(1);
  });

  it("reports a file that fails and carries on with the next one", async () => {
    const files = [
      addFile({ name: "broken.xlsx", columns: [], fail: "parse" }),
      addFile({ name: "empty.xlsx", columns: [], fail: "load" }),
      addFile({ name: "good.xlsx", columns: ["Customer", "Amount"], rows: 2 }),
    ];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.results.map((entry) => [entry.fileName, entry.ok, entry.error])).toEqual([
      ["broken.xlsx", false, "This file is damaged."],
      ["empty.xlsx", false, "The sheet is empty."],
      ["good.xlsx", true, undefined],
    ]);
    expect(result.summary).toMatchObject({ files: 3, succeeded: 1, failed: 2 });
    expect(Object.keys(await unzip(result.bytes)).sort()).toEqual(["good/Detail.xlsx", "good/Summary.csv"]);
    expect(worker.calls.at(-1)).toEqual(["disposeDataset", "batch"]);
  });

  it("reports an output that fails and still builds the file's other outputs", async () => {
    worker.failOutputs.add("Detail");
    const files = [addFile({ name: "big.xlsx", columns: ["Customer", "Amount"], rows: 9 })];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe('"Detail" could not be built: Too many rows for one sheet.');
    expect(result.results[0].outputs.map((output) => output.fileName)).toEqual(["Summary.csv"]);
    expect(Object.keys(await unzip(result.bytes))).toEqual(["big/Summary.csv"]);
    expect(result.summary.outputs).toEqual([
      { name: "Detail", fileType: "xlsx", rowCount: 0 },
      { name: "Summary", fileType: "csv", rowCount: 9 },
    ]);
  });

  it("returns no zip when nothing could be built", async () => {
    const files = [addFile({ name: "broken.xlsx", columns: [], fail: "parse" })];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.bytes).toBeNull();
    expect(result.summary).toMatchObject({ succeeded: 0, failed: 1 });
  });

  it("keeps folder and file names unique inside the zip", async () => {
    const definition = salesDefinition({
      outputs: [createOutput({ name: "Report", fileType: "xlsx" }), createOutput({ name: "report", fileType: "xlsx" })],
    });
    const files = [
      addFile({ name: "sales.xlsx", columns: ["Customer", "Amount"], rows: 1 }),
      addFile({ name: "Sales.csv", columns: ["Customer", "Amount"], rows: 1 }),
      addFile({ name: "q1:sales?.xlsx", columns: ["Customer", "Amount"], rows: 1 }),
    ];
    const result = await runBatch({ files, definition });
    expect(Object.keys(await unzip(result.bytes)).sort()).toEqual([
      "Sales (2)/Report.xlsx",
      "Sales (2)/report (2).xlsx",
      "q1 sales/Report.xlsx",
      "q1 sales/report (2).xlsx",
      "sales/Report.xlsx",
      "sales/report (2).xlsx",
    ]);
    expect(result.results[0].outputs.map((output) => output.fileName)).toEqual(["Report.xlsx", "report (2).xlsx"]);
  });

  it("falls back to the first sheet with rows when the template's sheet is not there, and says so", async () => {
    const files = [
      addFile({
        name: "other.xlsx",
        columns: ["Customer", "Amount"],
        rows: 2,
        sheets: [
          { name: "Notes", rowCount: 0, colCount: 0 },
          { name: "Data", rowCount: 2, colCount: 2 },
        ],
        warnings: ["2 empty rows were skipped."],
      }),
    ];
    const result = await runBatch({ files, definition: salesDefinition() });
    expect(result.results[0].sheetNames).toEqual(["Data"]);
    expect(result.results[0].warnings).toEqual(['The sheet "Sales" was not found, so "Data" was read instead.', "2 empty rows were skipped."]);
    const load = worker.calls.find((call) => call[0] === "loadTable")[1];
    expect(load.sheetNames).toEqual(["Data"]);
  });

  it("reports progress for every step", async () => {
    const files = [addFile({ name: "a.xlsx", columns: ["Customer", "Amount"], rows: 1 })];
    const progress = [];
    await runBatch({ files, definition: salesDefinition(), onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([
      { total: 1, index: 0, fileName: "a.xlsx", phase: "reading" },
      { total: 1, index: 0, fileName: "a.xlsx", phase: "loading" },
      { total: 1, index: 0, fileName: "a.xlsx", phase: "building", outputName: "Detail", outputIndex: 0, outputCount: 2 },
      { total: 1, index: 0, fileName: "a.xlsx", phase: "building", outputName: "Summary", outputIndex: 1, outputCount: 2 },
      { total: 1, index: 1, fileName: "", phase: "zipping" },
    ]);
  });

  it("survives a progress callback that throws", async () => {
    const files = [addFile({ name: "a.xlsx", columns: ["Customer", "Amount"], rows: 1 })];
    const result = await runBatch({
      files,
      definition: salesDefinition(),
      onProgress: () => {
        throw new Error("UI went away");
      },
    });
    expect(result.results[0].ok).toBe(true);
  });

  it("stops when cancelled: the rest is reported as not processed and no zip is built", async () => {
    const controller = new AbortController();
    const files = [
      addFile({ name: "a.xlsx", columns: ["Customer", "Amount"], rows: 1 }),
      addFile({ name: "b.xlsx", columns: ["Customer", "Amount"], rows: 1 }),
      addFile({ name: "c.xlsx", columns: ["Customer", "Amount"], rows: 1 }),
    ];
    const result = await runBatch({
      files,
      definition: salesDefinition(),
      signal: controller.signal,
      onProgress: (p) => {
        if (p.fileName === "b.xlsx" && p.phase === "building" && p.outputIndex === 0) controller.abort();
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.bytes).toBeNull();
    expect(result.results.map((entry) => [entry.fileName, entry.ok, Boolean(entry.skipped)])).toEqual([
      ["a.xlsx", true, false],
      ["b.xlsx", false, false],
      ["c.xlsx", false, true],
    ]);
    expect(result.results[1].outputs).toHaveLength(1);
    expect(result.results[1].error).toMatch(/Stopped/);
    expect(result.results[2].error).toMatch(/not processed/i);
    expect(worker.calls.filter((call) => call[0] === "parseFile")).toHaveLength(2);
    expect(worker.calls.at(-1)).toEqual(["disposeDataset", "batch"]);
  });

  it("joins the workflow's lookup file only when asked and configured", async () => {
    const lookup = createLookup({ enabled: true, matchColumn: "Customer", lookupColumn: "Name" });
    const files = [addFile({ name: "a.xlsx", columns: ["Customer", "Amount"], rows: 1 })];
    await runBatch({ files, definition: salesDefinition({ lookup }), useLookup: true });
    expect(worker.calls.find((call) => call[0] === "loadTable")[1].lookup).toMatchObject({ matchColumn: "Customer", lookupColumn: "Name" });

    worker.calls.length = 0;
    await runBatch({ files, definition: salesDefinition({ lookup }), useLookup: false });
    expect(worker.calls.find((call) => call[0] === "loadTable")[1].lookup).toBeNull();

    worker.calls.length = 0;
    await runBatch({ files, definition: salesDefinition(), useLookup: true });
    expect(worker.calls.find((call) => call[0] === "loadTable")[1].lookup).toBeNull();
  });

  it("refuses to start without files or without outputs", async () => {
    await expect(runBatch({ files: [], definition: salesDefinition() })).rejects.toThrow(/at least one file/);
    const files = [addFile({ name: "a.xlsx", columns: ["Customer", "Amount"], rows: 1 })];
    await expect(runBatch({ files, definition: salesDefinition({ outputs: [] }) })).rejects.toThrow(/no outputs/);
    expect(worker.calls).toEqual([]);
  });

  it("recognises spreadsheet file names", () => {
    expect(["a.xlsx", "B.XLS", "c.csv", "d.xlsm", "e.tsv"].every((name) => isSpreadsheetFile({ name }))).toBe(true);
    expect(["notes.txt", "image.png", "xlsx", "", null].some((name) => isSpreadsheetFile({ name }))).toBe(false);
    expect(isSpreadsheetFile(null)).toBe(false);
  });
});
