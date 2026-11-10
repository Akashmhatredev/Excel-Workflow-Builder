/**
 * lib/storage.js: the only place that touches localStorage.
 *
 * - every key is namespaced ("ewb:v1:<name>")
 * - every call is wrapped in try/catch and never throws
 * - write failures are reported to listeners (see onStorageError) so the UI can
 *   show "storage is full" instead of failing silently
 * - changes made by another tab are reported through onStorageChange
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
export const UNKNOWN_MESSAGE = "Could not save to browser storage.";

const MESSAGES = { quota: QUOTA_MESSAGE, unavailable: UNAVAILABLE_MESSAGE, unknown: UNKNOWN_MESSAGE };

const listeners = new Set();

export function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

function getStore() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // reading window.localStorage itself throws when site data is blocked
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

/**
 * 'quota' | 'unavailable' | 'unknown' for a failed setItem.
 * Some browsers (private windows with a zero quota) throw a quota error for every
 * write. That is "storage is switched off", not "storage is full": an empty store
 * that cannot hold a single character tells the two apart.
 */
function classifyWriteError(error, store) {
  if (!isQuotaError(error)) return error && error.name === "SecurityError" ? "unavailable" : "unknown";
  try {
    if (store.length > 0) return "quota";
    const probe = storageKey("__probe__");
    store.setItem(probe, "1");
    store.removeItem(probe);
    return "quota";
  } catch {
    return "unavailable";
  }
}

function report(code, error, key) {
  const detail = { code, key, message: MESSAGES[code] || UNKNOWN_MESSAGE, error };
  for (const listener of [...listeners]) {
    try {
      listener(detail);
    } catch {
      // a broken listener must not break storage
    }
  }
  return detail;
}

/**
 * Subscribe to write failures. Returns an unsubscribe function.
 * detail = { code: 'quota' | 'unavailable' | 'unknown', key, message, error }
 * (`key` is the un-prefixed name, for example KEYS.draft).
 */
export function onStorageError(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe to changes made by ANOTHER tab or window (the browser "storage" event;
 * a tab never hears its own writes). Returns an unsubscribe function.
 * change = { name, newValue, oldValue }: `name` is the un-prefixed key, or null when
 * the whole storage was cleared.
 */
export function onStorageChange(listener) {
  if (typeof listener !== "function") return () => {};
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const handler = (event) => {
    try {
      if (!event) return;
      if (event.storageArea && event.storageArea !== getStore()) return;
      if (event.key == null) {
        listener({ name: null, newValue: null, oldValue: null });
        return;
      }
      if (typeof event.key !== "string" || !event.key.startsWith(STORAGE_PREFIX)) return;
      listener({
        name: event.key.slice(STORAGE_PREFIX.length),
        newValue: event.newValue ?? null,
        oldValue: event.oldValue ?? null,
      });
    } catch {
      // a broken listener must not break the page
    }
  };
  try {
    window.addEventListener("storage", handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      window.removeEventListener("storage", handler);
    } catch {
      // nothing to clean up
    }
  };
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
    const value = store.getItem(storageKey(name));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Raw string write. Returns { ok: true } or { ok: false, code, message }.
 * A failed write leaves the previously stored value untouched and notifies onStorageError listeners.
 */
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
    const detail = report(classifyWriteError(error, store), error, name);
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
  if (typeof raw !== "string") {
    // JSON.stringify(undefined) is undefined: there is nothing to store
    const detail = report("unknown", null, name);
    return { ok: false, code: detail.code, message: detail.message };
  }
  return writeRaw(name, raw);
}

/**
 * StateStorage for zustand's persist middleware (use with createJSONStorage).
 * The persist `name` option should be a bare key from KEYS; the prefix is added here.
 * setItem / removeItem return the write result ({ ok, code?, message? }) so a store
 * can check whether its last change really reached the disk.
 */
export const zustandStorage = {
  getItem: (name) => readRaw(name),
  setItem: (name, value) => writeRaw(name, value),
  removeItem: (name) => remove(name),
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
