import { loadAliases } from "./aliases";
import {
  collectColumnRefs,
  isLookupConfigured,
  matchColumns,
  normalizeDefinition,
  pickSheetNames,
  remapColumnRefs,
  sanitizeFileName,
  uniqueName,
} from "./schema";
import { buildOutput, disposeDataset, loadTable, parseFile } from "./workerClient";

export const BATCH_DATASET = "batch";

// Same as zipEntryDate in lib/excel.js (not imported, to keep SheetJS out of the page bundle).
function zipEntryDate(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
}

/**
 * lib/batch.js: apply one workflow definition to several files and bundle every result into one zip.
 * Files are processed one at a time in the worker (dataset "batch"), so memory stays bounded.
 *
 * Zip layout: "<source file name>/<output file name>". A file that fails is skipped and reported.
 *
 * @param {{ files: File[], definition: object, zipName?: string, useLookup?: boolean,
 *           onProgress?: (p: { index: number, total: number, fileName: string, phase: string }) => void }} args
 *   useLookup: join the lookup file currently loaded in the workflow (dataset "lookup") into every file.
 * @returns {Promise<{ bytes: Uint8Array | null, fileName: string, mime: string,
 *   results: { fileName: string, ok: boolean, error?: string, rowCount?: number, missing?: string[],
 *              outputs: { fileName: string, rowCount: number }[] }[] }>}
 */
export async function runBatch({ files, definition, zipName = "batch-results.zip", useLookup = false, onProgress } = {}) {
  const list = Array.from(files || []);
  const base = normalizeDefinition(definition);
  const results = [];
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folders = [];
  const aliases = loadAliases();
  const report = (index, fileName, phase) => {
    if (onProgress) onProgress({ index, total: list.length, fileName, phase });
  };

  try {
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      const entry = { fileName: file.name, ok: false, outputs: [] };
      results.push(entry);
      try {
        report(index, file.name, "reading");
        const parsed = await parseFile(file, { datasetId: BATCH_DATASET });
        const table = await loadTable({
          datasetId: BATCH_DATASET,
          sheetNames: pickSheetNames(parsed.sheets || [], base.source.sheetNames),
          headerRow: base.source.headerRow || 1,
          previewLimit: 0,
          lookup: useLookup && isLookupConfigured(base.lookup) ? base.lookup : null,
        });
        const match = matchColumns(collectColumnRefs(base), table.columns.map((column) => column.name), aliases);
        const fileDefinition = remapColumnRefs(base, match.map);
        entry.rowCount = table.rowCount;
        if (match.missing.length) entry.missing = match.missing;
        const folder = uniqueName(sanitizeFileName(file.name.replace(/\.[^.]+$/, ""), `file-${index + 1}`), folders);
        folders.push(folder);
        for (const output of fileDefinition.outputs) {
          report(index, file.name, `building ${output.name}`);
          const built = await buildOutput({ datasetId: BATCH_DATASET, definition: fileDefinition, outputId: output.id });
          zip.file(`${folder}/${built.fileName}`, built.bytes, { date: zipEntryDate() });
          entry.outputs.push({ fileName: built.fileName, rowCount: built.rowCount });
        }
        entry.ok = true;
      } catch (error) {
        entry.error = (error && error.message) || "This file could not be processed.";
      }
    }
  } finally {
    disposeDataset(BATCH_DATASET).catch(() => {});
  }

  const built = results.some((entry) => entry.outputs.length > 0);
  report(list.length, "", "zipping");
  const bytes = built ? await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }) : null;
  return { bytes, fileName: sanitizeFileName(zipName, "batch-results.zip"), mime: "application/zip", results };
}
