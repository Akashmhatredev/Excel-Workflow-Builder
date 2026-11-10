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
let ready = null; // Promise that resolves once the worker has attached its message handler
let sequence = 0;
const pending = new Map();
const READY_TIMEOUT_MS = 20_000;

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
    let markReady;
    ready = new Promise((resolve) => {
      markReady = resolve;
    });
    const instance = worker;
    const timer = setTimeout(() => {
      if (worker !== instance) return;
      failAll("The background worker did not start. Reload the page and try again.");
      resetWorker();
    }, READY_TIMEOUT_MS);
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.ready) {
        clearTimeout(timer);
        markReady();
        return;
      }
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
      clearTimeout(timer);
      failAll("The background worker stopped unexpectedly. Please load the file again.");
      resetWorker();
    };
  }
  return worker;
}

function resetWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // already gone
    }
  }
  worker = null;
  ready = null;
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
    ready.then(() => {
      if (!pending.has(id) || worker !== instance) return;
      try {
        instance.postMessage({ id, type, payload });
      } catch (error) {
        pending.delete(id);
        reject(toError({ code: ERROR_CODES.UNKNOWN, message: error && error.message }));
      }
    });
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
 *   lookupInfo?: { applied: boolean, matched: number, unmatched: number, addedColumns: string[], duplicateKeys: number } | null }>}
 *   duplicateKeys counts distinct lookup keys that occur more than once (the first row wins).
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
 *   stats: { emptyRowsRemoved: number, duplicatesRemoved: number, blanksFilled: number },
 *   cellIssues: [rowIndex: number, columnIndex: number, code: 'error'|'blank'][],
 *   highlights: [rowIndex: number, columnIndex: number, style: string, bold: boolean][] }>}
 *   Indexes refer to the returned `rows` / `columns`.
 *   cellIssues: 'error' = the value could not be computed or does not fit the column's type, 'blank' = empty.
 *   highlights: the output's conditional formats (`style` is a HIGHLIGHT_STYLES key); [] when outputId is null.
 *   stats: what data cleaning did over the whole result (zeros when cleaning is off).
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
