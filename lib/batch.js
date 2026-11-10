import { loadAliases } from "./aliases";
import {
  collectColumnRefs,
  isLookupConfigured,
  matchColumns,
  normalizeDefinition,
  normalizeName,
  pickSheetNames,
  remapColumnRefs,
  sanitizeFileName,
  uniqueName,
} from "./schema";
import { buildOutput, disposeDataset, loadTable, parseFile } from "./workerClient";

/**
 * lib/batch.js: apply one workflow definition to several files and bundle every result into one zip.
 * Files are processed one at a time in the worker (dataset "batch"), so memory stays bounded and the
 * file loaded in the wizard (dataset "main") is never touched. Nothing leaves the browser.
 *
 * Zip layout: "<source file name>/<output file name>". A file that fails is reported and skipped;
 * an output that fails is reported and the file's other outputs are still built.
 *
 * Column matching per file: exact name, then case/space-insensitive, then the saved aliases
 * (lib/aliases.js). Columns that are still missing are listed in `missing`; the outputs are built
 * anyway and those values are empty.
 */

export const BATCH_DATASET = "batch";
/** File types the batch page accepts (the same as the upload step, plus .xlsm and .tsv the engine reads). */
export const BATCH_ACCEPT = ".xlsx,.xlsm,.xls,.csv,.tsv";
export const BATCH_MAX_FILES = 50;

const SPREADSHEET_NAME = /\.(xlsx|xlsm|xls|csv|tsv)$/i;
const CANCELLED_MESSAGE = "Not processed: the batch was stopped.";

/** True when a file name has an extension the engine reads. */
export function isSpreadsheetFile(file) {
  return Boolean(file && typeof file.name === "string" && SPREADSHEET_NAME.test(file.name));
}

// Same as zipEntryDate in lib/excel.js (not imported, to keep SheetJS out of the page bundle).
function zipEntryDate(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
}

/** "Sales.xlsx" twice in one folder -> "Sales.xlsx", "Sales (2).xlsx". `taken` holds lower-cased names. */
function uniqueFileName(fileName, taken) {
  const name = String(fileName || "output");
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function zipFileNameOf(name) {
  const clean = sanitizeFileName(name, "batch-results.zip");
  return /\.zip$/i.test(clean) ? clean : `${clean}.zip`;
}

const quoteList = (names) => names.map((name) => `"${name}"`).join(", ");

/** A warning when the sheets the definition asks for are not all in this file. */
function sheetWarning(wanted, sheets, picked) {
  const present = new Set(sheets.map((sheet) => normalizeName(sheet.name)));
  const absent = wanted.filter((name) => !present.has(normalizeName(name)));
  if (!absent.length) return null;
  const subject = absent.length === 1 ? `The sheet ${quoteList(absent)} was` : `The sheets ${quoteList(absent)} were`;
  if (absent.length === wanted.length) {
    return picked.length ? `${subject} not found, so ${quoteList(picked)} was read instead.` : `${subject} not found.`;
  }
  return `${subject} not found and skipped.`;
}

const errorMessage = (error, fallback) => (error && typeof error.message === "string" && error.message) || fallback;

/**
 * @param {{ files: File[], definition: object, zipName?: string, useLookup?: boolean, signal?: AbortSignal,
 *           onProgress?: (p: { index: number, total: number, fileName: string,
 *                              phase: 'reading' | 'loading' | 'building' | 'zipping',
 *                              outputName?: string, outputIndex?: number, outputCount?: number }) => void }} args
 *   useLookup: join the lookup file currently loaded in the workflow (dataset "lookup") into every file.
 *   signal: stop after the current step; the remaining files are reported as not processed and no zip is built.
 * @returns {Promise<{ bytes: Uint8Array | null, fileName: string, mime: string, cancelled: boolean,
 *   results: { fileName: string, ok: boolean, skipped?: boolean, error?: string, rowCount?: number,
 *              sheetNames?: string[], missing?: string[], warnings: string[],
 *              outputs: { outputId: string, name: string, fileType: string, fileName: string, rowCount: number }[] }[],
 *   summary: { files: number, succeeded: number, failed: number, withMissingColumns: number,
 *              outputs: { name: string, fileType: string, rowCount: number }[] } }>}
 *   summary.outputs: one entry per output of the definition, row counts summed over every file.
 * Rejects (before doing anything) when there are no files or the definition has no outputs.
 *
 * Runs never overlap: they share the worker's "batch" dataset, so a run that starts while another
 * one is still going (for example after leaving the page and coming back) waits for it to finish.
 */
export function runBatch(args) {
  const run = queue.then(() => runBatchNow(args || {}));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let queue = Promise.resolve();

async function runBatchNow({ files, definition, zipName = "batch-results.zip", useLookup = false, signal, onProgress }) {
  const list = Array.from(files || []).filter(Boolean);
  const base = normalizeDefinition(definition);
  if (!list.length) throw new Error("Add at least one file to run the batch.");
  if (!base.outputs.length) throw new Error("This workflow has no outputs. Add one in the Outputs step first.");

  const results = [];
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folders = [];
  const aliases = loadAliases();
  const lookup = useLookup && isLookupConfigured(base.lookup) ? base.lookup : null;
  const refs = collectColumnRefs(base);
  const stopped = () => Boolean(signal && signal.aborted);
  const report = (progress) => {
    if (!onProgress) return;
    try {
      onProgress({ total: list.length, ...progress });
    } catch {
      // a broken progress callback must not break the batch
    }
  };
  let cancelled = false;

  try {
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      const fileName = String((file && file.name) || `File ${index + 1}`);
      if (stopped()) {
        cancelled = true;
        results.push({ fileName, ok: false, skipped: true, error: CANCELLED_MESSAGE, warnings: [], outputs: [] });
        continue;
      }
      const entry = { fileName, ok: false, warnings: [], outputs: [] };
      results.push(entry);
      const errors = [];
      try {
        report({ index, fileName, phase: "reading" });
        const parsed = await parseFile(file, { datasetId: BATCH_DATASET });
        const sheets = Array.isArray(parsed && parsed.sheets) ? parsed.sheets : [];
        const sheetNames = pickSheetNames(sheets, base.source.sheetNames);
        const sheetNote = sheetWarning(base.source.sheetNames, sheets, sheetNames);
        if (sheetNote) entry.warnings.push(sheetNote);

        report({ index, fileName, phase: "loading" });
        const table = await loadTable({
          datasetId: BATCH_DATASET,
          sheetNames,
          headerRow: base.source.headerRow || 1,
          previewLimit: 0,
          lookup,
        });
        entry.rowCount = table.rowCount;
        entry.sheetNames = Array.isArray(table.sheetNames) ? table.sheetNames : sheetNames;
        if (Array.isArray(table.warnings)) entry.warnings.push(...table.warnings.filter((w) => typeof w === "string" && w));

        const columnNames = (table.columns || []).map((column) => column.name);
        const match = matchColumns(refs, columnNames, aliases);
        if (match.missing.length) entry.missing = match.missing;
        const fileDefinition = remapColumnRefs(base, match.map);

        const folder = uniqueName(sanitizeFileName(fileName.replace(/\.[^.]+$/, ""), `file-${index + 1}`), folders);
        folders.push(folder);
        const taken = new Set();
        const outputs = fileDefinition.outputs;
        for (let o = 0; o < outputs.length; o += 1) {
          const output = outputs[o];
          if (stopped()) {
            cancelled = true;
            errors.push("Stopped before every output was built.");
            break;
          }
          report({ index, fileName, phase: "building", outputName: output.name, outputIndex: o, outputCount: outputs.length });
          try {
            const built = await buildOutput({ datasetId: BATCH_DATASET, definition: fileDefinition, outputId: output.id });
            const name = uniqueFileName(built.fileName, taken);
            zip.file(`${folder}/${name}`, built.bytes, { date: zipEntryDate() });
            entry.outputs.push({
              outputId: output.id,
              name: output.name,
              fileType: output.fileType,
              fileName: name,
              rowCount: Number.isFinite(built.rowCount) ? built.rowCount : 0,
            });
          } catch (error) {
            errors.push(`"${output.name || "Output"}" could not be built: ${errorMessage(error, "unknown error.")}`);
          }
        }
      } catch (error) {
        errors.push(errorMessage(error, "This file could not be processed."));
      }
      if (errors.length) entry.error = errors.join(" ");
      entry.ok = !errors.length;
    }
  } finally {
    disposeDataset(BATCH_DATASET).catch(() => {});
  }

  const anyBuilt = results.some((entry) => entry.outputs.length > 0);
  let bytes = null;
  if (anyBuilt && !cancelled) {
    report({ index: list.length, fileName: "", phase: "zipping" });
    bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  const totals = base.outputs.map((output) => ({ id: output.id, name: output.name, fileType: output.fileType, rowCount: 0 }));
  for (const entry of results) {
    for (const built of entry.outputs) {
      const total = totals.find((item) => item.id === built.outputId);
      if (total) total.rowCount += built.rowCount;
    }
  }

  return {
    bytes,
    fileName: zipFileNameOf(zipName),
    mime: "application/zip",
    cancelled,
    results,
    summary: {
      files: results.length,
      succeeded: results.filter((entry) => entry.ok).length,
      failed: results.filter((entry) => !entry.ok).length,
      withMissingColumns: results.filter((entry) => entry.missing && entry.missing.length).length,
      outputs: totals.map(({ name, fileType, rowCount }) => ({ name, fileType, rowCount })),
    },
  };
}
