/**
 * lib/storage.js: the only place that touches localStorage.
 *
 * - every key is namespaced ("ewb:v1:<name>")
 * - every call is wrapped in try/catch and never throws
 * - write failures are reported to listeners (see onStorageError) so the UI can
 *   show "storage is full" instead of failing silently
 *
 * Spreadsheet data is never written here: only definitions, templates and
 * small preferences.
 */

export const STORAGE_PREFIX = "ewb:v1:";

export const KEYS = {
  templates: "templates",
  draft: "draft",
  theme: "theme",
  aliases: "aliases",
  history: "history",
};

export const QUOTA_MESSAGE =
  "Browser storage is full. Delete some templates (or export them as JSON first) and try again.";
export const UNAVAILABLE_MESSAGE =
  "Browser storage is not available (private window or blocked site data). Templates and drafts will not be saved.";

const listeners = new Set();

export function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

function getStore() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isQuotaError(error) {
  if (!error) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

function report(code, error, key) {
  const detail = {
    code,
    key,
    message: code === "quota" ? QUOTA_MESSAGE : code === "unavailable" ? UNAVAILABLE_MESSAGE : "Could not save to browser storage.",
    error,
  };
  for (const listener of listeners) {
    try {
      listener(detail);
    } catch {
      // a broken listener must not break storage
    }
  }
  return detail;
}

/** Subscribe to write failures. Returns an unsubscribe function. detail = { code: 'quota'|'unavailable'|'unknown', key, message }. */
export function onStorageError(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStorageAvailable() {
  const store = getStore();
  if (!store) return false;
  try {
    const probe = storageKey("__probe__");
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Raw string read. Returns null when missing or unreadable. */
export function readRaw(name) {
  const store = getStore();
  if (!store) return null;
  try {
    return store.getItem(storageKey(name));
  } catch {
    return null;
  }
}

/** Raw string write. Returns { ok: true } or { ok: false, code, message }. */
export function writeRaw(name, value) {
  const store = getStore();
  if (!store) {
    const detail = report("unavailable", null, name);
    return { ok: false, code: detail.code, message: detail.message };
  }
  try {
    store.setItem(storageKey(name), value);
    return { ok: true };
  } catch (error) {
    const detail = report(isQuotaError(error) ? "quota" : "unknown", error, name);
    return { ok: false, code: detail.code, message: detail.message };
  }
}

export function remove(name) {
  const store = getStore();
  if (!store) return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  try {
    store.removeItem(storageKey(name));
    return { ok: true };
  } catch {
    return { ok: false, code: "unknown", message: "Could not remove the saved value." };
  }
}

/** JSON read with a fallback for missing or corrupt values. */
export function readJSON(name, fallback = null) {
  const raw = readRaw(name);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** JSON write. Returns { ok: true } or { ok: false, code, message }. */
export function writeJSON(name, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (error) {
    const detail = report("unknown", error, name);
    return { ok: false, code: detail.code, message: detail.message };
  }
  return writeRaw(name, raw);
}

/**
 * StateStorage for zustand's persist middleware (use with createJSONStorage).
 * The persist `name` option should be a bare key from KEYS; the prefix is added here.
 */
export const zustandStorage = {
  getItem: (name) => readRaw(name),
  setItem: (name, value) => {
    writeRaw(name, value);
  },
  removeItem: (name) => {
    remove(name);
  },
};

/** Approximate bytes used by this app's keys (UTF-16, so 2 bytes per character). */
export function storageUsage() {
  const store = getStore();
  if (!store) return 0;
  let chars = 0;
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) chars += key.length + (store.getItem(key) || "").length;
    }
  } catch {
    return 0;
  }
  return chars * 2;
}
