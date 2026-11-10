/**
 * Run history for the Export step (owner: X3). Every successful download is logged with
 * lib/history.js `logRun`: what was exported (names, types, row counts), never the data.
 */

import { logRun } from "@/lib/history";
import { useWorkflowStore } from "@/store/useWorkflowStore";

/** "Sales.xlsx" -> "xlsx" (lower case), "" when there is no extension. */
export function fileTypeOf(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(String(fileName || ""));
  return match ? match[1].toLowerCase() : "";
}

/**
 * @param {'file'|'zip'|'image'|'pdf'} kind
 * @param {{ name: string, fileType: string, rowCount?: number|null }[]} outputs
 */
export function recordRun(kind, outputs) {
  try {
    const state = useWorkflowStore.getState();
    logRun({
      kind,
      templateName: state.templateName || "",
      fileName: (state.file && state.file.name) || "",
      outputs,
    });
  } catch {
    // The log is a convenience: it must never turn a finished download into an error.
  }
}
