import { createId } from "./schema";
import { KEYS, readJSON, remove, writeJSON } from "./storage";

/**
 * lib/history.js: a small run log kept in localStorage ("ewb:v1:history").
 * It records WHAT was exported (template name, file name, output names, row counts, time),
 * never the data itself.
 *
 * entry = { id, at: ISO string, kind: 'file'|'zip'|'image'|'pdf'|'batch', templateName, fileName,
 *           outputs: [{ name, fileType, rowCount }] }
 *
 * React usage:
 *   const entries = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot);
 */

export const HISTORY_LIMIT = 100;

const EMPTY = Object.freeze([]);
const listeners = new Set();
let snapshot = null;

function sanitize(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.at === "string")
    .slice(0, HISTORY_LIMIT);
}

function emit() {
  for (const listener of listeners) listener();
}

export function loadHistory() {
  snapshot = sanitize(readJSON(KEYS.history, []));
  return snapshot;
}

/** Stable snapshot for useSyncExternalStore (re-read only after a change). */
export function getHistorySnapshot() {
  return snapshot || loadHistory();
}

export function getServerHistorySnapshot() {
  return EMPTY;
}

export function subscribeHistory(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record one export. Never throws; a full or unavailable storage simply skips the log.
 * @param {{ kind?: string, templateName?: string, fileName?: string,
 *           outputs?: { name: string, fileType?: string, rowCount?: number }[] }} run
 */
export function logRun(run = {}) {
  const entry = {
    id: createId("run"),
    at: new Date().toISOString(),
    kind: String(run.kind || "file"),
    templateName: String(run.templateName || ""),
    fileName: String(run.fileName || ""),
    outputs: (Array.isArray(run.outputs) ? run.outputs : []).slice(0, 50).map((output) => ({
      name: String((output && output.name) || ""),
      fileType: String((output && output.fileType) || ""),
      rowCount: Number.isFinite(output && output.rowCount) ? output.rowCount : null,
    })),
  };
  const next = [entry, ...getHistorySnapshot()].slice(0, HISTORY_LIMIT);
  const result = writeJSON(KEYS.history, next);
  if (result.ok) {
    snapshot = next;
    emit();
  }
  return entry;
}

export function removeHistoryEntry(id) {
  const next = getHistorySnapshot().filter((entry) => entry.id !== id);
  if (writeJSON(KEYS.history, next).ok) {
    snapshot = next;
    emit();
  }
}

export function clearHistory() {
  remove(KEYS.history);
  snapshot = EMPTY;
  emit();
}
