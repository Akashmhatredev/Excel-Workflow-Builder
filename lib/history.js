import { createId } from "./schema";
import { KEYS, onStorageChange, readJSON, remove, writeJSON } from "./storage";

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
 *
 * Other tabs: while anything is subscribed, a change made in another tab (the browser "storage"
 * event on ewb:v1:history, or the whole storage being cleared) drops the cached snapshot and
 * notifies the subscribers. Writes always start from what is stored right now, so a tab never
 * overwrites runs another tab logged in the meantime.
 */

export const HISTORY_LIMIT = 100;

const EMPTY = Object.freeze([]);
const listeners = new Set();
let snapshot = null;
let unbindStorage = null;

function sanitize(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.at === "string")
    .slice(0, HISTORY_LIMIT);
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function readStored() {
  return sanitize(readJSON(KEYS.history, []));
}

/** Re-read the log from storage and cache it as the current snapshot. */
export function loadHistory() {
  snapshot = readStored();
  return snapshot;
}

/** Stable snapshot for useSyncExternalStore (re-read only after a change). */
export function getHistorySnapshot() {
  return snapshot || loadHistory();
}

export function getServerHistorySnapshot() {
  return EMPTY;
}

function onOtherTabChange(change) {
  // name === null: another tab cleared the whole storage.
  if (change.name !== null && change.name !== KEYS.history) return;
  snapshot = null;
  emit();
}

export function subscribeHistory(listener) {
  listeners.add(listener);
  if (!unbindStorage) unbindStorage = onStorageChange(onOtherTabChange);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unbindStorage) {
      unbindStorage();
      unbindStorage = null;
      // Nobody hears other tabs any more: the next read goes back to storage.
      snapshot = null;
    }
  };
}

function commit(next) {
  if (!writeJSON(KEYS.history, next).ok) return false;
  snapshot = next;
  emit();
  return true;
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
  commit([entry, ...readStored()].slice(0, HISTORY_LIMIT));
  return entry;
}

export function removeHistoryEntry(id) {
  const current = readStored();
  const next = current.filter((entry) => entry.id !== id);
  if (next.length !== current.length) commit(next);
}

export function clearHistory() {
  remove(KEYS.history);
  snapshot = EMPTY;
  emit();
}
