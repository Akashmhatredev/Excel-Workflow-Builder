import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEYS,
  QUOTA_MESSAGE,
  STORAGE_PREFIX,
  UNAVAILABLE_MESSAGE,
  isQuotaError,
  isStorageAvailable,
  onStorageChange,
  onStorageError,
  readJSON,
  readRaw,
  remove,
  storageKey,
  storageUsage,
  writeJSON,
  writeRaw,
  zustandStorage,
} from "@/lib/storage";

/** In-memory stand-in for window.localStorage with an optional size limit (in characters, keys + values). */
class FakeStorage {
  constructor({ quota = Infinity } = {}) {
    this.map = new Map();
    this.quota = quota;
    this.broken = false; // every call throws, like blocked site data
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key) {
    if (this.broken) throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.broken) throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
    const text = String(value);
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + text.length > this.quota) {
      throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError", code: 22 });
    }
    this.map.set(key, text);
  }

  removeItem(key) {
    if (this.broken) throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
    this.map.delete(key);
  }
}

/** A window with just enough for lib/storage.js: localStorage and add/removeEventListener. */
function installWindow(localStorage) {
  const handlers = new Map();
  const fakeWindow = {
    localStorage,
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener: (type, handler) => handlers.get(type)?.delete(handler),
    dispatch: (type, event) => [...(handlers.get(type) || [])].forEach((handler) => handler(event)),
    listenerCount: (type) => handlers.get(type)?.size || 0,
  };
  globalThis.window = fakeWindow;
  return fakeWindow;
}

describe("lib/storage", () => {
  let store;
  let fakeWindow;

  beforeEach(() => {
    store = new FakeStorage();
    fakeWindow = installWindow(store);
  });

  afterEach(() => {
    delete globalThis.window;
  });

  describe("reading and writing", () => {
    it("namespaces every key", () => {
      expect(storageKey("draft")).toBe("ewb:v1:draft");
      expect(STORAGE_PREFIX).toBe("ewb:v1:");
      expect(writeRaw(KEYS.theme, "dark")).toEqual({ ok: true });
      expect(store.getItem("ewb:v1:theme")).toBe("dark");
      expect(store.getItem("theme")).toBeNull();
      expect(readRaw(KEYS.theme)).toBe("dark");
    });

    it("round-trips JSON", () => {
      const value = { definition: { fields: [{ id: "fld_1", name: "Region" }] }, dirty: true };
      expect(writeJSON(KEYS.draft, value)).toEqual({ ok: true });
      expect(readJSON(KEYS.draft)).toEqual(value);
    });

    it("returns the fallback for a missing or corrupt value", () => {
      expect(readJSON(KEYS.draft)).toBeNull();
      expect(readJSON(KEYS.draft, { empty: true })).toEqual({ empty: true });
      store.setItem(storageKey(KEYS.draft), "{ not json");
      expect(readJSON(KEYS.draft, "fallback")).toBe("fallback");
      expect(readRaw(KEYS.draft)).toBe("{ not json");
    });

    it("removes a key", () => {
      writeRaw(KEYS.draft, "x");
      expect(remove(KEYS.draft)).toEqual({ ok: true });
      expect(readRaw(KEYS.draft)).toBeNull();
      expect(remove(KEYS.draft)).toEqual({ ok: true });
    });

    it("measures only this app's keys", () => {
      expect(storageUsage()).toBe(0);
      store.setItem("someone-else", "x".repeat(500));
      writeRaw(KEYS.theme, "dark");
      expect(storageUsage()).toBe(("ewb:v1:theme".length + "dark".length) * 2);
    });

    it("exposes a zustand StateStorage that reports the result of each write", () => {
      expect(zustandStorage.setItem(KEYS.templates, '{"state":{}}')).toEqual({ ok: true });
      expect(zustandStorage.getItem(KEYS.templates)).toBe('{"state":{}}');
      expect(store.getItem("ewb:v1:templates")).toBe('{"state":{}}');
      zustandStorage.removeItem(KEYS.templates);
      expect(zustandStorage.getItem(KEYS.templates)).toBeNull();
    });
  });

  describe("failures", () => {
    it("detects a full storage, keeps the old value and tells listeners", () => {
      writeJSON(KEYS.templates, { small: true });
      store.quota = 200;
      const seen = [];
      const off = onStorageError((detail) => seen.push(detail));

      const result = writeJSON(KEYS.templates, { big: "x".repeat(1000) });

      expect(result).toEqual({ ok: false, code: "quota", message: QUOTA_MESSAGE });
      expect(readJSON(KEYS.templates)).toEqual({ small: true });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ code: "quota", key: KEYS.templates, message: QUOTA_MESSAGE });
      expect(seen[0].error.name).toBe("QuotaExceededError");

      off();
      writeJSON(KEYS.templates, { big: "x".repeat(1000) });
      expect(seen).toHaveLength(1);
    });

    it("recognises the quota errors of the different browsers", () => {
      expect(isQuotaError({ name: "QuotaExceededError" })).toBe(true);
      expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
      expect(isQuotaError({ code: 22 })).toBe(true);
      expect(isQuotaError({ code: 1014 })).toBe(true);
      expect(isQuotaError(new Error("something else"))).toBe(false);
      expect(isQuotaError(null)).toBe(false);
    });

    it("calls an oversized first write a quota problem, but a store that holds nothing 'unavailable'", () => {
      store.quota = 100;
      expect(writeRaw(KEYS.draft, "x".repeat(500)).code).toBe("quota");
      store.quota = 0; // private windows of some browsers: every write throws a quota error
      expect(writeRaw(KEYS.draft, "x")).toEqual({ ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE });
      expect(isStorageAvailable()).toBe(false);
    });

    it("never throws when storage is blocked", () => {
      store.broken = true;
      const seen = [];
      const off = onStorageError((detail) => seen.push(detail.code));
      expect(readRaw(KEYS.draft)).toBeNull();
      expect(readJSON(KEYS.draft, 7)).toBe(7);
      expect(writeJSON(KEYS.draft, { a: 1 })).toMatchObject({ ok: false, code: "unavailable" });
      expect(remove(KEYS.draft).ok).toBe(false);
      expect(isStorageAvailable()).toBe(false);
      expect(storageUsage()).toBe(0);
      expect(seen).toEqual(["unavailable"]);
      off();
    });

    it("reports 'unavailable' when there is no window at all, or reading localStorage throws", () => {
      delete globalThis.window;
      expect(isStorageAvailable()).toBe(false);
      expect(readRaw(KEYS.draft)).toBeNull();
      expect(writeRaw(KEYS.draft, "x")).toEqual({ ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE });
      expect(remove(KEYS.draft)).toMatchObject({ ok: false, code: "unavailable" });

      globalThis.window = {
        get localStorage() {
          throw new Error("Access is denied for this document.");
        },
      };
      expect(readJSON(KEYS.draft, "fallback")).toBe("fallback");
      expect(writeJSON(KEYS.draft, {})).toMatchObject({ ok: false, code: "unavailable" });
    });

    it("refuses values that cannot be serialised", () => {
      const circular = {};
      circular.self = circular;
      expect(writeJSON(KEYS.draft, circular)).toMatchObject({ ok: false, code: "unknown" });
      expect(writeJSON(KEYS.draft, undefined)).toMatchObject({ ok: false, code: "unknown" });
      expect(readRaw(KEYS.draft)).toBeNull();
    });

    it("survives a listener that throws", () => {
      store.quota = 0;
      const good = vi.fn();
      const offBad = onStorageError(() => {
        throw new Error("broken listener");
      });
      const offGood = onStorageError(good);
      expect(() => writeRaw(KEYS.draft, "x")).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
      offBad();
      offGood();
    });
  });

  describe("changes from other tabs", () => {
    it("reports changes to this app's keys only, without the prefix", () => {
      const seen = [];
      const off = onStorageChange((change) => seen.push(change));
      expect(fakeWindow.listenerCount("storage")).toBe(1);

      fakeWindow.dispatch("storage", { key: "ewb:v1:templates", newValue: "new", oldValue: "old", storageArea: store });
      fakeWindow.dispatch("storage", { key: "unrelated", newValue: "1", oldValue: null, storageArea: store });
      fakeWindow.dispatch("storage", { key: "ewb:v1:draft", newValue: "x", oldValue: null, storageArea: {} }); // sessionStorage
      fakeWindow.dispatch("storage", { key: null, newValue: null, oldValue: null, storageArea: store }); // clear()

      expect(seen).toEqual([
        { name: "templates", newValue: "new", oldValue: "old" },
        { name: null, newValue: null, oldValue: null },
      ]);

      off();
      expect(fakeWindow.listenerCount("storage")).toBe(0);
      fakeWindow.dispatch("storage", { key: "ewb:v1:templates", newValue: "newer", oldValue: "new", storageArea: store });
      expect(seen).toHaveLength(2);
    });

    it("is a no-op without a window", () => {
      delete globalThis.window;
      const off = onStorageChange(() => {});
      expect(() => off()).not.toThrow();
    });
  });
});
