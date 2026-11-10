/**
 * workers/parse.worker.js: the data engine's home. See lib/workerClient.js for the protocol.
 *
 * Each handler receives (payload, ctx) and returns the result object described
 * in CONTRACTS.md. ctx.progress({ phase, percent, message }) reports progress.
 * Throw an Error with a `.code` (ERROR_CODES in lib/workerClient.js) for user-facing failures.
 * Results that carry `bytes` (Uint8Array) are transferred, not copied.
 *
 * This file is glue: the logic lives in lib/excel.js, lib/pipeline.js and lib/validate.js
 * so it can be tested in Node. `handlers` is exported for those tests; the message loop
 * is only installed when the file runs as a worker.
 */

import { buildOutputFile, buildTable, listSheets, readWorkbook, zipFileName, zipFiles } from "../lib/excel.js";
import { runPipeline, toDisplayRows } from "../lib/pipeline.js";
import { toText } from "../lib/transforms.js";
import { validateDefinition } from "../lib/validate.js";

const datasets = new Map(); // datasetId -> { fileName, fileSize, workbook, table, results }
const RESULT_CACHE_SIZE = 2;
const ZIP_MIME = "application/zip";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const idOf = (datasetId) => (datasetId === undefined || datasetId === null || datasetId === "" ? "main" : String(datasetId));

function getDataset(datasetId) {
  const dataset = datasets.get(idOf(datasetId));
  if (!dataset) throw fail("NO_DATA", "Upload a file first.");
  return dataset;
}

function getTable(datasetId) {
  const dataset = getDataset(datasetId);
  if (!dataset.table) throw fail("NO_DATA", "Choose a sheet to load first.");
  return dataset;
}

function displayRows(rows, offset, limit) {
  const end = Math.min(rows.length, offset + limit);
  const out = [];
  for (let r = offset; r < end; r += 1) {
    const row = rows[r];
    const cells = new Array(row.length);
    for (let c = 0; c < row.length; c += 1) cells[c] = toText(row[c]);
    out.push(cells);
  }
  return out;
}

const whole = (value, fallback, min = 0) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min ? n : fallback;
};

function checkDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw fail("INVALID_DEFINITION", "The workflow could not be read.");
  }
}

/**
 * Pipeline results are cached per dataset (the last two definition + output pairs),
 * so "preview, then download" does not run the same workflow twice.
 */
function resultFor(dataset, definition, outputId) {
  const key = `${outputId || ""}\u0000${JSON.stringify(definition)}`;
  const hit = dataset.results.find((entry) => entry.key === key);
  if (hit) return hit.result;
  const result = runPipeline(dataset.table, definition, { outputId: outputId || null });
  dataset.results.unshift({ key, result });
  dataset.results.length = Math.min(dataset.results.length, RESULT_CACHE_SIZE);
  return result;
}

export const handlers = {
  async parseFile({ file, datasetId }, ctx) {
    if (!file || typeof file.arrayBuffer !== "function") throw fail("EMPTY_FILE", "No file was received.");
    const id = idOf(datasetId);
    datasets.delete(id); // free the previous file before reading the next one
    ctx.progress({ phase: "reading", percent: 0, message: `Reading ${file.name}` });
    const buffer = await file.arrayBuffer();
    ctx.progress({ phase: "parsing", percent: 40, message: "Parsing the workbook" });
    const workbook = readWorkbook(buffer, file.name);
    ctx.progress({ phase: "parsing", percent: 100 });
    datasets.set(id, { fileName: file.name, fileSize: file.size, workbook, table: null, results: [] });
    return { datasetId: id, fileName: file.name, fileSize: file.size, sheets: listSheets(workbook) };
  },

  async loadTable({ datasetId, sheetNames, headerRow, previewLimit }, ctx) {
    // `lookup` (a later feature) is accepted and ignored for now: no columns are joined.
    const dataset = getDataset(datasetId);
    ctx.progress({ phase: "building", percent: 0, message: "Building the table" });
    dataset.table = null;
    dataset.results = [];
    const table = buildTable(dataset.workbook, {
      sheetNames: Array.isArray(sheetNames) ? sheetNames : [],
      headerRow: whole(headerRow, 1, 1),
    });
    dataset.table = table;
    return {
      columns: table.columns,
      rowCount: table.rows.length,
      previewRows: displayRows(table.rows, 0, whole(previewLimit, 50)),
      sheetNames: table.sheetNames,
      headerRow: table.headerRow,
      warnings: table.warnings,
      lookupInfo: null,
    };
  },

  async getRows({ datasetId, offset, limit }) {
    const { table } = getTable(datasetId);
    const start = Math.min(whole(offset, 0), table.rows.length);
    return { rows: displayRows(table.rows, start, whole(limit, 100)), offset: start, total: table.rows.length };
  },

  async runPreview({ datasetId, definition, outputId, limit }) {
    checkDefinition(definition);
    const dataset = getTable(datasetId);
    const result = resultFor(dataset, definition, outputId);
    return {
      columns: result.columns.map(({ key, name, type }) => ({ key, name, type })),
      rows: toDisplayRows(result, whole(limit, 20)),
      totalRows: result.totalRows,
      sourceRows: result.sourceRows,
      issues: [...validateDefinition(definition, dataset.table.columns), ...result.issues],
      stats: { ...result.stats },
    };
  },

  async buildOutput({ datasetId, definition, outputId }, ctx) {
    checkDefinition(definition);
    const dataset = getTable(datasetId);
    ctx.progress({ phase: "building", percent: 0, message: "Running the workflow" });
    const result = resultFor(dataset, definition, outputId);
    ctx.progress({ phase: "building", percent: 50, message: "Writing the file" });
    const file = buildOutputFile(dataset.table, definition, outputId, { result });
    ctx.progress({ phase: "building", percent: 100 });
    return file;
  },

  async buildZip({ datasetId, definition, outputIds, zipName }, ctx) {
    checkDefinition(definition);
    const dataset = getTable(datasetId);
    const outputs = Array.isArray(definition.outputs) ? definition.outputs.filter(Boolean) : [];
    const wanted = Array.isArray(outputIds) ? outputs.filter((output) => outputIds.includes(output.id)) : outputs;
    if (!wanted.length) throw fail("INVALID_DEFINITION", "There are no outputs to export.");
    const files = [];
    for (let i = 0; i < wanted.length; i += 1) {
      const output = wanted[i];
      ctx.progress({
        phase: "building",
        percent: Math.round((i / (wanted.length + 1)) * 100),
        message: `Building ${output.name || "output"} (${i + 1} of ${wanted.length})`,
      });
      const result = resultFor(dataset, definition, output.id);
      files.push(buildOutputFile(dataset.table, definition, output.id, { result }));
    }
    ctx.progress({ phase: "building", percent: Math.round((wanted.length / (wanted.length + 1)) * 100), message: "Zipping" });
    const { bytes, fileNames } = await zipFiles(files);
    ctx.progress({ phase: "building", percent: 100 });
    return {
      fileName: zipFileName(zipName),
      mime: ZIP_MIME,
      bytes,
      files: files.map((file, index) => ({ fileName: fileNames[index], rowCount: file.rowCount })),
    };
  },

  async disposeDataset({ datasetId }) {
    datasets.delete(idOf(datasetId));
    return { ok: true };
  },
};

/** Test helper: forget every dataset. */
export function resetDatasets() {
  datasets.clear();
}

// Do not test `typeof window` here: Next.js replaces it with a constant ("object") in client bundles,
// which would compile this whole block away. WorkerGlobalScope exists only inside a worker.
const isWorker =
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope;

if (isWorker) {
  self.onmessage = async (event) => {
    const { id, type, payload } = event.data || {};
    const handler = Object.prototype.hasOwnProperty.call(handlers, type) ? handlers[type] : null;
    const ctx = { progress: (progress) => self.postMessage({ id, progress }) };
    try {
      if (!handler) throw fail("NOT_IMPLEMENTED", `Unknown request "${type}".`);
      const result = await handler(payload || {}, ctx);
      const transfer = result && result.bytes && result.bytes.buffer ? [result.bytes.buffer] : [];
      self.postMessage({ id, ok: true, result }, transfer);
    } catch (error) {
      const coded = Boolean(error && error.code);
      if (!coded) console.error(`[parse.worker] ${type} failed`, error);
      self.postMessage({
        id,
        ok: false,
        error: {
          code: coded ? error.code : "UNKNOWN",
          message: (coded && error.message) || "Something went wrong while processing the file.",
        },
      });
    }
  };
  // Tell the page the handler is attached. The bundler's worker bootstrap loads this module
  // asynchronously, so messages posted before this point would otherwise be dropped.
  self.postMessage({ ready: true });
}
