import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "ewb:v1:history";

function fakeStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

/** A window with localStorage and a working "storage" event, like a second tab would trigger. */
function fakeWindow() {
  const handlers = new Set();
  const localStorage = fakeStorage();
  return {
    localStorage,
    addEventListener: (type, handler) => type === "storage" && handlers.add(handler),
    removeEventListener: (type, handler) => handlers.delete(handler),
    listenerCount: () => handlers.size,
    /** Simulate another tab writing `value` (null removes, key null clears everything). */
    otherTab(key, value) {
      const oldValue = key ? localStorage.getItem(key) : null;
      if (key === null) localStorage.clear();
      else if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      for (const handler of handlers) handler({ key, newValue: value, oldValue, storageArea: localStorage });
    },
  };
}

function entry(id, at = "2026-11-10T10:00:00.000Z") {
  return { id, at, kind: "file", templateName: "T", fileName: "f.xlsx", outputs: [] };
}

describe("run history across tabs", () => {
  let history;
  let win;

  beforeEach(async () => {
    vi.resetModules();
    win = fakeWindow();
    globalThis.window = win;
    history = await import("@/lib/history");
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("refreshes the snapshot and notifies when another tab changes the log", () => {
    const listener = vi.fn();
    const unsubscribe = history.subscribeHistory(listener);
    const before = history.getHistorySnapshot();
    expect(before).toEqual([]);

    win.otherTab(KEY, JSON.stringify([entry("a")]));
    expect(listener).toHaveBeenCalledTimes(1);
    const after = history.getHistorySnapshot();
    expect(after).not.toBe(before);
    expect(after.map((item) => item.id)).toEqual(["a"]);
    // Stable until the next change.
    expect(history.getHistorySnapshot()).toBe(after);

    win.otherTab("ewb:v1:templates", "[]");
    expect(listener).toHaveBeenCalledTimes(1);

    win.otherTab(null, null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(history.getHistorySnapshot()).toEqual([]);

    unsubscribe();
    expect(win.listenerCount()).toBe(0);
  });

  it("listens to storage only while subscribed and re-reads after the last unsubscribe", () => {
    const unsubscribeA = history.subscribeHistory(() => {});
    const unsubscribeB = history.subscribeHistory(() => {});
    expect(win.listenerCount()).toBe(1);
    unsubscribeA();
    expect(win.listenerCount()).toBe(1);
    unsubscribeB();
    expect(win.listenerCount()).toBe(0);

    // A change nobody heard is still picked up by the next read.
    win.localStorage.setItem(KEY, JSON.stringify([entry("late")]));
    expect(history.getHistorySnapshot().map((item) => item.id)).toEqual(["late"]);
  });

  it("never overwrites runs that another tab logged", () => {
    expect(history.getHistorySnapshot()).toEqual([]);
    // Another tab logs a run while this tab is not subscribed (no storage event reaches it).
    win.localStorage.setItem(KEY, JSON.stringify([entry("other")]));
    history.logRun({ kind: "zip", fileName: "mine.xlsx" });
    const ids = JSON.parse(win.localStorage.getItem(KEY)).map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe("other");

    history.removeHistoryEntry("other");
    expect(JSON.parse(win.localStorage.getItem(KEY))).toHaveLength(1);
    expect(history.getHistorySnapshot()).toHaveLength(1);
  });

  it("ignores corrupt values and keeps the snapshot stable when nothing changes", () => {
    win.localStorage.setItem(KEY, "{not json");
    const listener = vi.fn();
    const unsubscribe = history.subscribeHistory(listener);
    const snapshot = history.getHistorySnapshot();
    expect(snapshot).toEqual([]);
    history.removeHistoryEntry("missing");
    expect(listener).not.toHaveBeenCalled();
    expect(history.getHistorySnapshot()).toBe(snapshot);
    unsubscribe();
  });
});
