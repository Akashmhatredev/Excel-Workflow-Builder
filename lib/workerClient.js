/**
 * lib/workerClient.js: promise-based RPC to workers/parse.worker.js (browser only).
 *
 * The worker is stateful: it keeps the parsed workbook and the loaded table in
 * its own memory, so the UI thread never holds the full dataset. The UI only
 * receives small, display-ready slices (string[][]) and finished file bytes.
 *
 * Protocol (one worker, many requests):
 *   request   { id, type, payload }
 *   progress  { id, progress: { phase, percent?, message? } }      (0..n times)
 *   response  { id, ok: true, result } | { id, ok: false, error: { code, message } }
 *
 * Every function rejects with an Error that has a `.code` (see ERROR_CODES).
 */

export const ERROR_CODES = {
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  CORRUPT_FILE: "CORRUPT_FILE",
  PASSWORD_PROTECTED: "PASSWORD_PROTECTED",
  EMPTY_FILE: "EMPTY_FILE",
  EMPTY_SHEET: "EMPTY_SHEET",
  NO_DATA: "NO_DATA",
  INVALID_DEFINITION: "INVALID_DEFINITION",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  WORKER_CRASHED: "WORKER_CRASHED",
  UNKNOWN: "UNKNOWN",
};

export const DEFAULT_DATASET = "main";

let worker = null;
let sequence = 0;
const pending = new Map();

function toError(error) {
  const err = new Error((error && error.message) || "Something went wrong while processing the file.");
  err.code = (error && error.code) || ERROR_CODES.UNKNOWN;
  return err;
}

function failAll(message) {
  for (const [, entry] of pending) entry.reject(toError({ code: ERROR_CODES.WORKER_CRASHED, message }));
  pending.clear();
}

function getWorker() {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw toError({ code: ERROR_CODES.UNKNOWN, message: "Web Workers are not available in this browser." });
  }
  if (!worker) {
    worker = new Worker(new URL("../workers/parse.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const data = event.data || {};
      const entry = pending.get(data.id);
      if (!entry) return;
      if (data.progress) {
        if (entry.onProgress) entry.onProgress(data.progress);
        return;
      }
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(toError(data.error));
    };
    worker.onerror = (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      failAll("The background worker stopped unexpectedly. Please load the file again.");
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      worker = null;
    };
  }
  return worker;
}

function call(type, payload = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let instance;
    try {
      instance = getWorker();
    } catch (error) {
      reject(error);
      return;
    }
    sequence += 1;
    const id = sequence;
    pending.set(id, { resolve, reject, onProgress: options.onProgress });
    try {
      instance.postMessage({ id, type, payload });
    } catch (error) {
      pending.delete(id);
      reject(toError({ code: ERROR_CODES.UNKNOWN, message: error && error.message }));
    }
  });
}

/**
 * Read a workbook (.xlsx, .xls, .csv) into the worker.
 * @param {File} file
 * @param {{ datasetId?: string, onProgress?: (p: {phase: string, percent?: number, message?: string}) => void }} [options]
 * @returns {Promise<{ datasetId: string, fileName: string, fileSize: number,
 *   sheets: { name: string, rowCount: number, colCount: number }[] }>}
 */
export function parseFile(file, options = {}) {
  return call("parseFile", { file, datasetId: options.datasetId || DEFAULT_DATASET }, { onProgress: options.onProgress });
}

/**
 * Build the working table from one or more sheets of a parsed workbook.
 * Several sheets are stacked (union of columns, plus a "Source Sheet" column).
 *
 * `lookup` (a Lookup from lib/schema.js, or null) left-joins the table loaded in the "lookup"
 * dataset onto this one: the chosen lookup columns are appended as ordinary source columns
 * (`origin: 'lookup'`; a name that already exists gets the suffix " (lookup)").
 * @param {{ datasetId?: string, sheetNames: string[], headerRow?: number, previewLimit?: number, lookup?: object|null }} args
 * @returns {Promise<{ columns: { name: string, type: 'text'|'number'|'date', index: number, origin?: 'lookup' }[],
 *   rowCount: number, previewRows: string[][], sheetNames: string[], headerRow: number, warnings: string[],
 *   lookupInfo?: { applied: boolean, matched: number, unmatched: number, addedColumns: string[] } | null }>}
 */
export function loadTable({ datasetId = DEFAULT_DATASET, sheetNames = [], headerRow = 1, previewLimit = 50, lookup = null } = {}) {
  return call("loadTable", { datasetId, sheetNames, headerRow, previewLimit, lookup });
}

/**
 * A page of the loaded source table as display strings.
 * @returns {Promise<{ rows: string[][], offset: number, total: number }>}
 */
export function getRows({ datasetId = DEFAULT_DATASET, offset = 0, limit = 100 } = {}) {
  return call("getRows", { datasetId, offset, limit });
}

/**
 * Run the workflow over the whole table and return the first `limit` result rows.
 * outputId = null previews the workflow-level result (mapping step); an output id
 * applies that output's field selection and overrides.
 * @returns {Promise<{ columns: { key: string, name: string, type: 'text'|'number'|'date' }[],
 *   rows: string[][], totalRows: number, sourceRows: number,
 *   issues: { level: 'error'|'warning', scope: string, id: string|null, code: string, message: string }[],
 *   cellIssues?: [rowIndex: number, columnIndex: number, code: 'error'|'blank'][] }>}
 *   cellIssues flags cells of the returned rows: 'error' = the value could not be computed or does not
 *   fit the column type, 'blank' = empty.
 */
export function runPreview({ datasetId = DEFAULT_DATASET, definition, outputId = null, limit = 20 } = {}) {
  return call("runPreview", { datasetId, definition, outputId, limit });
}

/**
 * Build one output file.
 * @returns {Promise<{ fileName: string, mime: string, bytes: Uint8Array, rowCount: number }>}
 */
export function buildOutput({ datasetId = DEFAULT_DATASET, definition, outputId, onProgress } = {}) {
  return call("buildOutput", { datasetId, definition, outputId }, { onProgress });
}

/**
 * Build several outputs and bundle them into one zip (duplicate file names get a numeric suffix).
 * outputIds = null means every output.
 * @returns {Promise<{ fileName: string, mime: string, bytes: Uint8Array,
 *   files: { fileName: string, rowCount: number }[] }>}
 */
export function buildZip({ datasetId = DEFAULT_DATASET, definition, outputIds = null, zipName = "outputs.zip", onProgress } = {}) {
  return call("buildZip", { datasetId, definition, outputIds, zipName }, { onProgress });
}

/**
 * Pivot / summary of the workflow-level rows (after mapping, filters and cleaning; before grouping).
 * rowKey / columnKey / valueKey are field ids. columnKey null = a single value column.
 * fn: 'sum' | 'count' | 'avg' | 'min' | 'max' (count ignores valueKey when it is null).
 * @returns {Promise<{ columns: { key: string, name: string, type: 'text'|'number'|'date' }[],
 *   rows: string[][], totalRows: number, truncatedColumns: boolean }>}
 *   The first column holds the row labels; the last column and the last row are totals.
 */
export function runPivot({ datasetId = DEFAULT_DATASET, definition, rowKey, columnKey = null, valueKey = null, fn = "count", limit = 200 } = {}) {
  return call("runPivot", { datasetId, definition, rowKey, columnKey, valueKey, fn, limit });
}

/** Free a dataset's memory in the worker. */
export function disposeDataset(datasetId = DEFAULT_DATASET) {
  if (!worker) return Promise.resolve({ ok: true });
  return call("disposeDataset", { datasetId });
}

/** Low-level escape hatch for new message types added later (batch mode, lookups...). */
export function callWorker(type, payload, options) {
  return call(type, payload, options);
}
