import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchColumns } from "@/lib/schema";

const KEY = "ewb:v1:aliases";

/** In-memory localStorage with an optional size limit (characters, keys + values). */
class FakeStorage {
  constructor({ quota = Infinity } = {}) {
    this.map = new Map();
    this.quota = quota;
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    const text = String(value);
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + text.length > this.quota) {
      throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError", code: 22 });
    }
    this.map.set(key, text);
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

function installWindow(localStorage) {
  const handlers = new Map();
  globalThis.window = {
    localStorage,
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener: (type, handler) => handlers.get(type)?.delete(handler),
    dispatch: (type, event) => [...(handlers.get(type) || [])].forEach((handler) => handler(event)),
    listenerCount: (type) => handlers.get(type)?.size || 0,
  };
  return globalThis.window;
}

describe("lib/aliases", () => {
  let store;
  let aliases;

  beforeEach(async () => {
    store = new FakeStorage();
    installWindow(store);
    vi.resetModules(); // the module keeps a snapshot: start every test from a fresh copy
    aliases = await import("@/lib/aliases");
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("starts empty and saves a pair under the namespaced key", () => {
    expect(aliases.loadAliases()).toEqual([]);
    const result = aliases.saveAlias("  Cust   Name ", "Customer");
    expect(result).toEqual({ ok: true, aliases: [{ from: "Cust Name", to: "Customer" }] });
    expect(JSON.parse(store.getItem(KEY))).toEqual([{ from: "Cust Name", to: "Customer" }]);
    expect(aliases.loadAliases()).toEqual([{ from: "Cust Name", to: "Customer" }]);
  });

  it("treats a pair as the same alias in either direction and in any case", () => {
    aliases.saveAlias("Cust Name", "Customer");
    const again = aliases.saveAlias("customer", "CUST NAME");
    expect(again.ok).toBe(true);
    expect(again.existed).toBe(true);
    expect(aliases.loadAliases()).toHaveLength(1);
    expect(aliases.isSameAlias({ from: "Cust Name", to: "Customer" }, "CUSTOMER", "cust  name")).toBe(true);
    expect(aliases.isSameAlias({ from: "Cust Name", to: "Customer" }, "Customer", "Client")).toBe(false);
  });

  it("refuses empty names, the same name twice and too long a list, without writing", () => {
    expect(aliases.saveAlias("", "Customer")).toMatchObject({ ok: false, code: "invalid" });
    expect(aliases.saveAlias("Region", "  ")).toMatchObject({ ok: false, code: "invalid" });
    expect(aliases.saveAlias("Region", " region ")).toMatchObject({ ok: false, code: "invalid" });
    expect(store.getItem(KEY)).toBeNull();

    const full = Array.from({ length: aliases.MAX_ALIASES }, (_, i) => ({ from: `A${i}`, to: `B${i}` }));
    store.setItem(KEY, JSON.stringify(full));
    expect(aliases.saveAlias("One more", "Another")).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.parse(store.getItem(KEY))).toHaveLength(aliases.MAX_ALIASES);
  });

  it("caps very long names", () => {
    const long = "x".repeat(500);
    aliases.saveAlias(long, "Short");
    expect(aliases.loadAliases()[0].from).toHaveLength(aliases.ALIAS_MAX_LENGTH);
  });

  it("removes a pair in either direction", () => {
    aliases.saveAlias("Cust Name", "Customer");
    aliases.saveAlias("Qty", "Quantity");
    expect(aliases.removeAlias("customer", "cust name")).toEqual({ ok: true, aliases: [{ from: "Qty", to: "Quantity" }] });
    expect(aliases.loadAliases()).toEqual([{ from: "Qty", to: "Quantity" }]);
    // removing something that is not there changes nothing
    expect(aliases.removeAlias("Nope", "Nothing")).toEqual({ ok: true, aliases: [{ from: "Qty", to: "Quantity" }] });
  });

  it("cleans junk and duplicates out of the stored list", () => {
    store.setItem(
      KEY,
      JSON.stringify([
        { from: "A", to: "B" },
        { from: "b", to: "a" },
        { from: "A", to: "a" },
        { from: "", to: "C" },
        { from: 1, to: "D" },
        null,
        "text",
        { from: " E ", to: " F " },
      ]),
    );
    expect(aliases.loadAliases()).toEqual([
      { from: "A", to: "B" },
      { from: "E", to: "F" },
    ]);
    store.setItem(KEY, "{not json");
    expect(aliases.loadAliases()).toEqual([]);
    store.setItem(KEY, JSON.stringify({ from: "A", to: "B" }));
    expect(aliases.loadAliases()).toEqual([]);
  });

  it("reports a full storage and keeps the stored list unchanged", () => {
    aliases.saveAlias("Cust Name", "Customer");
    store.quota = store.getItem(KEY).length + KEY.length + 5;
    const result = aliases.saveAlias("Quantity of items", "Qty");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("quota");
    expect(result.error).toMatch(/full/i);
    expect(result.aliases).toEqual([{ from: "Cust Name", to: "Customer" }]);
    expect(aliases.loadAliases()).toEqual([{ from: "Cust Name", to: "Customer" }]);
    expect(aliases.getAliasesSnapshot()).toEqual([{ from: "Cust Name", to: "Customer" }]);
  });

  it("reports missing storage instead of pretending", () => {
    delete globalThis.window;
    expect(aliases.loadAliases()).toEqual([]);
    expect(aliases.saveAlias("A", "B")).toMatchObject({ ok: false, code: "unavailable" });
  });

  describe("snapshot for useSyncExternalStore", () => {
    it("is stable between changes and follows saves and removes", () => {
      const first = aliases.getAliasesSnapshot();
      expect(aliases.getAliasesSnapshot()).toBe(first);
      let calls = 0;
      const unsubscribe = aliases.subscribeAliases(() => {
        calls += 1;
      });
      aliases.saveAlias("A", "B");
      const second = aliases.getAliasesSnapshot();
      expect(second).not.toBe(first);
      expect(second).toEqual([{ from: "A", to: "B" }]);
      expect(aliases.getAliasesSnapshot()).toBe(second);
      aliases.saveAlias("b", "a"); // already there: no change, no notification
      aliases.removeAlias("A", "B");
      expect(aliases.getAliasesSnapshot()).toEqual([]);
      expect(calls).toBe(2);
      unsubscribe();
      expect(aliases.getServerAliasesSnapshot()).toEqual([]);
    });

    it("re-reads after another tab changes the aliases, and stops listening when nobody subscribes", () => {
      const fakeWindow = globalThis.window;
      expect(aliases.getAliasesSnapshot()).toEqual([]);
      let calls = 0;
      const unsubscribe = aliases.subscribeAliases(() => {
        calls += 1;
      });
      expect(fakeWindow.listenerCount("storage")).toBe(1);
      store.setItem(KEY, JSON.stringify([{ from: "X", to: "Y" }]));
      fakeWindow.dispatch("storage", { key: "ewb:v1:templates", storageArea: store });
      expect(calls).toBe(0);
      fakeWindow.dispatch("storage", { key: KEY, storageArea: store, newValue: "[]" });
      expect(calls).toBe(1);
      expect(aliases.getAliasesSnapshot()).toEqual([{ from: "X", to: "Y" }]);
      unsubscribe();
      expect(fakeWindow.listenerCount("storage")).toBe(0);
    });
  });

  it("feeds matchColumns, which uses a pair in both directions", () => {
    aliases.saveAlias("Cust Name", "Customer");
    const saved = aliases.loadAliases();
    expect(matchColumns(["Cust Name"], ["customer"], saved)).toMatchObject({ map: { "Cust Name": "customer" }, missing: [] });
    expect(matchColumns(["Customer"], ["CUST NAME"], saved)).toMatchObject({ map: { Customer: "CUST NAME" }, missing: [] });
    expect(matchColumns(["Client"], ["Customer"], saved).missing).toEqual(["Client"]);
  });
});
